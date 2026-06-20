import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Between, Repository } from "typeorm";
import { DateTime } from "luxon";
import { VentasService } from "../ventas/ventas.service";
import { Baja, Capital, MovimientoCapital, TipoMovimiento } from "./capital.entities";
import { invalidateCache } from "../common/memoryCache";
import { INVENTARIO_CACHE_KEY } from "../productos/productos.service";

export interface DarBajaDto {
  variantId: string;
  itemId?: string;
  itemName: string;
  cantidad: number;
  partePagada?: number;
  costoUnitario?: number;
  motivo: string;
}

export interface DarEntradaDto {
  variantId: string;
  itemId: string;
  itemName: string;
  cantidad: number;
  nuevoCosto: number;
  nuevoPrecio: number;
}

export interface TransformarDto {
  variantXId: string;
  variantYId: string;
  cantidad: number; // unidades de X que se consumen (N)
  cantidadDestino: number; // unidades de Y que se producen (M)
  itemXName?: string;
  itemYName?: string;
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

  // GET /capital/bajas?mes=YYYY-MM → bajas del mes + valor total (al costo).
  async getBajas(mes?: string) {
    const base = mes
      ? DateTime.fromFormat(mes, "yyyy-MM", { zone: this.ZONE })
      : DateTime.now().setZone(this.ZONE);

    if (!base.isValid) {
      throw new BadRequestException("Mes inválido (use el formato YYYY-MM)");
    }

    const inicio = base.startOf("month").toUTC().toJSDate();
    const fin = base.endOf("month").toUTC().toJSDate();

    const bajas = await this.bajaRepo.find({
      where: { fecha: Between(inicio, fin) },
      order: { fecha: "DESC" },
    });

    // El dinero que representa una baja es su COSTO (costo × cantidad), no el precio.
    const totalCosto = bajas.reduce(
      (s, b) => s + b.costoUnitario * b.cantidad,
      0
    );
    const totalPartePagada = bajas.reduce((s, b) => s + b.partePagada, 0);

    return {
      mes: base.toFormat("yyyy-MM"),
      totalCosto,
      totalPartePagada,
      totalNeto: totalCosto - totalPartePagada,
      cantidadBajas: bajas.length,
      bajas,
    };
  }

  // GET /capital/extracciones?desde&hasta → extracciones de caja en el rango.
  // Sirve para mostrar en el resumen cuánto efectivo salió de la caja (y por tanto
  // cuánto debería haber realmente vs lo que reportan las ventas).
  async getExtracciones(desdeStr?: string, hastaStr?: string) {
    const now = DateTime.now().setZone(this.ZONE);
    const inicio = (
      desdeStr ? DateTime.fromISO(desdeStr) : now.startOf("day")
    ).toJSDate();
    const fin = (
      hastaStr ? DateTime.fromISO(hastaStr) : now.endOf("day")
    ).toJSDate();

    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) {
      throw new BadRequestException("Rango de fechas inválido");
    }

    const movimientos = await this.movimientoRepo.find({
      where: { tipo: "EXTRACCION", fecha: Between(inicio, fin) },
      order: { fecha: "DESC" },
    });

    const total = movimientos.reduce((s, m) => s + m.monto, 0);

    return { total, cantidad: movimientos.length, movimientos };
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

    // Lo que SALE del negocio en el día (va a personas o al banco). La reinversión
    // y el costo de la mercancía NO se restan: ese dinero se queda en la caja para
    // reponer, así que sigue siendo capital disponible.
    const salidas =
      d.pagoTrabajadores +
      d.pagoImpuestos +
      d.gastosExtras +
      d.estimulo +
      d.limpieza +
      d.jefes.total +
      ventas.descuentoFiscal;

    // Lo retenido del día que se queda como capital disponible.
    const retenido = ventas.ventaNeta - salidas;

    // Si durante el día ya se extrajo dinero de la caja hacia el capital, eso ya
    // se sumó; lo restamos del cierre para no contarlo dos veces.
    const inicioDia = dia.startOf("day").toUTC().toJSDate();
    const finDia = dia.endOf("day").toUTC().toJSDate();
    const extraccionesHoy = await this.movimientoRepo.find({
      where: { tipo: "EXTRACCION", fecha: Between(inicioDia, finDia) },
    });
    const totalExtraido = extraccionesHoy.reduce((s, m) => s + m.monto, 0);

    const delta = retenido - totalExtraido;

    const { saldo, movimiento } = await this.aplicarMovimiento(
      "CIERRE",
      delta,
      `Cierre del día ${fecha}`,
      {
        fecha,
        ventaNeta: ventas.ventaNeta,
        salidas,
        retenido,
        extraido: totalExtraido,
        recibosProcesados: ventas.recibosProcesados,
      }
    );

    return { monto: saldo, delta, fecha, movimiento };
  }

  // POST /capital/extraccion → saca dinero de la caja hacia el capital disponible
  // (para comprar). Se registra y el cierre del día lo descuenta.
  async registrarExtraccion(monto: number, descripcion?: string) {
    const m = Number(monto);
    if (!Number.isFinite(m) || m <= 0) {
      throw new BadRequestException("El monto debe ser mayor que 0");
    }
    const { saldo, movimiento } = await this.aplicarMovimiento(
      "EXTRACCION",
      m,
      descripcion ?? "Extracción de caja",
      { fecha: DateTime.now().setZone(this.ZONE).toFormat("yyyy-MM-dd") }
    );
    return { monto: saldo, movimiento };
  }

  // POST /capital/inyeccion → mete dinero externo al capital disponible.
  async registrarInyeccion(monto: number, descripcion?: string) {
    const m = Number(monto);
    if (!Number.isFinite(m) || m <= 0) {
      throw new BadRequestException("El monto debe ser mayor que 0");
    }
    const { saldo, movimiento } = await this.aplicarMovimiento(
      "INYECCION",
      m,
      descripcion ?? "Inyección de capital"
    );
    return { monto: saldo, movimiento };
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

  // POST /capital/entrada → suma stock en Loyverse, actualiza costo/precio del
  // producto y resta del capital el costo de lo que entró (costo × cantidad).
  async darEntrada(dto: DarEntradaDto) {
    const cantidad = Number(dto.cantidad);
    const nuevoCosto = Number(dto.nuevoCosto);
    const nuevoPrecio = Number(dto.nuevoPrecio);

    if (!dto.variantId || !dto.itemId) {
      throw new BadRequestException("Falta el producto");
    }
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      throw new BadRequestException("La cantidad debe ser mayor que 0");
    }
    if (!Number.isFinite(nuevoCosto) || nuevoCosto < 0) {
      throw new BadRequestException("El costo no es válido");
    }
    if (!Number.isFinite(nuevoPrecio) || nuevoPrecio < 0) {
      throw new BadRequestException("El precio no es válido");
    }

    const stockAntes = await this.getStockActual(dto.variantId);
    if (stockAntes === null) {
      throw new BadRequestException(
        "No se encontró el inventario del producto en Loyverse"
      );
    }
    const stockDespues = stockAntes + cantidad;

    // 1) Actualizar costo y precio del producto (si falla, no tocamos nada más).
    await this.actualizarItemLoyverse(
      dto.itemId,
      dto.variantId,
      nuevoCosto,
      nuevoPrecio
    );

    // 2) Sumar el stock.
    await this.actualizarStockLoyverse(dto.variantId, stockDespues);

    // 3) Restar del capital el costo de la mercancía que entró.
    const costoEntrada = nuevoCosto * cantidad;
    const { saldo } = await this.aplicarMovimiento(
      "COMPRA",
      -costoEntrada,
      `Entrada de ${cantidad} × ${dto.itemName}`,
      {
        variantId: dto.variantId,
        cantidad,
        nuevoCosto,
        nuevoPrecio,
        costoEntrada,
      }
    );

    return { monto: saldo, stockAntes, stockDespues, costoEntrada };
  }

  // Actualiza el costo y el precio (de esta tienda) de un producto en Loyverse.
  // Lee el item completo, modifica solo lo necesario y lo devuelve entero para
  // no borrar otros datos ni afectar la otra tienda.
  private async actualizarItemLoyverse(
    itemId: string,
    variantId: string,
    nuevoCosto: number,
    nuevoPrecio: number
  ) {
    const getRes = await fetch(`${this.LOYVERSE_BASE}/items/${itemId}`, {
      headers: {
        Authorization: `Bearer ${this.loyverseToken}`,
        "Content-Type": "application/json",
      },
    });
    if (!getRes.ok) {
      const body: any = await getRes.json().catch(() => ({}));
      throw new InternalServerErrorException(
        body.errors?.[0]?.details || "No se encontró el producto en Loyverse"
      );
    }
    const item: any = await getRes.json();

    const stripReadOnly = (o: any) => {
      delete o.created_at;
      delete o.updated_at;
      delete o.deleted_at;
      delete o.source;
    };
    stripReadOnly(item);
    for (const v of item.variants ?? []) {
      stripReadOnly(v);
      for (const s of v.stores ?? []) stripReadOnly(s);
      if (v.variant_id === variantId) {
        v.cost = nuevoCosto;
        v.default_price = nuevoPrecio;
        for (const s of v.stores ?? []) {
          if (s.store_id === this.storeId) s.price = nuevoPrecio;
        }
      }
    }

    const res = await fetch(`${this.LOYVERSE_BASE}/items`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.loyverseToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(item),
    });
    if (!res.ok) {
      const body: any = await res.json().catch(() => ({}));
      console.error("Error actualizando producto en Loyverse:", body);
      throw new InternalServerErrorException(
        body.errors?.[0]?.details ||
          "No se pudo actualizar el costo/precio en Loyverse"
      );
    }
    return res.json();
  }

  // POST /capital/transformacion → convierte N unidades del producto X en M del
  // producto Y (X baja N, Y sube M). Ej: 1 blíster → 18 huevos sueltos.
  // Solo mueve stock, no toca el capital.
  async transformarProducto(dto: TransformarDto) {
    const cantidad = Number(dto.cantidad);
    const cantidadDestino = Number(dto.cantidadDestino);
    if (!dto.variantXId || !dto.variantYId) {
      throw new BadRequestException("Faltan productos");
    }
    if (dto.variantXId === dto.variantYId) {
      throw new BadRequestException("Elige dos productos distintos");
    }
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      throw new BadRequestException("La cantidad a transformar debe ser mayor que 0");
    }
    if (!Number.isFinite(cantidadDestino) || cantidadDestino <= 0) {
      throw new BadRequestException("La cantidad resultante debe ser mayor que 0");
    }

    const [stockX, stockY] = await Promise.all([
      this.getStockActual(dto.variantXId),
      this.getStockActual(dto.variantYId),
    ]);
    if (stockX === null || stockY === null) {
      throw new BadRequestException(
        "No se encontró el inventario de alguno de los productos"
      );
    }
    if (cantidad > stockX) {
      throw new BadRequestException(
        `Solo hay ${stockX} de ${dto.itemXName ?? "ese producto"} en stock`
      );
    }

    await this.actualizarStockLoyverse(dto.variantXId, stockX - cantidad);
    await this.actualizarStockLoyverse(dto.variantYId, stockY + cantidadDestino);

    return {
      ok: true,
      x: { antes: stockX, despues: stockX - cantidad },
      y: { antes: stockY, despues: stockY + cantidadDestino },
    };
  }

  // Lee el stock actual de una variante en la tienda, paginando el inventario.
  private async getStockActual(variantId: string): Promise<number | null> {
    let cursor: string | null = null;
    try {
      do {
        const qp = new URLSearchParams({
          store_id: this.storeId,
          // Pedimos SOLO este producto. Si Loyverse respeta el filtro, vuelve en
          // la primera página (sin recorrer todo el inventario); si lo ignora,
          // el bucle sigue funcionando igual que antes (sin regresión).
          variant_ids: variantId,
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

    // El inventario cacheado quedó obsoleto: forzamos que se relea la próxima vez.
    invalidateCache(INVENTARIO_CACHE_KEY);

    return res.json();
  }
}
