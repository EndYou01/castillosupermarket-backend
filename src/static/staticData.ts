import { IGastosExtras } from "src/interfaces/interfaces";

export const gastosExtras: IGastosExtras[] = [
  {
    fecha: "2025-05-18",
    amount: 3350,
  },
];

// Estímulo a los trabajadores: 200 cup, patrón "2 días sí / 2 días no".
// `anchor` es un día que SÍ tuvo estímulo (primer día de un par activo).
// ⚠️ AJUSTA esta fecha a un día real de estímulo para que el patrón caiga bien.
export const estimuloConfig = {
  anchor: "2026-06-19",
  monto: 200,
};

// Limpieza: se le paga a Mary 1000 cup cada domingo (se rebaja de la reinversión).
export const limpiezaConfig = {
  monto: 1000,
};
