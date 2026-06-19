import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { DateTime } from "luxon";
import { VentasService } from "../ventas/ventas.service";
import { Baja, Capital, MovimientoCapital, TipoMovimiento } from "./capital.entities";

export interface DarBajaDto {
  variantId: string;
  itemId?: string;
  itemName: string;
  cantidad: number;
  partePagada?: number;
  costoUnitario?: number;
  motivo: string;
}

@Injectable()
export class CapitalService {
  private readonly LOYVERSE_BASE = "https://api.loyverse.com/v1.0";
  private readonly loyverseToken: string;
  private readonly storeId: string;
  private readonly ZONE = "America/Havana";

  constructor(
    @InjectRepository(Capital)
    private readonly capitalRepo: Repository<Capital>,
    @InjectRepository(MovimientoCapital)
    private readonly movimientoRepo: Repository<MovimientoCapital>,
    @InjectRepository(Baja)
    private readonly bajaRepo: Repository<Baja>,
    private readonly ventasService: VentasService,
    private readonly configService: ConfigService
  ) {
    this.loyverseToken = this.configService.get<string>("LOYVERSE_TOKEN");
    this.storeId = this.configService.get<string>("STORE_ID");
  }

  // Garantiza que exista la fila singleton del capital.
  private async getOrCreateCapital(): Promise<Capital> {
    const [existente] = await this.capitalRepo.find({
      order: { id: "ASC" },
      take: 1,
    });
    if (existente) return existente;
    return this.capitalRepo.save(this.capitalRepo.create({ monto: 0 }));
  }

  // Aplica un cambio al capital y deja registro en el historial.
  private async aplicarMovimiento(
    tipo: TipoMovimiento,
    delta: number,
    descripcion: string,
    metadata?: Record<string, any>
  ): Promise<{ saldo: number; movimiento: MovimientoCapital }> {
    const capital = await this.getOrCreateCapital();
    const saldo = capital.monto + delta;
    capital.monto = saldo;
    await this.capitalRepo.save(capital);

    const movimiento = await this.movimientoRepo.save(
      this.movimientoRepo.create({
        tipo,
        monto: delta,
        saldoResultante: saldo,
        descripcion,
        metadata: metadata ?? null,
      })
    );

    return { saldo, movimiento };
  }

  // GET /capital → monto actual + últimos movimientos.
  async getCapital() {
    const capital = await this.getOrCreateCapital();
    const movimientos = await this.movimientoRepo.find({
      order: { fecha: "DESC" },
      take: 30,
    });
    return {
      monto: capital.monto,
      actualizadoEn: capital.actualizadoEn,
      movimientos,
    };
  }

  // PUT /capital → fijar el valor absoluto (lo usas en cada conteo físico).
  async setConteo(monto: number, descripcion?: string) {
    if (typeof monto !== "number" || Number.isNaN(monto)) {
      throw new BadRequestException("El monto del conteo no es válido");
    }
    const capital = await this.getOrCreateCapital();
    const delta = monto - capital.monto;
    const { saldo } = await this.aplicarMovimiento(
      "CONTEO",
      delta,
      descripcion ?? "Conteo manual de capital",
      { montoFijado: monto }
    );
    return { monto: saldo };
  }

  // POST /capital/cierre → suma al capital la venta neta del día menos el reparto.
  async registrarCierre(fechaStr?: string) {
    const dia = fechaStr
      ? DateTime.fromISO(fechaStr, { zone: this.ZONE })
      : DateTime.now().setZone(this.ZONE);

    if (!dia.isValid) {
      throw new BadRequestException("Fecha de cierre inválida");
    }

    const fecha = dia.toFormat("yyyy-MM-dd");

    // Evitar registrar dos veces el cierre del mismo día.
    const yaExiste = await this.movimientoRepo
      .createQueryBuilder("m")
      .where("m.tipo = :tipo", { tipo: "CIERRE" })
      .andWhere("m.metadata ->> 'fecha' = :fecha", { fecha })
      .getOne();
    if (yaExiste) {
      throw new BadRequestException(
        `El cierre del día ${fecha} ya fue registrado`
      );
    }

    const desde = dia.startOf("day").toUTC().toISO();
    const hasta = dia.endOf("day").toUTC().toISO();

    const ventas = await this.ventasService.obtenerVentasPorRango(desde, hasta);
    const d = ventas.distribucion;

    const reparto =
      d.pagoTrabajadores +
      d.pagoImpuestos +
      d.gastosExtras +
      d.reinversion +
      d.estimulo +
      d.limpieza +
      d.jefes.total;

    // El costo de la mercancía vendida queda líquido para reponer; la ganancia
    // se reparte. Por eso el capital sube en (venta neta − reparto).
    const delta = ventas.ventaNeta - reparto;

    const { saldo, movimiento } = await this.aplicarMovimiento(
      "CIERRE",
      delta,
      `Cierre del día ${fecha}`,
      {
        fecha,
        ventaNeta: ventas.ventaNeta,
        reparto,
        recibosProcesados: ventas.recibosProcesados,
      }
    );

    return { monto: saldo, delta, fecha, movimiento };
  }

  // POST /capital/baja → rebaja stock en Loyverse, registra la baja y suma la
  // parte pagada al capital disponible.
  async darBaja(dto: DarBajaDto) {
    const cantidad = Number(dto.cantidad);
    const partePagada = Number(dto.partePagada ?? 0);

    if (!dto.variantId) {
      throw new BadRequestException("Falta el producto (variantId)");
    }
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      throw new BadRequestException("La cantidad debe ser mayor que 0");
    }
    if (!Number.isFinite(partePagada) || partePagada < 0) {
      throw new BadRequestException("La parte pagada no es válida");
    }
    if (!dto.motivo) {
      throw new BadRequestException("Falta el motivo de la baja");
    }

    const stockAntes = await this.getStockActual(dto.variantId);
    if (stockAntes === null) {
      throw new BadRequestException(
        "No se encontró el inventario del producto en Loyverse"
      );
    }
    if (cantidad > stockAntes) {
      throw new BadRequestException(
        `No puedes dar baja ${cantidad} unidades: solo hay ${stockAntes} en stock`
      );
    }

    const stockDespues = stockAntes - cantidad;

    await this.actualizarStockLoyverse(dto.variantId, stockDespues);

    const baja = await this.bajaRepo.save(
      this.bajaRepo.create({
        variantId: dto.variantId,
        itemId: dto.itemId ?? null,
        itemName: dto.itemName,
        cantidad,
        costoUnitario: Number(dto.costoUnitario ?? 0),
        stockAntes,
        stockDespues,
        partePagada,
        motivo: dto.motivo,
      })
    );

    // Solo la parte pagada entra como dinero al capital.
    let saldo = (await this.getOrCreateCapital()).monto;
    if (partePagada > 0) {
      const res = await this.aplicarMovimiento(
        "BAJA",
        partePagada,
        `Baja de ${cantidad} × ${dto.itemName} (${dto.motivo})`,
        {
          bajaId: baja.id,
          variantId: dto.variantId,
          cantidad,
          motivo: dto.motivo,
        }
      );
      saldo = res.saldo;
    }

    return { baja, monto: saldo, stockAntes, stockDespues };
  }

  // Lee el stock actual de una variante en la tienda, paginando el inventario.
  private async getStockActual(variantId: string): Promise<number | null> {
    let cursor: string | null = null;
    try {
      do {
        const qp = new URLSearchParams({
          store_id: this.storeId,
          limit: "250",
        });
        if (cursor) qp.set("cursor", cursor);

        const res = await fetch(`${this.LOYVERSE_BASE}/inventory?${qp}`, {
          headers: {
            Authorization: `Bearer ${this.loyverseToken}`,
            "Content-Type": "application/json",
          },
        });
        if (!res.ok) {
          const body: any = await res.json().catch(() => ({}));
          throw new InternalServerErrorException(
            body.errors?.[0]?.details || "Error leyendo inventario de Loyverse"
          );
        }
        const data: any = await res.json();
        const nivel = (data.inventory_levels ?? []).find(
          (l: any) => l.variant_id === variantId && l.store_id === this.storeId
        );
        if (nivel) return nivel.in_stock ?? 0;
        cursor = data.cursor ?? null;
      } while (cursor);
      return null;
    } catch (error) {
      if (error instanceof InternalServerErrorException) throw error;
      console.error("Error leyendo stock de Loyverse:", error);
      throw new InternalServerErrorException(
        "No se pudo leer el inventario de Loyverse"
      );
    }
  }

  // Escribe el nuevo stock absoluto de una variante en Loyverse.
  private async actualizarStockLoyverse(variantId: string, stockAfter: number) {
    const res = await fetch(`${this.LOYVERSE_BASE}/inventory`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.loyverseToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inventory_levels: [
          {
            variant_id: variantId,
            store_id: this.storeId,
            stock_after: stockAfter,
          },
        ],
      }),
    });

    if (!res.ok) {
      const body: any = await res.json().catch(() => ({}));
      console.error("Error actualizando stock en Loyverse:", body);
      throw new InternalServerErrorException(
        body.errors?.[0]?.details || "No se pudo actualizar el stock en Loyverse"
      );
    }
    return res.json();
  }
}
