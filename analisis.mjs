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
console.log(`\nRango: ${diaHavana(desdeISO)} → ${diaHavana(hastaISO)}`);
console.log(`Recibos totales: ${receipts.length}\n`);

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
console.log('=== POR DÍA (zona Havana) ===');
console.log('fecha       ventaNeta   costo   benefBruto  margen%  recibos refunds');
const fechasOrden = [...dias.keys()].sort();
let accV = 0, accB = 0;
for (const f of fechasOrden) {
  const d = dias.get(f);
  const vneta = d.venta - d.reemb;
  const bruto = vneta - d.costo;
  const m = vneta ? (bruto / vneta * 100) : 0;
  accV += vneta; accB += bruto;
  console.log(
    `${f}  ${String(Math.round(vneta)).padStart(9)} ${String(Math.round(d.costo)).padStart(7)} ${String(Math.round(bruto)).padStart(10)} ${m.toFixed(1).padStart(7)} ${String(d.recibos).padStart(7)} ${String(d.refunds).padStart(7)}`
  );
}
console.log('-----');
console.log(`TOTAL venta neta: ${Math.round(accV)} | beneficio bruto: ${Math.round(accB)} | margen global: ${(accB/accV*100).toFixed(2)}%`);

console.log('\n=== MÉTODOS DE PAGO (neto 34 días) ===');
let totalMet = 0;
for (const [n, v] of [...metodos.entries()].sort((a,b)=>b[1]-a[1])) {
  totalMet += v;
  const desc = n === 'Tarjeta Fiscal' ? `  (6% = -${Math.round(v*0.06)})` : '';
  console.log(`${n.padEnd(20)} ${String(Math.round(v)).padStart(10)}${desc}`);
}
console.log(`TOTAL métodos: ${Math.round(totalMet)}  (debe = venta neta ${Math.round(accV)})`);

const fiscal = metodos.get('Tarjeta Fiscal') ?? 0;
console.log(`\n>> Pérdida por 6% Tarjeta Fiscal (34d): ${Math.round(fiscal*0.06)} cup`);

// Costos sospechosos
console.log('\n=== PRODUCTOS CON COSTO 0 (vendidos) ===');
const cero = [...itemsVistos.entries()].filter(([,v]) => v.cost === 0).sort((a,b)=>b[1].qty-a[1].qty);
if (!cero.length) console.log('(ninguno)');
for (const [n, v] of cero.slice(0, 25)) console.log(`${n.padEnd(35)} precio:${v.price} qty:${v.qty}`);

console.log('\n=== MÁRGENES SOSPECHOSOS (margen <=0 o > precio*0.9) ===');
const susp = [...itemsVistos.entries()].filter(([,v]) => v.cost>0 && (v.margen<=0 || v.margen > v.price*0.9)).sort((a,b)=>a[1].margen-b[1].margen);
for (const [n, v] of susp.slice(0, 30)) console.log(`${n.padEnd(35)} cost:${v.cost} precio:${v.price} margen:${v.margen} qty:${v.qty}`);

console.log('\n=== VENTAS CON NOTA (posible "libreta") ===');
if (!ventasConNota.length) console.log('(ninguna)');
for (const v of ventasConNota.slice(0,40)) console.log(`${v.dia}  ${String(v.total).padStart(6)}  "${v.nota}"`);
console.log(`Total ventas con nota: ${ventasConNota.length}`);

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
console.log('\n=== DESCUENTOS Y REEMBOLSOS (30d) ===');
console.log(`Total descuentos aplicados: ${Math.round(totalDescuentos)} cup`);
console.log(`Total reembolsos (devoluciones): ${Math.round(totalReembAmount)} cup  (${reembDetalle.length} recibos)`);

console.log('\n=== POR EMPLEADO ===');
for (const [id, e] of [...porEmpleado.entries()].sort((a,b)=>b[1].venta-a[1].venta)) {
  console.log(`emp ${String(id).slice(0,8)}  venta:${String(Math.round(e.venta)).padStart(9)}  recibos:${String(e.recibos).padStart(4)}  reembolsos:${String(Math.round(e.refundAmount)).padStart(7)} (${e.refundCount})`);
}

console.log('\n=== REEMBOLSOS MAYORES ===');
for (const r of reembDetalle.sort((a,b)=>b.total-a.total).slice(0,15)) console.log(`${r.dia}  ${String(r.total).padStart(6)}  ${r.items.slice(0,50)}`);

// ===== Modelo de reparto real (con estímulo y Mary) =====
console.log('\n=== MODELO DE REPARTO (paper, 30 días completos) ===');
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
console.log(`Salarios: ${tSal} | Impuestos: ${tImp} | Estímulo trabajadores: ${tEst} | Limpieza (Mary): ${tMary}`);
console.log(`Reinversión: ${Math.round(tReinv)} | GANANCIA NETA JEFES: ${Math.round(tJefes)} (c/u ${Math.round(tJefes*0.25)})`);
console.log(`\n>> Beneficio bruto 30d: ${Math.round(accB - (dias.get(diaHavana(hastaISO))?.venta - dias.get(diaHavana(hastaISO))?.reemb - dias.get(diaHavana(hastaISO))?.costo || 0))}`);
