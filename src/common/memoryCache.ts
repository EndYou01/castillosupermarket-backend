// Caché TTL en memoria, simple, para agregados caros (inventario, ventas).
//
// Nota sobre serverless (Vercel): la caché vive en el proceso. Mientras la
// instancia esté "tibia" (varias requests seguidas), se reutiliza; en un cold
// start arranca vacía. Aun así reduce llamadas a Loyverse durante el uso activo
// (varios dispositivos / revalidaciones casi simultáneas).

type CacheEntry = { t: number; v: unknown };

const store = new Map<string, CacheEntry>();

// Tope defensivo para que no crezca sin límite (las claves reales son pocas:
// "inventario" + algunos rangos de ventas).
const MAX_ENTRIES = 200;

// Devuelve el valor cacheado si está fresco; si no, ejecuta `producer`, lo
// guarda y lo devuelve. Si `producer` lanza, no se cachea (se propaga el error).
export async function cached<T>(
  key: string,
  ttlMs: number,
  producer: () => Promise<T>
): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v as T;

  const value = await producer();

  if (store.size >= MAX_ENTRIES) store.clear();
  store.set(key, { t: Date.now(), v: value });
  return value;
}

// Invalida una clave exacta, o todas las que empiecen con `prefix`. Sin
// argumentos, limpia todo. Úsalo tras una mutación que vuelve obsoleto el dato.
export function invalidateCache(prefix?: string): void {
  if (!prefix) {
    store.clear();
    return;
  }
  for (const k of store.keys()) {
    if (k === prefix || k.startsWith(prefix)) store.delete(k);
  }
}
