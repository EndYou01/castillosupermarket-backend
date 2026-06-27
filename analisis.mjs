import { readFileSync } from 'node:fs';

// cargar .env manualmente
const env = Object.fromEntries(
  readFileSync(new URL('./.env', import.meta.url), 'utf8')
    .split('\n').filter(Boolean).map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
);
const TOKEN = env.LOYVERSE_TOKEN;
const STORE = env.STORE_ID;
const ZONE = 'America/Havana';

// formatea un instante (Date) como fecha yyyy-MM-dd en zona Havana
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const diaHavana = (iso) => fmt.format(new Date(iso)); // en-CA => yyyy-MM-dd

const ahora = new Date();
const hasta = ahora; // hasta ahora
const desde = new Date(ahora.getTime() - 30 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000);
const desdeISO = desde.toISOString();
const hastaISO = hasta.toISOString();

async function fetchAll() {
  let all = [], cursor = null;
  do {
    const qp = new URLSearchParams({
      store_id: STORE,
      created_at_min: desdeISO,
      created_at_max: hastaISO,
      limit: '250',
    });
    if (cursor) qp.set('cursor', cursor);
    const r = await fetch(`https://api.loyverse.com/v1.0/receipts?${qp}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!r.ok) { console.error('HTTP', r.status, await r.text()); process.exit(1); }
    const d = await r.json();
    all = all.concat(d.receipts ?? []);
    cursor = d.cursor ?? null;
    await new Promise(s => setTimeout(s, 400));
  } while (cursor);
  return all;
}

const receipts = await fetchAll();

// Agregados por dia
const dias = new Map();
const metodos = new Map();
let costCero = [], costSospechoso = [];
const itemsVistos = new Map(); // item_name -> {cost, price, qty}
let totalSale = 0, totalRefund = 0, totalCost = 0;
let ventasConNota = [];

for (const rec of receipts) {
  const factor = rec.receipt_type === 'SALE' ? 1 : rec.receipt_type === 'REFUND' ? -1 : 0;
  const dia = diaHavana(rec.created_at);
  const total = rec.total_money ?? 0;
  if (factor === 1) totalSale += total; else if (factor === -1) totalRefund += total;

  const d = dias.get(dia) ?? { venta: 0, reemb: 0, costo: 0, recibos: 0, refunds: 0 };
  if (factor === 1) { d.venta += total; d.recibos++; }
  else if (factor === -1) { d.reemb += total; d.refunds++; }

  for (const it of rec.line_items ?? []) {
    const cost = it.cost ?? 0, qty = it.quantity ?? 0, price = it.price ?? 0;
    d.costo += factor * cost * qty;
    totalCost += factor * cost * qty;
    if (factor === 1) {
      const prev = itemsVistos.get(it.item_name) ?? { cost, price, qty: 0, margen: price - cost };
      prev.qty += qty; prev.cost = cost; prev.price = price; prev.margen = price - cost;
      itemsVistos.set(it.item_name, prev);
    }
  }
  dias.set(dia, d);

  for (const p of rec.payments ?? []) {
    const n = p.name ?? 'Sin nombre';
    metodos.set(n, (metodos.get(n) ?? 0) + (p.money_amount ?? 0) * factor);
  }
  if (rec.note && rec.note.trim() && factor === 1) ventasConNota.push({ dia, nota: rec.note.trim(), total });
}

// Tabla por dia
const fechasOrden = [...dias.keys()].sort();
let accV = 0, accB = 0;
for (const f of fechasOrden) {
  const d = dias.get(f);
  const vneta = d.venta - d.reemb;
  const bruto = vneta - d.costo;
  const m = vneta ? (bruto / vneta * 100) : 0;
  accV += vneta; accB += bruto;
}

let totalMet = 0;
for (const [n, v] of [...metodos.entries()].sort((a,b)=>b[1]-a[1])) {
  totalMet += v;
  const desc = n === 'Tarjeta Fiscal' ? `  (6% = -${Math.round(v*0.06)})` : '';
}

const fiscal = metodos.get('Tarjeta Fiscal') ?? 0;

// Costos sospechosos
const cero = [...itemsVistos.entries()].filter(([,v]) => v.cost === 0).sort((a,b)=>b[1].qty-a[1].qty);

const susp = [...itemsVistos.entries()].filter(([,v]) => v.cost>0 && (v.margen<=0 || v.margen > v.price*0.9)).sort((a,b)=>a[1].margen-b[1].margen);


// ===== Análisis extra =====
let totalDescuentos = 0, totalReembAmount = 0;
const porEmpleado = new Map(); // emp -> {venta, refundAmount, refundCount, recibos}
const reembDetalle = [];
for (const rec of receipts) {
  const factor = rec.receipt_type === 'SALE' ? 1 : rec.receipt_type === 'REFUND' ? -1 : 0;
  const total = rec.total_money ?? 0;
  totalDescuentos += rec.total_discount ?? 0;
  const e = porEmpleado.get(rec.employee_id) ?? { venta: 0, refundAmount: 0, refundCount: 0, recibos: 0 };
  if (factor === 1) { e.venta += total; e.recibos++; }
  else if (factor === -1) { e.refundAmount += total; e.refundCount++; totalReembAmount += total; reembDetalle.push({ dia: diaHavana(rec.created_at), total, items: (rec.line_items||[]).map(i=>i.item_name).join(', ') }); }
  porEmpleado.set(rec.employee_id, e);
}

for (const [id, e] of [...porEmpleado.entries()].sort((a,b)=>b[1].venta-a[1].venta)) {
}


// ===== Modelo de reparto real (con estímulo y Mary) =====
const dow = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, weekday: 'short' });
let tReinv=0, tJefes=0, tSal=0, tImp=0, tEst=0, tMary=0;
const SAL=2000, IMP=2000;
const fechasFull = fechasOrden.filter(f => f !== diaHavana(hastaISO)); // excluir hoy parcial
fechasFull.forEach((f, idx) => {
  const d = dias.get(f);
  const bruto = (d.venta - d.reemb) - d.costo;
  // estimulo 200 dos dias si, dos dias no (patron 2on/2off) -> aprox idx%4<2
  const estimulo = (idx % 4 < 2) ? 200 : 0;
  const esDomingo = dow.format(new Date(f + 'T12:00:00Z')) === 'Sun';
  const mary = esDomingo ? 1000 : 0;
  const reinvTarget = 1500 - estimulo - mary; // segun tu regla la reinversion se reduce
  tSal+=SAL; tImp+=IMP; tEst+=estimulo; tMary+=mary;
  const sinReinv = bruto - SAL - IMP;
  if (sinReinv >= 1500) { tReinv += reinvTarget; tEst+=0; tJefes += sinReinv - 1500; }
  else { tReinv += Math.max(0, sinReinv - estimulo - mary); }
});
