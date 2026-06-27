// Tipos de la analítica del negocio (reposición, márgenes/ABC y combos).
// Todo se calcula con algoritmos sobre los datos reales de Loyverse; el LLM
// (Gemini gratis) solo se usa para la explicación en lenguaje natural.

export interface IReposicionItem {
  variantId: string;
  itemName: string;
  stock: number;
  vendidoEnRango: number;
  velocidadDia: number; // unidades vendidas por día (promedio del rango)
  diasParaAgotar: number | null; // null si no se vende en el rango
  sugerenciaCompra: number; // unidades a comprar para la cobertura objetivo
  costo: number;
  precio: number;
  agotado: boolean; // stock 0 pero sí se vende → venta perdida
  ventaPerdidaDia: number; // si está agotado: velocidadDia * precio; si no, 0
}

export interface IMargenItem {
  variantId: string;
  itemName: string;
  costo: number;
  precio: number;
  stock: number;
  margenPct: number; // (precio - costo) / precio
  unidadesVendidas: number;
  ingresos: number; // dinero real facturado en el rango
  ganancia: number; // (precio - costo) * unidades, real del rango
  // GMROI: ganancia del rango por cada CUP invertido en el stock actual.
  // null si no hay stock (no se puede calcular el retorno sobre inventario).
  gmroi: number | null;
  claseABC: "A" | "B" | "C" | "-";
  bajoMargen: boolean; // margen muy bajo o venta bajo costo
}

// ---- #1 Venta perdida por agotados ----
export interface IVentaPerdidaItem {
  variantId: string;
  itemName: string;
  velocidadDia: number;
  precio: number;
  perdidaDia: number; // velocidadDia * precio
}

// ---- #2 Patrones temporales (horas y días pico) ----
export interface IBucketHora {
  hora: number; // 0..23 (zona America/Havana)
  recibos: number;
  ingresos: number;
}
export interface IBucketDia {
  dia: number; // 1=Lun .. 7=Dom (luxon)
  nombre: string;
  recibos: number;
  ingresos: number;
}
export interface ITemporal {
  porHora: IBucketHora[];
  porDia: IBucketDia[];
  horaPico: number; // hora con más ingresos
  diaPico: string; // nombre del día con más ingresos
}

// ---- #4 Ticket promedio y evolución ----
export interface ISerieDia {
  fecha: string; // YYYY-MM-DD (zona America/Havana)
  recibos: number;
  ingresos: number;
  ticket: number; // ingresos / recibos
}
export interface ITicketAnalisis {
  promedio: number; // ticket promedio de todo el rango
  serie: ISerieDia[];
  tendenciaPct: number; // % cambio del ticket (segunda mitad vs primera)
}

// ---- #9 Concentración de ventas (Pareto) ----
export interface IConcentracion {
  totalProductosVendidos: number;
  productosPara80pct: number; // cuántos productos suman el 80% de los ingresos
  pctTop5: number;
  pctTop10: number;
  pctTop20: number;
}

export interface ICapitalParadoItem {
  variantId: string;
  itemName: string;
  stock: number;
  costo: number;
  capitalInmovilizado: number; // costo * stock
}

export interface IComboItem {
  itemA: string;
  itemB: string;
  veces: number; // recibos donde aparecen juntos
  confianza: number; // P(comprar el otro | comprar uno) — el sentido más fuerte
  lift: number; // cuánto más probable es que juntos vs. azar (>1 = relación real)
}

export interface IAnaliticaResponse {
  rango: { desde: string; hasta: string; dias: number };
  recibosAnalizados: number;
  coberturaObjetivoDias: number;
  reposicion: IReposicionItem[];
  ventaPerdida: {
    totalDia: number; // CUP/día que se pierden por productos agotados
    totalMes: number; // proyección a 30 días
    items: IVentaPerdidaItem[];
  };
  margenes: {
    items: IMargenItem[];
    capitalParado: ICapitalParadoItem[];
    totalCapitalParado: number;
  };
  combos: IComboItem[];
  temporal: ITemporal;
  ticket: ITicketAnalisis;
  concentracion: IConcentracion;
  inventarioInmovil: {
    buckets: {
      etiqueta: string;
      items: IInventarioInmovilItem[];
      totalCapital: number;
    }[];
    totalCapital: number;
  };
}

// ---- #7 Inventario inmóvil / muerto con antigüedad ----
export interface IInventarioInmovilItem {
  variantId: string;
  itemName: string;
  stock: number;
  costo: number;
  capitalInmovilizado: number; // costo * stock
  diasSinVenta: number | null; // null = no vendió dentro del rango analizado
  ultimaVenta: string | null; // fecha ISO de la última venta, o null
}

export interface IAsistenteResponse {
  ok: boolean;
  mensaje: string; // texto en español, o un aviso si falta configurar la IA
}
