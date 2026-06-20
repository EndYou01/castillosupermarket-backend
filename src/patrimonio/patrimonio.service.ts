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
  private readonly CAMBIOCUBA_URL =
    "https://api.cambiocuba.money/api/v1/x-rates-by-date-range?cur=USD&trmi=true";

  constructor(
    @InjectRepository(Capital)
    private readonly capitalRepo: Repository<Capital>,
    @InjectRepository(PatrimonioSnapshot)
    private readonly snapshotRepo: Repository<PatrimonioSnapshot>,
    private readonly productosService: ProductosService,
    private readonly configService: ConfigService
  ) {}

  // Tasa del dólar (CUP por USD). Intenta primero la API oficial de eltoque (si
  // hay token) y, si no, cae al mirror comunitario cambiocuba.money (sin token).
  // Devuelve null si ninguna responde.
  private async getTasaUSDLive(): Promise<number | null> {
    const token = this.configService.get<string>("EL_TOQUE_API_TOKEN");
    if (token) {
      const oficial = await this.fetchEltoqueOficial(token);
      if (oficial) return oficial;
    }
    return this.fetchCambioCubaMirror();
  }

  private async fetchEltoqueOficial(token: string): Promise<number | null> {
    try {
      const res = await fetch(this.ELTOQUE_URL, {
        headers: { accept: "*/*", Authorization: `Bearer ${token}` },
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

  // Mirror comunitario de la TRMI, sin token. Toma la mediana del día más
  // reciente (coincide con la tasa oficial de eltoque).
  private async fetchCambioCubaMirror(): Promise<number | null> {
    try {
      const res = await fetch(this.CAMBIOCUBA_URL, {
        headers: { accept: "application/json" },
      });
      if (!res.ok) {
        console.error("cambiocuba API error:", res.status);
        return null;
      }
      const data: any = await res.json();
      if (!Array.isArray(data) || data.length === 0) return null;
      const ultimo = data.reduce((a: any, b: any) => (a._id > b._id ? a : b));
      const val = ultimo?.median ?? ultimo?.avg;
      return typeof val === "number" && val > 0 ? val : null;
    } catch (error) {
      console.error("Error consultando cambiocuba.money:", error);
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

  // Guarda un registro del patrimonio actual (lo usa el cron y el botón manual).
  // Si el patrimonio en CUP bajó respecto al registro anterior, avisa por Telegram.
  async guardarSnapshot() {
    const [anterior] = await this.snapshotRepo.find({
      order: { fecha: "DESC" },
      take: 1,
    });

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

    // Avisar SOLO si el patrimonio (en CUP) bajó respecto al registro anterior.
    if (anterior && snap.totalCup < anterior.totalCup) {
      await this.enviarAlertaTelegram(anterior, snap);
    }

    return snap;
  }

  // Envía un aviso al canal de Telegram cuando el patrimonio baja.
  private async enviarAlertaTelegram(
    anterior: PatrimonioSnapshot,
    actual: PatrimonioSnapshot
  ) {
    const token = this.configService.get<string>("TELEGRAM_BOT_TOKEN");
    const chatId = this.configService.get<string>("TELEGRAM_CHANNEL_ID");
    if (!token || !chatId) return;

    const diff = actual.totalCup - anterior.totalCup; // negativo
    const texto =
      `⚠️ *El patrimonio de Castillo bajó*\n\n` +
      `Antes: ${Math.round(anterior.totalCup)} cup\n` +
      `Ahora: ${Math.round(actual.totalCup)} cup\n` +
      `Diferencia: ${Math.round(diff)} cup\n\n` +
      `(Capital ${Math.round(actual.capital)} + inventario ${Math.round(
        actual.inventario
      )})`;

    try {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: texto,
            parse_mode: "Markdown",
          }),
        }
      );
      if (!res.ok) {
        console.error("Error Telegram sendMessage:", res.status, await res.text());
      }
    } catch (error) {
      console.error("Error enviando alerta a Telegram:", error);
    }
  }

  // Historial de fotos para la tendencia (más reciente primero).
  async getHistorial(limit = 60) {
    return this.snapshotRepo.find({
      order: { fecha: "DESC" },
      take: limit,
    });
  }

  // Inflación del dólar (subida reciente de la TRMI), para recomendar precios.
  // Usa la serie diaria del mirror comunitario (varios días).
  async getInflacion() {
    let serie: { fecha: string; valor: number }[] = [];
    try {
      const res = await fetch(this.CAMBIOCUBA_URL, {
        headers: { accept: "application/json" },
      });
      if (res.ok) {
        const data: any = await res.json();
        if (Array.isArray(data)) {
          serie = data
            .map((x: any) => ({ fecha: x._id, valor: x.median ?? x.avg }))
            .filter((x: any) => typeof x.valor === "number" && x.valor > 0)
            .sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
        }
      }
    } catch (error) {
      console.error("Error consultando serie de cambiocuba:", error);
    }

    if (serie.length < 2) {
      return {
        tasaHoy: serie[0]?.valor ?? null,
        cambioPctDia: 0,
        cambioPctVentana: 0,
        diasVentana: 0,
      };
    }

    const primero = serie[0].valor;
    const ultimo = serie[serie.length - 1].valor;
    const dias = serie.length - 1;
    const cambioPctVentana = (ultimo - primero) / primero;
    // Crecimiento diario compuesto.
    const cambioPctDia = Math.pow(ultimo / primero, 1 / dias) - 1;

    return {
      tasaHoy: ultimo,
      cambioPctDia,
      cambioPctVentana,
      diasVentana: dias,
    };
  }
}
