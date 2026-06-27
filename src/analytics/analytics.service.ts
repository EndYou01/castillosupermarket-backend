import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DateTime } from "luxon";
import { IReceipt } from "src/interfaces/interfaces";
import { cached } from "../common/memoryCache";
import { ProductosService } from "../productos/productos.service";
import {
  IAnaliticaResponse,
  IAsistenteResponse,
  IComboItem,
  IMargenItem,
  IReposicionItem,
} from "./analytics.interfaces";

// Días de stock que queremos tener cubiertos al sugerir una compra.
const COBERTURA_OBJETIVO_DIAS = 14;
// Mínimo de recibos en común para considerar que dos productos "van juntos".
const MIN_RECIBOS_COMBO = 3;
// Margen por debajo del cual marcamos un producto como "bajo margen".
const UMBRAL_BAJO_MARGEN = 0.1; // 10%

@Injectable()
export class AnalyticsService {
  private readonly BASE_URL = "https://api.loyverse.com/v1.0/receipts";
  private readonly loyverseToken: string;
  private readonly store_id: string;
  private readonly geminiKey: string | undefined;
  private readonly geminiModel: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly productosService: ProductosService
  ) {
    this.loyverseToken = this.configService.get<string>("LOYVERSE_TOKEN");
    this.store_id = this.configService.get<string>("STORE_ID");
    this.geminiKey = this.configService.get<string>("GEMINI_API_KEY");
    this.geminiModel =
      this.configService.get<string>("GEMINI_MODEL") || "gemini-2.5-flash";
  }

  // Punto de entrada: análisis completo cacheado 5 min (los recibos del pasado
  // son inmutables; para "hoy" un retraso de minutos es aceptable).
  async getAnalitica(desde: string, hasta: string): Promise<IAnaliticaResponse> {
    return cached(`analytics:${desde}:${hasta}`, 300_000, () =>
      this.computeAnalitica(desde, hasta)
    );
  }

  private async computeAnalitica(
    desde: string,
    hasta: string
  ): Promise<IAnaliticaResponse> {
    const [recibos, inventario] = await Promise.all([
      this.fetchRecibos(desde, hasta),
      this.productosService.getInventario(),
    ]);

    const dias = this.contarDias(desde, hasta);

    // Mapa de inventario actual por variant_id (stock, costo, precio).
    const inv = new Map<
      string,
      { itemName: string; costo: number; precio: number; stock: number }
    >();
    for (const p of inventario.productosConInventario ?? []) {
      if (!p.variant_id) continue;
      inv.set(p.variant_id, {
        itemName: p.item_name,
        costo: p.cost ?? 0,
        precio: p.price ?? 0,
        stock: p.quantity ?? 0,
      });
    }

    // ---- Agregados de ventas por producto + co-ocurrencias (un solo pase) ----
    type Vendido = {
      itemName: string;
      unidades: number;
      ingresos: number;
      costoVendido: number;
    };
    const vendidos = new Map<string, Vendido>();

    // Para market basket: frecuencia por producto y por par.
    const frecItem = new Map<string, number>();
    const frecPar = new Map<string, number>();
    const nombrePorItem = new Map<string, string>();
    let recibosVenta = 0;

    for (const recibo of recibos) {
      if (recibo.receipt_type !== "SALE") continue; // ignora reembolsos
      recibosVenta++;

      const lineItems = recibo.line_items ?? [];
      const itemsDelRecibo = new Set<string>(); // item_id distintos del recibo

      for (const item of lineItems) {
        const variantId = item.variant_id;
        const qty = item.quantity ?? 0;
        if (variantId) {
          const acc =
            vendidos.get(variantId) ??
            { itemName: item.item_name, unidades: 0, ingresos: 0, costoVendido: 0 };
          acc.unidades += qty;
          acc.ingresos += item.total_money ?? 0;
          acc.costoVendido += (item.cost ?? 0) * qty;
          vendidos.set(variantId, acc);
        }

        // Para combos usamos el producto (item_id) para no duplicar variantes.
        const id = item.item_id ?? item.variant_id;
        if (id) {
          itemsDelRecibo.add(id);
          if (!nombrePorItem.has(id)) nombrePorItem.set(id, item.item_name);
        }
      }

      // Cuenta el producto una vez por recibo y cada par una vez.
      const ids = Array.from(itemsDelRecibo).sort();
      for (const id of ids) frecItem.set(id, (frecItem.get(id) ?? 0) + 1);
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const clave = `${ids[i]}|${ids[j]}`;
          frecPar.set(clave, (frecPar.get(clave) ?? 0) + 1);
        }
      }
    }

    return {
      rango: { desde, hasta, dias },
      recibosAnalizados: recibosVenta,
      coberturaObjetivoDias: COBERTURA_OBJETIVO_DIAS,
      reposicion: this.calcularReposicion(vendidos, inv, dias),
      margenes: this.calcularMargenes(vendidos, inv),
      combos: this.calcularCombos(
        frecItem,
        frecPar,
        nombrePorItem,
        recibosVenta
      ),
    };
  }

  // ---- 1) Reposición / predicción de quiebre de stock ----
  private calcularReposicion(
    vendidos: Map<string, { itemName: string; unidades: number }>,
    inv: Map<string, { itemName: string; costo: number; stock: number }>,
    dias: number
  ): IReposicionItem[] {
    const out: IReposicionItem[] = [];

    for (const [variantId, v] of vendidos) {
      if (v.unidades <= 0) continue;
      const datos = inv.get(variantId);
      const stock = datos?.stock ?? 0;
      const costo = datos?.costo ?? 0;
      const velocidadDia = v.unidades / dias;
      const diasParaAgotar =
        velocidadDia > 0 ? stock / velocidadDia : null;
      const sugerenciaCompra = Math.max(
        0,
        Math.ceil(velocidadDia * COBERTURA_OBJETIVO_DIAS - stock)
      );

      out.push({
        variantId,
        itemName: datos?.itemName ?? v.itemName,
        stock,
        vendidoEnRango: Math.round(v.unidades * 100) / 100,
        velocidadDia: Math.round(velocidadDia * 100) / 100,
        diasParaAgotar:
          diasParaAgotar === null
            ? null
            : Math.round(diasParaAgotar * 10) / 10,
        sugerenciaCompra,
        costo,
        agotado: stock <= 0,
      });
    }

    // Más urgente primero: agotados arriba, luego por días para agotar.
    out.sort((a, b) => {
      const da = a.diasParaAgotar ?? Infinity;
      const db = b.diasParaAgotar ?? Infinity;
      return da - db;
    });
    return out.slice(0, 50);
  }

  // ---- 2) Márgenes + clasificación ABC + capital parado ----
  private calcularMargenes(
    vendidos: Map<
      string,
      { itemName: string; unidades: number; ingresos: number; costoVendido: number }
    >,
    inv: Map<
      string,
      { itemName: string; costo: number; precio: number; stock: number }
    >
  ) {
    const items: IMargenItem[] = [];

    for (const [variantId, v] of vendidos) {
      if (v.unidades <= 0) continue;
      const datos = inv.get(variantId);
      const costo = datos?.costo ?? (v.costoVendido / v.unidades || 0);
      const precio = datos?.precio ?? (v.ingresos / v.unidades || 0);
      const margenPct = precio > 0 ? (precio - costo) / precio : 0;
      const ganancia = v.ingresos - v.costoVendido;

      items.push({
        variantId,
        itemName: datos?.itemName ?? v.itemName,
        costo,
        precio,
        margenPct: Math.round(margenPct * 1000) / 1000,
        unidadesVendidas: Math.round(v.unidades * 100) / 100,
        ingresos: Math.round(v.ingresos),
        ganancia: Math.round(ganancia),
        claseABC: "-",
        bajoMargen: precio <= costo || margenPct < UMBRAL_BAJO_MARGEN,
      });
    }

    // Clasificación ABC por contribución a la ganancia (regla 80/15/5).
    items.sort((a, b) => b.ganancia - a.ganancia);
    const totalGanancia = items.reduce((s, i) => s + Math.max(0, i.ganancia), 0);
    let acumulado = 0;
    for (const item of items) {
      acumulado += Math.max(0, item.ganancia);
      const pct = totalGanancia > 0 ? acumulado / totalGanancia : 1;
      item.claseABC = pct <= 0.8 ? "A" : pct <= 0.95 ? "B" : "C";
    }

    // Capital parado: en stock pero sin ventas en el rango.
    const capitalParado = [];
    for (const [variantId, datos] of inv) {
      if (datos.stock > 0 && !vendidos.has(variantId)) {
        capitalParado.push({
          variantId,
          itemName: datos.itemName,
          stock: datos.stock,
          costo: datos.costo,
          capitalInmovilizado: Math.round(datos.costo * datos.stock),
        });
      }
    }
    capitalParado.sort(
      (a, b) => b.capitalInmovilizado - a.capitalInmovilizado
    );
    const totalCapitalParado = capitalParado.reduce(
      (s, i) => s + i.capitalInmovilizado,
      0
    );

    return {
      items: items.slice(0, 100),
      capitalParado: capitalParado.slice(0, 30),
      totalCapitalParado,
    };
  }

  // ---- 3) Market Basket: pares que se compran juntos ----
  private calcularCombos(
    frecItem: Map<string, number>,
    frecPar: Map<string, number>,
    nombrePorItem: Map<string, string>,
    totalRecibos: number
  ): IComboItem[] {
    const combos: IComboItem[] = [];

    for (const [clave, veces] of frecPar) {
      if (veces < MIN_RECIBOS_COMBO) continue;
      const [a, b] = clave.split("|");
      const countA = frecItem.get(a) ?? 0;
      const countB = frecItem.get(b) ?? 0;
      if (countA === 0 || countB === 0 || totalRecibos === 0) continue;

      // Confianza: el sentido más fuerte (A→B o B→A).
      const confianza = Math.max(veces / countA, veces / countB);
      // Lift: qué tan por encima del azar aparecen juntos.
      const lift = (veces * totalRecibos) / (countA * countB);

      combos.push({
        itemA: nombrePorItem.get(a) ?? a,
        itemB: nombrePorItem.get(b) ?? b,
        veces,
        confianza: Math.round(confianza * 100) / 100,
        lift: Math.round(lift * 100) / 100,
      });
    }

    // Mejores relaciones primero (lift), desempate por frecuencia.
    combos.sort((x, y) => y.lift - x.lift || y.veces - x.veces);
    return combos.slice(0, 25);
  }

  // ---- Asistente IA (Gemini, capa gratuita). Explica los números en español. ----
  async asistente(
    desde: string,
    hasta: string,
    pregunta?: string
  ): Promise<IAsistenteResponse> {
    if (!this.geminiKey) {
      return {
        ok: false,
        mensaje:
          "Falta configurar la IA. Agrega GEMINI_API_KEY en el archivo .env del backend (clave gratis en aistudio.google.com).",
      };
    }

    const data = await this.getAnalitica(desde, hasta);
    const prompt = this.construirPrompt(data, pregunta);

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.geminiModel}:generateContent?key=${this.geminiKey}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 2048,
            // gemini-2.5-flash piensa por defecto y ese "pensamiento" consume
            // el presupuesto de tokens, dejando la respuesta a medias. Lo
            // desactivamos para que todo el presupuesto sea texto para el dueño.
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        console.error("Error Gemini:", body);
        return {
          ok: false,
          mensaje:
            "La IA no respondió. Revisa que la GEMINI_API_KEY sea válida e intenta de nuevo.",
        };
      }

      const json: any = await response.json();
      const candidato = json?.candidates?.[0];
      // Une todas las partes de texto (puede venir fragmentado en varias).
      const texto = (candidato?.content?.parts ?? [])
        .map((p: any) => p?.text ?? "")
        .join("")
        .trim();

      // Si Gemini cortó por límite de tokens, avísalo en vez de mostrar a medias.
      if (candidato?.finishReason === "MAX_TOKENS" && texto) {
        return { ok: true, mensaje: texto + "\n\n(Respuesta recortada.)" };
      }

      return {
        ok: !!texto,
        mensaje: texto || "La IA no devolvió texto. Intenta de nuevo.",
      };
    } catch (error) {
      console.error("Error llamando a Gemini:", error);
      return {
        ok: false,
        mensaje: "No se pudo conectar con la IA. Intenta de nuevo.",
      };
    }
  }

  // Arma el contexto en español con los números reales para que la IA no invente.
  private construirPrompt(data: IAnaliticaResponse, pregunta?: string): string {
    const urgentes = data.reposicion
      .filter((r) => r.agotado || (r.diasParaAgotar ?? 99) <= 7)
      .slice(0, 12)
      .map(
        (r) =>
          `- ${r.itemName}: stock ${r.stock}, vende ${r.velocidadDia}/día, ${
            r.agotado
              ? "AGOTADO (venta perdida)"
              : `se agota en ${r.diasParaAgotar} días`
          }, comprar ~${r.sugerenciaCompra}`
      )
      .join("\n");

    const estrellas = data.margenes.items
      .filter((m) => m.claseABC === "A")
      .slice(0, 8)
      .map(
        (m) =>
          `- ${m.itemName}: ganancia ${m.ganancia} cup, margen ${Math.round(
            m.margenPct * 100
          )}%`
      )
      .join("\n");

    const bajoMargen = data.margenes.items
      .filter((m) => m.bajoMargen)
      .slice(0, 8)
      .map(
        (m) =>
          `- ${m.itemName}: margen ${Math.round(m.margenPct * 100)}%${
            m.precio <= m.costo ? " (¡vende bajo costo!)" : ""
          }`
      )
      .join("\n");

    const combos = data.combos
      .slice(0, 8)
      .map(
        (c) =>
          `- ${c.itemA} + ${c.itemB}: juntos ${c.veces} veces (lift ${c.lift})`
      )
      .join("\n");

    return `Eres el analista de negocio de un supermercado en Cuba (moneda CUP). Habla en español claro y directo, para los dueños. Usa SOLO los datos de abajo, no inventes cifras. Da consejos accionables y concretos para ganar más dinero.

PERIODO: ${data.rango.dias} días, ${data.recibosAnalizados} ventas analizadas.

PRODUCTOS POR REPONER (urgentes):
${urgentes || "Ninguno urgente."}

PRODUCTOS ESTRELLA (clase A, los que más ganancia dejan):
${estrellas || "Sin datos."}

PRODUCTOS DE BAJO MARGEN (revisar precio):
${bajoMargen || "Ninguno."}

CAPITAL PARADO (stock que no se vende): ${data.margenes.totalCapitalParado} cup inmovilizados.

COMBOS (productos que se compran juntos → ideas de promoción):
${combos || "Sin combos relevantes."}

${
  pregunta
    ? `PREGUNTA DEL DUEÑO: ${pregunta}\nResponde la pregunta usando los datos.`
    : "Da un resumen ejecutivo de máximo 6 puntos: qué comprar ya, qué precios revisar, qué promociones armar y dónde se está perdiendo dinero."
}`;
  }

  // Trae todos los recibos del rango paginando (mismo patrón que VentasService).
  private async fetchRecibos(
    desde: string,
    hasta: string
  ): Promise<IReceipt[]> {
    return cached(`analytics:recibos:${desde}:${hasta}`, 300_000, async () => {
      let allReceipts: IReceipt[] = [];
      let cursor: string | null = null;

      try {
        do {
          const queryParams = new URLSearchParams({
            store_id: this.store_id,
            created_at_min: desde,
            created_at_max: hasta,
            limit: "250",
          });
          if (cursor) queryParams.set("cursor", cursor);

          const url = `${this.BASE_URL}?${queryParams.toString()}`;
          const response = await fetch(url, {
            headers: {
              Authorization: `Bearer ${this.loyverseToken}`,
              "Content-Type": "application/json",
            },
          });

          if (response.status === 429) {
            await new Promise((r) => setTimeout(r, 60000));
            continue;
          }
          if (!response.ok) {
            const errorBody: any = await response.json();
            throw new InternalServerErrorException(
              errorBody.errors?.[0]?.details || "Error en la API de Loyverse"
            );
          }

          const data: any = await response.json();
          allReceipts = allReceipts.concat(data.receipts ?? []);
          cursor = data.cursor ?? null;
          await new Promise((r) => setTimeout(r, 500));
        } while (cursor);

        return allReceipts;
      } catch (error) {
        console.error("Error obteniendo recibos para analítica:", error);
        throw new InternalServerErrorException(
          "No se pudieron obtener los recibos para el análisis"
        );
      }
    });
  }

  private contarDias(desde: string, hasta: string): number {
    const ini = DateTime.fromISO(desde, { zone: "utc" }).startOf("day");
    const fin = DateTime.fromISO(hasta, { zone: "utc" }).endOf("day");
    const dias = Math.floor(fin.diff(ini, "days").days) + 1;
    return Math.max(1, dias);
  }
}
