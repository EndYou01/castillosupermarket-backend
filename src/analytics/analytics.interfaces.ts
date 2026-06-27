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
  agotado: boolean; // stock 0 pero sí se vende → venta perdida
}

export interface IMargenItem {
  variantId: string;
  itemName: string;
  costo: number;
  precio: number;
  margenPct: number; // (precio - costo) / precio
  unidadesVendidas: number;
  ingresos: number; // dinero real facturado en el rango
  ganancia: number; // (precio - costo) * unidades, real del rango
  claseABC: "A" | "B" | "C" | "-";
  bajoMargen: boolean; // margen muy bajo o venta bajo costo
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
  margenes: {
    items: IMargenItem[];
    capitalParado: ICapitalParadoItem[];
    totalCapitalParado: number;
  };
  combos: IComboItem[];
}

export interface IAsistenteResponse {
  ok: boolean;
  mensaje: string; // texto en español, o un aviso si falta configurar la IA
}
