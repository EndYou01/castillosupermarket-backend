import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Capital } from "../capital/capital.entities";
import { ProductosService } from "../productos/productos.service";
import { PatrimonioSnapshot } from "./patrimonio.entity";

@Injectable()
export class PatrimonioService {
  private readonly ELTOQUE_URL = "https://tasas.eltoque.com/v1/trmi";

  constructor(
    @InjectRepository(Capital)
    private readonly capitalRepo: Repository<Capital>,
    @InjectRepository(PatrimonioSnapshot)
    private readonly snapshotRepo: Repository<PatrimonioSnapshot>,
    private readonly productosService: ProductosService,
    private readonly configService: ConfigService
  ) {}

  // Tasa del dólar (CUP por USD) desde eltoque. Devuelve null si no hay token
  // o si la API falla (el llamador puede caer al último valor conocido).
  private async getTasaUSDLive(): Promise<number | null> {
    const token = this.configService.get<string>("EL_TOQUE_API_TOKEN");
    if (!token) return null;

    try {
      const res = await fetch(this.ELTOQUE_URL, {
        headers: {
          accept: "*/*",
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        console.error("eltoque API error:", res.status);
        return null;
      }
      const data: any = await res.json();
      const usd = data?.tasas?.USD;
      return typeof usd === "number" && usd > 0 ? usd : null;
    } catch (error) {
      console.error("Error consultando eltoque:", error);
      return null;
    }
  }

  private async getCapitalMonto(): Promise<number> {
    const [c] = await this.capitalRepo.find({ order: { id: "ASC" }, take: 1 });
    return c?.monto ?? 0;
  }

  // Patrimonio actual (en vivo): capital + inventario, en CUP y en USD.
  async getPatrimonio() {
    const [capital, inventarioResumen] = await Promise.all([
      this.getCapitalMonto(),
      this.productosService.getInventario(),
    ]);

    const inventario = inventarioResumen.totalInvertido;
    const totalCup = capital + inventario;

    let tasaUsd = await this.getTasaUSDLive();
    let tasaEsRespaldo = false;

    // Si la API de eltoque no respondió, usar la última tasa guardada.
    if (tasaUsd === null) {
      const [ultimo] = await this.snapshotRepo.find({
        where: {},
        order: { fecha: "DESC" },
        take: 1,
      });
      if (ultimo?.tasaUsd) {
        tasaUsd = ultimo.tasaUsd;
        tasaEsRespaldo = true;
      }
    }

    const totalUsd = tasaUsd ? totalCup / tasaUsd : null;

    return {
      capital,
      inventario,
      totalCup,
      tasaUsd,
      tasaEsRespaldo,
      totalUsd,
      fecha: new Date().toISOString(),
    };
  }

  // Guarda una foto del patrimonio actual (la usa el cron y el botón manual).
  async guardarSnapshot() {
    const p = await this.getPatrimonio();
    const snap = await this.snapshotRepo.save(
      this.snapshotRepo.create({
        capital: p.capital,
        inventario: p.inventario,
        totalCup: p.totalCup,
        tasaUsd: p.tasaUsd,
        totalUsd: p.totalUsd,
      })
    );
    return snap;
  }

  // Historial de fotos para la tendencia (más reciente primero).
  async getHistorial(limit = 60) {
    return this.snapshotRepo.find({
      order: { fecha: "DESC" },
      take: limit,
    });
  }
}
