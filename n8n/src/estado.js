// Lee el estado actual del Budget: corridas anteriores, facturas registradas, las pestañas donde
// registra n8n (OPEX, FIXED_ASSETS, FINANCIAL, INCOME) y el tipo de cambio. OPEX-CONTA no se lee ni se toca.
const cfg = $('Config').first().json;
const rangos = $('Sheets: leer estado').first().json.valueRanges || [];        // Budget
const rangosControl = $('Sheets: leer control').first().json.valueRanges || []; // hoja de control
const valores = i => (rangos[i] && rangos[i].values) || [];
const control = i => (rangosControl[i] && rangosControl[i].values) || [];

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9?]+/g, ' ').trim();
const num = v => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(/[$,\s]/g, ''));
  return isNaN(n) ? null : n;
};
function parseFecha(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5).toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) return `${m[3].length === 2 ? 2000 + +m[3] : m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  return null;
}
const letra = i => { let s = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

// ---------- Pestañas de registro ----------
const ALIAS = [
  ['vintage', ['=vintage']], ['fecha', ['=date', '=fecha']],
  ['categoria', ['expense category', 'categoria de compra', '=categoria', '=category']], ['subcategoria', ['subcategoria']],
  ['area', ['=area']], ['descripcion', ['description', 'descripcion', '=concept']], ['tipo', ['expense type']],
  ['metodo', ['payment method', 'metodo de pago']], ['amount', ['=amount', 'monto mxn', '=monto']],
  ['vat', ['=vat', '=iva']], ['vat_ret', ['vat with']], ['isr', ['=isr']],
  ['total', ['total amount', 'total mxn', '=ingreso', '=total']], ['usd', ['=usd', 'total usd', 'monto usd']],
  ['user', ['=user']], ['provider', ['provider']], ['folio', ['=folio']], ['invoice', ['invoice', 'factura']],
  ['receipt', ['receipt', 'recibo']], ['prorated', ['=prorated', '=prorated ?']], ['prorated_m', ['prorated p', 'prorated m', 'prorated n']],
  ['id', ['=id']], ['ref_banco', ['ref banco']], ['eeff', ['=eeff']], ['contpaq', ['contpaq']], ['origen', ['=origen']], ['gl', ['=gl']]
];
function ubicar(encabezado) {
  const h = encabezado.map(x => norm(x).replace(/\s*\?$/, ' ?'));
  const tomadas = new Set(), col = {};
  for (const [clave, alias] of ALIAS) {
    let pos = -1;
    for (const a of alias) {
      const exacto = a.startsWith('=');
      const t = exacto ? a.slice(1) : a;
      pos = h.findIndex((x, i) => !tomadas.has(i) && (exacto ? x === t : x.startsWith(t)));
      if (pos >= 0) break;
    }
    col[clave] = pos;
    if (pos >= 0) tomadas.add(pos);
  }
  // "VAT ?" es la casilla junto a Amount (en OPEX su encabezado está vacío)
  if (col.amount >= 0) {
    const sig = h[col.amount + 1];
    if (sig === '' || sig === 'vat ?' || sig === '?') {
      col.vatq = col.amount + 1;
      if (col.vat === col.amount + 1) col.vat = h.findIndex((x, i) => i > col.amount + 1 && (x === 'vat' || x === 'iva'));
    }
  }
  if (col.vatq === undefined) col.vatq = -1;
  return col;
}
const conTexto = v => v !== '' && v !== null && v !== undefined;
function leerPestana(destino, vals) {
  const nombre = cfg.destinos[destino];
  const h = vals.findIndex((r, i) => i < 25 && norm(r && r[0]) === 'vintage');
  if (h < 0) return { destino, nombre, error: `No encontré el encabezado (VINTAGE) en ${nombre}`, filas: [], col: {}, letras: {}, ultima: vals.length, fila_encabezado: 0 };
  const encabezado = vals[h].map(x => String(x ?? ''));
  const col = ubicar(encabezado);
  let crearRef = false;
  if (['OPEX', 'FIXED_ASSETS'].includes(destino) && col.ref_banco < 0) {      // columna W nueva, después de ID
    col.ref_banco = Math.max(encabezado.length, ...Object.values(col).map(i => i + 1));
    crearRef = true;
  }
  const g = (r, k) => (col[k] >= 0 ? r[col[k]] : '');
  const filas = [];
  let ultima = h + 1;
  for (let i = h + 1; i < vals.length; i++) {
    const r = vals[i] || [];
    if (![g(r, 'fecha'), g(r, 'descripcion'), g(r, 'amount'), g(r, 'total')].some(conTexto)) continue;
    ultima = i + 1;
    const origen = String(g(r, 'origen') ?? '');
    filas.push({
      tab: destino, fila: i + 1, fecha: parseFecha(g(r, 'fecha')), fecha_num: typeof g(r, 'fecha') === 'number', vintage: String(g(r, 'vintage') ?? ''),
      categoria: String(g(r, 'categoria') ?? ''), subcategoria: String(g(r, 'subcategoria') ?? ''), area: String(g(r, 'area') ?? ''),
      tipo: String(g(r, 'tipo') ?? ''), metodo: String(g(r, 'metodo') ?? ''), descripcion: String(g(r, 'descripcion') ?? ''),
      proveedor: String(g(r, 'provider') ?? ''), amount: num(g(r, 'amount')), total: num(g(r, 'total')) ?? num(g(r, 'amount')),
      folio: String(g(r, 'folio') ?? ''), invoice: String(g(r, 'invoice') ?? ''), receipt: String(g(r, 'receipt') ?? ''),
      id: String(g(r, 'id') ?? '').trim(), ref: String(g(r, 'ref_banco') ?? '').trim() || ((origen.match(/n8n mov #(\S+)/) || [])[1] || ''), origen
    });
  }
  const letras = Object.fromEntries(Object.entries(col).map(([k, i]) => [k, i >= 0 ? letra(i) : null]));
  return { destino, nombre, fila_encabezado: h + 1, encabezado, col, letras, crear_ref: crearRef, filas, ultima };
}
const pestanas = {
  OPEX: leerPestana('OPEX', valores(0)), FIXED_ASSETS: leerPestana('FIXED_ASSETS', valores(1)),
  FINANCIAL: leerPestana('FINANCIAL', valores(2)), INCOME: leerPestana('INCOME', valores(3))
};
const errores = Object.values(pestanas).filter(p => p.error).map(p => p.error);
if (pestanas.OPEX.error) throw new Error(pestanas.OPEX.error);

// Gastos (OPEX + FIXED_ASSETS + FINANCIAL) e ingresos, para historial y conciliación
const gastos = [...pestanas.OPEX.filas, ...pestanas.FIXED_ASSETS.filas, ...pestanas.FINANCIAL.filas];
const ingresos = pestanas.INCOME.filas;
const maxCodigo = {};
for (const f of [...pestanas.OPEX.filas, ...pestanas.FIXED_ASSETS.filas]) {
  const m = f.id.match(/^(\d{2})-(\d+)$/);
  if (m) maxCodigo[m[1]] = Math.max(maxCodigo[m[1]] || 0, +m[2]);
}
const cuenta = (filas, k) => { const c = {}; filas.forEach(o => { if (o[k]) c[o[k]] = (c[o[k]] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([v]) => v); };
const catalogos = {
  categorias: cuenta([...pestanas.OPEX.filas, ...pestanas.FIXED_ASSETS.filas], 'categoria'),
  areas: cuenta([...pestanas.OPEX.filas, ...pestanas.FIXED_ASSETS.filas], 'area'),
  tipos: cuenta([...pestanas.OPEX.filas, ...pestanas.FIXED_ASSETS.filas], 'tipo'),
  metodos: cuenta([...gastos], 'metodo'),
  categorias_financial: cuenta(pestanas.FINANCIAL.filas, 'categoria'),
  subcategorias_financial: cuenta(pestanas.FINANCIAL.filas, 'subcategoria'),
  categorias_activos: cuenta(pestanas.FIXED_ASSETS.filas, 'categoria')
};

// ---------- Corridas anteriores ----------
const vCorr = control(0);
const hCorr = (vCorr[0] || cfg.pestanas.N8N_CORRIDAS).map(norm);
const ci = n => hCorr.indexOf(norm(n));
let ultimaOk = null;
for (const r of vCorr.slice(1)) {
  const inicio = r[ci('Inicio (UTC)')];
  if (String(r[ci('Estado')] ?? '').toLowerCase() === 'ok' && String(r[ci('Modo prueba')] ?? '').toUpperCase() === 'NO' && inicio && (!ultimaOk || String(inicio) > ultimaOk)) ultimaOk = String(inicio);
}
const desde = ultimaOk || new Date(Date.now() - cfg.dias_primera_corrida * 864e5).toISOString();

// ---------- Facturas registradas ----------
const vFac = control(1);
const hFac = (vFac[0] || cfg.pestanas.FACTURAS).map(String);
const facturas = vFac.slice(1).map((r, i) => {
  const o = { fila: i + 2 };
  hFac.forEach((h, j) => { o[h] = r[j] ?? ''; });
  return o;
}).filter(f => f.Clave || f.UUID);

// ---------- Tipo de cambio mensual (renglón "Dolar") ----------
const vDol = valores(4);
const fx = {};
if (vDol.length >= 2) vDol[0].forEach((h, j) => { const mm = String(h).match(/^(\d{2})_/); const v = num(vDol[1][j]); if (mm && v) fx[+mm[1]] = v; });

// Sin las filas (pesadas) para referencias rápidas
const resumenPestanas = Object.fromEntries(Object.entries(pestanas).map(([k, p]) => [k, { ...p, filas: undefined }]));
return [{ json: {
  hoy: $('¿Día hábil?').first().json.hoy,
  dia_semana: $('¿Día hábil?').first().json.dia_semana,
  desde, corrida: Math.max(1, vCorr.length),
  facturas, encabezado_facturas: hFac,
  filas: { facturas: vFac.length, bitacora: control(2).length, corridas: vCorr.length, sat: control(3).length },
  // Solicitudes de descarga al SAT de corridas anteriores (la más reciente primero): su ZIP trae los XML
  sat_solicitudes: [...new Set(control(3).slice(1).filter(r => String(r[1] || '') === 'solicitar')
    .map(r => (String(r[4] || '').match(/Solicitud\s+([0-9a-f-]{36})/i) || [])[1]).filter(Boolean).reverse())],
  pestanas: resumenPestanas, gastos, ingresos, max_codigo: maxCodigo, catalogos, fx, errores
} }];
