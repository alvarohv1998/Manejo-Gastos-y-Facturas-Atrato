/* ============ Fuentes de datos ============
   1. Histórico del Budget (enero–septiembre): base de datos de la interfaz, colección datos/historico/partes.
   2. Desde octubre: archivo interfaz_gastos.json en Drive, que n8n reescribe al final de cada corrida.
      Reemplaza los meses desde desde_mes y trae FACTURAS, BITACORA y N8N_CORRIDAS de la hoja de control.
   3. Lo que la gente hace aquí (aprobaciones, ediciones, relaciones, bitácora): colecciones cambios, cambios_f, nuevos y bitacora. */
const ANIO = 2026;
const FEED_ID = '1-8_ymzdcIWNxUGYMi4xV1NieVnZSRLHc';
const DRIVE = 'Google Drive';
const CARPETA_DRIVE = 'https://drive.google.com/drive/folders/1-MhGV88LInkbTagUcAg5LETJLJ2djjhr';
const SLACK_CANAL = 'https://atratopago.slack.com/archives/C03KJNZRX5J/p';
const MESES = ['01_ENERO','02_FEBRERO','03_MARZO','04_ABRIL','05_MAYO','06_JUNIO','07_JULIO','08_AGOSTO','09_SEPTIEMBRE','10_OCTUBRE','11_NOVIEMBRE','12_DICIEMBRE'];
const CARPETAS = ['01_Enero','02_Febrero','03_Marzo','04_Abril','05_Mayo','06_Junio','07_Julio','08_Agosto','09_Septiembre','10_Octubre','11_Noviembre','12_Diciembre'];
const USUARIOS = ['Luis Caloca','Isabel Torres','Álvaro Hernández','Gilberto Retamoza'];
const APROB = {
  aprob:{l:'Aprobado',c:'ok'}, pend_a:{l:'Pend. aprobación',c:'warn'}, rech:{l:'Rechazado',c:'bad'},
  pend_r:{l:'Pend. revisión',c:'warn'}, rev:{l:'Revisado',c:'ok'}
};
const HOJAS = ['OPEX','FIXED_ASSETS','FINANCIAL','INCOME'];
const LIMITE = 300;

let FX = {};
let gastos = [], facturas = [], rel = [], bitacora = [], corridas = [];
let otras = { FINANCIAL: { enc: [], filas: [] }, INCOME: { enc: [], filas: [] } };
let CATEGORIAS = [], AREAS = [], TIPOS = [], METODOS = [];
let gIdx = new Map(), fIdx = new Map(), relG = new Map(), relF = new Map();

const SRC = {
  db: null, dbEstado: 'cargando', hist: null,
  feed: null, feedEstado: 'cargando', feedError: '', feedCache: null,
  cambios: {}, cambiosF: {}, nuevos: {}, bitUI: [], progreso: '', dbError: '', errorPagina: ''
};

/* ============ Estado de la interfaz ============ */
const S = {
  user: USUARIOS[0], screen: 'opex', tab: 'opex', hoja: 'OPEX', mes: null, mesAuto: true, metodo: '', q: '',
  carpeta: 'all', fEstado: '', fq: '', bU: '', bA: '', bE: '', bq: '',
  limite: LIMITE, flimite: LIMITE, blimite: LIMITE, llimite: LIMITE,
  active: null, anchor: null, sel: null, editing: null, draft: null
};
try { const u = localStorage.getItem('mg_user'); if (u) S.user = u; } catch (e) {}

/* ============ Utilidades ============ */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const uniq = a => [...new Set(a.filter(x => x !== '' && x != null).map(String))].sort((x, y) => x.localeCompare(y, 'es'));
const round2 = n => Math.round(n * 100) / 100;
const esTarjeta = m => /clara|amex|tarjeta/i.test(String(m || ''));
const mesDe = v => { const m = String(v ?? '').match(/^(\d{1,2})_/); return m ? +m[1] : 0; };
const num = v => { if (v === '' || v == null) return ''; const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,\s]/g, '')); return isNaN(n) ? '' : n; };
const bool = v => v === true || /^(true|verdadero|si|sí|1)$/i.test(String(v ?? '').trim());
const pad = n => String(n).padStart(2, '0');
function fechaIso(v, vint) {
  if (typeof v === 'number' && v > 20000) return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10);
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad(m[2])}-${pad(m[1])}`;
  const mm = mesDe(vint);
  return mm ? `${ANIO}-${pad(mm)}-01` : '';
}
function tiempoIso(v) {
  if (typeof v === 'number' && v > 20000) return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 16);
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
  if (m) return `${m[1]}T${m[2]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})/);
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad(m[2])}-${pad(m[1])}T${pad(m[4])}:${m[5]}`;
  const f = fechaIso(s);
  return f ? f + 'T00:00' : '';
}
const money = (n, cur) => {
  if (n === null || n === undefined || n === '') return '';
  const s = (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cur && cur !== 'MXN' ? s + ' ' + cur : s;
};
const dmy = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(2, 4) : '';
const vintageDe = iso => iso ? MESES[+iso.slice(5, 7) - 1] : '';
const mesG = g => mesDe(g.vintage) || (g.fecha ? +g.fecha.slice(5, 7) : 0);
const daysSince = iso => Math.max(0, Math.floor((Date.now() - new Date(iso + 'T12:00').getTime()) / 864e5));
const nowIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtT = t => t ? `${t.slice(8, 10)}/${t.slice(5, 7)}/${t.slice(2, 4)} ${t.slice(11, 16)}` : '';
const st = (c, l) => `<span class="st ${c}">${esc(l)}</span>`;
const docId = s => String(s).replace(/[^A-Za-z0-9_\-.~:@+]/g, '_').slice(0, 180) || '_';
const clon = o => JSON.parse(JSON.stringify(o));
const fById = id => fIdx.get(String(id));
const gByCode = c => gIdx.get(String(c));
const facturasDe = g => (relG.get(g.codigo) || []).map(fById).filter(Boolean);
const gastosDe = f => (relF.get(f.id) || []).map(gByCode).filter(Boolean);
const fxMes = m => FX[m] || FX[Math.max(0, ...Object.keys(FX).map(Number).filter(k => k <= m))] || 18;
const totalMXN = f => f.total == null || f.total === '' ? null : (f.moneda === 'USD' ? f.total * fxMes(+String(f.fecha).slice(5, 7)) : f.total);

/* ============ Armar los datos ============ */
function objetos(t) {
  if (!t || !t.enc) return [];
  const enc = t.enc.map(h => norm(h));
  return (t.filas || []).map(f => { const o = {}; enc.forEach((h, i) => { if (h && !(h in o)) o[h] = f[i] ?? ''; }); return o; });
}
const pick = (o, ...ks) => { for (const k of ks) if (o[k] !== undefined && o[k] !== '') return o[k]; return ''; };
function tablaCombinada(tab) {
  const h = SRC.hist && SRC.hist.tabs[tab];
  const f = SRC.feed && SRC.feed.tabs && SRC.feed.tabs[tab];
  const conFeed = !!(f && f.enc && f.enc.length);
  const desde = SRC.feed ? (SRC.feed.desde_mes || 10) : 13;
  const antes = objetos(h).filter(o => mesDe(o.vintage) < desde);
  const despues = conFeed ? objetos(f) : objetos(h).filter(o => mesDe(o.vintage) >= desde);
  return { enc: conFeed ? f.enc : (h ? h.enc : []), filas: antes.concat(despues) };
}
function control() {
  if (SRC.feed && SRC.feed.control && SRC.feed.control.FACTURAS) return SRC.feed.control;
  return (SRC.hist && SRC.hist.control) || {};
}
function nombreLink(url, g) {
  if (/bizpoint/i.test(url)) return `Bizpoint · ${g.proveedor || g.codigo}`;
  if (/drive\.google|docs\.google/i.test(url)) return `Drive · ${g.proveedor || g.codigo}`;
  return url.replace(/^https?:\/\//, '').slice(0, 60);
}
function construir() {
  const fxRows = (SRC.feed && SRC.feed.fx && SRC.feed.fx.length ? SRC.feed.fx : (SRC.hist && SRC.hist.fx)) || [];
  FX = {};
  if (fxRows.length >= 2) fxRows[0].forEach((h, i) => { const m = mesDe(h), v = num(fxRows[1][i]); if (m && v) FX[m] = v; });

  gastos = [];
  ['OPEX', 'FIXED_ASSETS'].forEach(tab => {
    tablaCombinada(tab).filas.forEach((o, i) => {
      const metodo = String(pick(o, 'payment method'));
      const ref = String(pick(o, 'ref banco (n8n)'));
      const n8n = /^n8n/i.test(ref);
      const fecha = fechaIso(pick(o, 'date', 'fecha'), o.vintage);
      gastos.push({
        codigo: String(pick(o, 'id') || `${tab}-${i + 1}`), pestana: tab, vintage: String(o.vintage || vintageDe(fecha)), fecha,
        categoria: String(pick(o, 'expense category')), area: String(pick(o, 'area')), descripcion: String(pick(o, 'description')),
        tipo: String(pick(o, 'expense type')), metodo, monto: num(o.amount), lleva_iva: bool(o['vat ?']), iva: num(o.vat),
        iva_ret: num(o['vat withholding']), isr: num(o.isr), total: num(o['total amount']), usd: num(o.usd),
        usuario: String(pick(o, 'user')), proveedor: String(pick(o, 'provider')), folio: String(pick(o, 'folio')),
        invoice: String(o.invoice || ''), recibo: String(o.receipt || ''), prorrateado: bool(o.prorated), meses_pr: String(o['prorated period'] ?? ''),
        ref_banco: ref, eeff: String(o.eeff || ''), contpaq: String(o.contpaq || ''), n8n, origen: 'budget',
        aprob: n8n ? (esTarjeta(metodo) ? 'pend_r' : 'pend_a') : (esTarjeta(metodo) ? 'rev' : 'aprob'), motivo_rechazo: '', notas: ''
      });
    });
  });
  Object.values(SRC.nuevos).forEach(n => gastos.push(Object.assign(clon(n), { origen: 'interfaz' })));
  gIdx = new Map(gastos.map(g => [g.codigo, g]));
  for (const c of Object.values(SRC.cambios)) {
    const g = gIdx.get(c.codigo); if (!g) continue;
    Object.assign(g, c.campos || {});
    if (c.aprob) g.aprob = c.aprob;
    if (c.motivo_rechazo !== undefined) g.motivo_rechazo = c.motivo_rechazo;
  }

  facturas = []; rel = [];
  const ctrl = control();
  const conN8n = new Set();
  objetos(ctrl.FACTURAS).forEach(o => {
    const id = String(o.clave || o.uuid || ''); if (!id) return;
    const fecha = fechaIso(o.fecha);
    const link = /^https?:/i.test(String(o['link drive'] || '')) ? String(o['link drive']) : '';
    const emisor = String(o.emisor || '');
    const sf = `${o.serie || ''}${o.folio || ''}`;
    const f = {
      id, origen: 'n8n', archivo: `${emisor || o['rfc emisor'] || 'Factura'} · ${sf || String(o.uuid || id).slice(0, 8)}`, link,
      ext: link ? 'pdf' : 'xml', uuid: String(o.uuid || ''), tipo: String(o.tipo || ''), emisor, rfc: String(o['rfc emisor'] || ''), fecha,
      subtotal: num(o.subtotal), ivaF: num(o.iva), total: num(o.total), moneda: String(o.moneda || 'MXN'), metodo: String(o['metodo pago'] || ''),
      forma: String(o['forma pago'] || ''), receptor: String(o['rfc receptor'] || ''), buzon: String(o.buzon || ''), remitente: String(o.remitente || ''),
      asunto: String(o.asunto || ''), conceptos: String(o.conceptos || ''), datos: !!(o.uuid || o.total), clas: String(o.clasificacion || ''),
      motivo: String(o.motivo || ''), estado: String(o.estado || ''), gastoId: String(o['gasto id'] || ''), sugerido: String(o['gasto sugerido'] || ''),
      carpeta: String(o.carpeta || '') || (fecha ? CARPETAS[+fecha.slice(5, 7) - 1] : ''), categoria: String(o.categoria || ''), area: String(o.area || ''),
      destino: String(o.destino || ''), metodoSug: String(o['metodo sugerido'] || ''), slackTs: String(o['slack ts'] || '').replace(/^'/, ''),
      registrada: String(o.registrada || ''), origenN8n: String(o.origen || '')
    };
    facturas.push(f);
    if (f.gastoId && gIdx.has(f.gastoId)) { rel.push({ g: f.gastoId, f: id }); conN8n.add(f.gastoId); }
  });
  gastos.forEach(g => {
    if (!g.invoice || g.origen !== 'budget' || conN8n.has(g.codigo)) return;
    const url = /^https?:\/\//i.test(g.invoice), id = 'b:' + g.codigo, m = mesG(g);
    facturas.push({
      id, origen: 'budget', archivo: url ? nombreLink(g.invoice, g) : g.invoice, link: url ? g.invoice : '',
      ext: url ? 'link' : (/\.xml$/i.test(g.invoice) ? 'xml' : 'pdf'), uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(g.folio) ? g.folio : '',
      tipo: '', emisor: g.proveedor, rfc: '', fecha: g.fecha, total: g.total === '' ? null : Math.abs(g.total), moneda: 'MXN',
      metodo: '', forma: '', receptor: '', buzon: '', datos: true, clas: '', motivo: '', estado: 'budget', gastoId: g.codigo,
      carpeta: m ? CARPETAS[m - 1] : ''
    });
    rel.push({ g: g.codigo, f: id });
  });
  fIdx = new Map(facturas.map(f => [f.id, f]));
  for (const c of Object.values(SRC.cambiosF)) { const f = fIdx.get(c.id); if (f && c.estado) f.estadoUI = c.estado; }
  for (const c of Object.values(SRC.cambios)) {
    (c.facturas_del || []).forEach(fid => { rel = rel.filter(r => !(r.g === c.codigo && r.f === fid)); });
    (c.facturas_add || []).forEach(fid => { if (fIdx.has(fid) && gIdx.has(c.codigo) && !rel.some(r => r.g === c.codigo && r.f === fid)) rel.push({ g: c.codigo, f: fid }); });
  }
  relG = new Map(); relF = new Map();
  rel.forEach(r => { (relG.get(r.g) || relG.set(r.g, []).get(r.g)).push(r.f); (relF.get(r.f) || relF.set(r.f, []).get(r.f)).push(r.g); });

  ['FINANCIAL', 'INCOME'].forEach(t => {
    const tc = tablaCombinada(t);
    otras[t] = { enc: (tc.enc || []).map(String).filter(h => h.trim()), filas: tc.filas };
  });

  const entidad = ref => gIdx.has(ref) ? 'gasto' : fIdx.has(ref) ? 'factura' : 'otro';
  bitacora = objetos(ctrl.BITACORA).map(o => ({
    t: tiempoIso(o.fecha), u: String(o.usuario || 'n8n'), canal: String(o.canal || 'n8n'), accion: String(o.accion || ''),
    ent: entidad(String(o.objeto || '')), ref: String(o.objeto || ''), campo: String(o.campo || ''),
    a: String(o.antes ?? ''), d: String(o.despues ?? ''), c: String(o.comentario || '')
  })).concat(SRC.bitUI.map(b => Object.assign({}, b, { ent: b.ent || entidad(b.ref) })))
    .sort((a, b) => a.t.localeCompare(b.t));
  corridas = objetos(ctrl.N8N_CORRIDAS);

  CATEGORIAS = uniq(gastos.map(g => g.categoria)); AREAS = uniq(gastos.map(g => g.area));
  TIPOS = uniq(gastos.map(g => g.tipo)); METODOS = uniq(gastos.map(g => g.metodo));
  if (S.mesAuto) {
    const meses = gastos.filter(g => g.pestana === 'OPEX').map(mesG).filter(Boolean);
    S.mes = meses.length ? Math.max(...meses) : null;
  }
}

function estadoFactura(g) {
  if (facturasDe(g).length) return { k: 'con', l: 'Con factura', c: 'ok' };
  if (/^no fact/i.test(g.recibo)) return { k: 'no', l: 'Sin factura', c: 'neu' };
  if (g.recibo) return { k: 'no', l: 'Con comprobante', c: 'neu' };
  return { k: 'falta', l: 'Falta factura', c: 'bad' };
}
function estadoDoc(f) {
  const e = f.estadoUI || f.estado;
  if (e === 'descartada') return { k: 'desc', l: 'Descartada', c: 'neu' };
  if (e === 'no_es_factura') return { k: 'nof', l: 'No es factura', c: 'neu' };
  if (e === 'complemento') return { k: 'comp', l: 'Complemento', c: 'neu' };
  if (e === 'pendiente_pago') return { k: 'pend', l: 'Pendiente de pago', c: 'warn' };
  if (e === 'por_conciliar') return { k: 'conc', l: 'Tarjeta · por conciliar', c: 'warn' };
  if (e === 'pagada') return { k: 'pag', l: 'Pagada', c: 'ok' };
  if (gastosDe(f).length) return { k: 'rel', l: 'Relacionada', c: 'ok' };
  return { k: 'val', l: 'Por validar', c: 'warn' };
}
const faltaList = () => gastos.filter(g => estadoFactura(g).k === 'falta').sort((a, b) => b.fecha.localeCompare(a.fecha));
const pendList = () => facturas.filter(f => ['pend', 'val'].includes(estadoDoc(f).k)).sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
const concList = () => facturas.filter(f => estadoDoc(f).k === 'conc').sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));

/* ============ Guardar en la base de la interfaz ============ */
async function dbSet(path, data) {
  if (!SRC.db) { toast('No se guardó: abre la interfaz desde claude.ai para guardar cambios.'); return false; }
  try { await SRC.db.doc(path).set(data); return true; }
  catch (e) {
    toast(e && e.code === 'invalid_argument' ? 'No tienes permiso para guardar cambios en esta interfaz. Pide acceso de edición.' : 'No se pudo guardar el cambio. Revisa tu conexión e intenta de nuevo.');
    return false;
  }
}
function cambio(codigo) { return SRC.cambios[codigo] || (SRC.cambios[codigo] = { codigo, campos: {}, facturas_add: [], facturas_del: [] }); }
function guardarCambio(codigo) {
  const c = cambio(codigo); c.actualizado = new Date().toISOString(); c.por = S.user;
  return dbSet('cambios/' + docId(codigo), clon(c));
}
function setEstadoF(f, estado) {
  SRC.cambiosF[f.id] = { id: f.id, estado, actualizado: new Date().toISOString(), por: S.user };
  return dbSet('cambios_f/' + docId(f.id), clon(SRC.cambiosF[f.id]));
}
function log(e) {
  const b = Object.assign({ t: nowIso(), u: S.user, canal: 'interfaz', campo: '', a: '', d: '', c: '' }, e);
  SRC.bitUI.push(b);
  if (SRC.db) SRC.db.collection('bitacora').add(b).catch(() => toast('El cambio se hizo pero no quedó en la bitácora compartida.'));
}
let toastTimer;
function toast(msg) {
  let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}
function cambiar(fn) { fn(); construir(); render(); }

/* ============ Carga ============ */
let renderTimer = null;
function programarRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => { if (S.editing) { programarRender(); return; } construir(); render(); }, 120);
}
function conTiempo(promesa, ms, etiqueta) {
  return Promise.race([promesa, new Promise((_, no) => setTimeout(() => no(new Error(`${etiqueta}: sin respuesta en ${ms / 1000} s`)), ms))]);
}
async function cargarHistorico() {
  // El índice (meta) dice qué partes hay; se piden una por una para no mandar todo el histórico en un solo mensaje.
  const col = SRC.db.collection('datos/historico/partes');
  const meta = await conTiempo(col.doc('meta').get(), 30000, 'Índice del histórico');
  let ids = [];
  if (meta.exists) { try { ids = JSON.parse(meta.data().json).partes || []; } catch (e) {} }
  let partes;
  if (ids.length) {
    let listas = 0;
    SRC.progreso = `0 de ${ids.length}`; renderFuente();
    partes = await Promise.all(ids.map(id => conTiempo(col.doc(id).get(), 60000, `Parte ${id}`).then(d => {
      listas++; SRC.progreso = `${listas} de ${ids.length}`; renderFuente();
      return d.exists ? d.data() : null;
    })));
    partes = [meta.data()].concat(partes.filter(Boolean));
  } else {
    const snap = await conTiempo(col.get(), 60000, 'Histórico');
    partes = snap.docs.map(d => d.data());
  }
  partes.sort((a, b) => (a.orden || 0) - (b.orden || 0));
  const hist = { tabs: {}, control: {}, fx: [], generado: '' };
  partes.forEach(p => {
    let d; try { d = JSON.parse(p.json); } catch (e) { return; }
    if (p.tipo === 'meta') { hist.fx = d.fx || []; hist.generado = d.generado || ''; }
    if (p.tipo === 'tab') { const t = hist.tabs[p.tab] || (hist.tabs[p.tab] = { enc: d.enc, filas: [] }); t.filas.push(...d.filas); }
    if (p.tipo === 'control') hist.control[p.tab] = d;
  });
  SRC.hist = partes.length ? hist : null;
}
function suscribir(col, fn) {
  SRC.db.collection(col).onSnapshot(snap => { fn(snap.docs.map(d => clon(d.data()))); programarRender(); },
    () => { SRC.dbEstado = 'sin_cambios'; programarRender(); });
}
function leerFeed(payload) {
  let p = payload;
  if (typeof p === 'string') { try { p = JSON.parse(p); } catch (e) { return null; } }
  if (!p || !p.content) return null;
  const bin = atob(p.content);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const datos = JSON.parse(new TextDecoder().decode(bytes));
  return datos && datos.generado ? datos : null;
}
const MCP_MSG = {
  server_not_connected: 'Conecta Google Drive en claude.ai (Ajustes → Conectores) para ver lo que carga n8n desde octubre.',
  needs_reauth: 'Vuelve a conectar Google Drive en claude.ai (Ajustes → Conectores) para ver lo que carga n8n desde octubre.',
  selection_required: 'Elige qué cuenta de Google Drive usar en claude.ai para ver lo que carga n8n desde octubre.',
  not_granted: 'Permite el acceso a Google Drive para ver lo que carga n8n desde octubre.',
  approval_required: 'Permite el acceso a Google Drive para ver lo que carga n8n desde octubre.',
  tool_error: 'Google Drive no entregó el archivo interfaz_gastos.json. Revisa que tengas acceso a la carpeta "Facturas conexión AI".',
  blocked_by_policy: 'Tu organización no permite usar Google Drive desde esta interfaz.'
};
let mcpRef = null, quitarWatch = null;
function vigilarFeed() {
  if (!mcpRef) return;
  if (quitarWatch) quitarWatch();
  SRC.feedEstado = 'cargando'; renderFuente();
  quitarWatch = mcpRef.watchTool(DRIVE, 'download_file_content', { fileId: FEED_ID }, ev => {
    if (ev.type === 'data') {
      try {
        const d = leerFeed(ev.result.payload ?? ev.result);
        SRC.feed = d; SRC.feedEstado = d ? 'ok' : 'vacio'; SRC.feedCache = ev.result.cache ? ev.result.cache.storedAt : Date.now();
      } catch (e) { SRC.feedEstado = 'error'; SRC.feedError = 'El archivo de n8n no se pudo leer.'; }
    } else {
      const code = ev.error && ev.error.code;
      if (['needs_reauth', 'server_not_connected', 'selection_required', 'not_granted', 'blocked_by_policy', 'approval_required'].includes(code)) SRC.feed = null;
      SRC.feedEstado = 'error'; SRC.feedError = MCP_MSG[code] || 'No se pudo leer lo que carga n8n. Intenta "Actualizar" en un momento.';
    }
    programarRender();
  }, { cache: { staleTime: 5 * 60e3 }, refetchInterval: 15 * 60e3 });
}
function avisoError(msg) { SRC.errorPagina = msg; renderFuente(); }
window.addEventListener('error', e => avisoError(`Error en la página: ${e.message}`));
window.addEventListener('unhandledrejection', e => avisoError(`Error en la página: ${(e.reason && (e.reason.message || e.reason.code)) || e.reason}`));
async function iniciarDrive(cl) {
  const mcp = await cl.use('mcp').catch(() => null);
  mcpRef = mcp;
  if (!mcp) { SRC.feedEstado = 'error'; SRC.feedError = 'Esta vista no puede leer Google Drive: se muestra solo el histórico.'; programarRender(); return; }
  vigilarFeed();
}
async function iniciar() {
  const cl = window.claude;
  if (!cl || !cl.use) { SRC.dbEstado = 'sin_db'; SRC.feedEstado = 'error'; SRC.feedError = ''; construir(); render(); return; }
  iniciarDrive(cl);                                  // Drive va por su lado: el histórico no lo espera
  const db = await cl.use('db').catch(() => null);
  SRC.db = db;
  if (!db) { SRC.dbEstado = 'sin_db'; construir(); render(); return; }
  try { await cargarHistorico(); SRC.dbEstado = 'ok'; }
  catch (e) { SRC.dbEstado = 'error'; SRC.dbError = (e && (e.message || e.code)) || String(e); }
  construir(); render();
  suscribir('cambios', docs => { SRC.cambios = {}; docs.forEach(d => { if (d.codigo) SRC.cambios[d.codigo] = Object.assign({ campos: {}, facturas_add: [], facturas_del: [] }, d); }); });
  suscribir('cambios_f', docs => { SRC.cambiosF = {}; docs.forEach(d => { if (d.id) SRC.cambiosF[d.id] = d; }); });
  suscribir('nuevos', docs => { SRC.nuevos = {}; docs.forEach(d => { if (d.codigo) SRC.nuevos[d.codigo] = d; }); });
  suscribir('bitacora', docs => { SRC.bitUI = docs.filter(d => d.t); });
}

/* ============ Navegación ============ */
const SCREENS = {
  registro: ['Registro de gastos', 'Da de alta un gasto y relaciónalo con su factura. Las transferencias se aprueban; las de tarjeta solo se revisan.'],
  opex: ['Opex', 'Los gastos del Budget con sus columnas. Doble clic en una celda para editarla; clic en el ID para ver el detalle.'],
  carpeta: ['Carpeta de facturas', 'Las facturas que registró n8n y las del Budget, por mes, con su estado y los gastos que respaldan.'],
  bitacora: ['Bitácora de cambios', 'Quién cambió qué y cuándo: n8n y las personas que usan esta interfaz. No se puede editar ni borrar.']
};
function go(screen) {
  S.screen = SCREENS[screen] ? screen : 'opex';
  S.sel = null; S.active = null; S.editing = null;
  render();
}
function navTo(screen) {
  go(screen);
  try { history.replaceState(null, '', '#' + S.screen); } catch (e) {}
}
function renderFuente() {
  const el = $('#fuente'); if (!el) return;
  const partes = [];
  if (SRC.errorPagina) partes.push(`<span class="warn">${esc(SRC.errorPagina)}</span>`);
  if (SRC.dbEstado === 'cargando') partes.push(`Cargando el histórico del Budget…${SRC.progreso ? ` (${esc(SRC.progreso)})` : ''}`);
  else if (SRC.dbEstado === 'sin_db') partes.push('<span class="warn">Abre esta interfaz desde claude.ai para ver el histórico y guardar cambios.</span>');
  else if (SRC.dbEstado === 'error') partes.push(`<span class="warn">No se pudo leer el histórico del Budget (${esc(SRC.dbError || 'sin detalle')}). Recarga la página.</span>`);
  else if (SRC.hist) partes.push(`Budget Opex 2026 · histórico al ${esc(dmy(String(SRC.hist.generado).slice(0, 10)))}`);
  if (SRC.feedEstado === 'cargando') partes.push('Buscando lo que cargó n8n…');
  else if (SRC.feedEstado === 'ok' && SRC.feed) {
    const t = new Date(SRC.feed.generado);
    partes.push(`n8n: corrida ${esc(SRC.feed.corrida || '')} del ${esc(dmy(t.toISOString().slice(0, 10)))} ${esc(t.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }))}${SRC.feed.modo_prueba ? ' (modo prueba)' : ''}`);
  } else if (SRC.feedEstado === 'vacio') partes.push('n8n todavía no ha cargado datos: aparecerán después de su primera corrida.');
  else if (SRC.feedEstado === 'error' && SRC.feedError) partes.push(`<span class="warn">${esc(SRC.feedError)}</span>`);
  if (mcpRef) partes.push('<button class="btn sm" data-act="actualizar">Actualizar</button>');
  if (SRC.dbEstado === 'sin_cambios') partes.push('<span class="warn">Los cambios de otras personas no se están actualizando; recarga la página.</span>');
  el.innerHTML = partes.map(p => `<span>${p}</span>`).join('');
}
function renderNav() {
  document.querySelectorAll('#nav a').forEach(a => a.setAttribute('aria-current', a.dataset.go === S.screen ? 'page' : 'false'));
  const f = faltaList().length, p = pendList().length, c = concList().length;
  $('#navCounts').innerHTML = `<span class="count bad" title="Gastos con falta de factura">${f} sin factura</span><span class="count warn" title="Facturas pendientes de pago o por validar">${p} por pagar</span><span class="count warn" title="Facturas de tarjeta por conciliar">${c} por conciliar</span>`;
}
function render() {
  renderFuente();
  renderNav();
  const [t, s] = SCREENS[S.screen];
  $('#title').textContent = t; $('#subtitle').textContent = s;
  const el = $('#screen');
  el.className = 'screen' + (S.screen === 'opex' ? ' fill' : '');
  if (!gastos.length && !facturas.length) {
    el.innerHTML = `<div class="empty-note">${SRC.dbEstado === 'cargando' ? `Cargando los gastos del Budget…${SRC.progreso ? ` (${esc(SRC.progreso)} partes)` : ''}` :
      'Todavía no hay gastos que mostrar. El histórico del Budget y lo que carga n8n aparecen aquí en cuanto están disponibles.'}</div>`;
    return;
  }
  if (S.screen === 'registro') el.innerHTML = viewRegistro();
  if (S.screen === 'opex') el.innerHTML = viewOpex();
  if (S.screen === 'carpeta') el.innerHTML = viewCarpeta();
  if (S.screen === 'bitacora') el.innerHTML = viewBitacora();
  if (S.screen === 'registro') syncRegistro();
}
const masBtn = (n, total, act) => n < total ? `<div class="more"><button class="btn" data-act="${act}">Mostrar ${Math.min(LIMITE, total - n)} más (${n} de ${total})</button></div>` : '';

/* ============ A. Registro ============ */
function nextCodigo() { return 'INT-' + Date.now().toString(36).slice(-6).toUpperCase(); }
function blankDraft() {
  const hoy = new Date();
  return { codigo: nextCodigo(), fecha: `${hoy.getFullYear()}-${pad(hoy.getMonth() + 1)}-${pad(hoy.getDate())}`, metodo: 'Banregio', proveedor: '', descripcion: '', monto: '',
    usuario: 'NA', folio: '', categoria: '', area: '', tipo: '', lleva_iva: true, notas: '', prorrateado: false, meses_pr: '',
    fact: 'falta', facturaId: null, motivo: '' };
}
function viewRegistro() {
  const d = S.draft || (S.draft = blankDraft());
  const opt = (arr, v, empty) => (empty ? `<option value="">${empty}</option>` : '') + arr.map(x => `<option ${x === v ? 'selected' : ''}>${esc(x)}</option>`).join('');
  const linked = d.facturaId ? fById(d.facturaId) : null;
  const recientes = gastos.filter(g => g.origen === 'interfaz' || g.n8n).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')).slice(0, 10);
  return `
  <div class="reg">
    <form class="panel" id="regForm" autocomplete="off">
      <div class="formfoot"><h2>Nuevo gasto <small>ID provisional: <span class="preview-id">${esc(d.codigo)}</span></small></h2></div>
      <p class="hint">Se guarda en esta interfaz y en la bitácora. Todavía no se escribe en el Budget: Isabel lo captura con su ID definitivo.</p>
      <h2>Datos del movimiento</h2>
      <div class="fields">
        <label class="f" for="r_fecha">Fecha<input type="date" id="r_fecha" name="fecha" value="${esc(d.fecha)}" required></label>
        <label class="f">Vintage<input type="text" id="r_vint" value="${vintageDe(d.fecha)}" readonly></label>
        <label class="f" for="r_metodo">Método de pago<select id="r_metodo" name="metodo">${opt(METODOS, d.metodo)}</select></label>
        <label class="f" for="r_monto">Monto<input type="number" step="0.01" id="r_monto" name="monto" value="${esc(d.monto)}" placeholder="14500.00" required></label>
        <label class="f span2" for="r_prov">Proveedor<input type="text" id="r_prov" name="proveedor" value="${esc(d.proveedor)}" placeholder="Como aparece en el banco" required></label>
        <label class="f span2" for="r_desc">Descripción<input type="text" id="r_desc" name="descripcion" value="${esc(d.descripcion)}" placeholder="RENTA OFICINA OCTUBRE" required></label>
        <label class="f">USD (dólar del mes)<input type="text" id="r_usd" readonly></label>
        <label class="f" for="r_folio">Folio<input type="text" id="r_folio" name="folio" value="${esc(d.folio)}" placeholder="NA"></label>
        <label class="f" for="r_user">User<input type="text" id="r_user" name="usuario" value="${esc(d.usuario)}"></label>
      </div>
      <div class="rule" id="r_rule"></div>

      <h2>Factura</h2>
      <div class="opts">
        <label class="opt" for="r_f1"><input type="radio" name="fact" id="r_f1" value="con" ${d.fact === 'con' ? 'checked' : ''}><div><b>Relacionar factura de la carpeta</b><span>Busca por proveedor, monto y fecha.</span></div></label>
        ${d.fact === 'con' ? (linked
          ? `<div class="linked"><span>📄 ${esc(linked.archivo)} · ${money(linked.total, linked.moneda)}</span><button type="button" class="btn sm" data-act="pick-factura">Cambiar</button></div>`
          : `<button type="button" class="btn" data-act="pick-factura">Buscar factura…</button>`) : ''}
        <label class="opt" for="r_f2"><input type="radio" name="fact" id="r_f2" value="no" ${d.fact === 'no' ? 'checked' : ''}><div><b>Sin factura (no requiere)</b><span>Nómina, impuestos, comisiones. Se guarda "NO FACTURABLE" en Receipt y no cuenta como pendiente.</span></div></label>
        ${d.fact === 'no' ? `<label class="f" for="r_motivo">Motivo<input type="text" id="r_motivo" name="motivo" value="${esc(d.motivo)}" placeholder="Comisión bancaria"></label>` : ''}
        <label class="opt" for="r_f3"><input type="radio" name="fact" id="r_f3" value="falta" ${d.fact === 'falta' ? 'checked' : ''}><div><b>Todavía no hay factura</b><span>El gasto aparece en la pestaña "Falta factura" hasta que se relacione.</span></div></label>
      </div>

      <h2>Clasificación <small>se puede completar después</small></h2>
      <div class="fields">
        <label class="f" for="r_cat">Expense Category<select id="r_cat" name="categoria">${opt(CATEGORIAS, d.categoria, '—')}</select></label>
        <label class="f" for="r_area">Area<select id="r_area" name="area">${opt(AREAS, d.area, '—')}</select></label>
        <label class="f" for="r_tipo">Expense Type<select id="r_tipo" name="tipo">${opt(TIPOS, d.tipo, '—')}</select></label>
        <label class="f" for="r_meses">Prorated Period<input type="number" min="0" id="r_meses" name="meses_pr" value="${esc(d.meses_pr)}" placeholder="0"></label>
      </div>
      <div class="fields">
        <label class="check" for="r_iva"><input type="checkbox" id="r_iva" name="lleva_iva" ${d.lleva_iva ? 'checked' : ''}> Lleva IVA (16%)</label>
        <label class="check" for="r_pr"><input type="checkbox" id="r_pr" name="prorrateado" ${d.prorrateado ? 'checked' : ''}> Prorrateado</label>
      </div>
      <label class="f" for="r_notas">Notas<textarea id="r_notas" name="notas">${esc(d.notas)}</textarea></label>
      <div class="formfoot">
        <span class="hint">Se guarda en la bitácora a nombre de <b>${esc(S.user)}</b>.</span>
        <div class="acts-row"><button type="button" class="btn" data-act="reset-draft">Limpiar</button><button type="submit" class="btn primary">Guardar gasto</button></div>
      </div>
    </form>

    <div class="panel">
      <h2>Por aprobar o revisar</h2>
      ${recientes.length ? `<table class="list"><tbody>
        ${recientes.map(g => { const ef = estadoFactura(g), ap = APROB[g.aprob]; return `
          <tr class="click" data-open-gasto="${esc(g.codigo)}">
            <td><div class="mono">${esc(g.codigo)}</div><div class="muted">${esc(g.descripcion)}</div>
              <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">${st(ef.c, ef.l)}${st(ap.c, ap.l)}</div></td>
            <td class="num">${money(g.total)}<div class="muted">${esc(g.metodo)}</div></td>
          </tr>`; }).join('')}
      </tbody></table>` : '<p class="hint">Aquí aparecen los gastos que crea n8n y los que se registran en esta pantalla.</p>'}
      <span class="hint">Clic en un gasto para aprobar, revisar o ver su historial.</span>
    </div>
  </div>`;
}
function readDraft() {
  const fm = $('#regForm'); if (!fm) return;
  const d = S.draft, v = id => $(id)?.value;
  d.fecha = v('#r_fecha'); d.metodo = v('#r_metodo'); d.monto = v('#r_monto'); d.proveedor = v('#r_prov'); d.descripcion = v('#r_desc');
  d.folio = v('#r_folio'); d.usuario = v('#r_user'); d.categoria = v('#r_cat'); d.area = v('#r_area'); d.tipo = v('#r_tipo');
  d.meses_pr = v('#r_meses'); d.notas = v('#r_notas');
  d.lleva_iva = $('#r_iva').checked; d.prorrateado = $('#r_pr').checked;
  if ($('#r_motivo')) d.motivo = $('#r_motivo').value;
  d.fact = fm.querySelector('input[name="fact"]:checked')?.value || 'falta';
}
function syncRegistro() {
  const d = S.draft; if (!$('#regForm')) return;
  const mes = +String(d.fecha).slice(5, 7), m = parseFloat(d.monto);
  $('#r_vint').value = vintageDe(d.fecha);
  $('#r_usd').value = isNaN(m) ? '' : money(m / fxMes(mes)) + ' USD';
  $('#r_rule').innerHTML = esTarjeta(d.metodo)
    ? `<b>${esc(d.metodo)}</b> es tarjeta de crédito: el gasto queda <b>Pend. revisión</b> (no se aprueba, no se paga; solo se registra).`
    : `<b>${esc(d.metodo)}</b> es transferencia: el gasto queda <b>Pend. aprobación</b>. Aprobar es solo registro; no ejecuta el pago.`;
}
async function saveDraft() {
  readDraft();
  const d = S.draft, monto = parseFloat(d.monto);
  if (!d.fecha || isNaN(monto) || !d.proveedor.trim() || !d.descripcion.trim()) { toast('Faltan fecha, monto, proveedor o descripción.'); return; }
  if (d.fact === 'con' && !d.facturaId) { toast('Elige la factura a relacionar o cambia la opción de factura.'); return; }
  const mes = +d.fecha.slice(5, 7), codigo = d.codigo;
  const iva = d.lleva_iva ? round2(monto * 0.16) : 0;
  const g = {
    codigo, pestana: 'OPEX', vintage: vintageDe(d.fecha), fecha: d.fecha, categoria: d.categoria, area: d.area, descripcion: d.descripcion.toUpperCase(),
    tipo: d.tipo, metodo: d.metodo, monto, lleva_iva: d.lleva_iva, iva, iva_ret: '', isr: '', total: round2(monto + iva),
    usd: round2((monto + iva) / fxMes(mes)), usuario: d.usuario || 'NA', proveedor: d.proveedor, folio: d.folio || 'NA', invoice: '',
    recibo: d.fact === 'no' ? 'NO FACTURABLE' : '', prorrateado: d.prorrateado, meses_pr: d.meses_pr, ref_banco: '', eeff: '', contpaq: '', n8n: false,
    notas: d.fact === 'no' && d.motivo ? (d.notas ? d.notas + ' · ' : '') + d.motivo : d.notas,
    aprob: esTarjeta(d.metodo) ? 'pend_r' : 'pend_a', motivo_rechazo: '', creado: new Date().toISOString(), por: S.user
  };
  SRC.nuevos[codigo] = g;
  if (!(await dbSet('nuevos/' + docId(codigo), clon(g)))) { delete SRC.nuevos[codigo]; return; }
  log({ accion: 'creó', ent: 'gasto', ref: codigo, d: `${money(g.total)} · ${d.metodo}` });
  if (d.fact === 'con') {
    const c = cambio(codigo); c.facturas_add.push(d.facturaId); await guardarCambio(codigo);
    log({ accion: 'relacionó', ent: 'gasto', ref: codigo, campo: 'factura', d: fById(d.facturaId).archivo });
  }
  if (d.fact === 'no') log({ accion: 'marcó sin factura', ent: 'gasto', ref: codigo, campo: 'Receipt', d: 'NO FACTURABLE', c: d.motivo });
  S.draft = blankDraft();
  cambiar(() => {});
  toast(`Gasto ${codigo} guardado.`);
}

/* ============ B. Opex ============ */
const COLS = [
  { k:'codigo', l:'ID', w:96, ro:true },
  { k:'vintage', l:'VINTAGE', w:124, ro:true, mono:true },
  { k:'fecha', l:'DATE', w:84, type:'date' },
  { k:'categoria', l:'Expense Category', w:160, opts: () => CATEGORIAS },
  { k:'area', l:'Area', w:130, opts: () => AREAS },
  { k:'descripcion', l:'Description', w:240 },
  { k:'tipo', l:'Expense Type', w:110, opts: () => TIPOS },
  { k:'metodo', l:'Payment Method', w:130, opts: () => METODOS },
  { k:'monto', l:'Amount', w:124, type:'money' },
  { k:'lleva_iva', l:'VAT ?', w:64, type:'bool' },
  { k:'iva', l:'VAT', w:110, type:'money' },
  { k:'iva_ret', l:'VAT Withholding', w:120, type:'money' },
  { k:'isr', l:'ISR', w:96, type:'money' },
  { k:'total', l:'Total Amount', w:128, type:'money' },
  { k:'usd', l:'USD', w:112, type:'money' },
  { k:'usuario', l:'User', w:160 },
  { k:'proveedor', l:'Provider', w:210 },
  { k:'folio', l:'Folio', w:160, mono:true },
  { k:'invoice', l:'Invoice', w:220, ro:true, get: g => facturasDe(g).map(f => f.archivo).join(', ') || g.invoice },
  { k:'recibo', l:'Receipt', w:140 },
  { k:'prorrateado', l:'Prorated', w:76, type:'bool' },
  { k:'meses_pr', l:'Prorated Period', w:110 },
  { k:'ref_banco', l:'Ref banco (n8n)', w:180, ro:true },
  { k:'notas', l:'Notas (interfaz)', w:220 }
];
const LEAD = [{ k:'_ef', l:'Estado factura', w:124 }, { k:'_ap', l:'Estado aprobación', w:140 }];
const ALL = LEAD.concat(COLS);
let filasGrid = [];

function opexRows() {
  const q = S.q.trim().toLowerCase();
  return gastos.filter(g => g.pestana === S.hoja && (!S.mes || mesG(g) === S.mes) && (!S.metodo || g.metodo === S.metodo) &&
    (!q || [g.codigo, g.descripcion, g.proveedor, g.categoria, g.area, g.folio, g.notas].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));
}
function viewOpex() {
  const f = faltaList().length, p = pendList().length, c = concList().length;
  const tabs = `
    <div class="tabs" role="tablist">
      <button role="tab" aria-selected="${S.tab === 'opex'}" data-tab="opex">Budget <span class="count">${gastos.length + otras.FINANCIAL.filas.length + otras.INCOME.filas.length}</span></button>
      <button role="tab" aria-selected="${S.tab === 'falta'}" data-tab="falta">Falta factura <span class="count bad">${f}</span></button>
      <button role="tab" aria-selected="${S.tab === 'pend'}" data-tab="pend">Pendientes de pago <span class="count warn">${p}</span></button>
      <button role="tab" aria-selected="${S.tab === 'conc'}" data-tab="conc">Por conciliar (tarjeta) <span class="count warn">${c}</span></button>
    </div>`;
  let body = '';
  if (S.tab === 'opex') body = ['FINANCIAL', 'INCOME'].includes(S.hoja) ? otraGrid() : opexGrid();
  if (S.tab === 'falta') body = faltaTable();
  if (S.tab === 'pend') body = pendTable();
  if (S.tab === 'conc') body = concTable();
  return body + tabs;
}
function hojaChips() {
  const n = h => ['FINANCIAL', 'INCOME'].includes(h) ? otras[h].filas.length : gastos.filter(g => g.pestana === h).length;
  return `<div class="chips" role="group" aria-label="Pestaña del Budget">${HOJAS.map(h => `<button class="chip-f" aria-pressed="${S.hoja === h}" data-hoja="${h}">${h} · ${n(h)}</button>`).join('')}</div>`;
}
function mesChips(meses) {
  return `<div class="chips" role="group" aria-label="Filtrar por mes">
      <button class="chip-f" aria-pressed="${!S.mes}" data-mes="">TODOS</button>
      ${meses.map(m => `<button class="chip-f" aria-pressed="${S.mes === m}" data-mes="${m}">${MESES[m - 1]}</button>`).join('')}
    </div>`;
}
function opexGrid() {
  const rows = opexRows();
  filasGrid = rows.slice(0, S.limite);
  const mesesConDatos = [...new Set(gastos.filter(g => g.pestana === S.hoja).map(mesG).filter(Boolean))].sort((a, b) => a - b);
  let left = 0; const stickyLeft = {};
  ALL.slice(0, 3).forEach(c => { stickyLeft[c.k] = left; left += c.w; });
  const thStyle = c => `style="min-width:${c.w}px;max-width:${c.w}px${stickyLeft[c.k] !== undefined ? `;left:${stickyLeft[c.k]}px` : ''}"`;
  const cls = c => stickyLeft[c.k] !== undefined ? 'stk' : '';
  const sum = k => rows.reduce((s, g) => s + (+g[k] || 0), 0);
  const mesFx = S.mes || Math.max(0, ...Object.keys(FX).map(Number));
  return `
  <div class="toolbar">${hojaChips()}</div>
  <div class="toolbar">
    ${mesChips(mesesConDatos)}
    <span class="grow"></span>
    <select id="o_met" aria-label="Filtrar por método de pago"><option value="">Todos los métodos</option>${METODOS.map(m => `<option ${S.metodo === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>
    <input type="text" id="o_q" placeholder="Buscar ID, proveedor, descripción, folio…" value="${esc(S.q)}" aria-label="Buscar">
    ${FX[mesFx] ? `<span class="fx">Dólar ${MESES[mesFx - 1]}: $${FX[mesFx].toFixed(4)}</span>` : ''}
  </div>
  <div class="sheet">
    <div class="grid-wrap" id="gridWrap">
      <table class="grid" id="grid">
        <thead><tr>${ALL.map(c => `<th class="${cls(c)}" ${thStyle(c)}>${esc(c.l)}</th>`).join('')}</tr></thead>
        <tbody>
        ${filasGrid.length ? filasGrid.map((g, ri) => `<tr>${ALL.map((c, ci) => cell(g, c, ri, ci, stickyLeft)).join('')}</tr>`).join('')
          : `<tr><td class="empty" colspan="${ALL.length}">No hay gastos con estos filtros. Quita el filtro de mes o de método para ver más.</td></tr>`}
        </tbody>
        <tfoot><tr>${ALL.map(c => {
          const st2 = stickyLeft[c.k] !== undefined ? `style="left:${stickyLeft[c.k]}px"` : '';
          let v = '';
          if (c.k === '_ef') v = `${rows.length} gastos`;
          if (['monto', 'iva', 'total', 'usd'].includes(c.k)) v = money(sum(c.k));
          return `<td class="${cls(c)} ${c.type === 'money' ? 'num' : ''}" ${st2}>${v}</td>`;
        }).join('')}</tr></tfoot>
      </table>
      ${masBtn(filasGrid.length, rows.length, 'mas-opex')}
    </div>
    <div class="statusbar"><span id="selInfo">Selecciona celdas (clic y Mayús+clic) para ver la suma.</span><span>Doble clic o Enter para editar · cada cambio queda en la bitácora</span></div>
  </div>`;
}
function otraGrid() {
  const t = otras[S.hoja], q = S.q.trim().toLowerCase();
  const meses = [...new Set(t.filas.map(o => mesDe(o.vintage)).filter(Boolean))].sort((a, b) => a - b);
  const rows = t.filas.filter(o => (!S.mes || mesDe(o.vintage) === S.mes) && (!q || Object.values(o).join(' ').toLowerCase().includes(q)));
  const vis = rows.slice(0, S.limite);
  const keys = t.enc.map(h => norm(h));
  const esNum = k => rows.some(o => typeof o[k] === 'number');
  const fmt = (o, k) => typeof o[k] === 'number' ? money(o[k]) : esc(o[k]);
  const totalK = keys.find(k => ['total mxn', 'ingreso'].includes(k));
  return `
  <div class="toolbar">${hojaChips()}</div>
  <div class="toolbar">
    ${mesChips(meses)}
    <span class="grow"></span>
    <input type="text" id="o_q" placeholder="Buscar en ${S.hoja}…" value="${esc(S.q)}" aria-label="Buscar">
  </div>
  <div class="sheet">
    <div class="grid-wrap">
      <table class="grid">
        <thead><tr>${t.enc.map(h => `<th style="min-width:110px">${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${vis.length ? vis.map(o => `<tr>${keys.map(k => `<td class="${esNum(k) ? 'num' : ''}" title="${esc(o[k])}">${fmt(o, k)}</td>`).join('')}</tr>`).join('')
          : `<tr><td class="empty" colspan="${keys.length || 1}">No hay renglones con estos filtros.</td></tr>`}</tbody>
      </table>
      ${masBtn(vis.length, rows.length, 'mas-opex')}
    </div>
    <div class="statusbar"><span>${rows.length} renglones${totalK ? ` · ${money(rows.reduce((s, o) => s + (+o[totalK] || 0), 0))}` : ''}</span><span>Solo lectura · ${S.hoja === 'INCOME' ? 'ingresos de tesorería' : 'gastos financieros'}</span></div>
  </div>`;
}
function cellText(g, c) {
  const v = c.get ? c.get(g) : g[c.k];
  if (c.type === 'money') return money(v === '' ? '' : v);
  if (c.type === 'bool') return v ? 'TRUE' : 'FALSE';
  if (c.type === 'date') return dmy(v);
  return v ?? '';
}
function cell(g, c, ri, ci, stickyLeft) {
  const stl = stickyLeft[c.k] !== undefined ? `left:${stickyLeft[c.k]}px;` : '';
  const base = `data-r="${ri}" data-c="${ci}" style="${stl}min-width:${c.w}px;max-width:${c.w}px"`;
  const sk = stickyLeft[c.k] !== undefined ? ' stk' : '';
  if (c.k === '_ef') { const e = estadoFactura(g); return `<td class="${sk}" ${base}>${st(e.c, e.l)}</td>`; }
  if (c.k === '_ap') { const a = APROB[g.aprob] || APROB.aprob; return `<td class="${sk}" ${base}>${st(a.c, a.l)}</td>`; }
  if (c.k === 'codigo') return `<td class="id${sk}" ${base} data-open-gasto="${esc(g.codigo)}" title="Ver detalle">${esc(g.codigo)}</td>`;
  const k = [c.type === 'money' ? 'num' : '', c.mono ? 'mono' : '', sk.trim()].filter(Boolean);
  const t = cellText(g, c);
  return `<td class="${k.join(' ')}" ${base} title="${esc(t)}">${esc(t)}</td>`;
}
function selectCells(r1, c1, r2, c2) {
  S.sel = { r1: Math.min(r1, r2), r2: Math.max(r1, r2), c1: Math.min(c1, c2), c2: Math.max(c1, c2) };
  let n = 0, s = 0, nums = 0;
  document.querySelectorAll('#grid tbody td[data-r]').forEach(td => {
    const r = +td.dataset.r, c = +td.dataset.c;
    const inSel = r >= S.sel.r1 && r <= S.sel.r2 && c >= S.sel.c1 && c <= S.sel.c2;
    td.classList.toggle('sel', inSel && !(r1 === r2 && c1 === c2));
    td.classList.toggle('active', r === r1 && c === c1 && S.anchor && S.anchor.r === r && S.anchor.c === c);
    if (inSel) {
      n++;
      const col = ALL[c], g = filasGrid[r];
      if (col && g && col.type === 'money') { const v = +(col.get ? col.get(g) : g[col.k]); if (!isNaN(v) && g[col.k] !== '') { s += v; nums++; } }
    }
  });
  $('#selInfo').textContent = nums ? `Suma: ${money(s)} · Promedio: ${money(s / nums)} · Recuento: ${n}` : `Recuento: ${n}`;
}
function editCell(td) {
  const ci = +td.dataset.c, col = ALL[ci], g = filasGrid[+td.dataset.r];
  if (!col || !g || col.k === '_ef' || col.k === 'codigo') { if (g) openGasto(g.codigo); return; }
  if (col.ro) { if (col.k === 'invoice') openGasto(g.codigo); return; }
  if (col.k === '_ap') {
    if (!esTarjeta(g.metodo)) { openGasto(g.codigo); return; }   // aprobar o rechazar se hace desde el detalle (rechazar pide motivo)
    td.innerHTML = `<select aria-label="Estado de revisión">${['pend_r', 'rev'].map(o => `<option value="${o}" ${g.aprob === o ? 'selected' : ''}>${APROB[o].l}</option>`).join('')}</select>`;
  } else if (col.type === 'bool') {
    setField(g, col, !g[col.k]); return;
  } else if (col.opts) {
    td.innerHTML = `<select aria-label="${esc(col.l)}"><option value=""></option>${col.opts().map(o => `<option ${g[col.k] === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  } else {
    const type = col.type === 'date' ? 'date' : col.type === 'money' ? 'number' : 'text';
    td.innerHTML = `<input type="${type}" ${type === 'number' ? 'step="0.01"' : ''} aria-label="${esc(col.l)}" value="${esc(g[col.k])}">`;
  }
  S.editing = { code: g.codigo, ci };
  const inp = td.querySelector('input,select'); inp.focus(); if (inp.select) inp.select();
  const commit = () => {
    if (!S.editing) return; S.editing = null;
    let v = inp.value;
    if (col.k === '_ap') { if (v !== g.aprob) setAprob(g, v); else render(); return; }
    if (col.type === 'money') v = v === '' ? '' : round2(parseFloat(v));
    if (String(v) !== String(g[col.k] ?? '')) setField(g, col, v); else render();
  };
  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } if (e.key === 'Escape') { S.editing = null; render(); } });
  if (inp.tagName === 'SELECT') inp.addEventListener('change', () => inp.blur());
}
function setField(g, col, v) {
  const before = cellText(g, col);
  const c = cambio(g.codigo);
  c.campos[col.k] = v;
  if (col.k === 'fecha') c.campos.vintage = vintageDe(v);
  if (col.k === 'metodo') {
    const t = esTarjeta(v);
    if (t && ['pend_a', 'aprob', 'rech'].includes(g.aprob)) c.aprob = 'pend_r';
    if (!t && ['pend_r', 'rev'].includes(g.aprob)) c.aprob = 'pend_a';
  }
  Object.assign(g, c.campos); if (c.aprob) g.aprob = c.aprob;
  const accion = col.k === 'recibo' && /^no fact/i.test(v) ? 'marcó sin factura' : 'editó';
  log({ accion, ent: 'gasto', ref: g.codigo, campo: col.l, a: before, d: cellText(g, col) });
  guardarCambio(g.codigo);
  cambiar(() => {});
  toast(`${g.codigo}: ${col.l} actualizado.`);
}
function setAprob(g, v, motivo) {
  const before = (APROB[g.aprob] || APROB.aprob).l;
  const c = cambio(g.codigo); c.aprob = v;
  if (v === 'rech') c.motivo_rechazo = motivo || '';
  const acc = { aprob: 'aprobó', rech: 'rechazó', rev: 'revisó', pend_a: 'regresó a pendiente', pend_r: 'regresó a pendiente' }[v];
  log({ accion: acc, ent: 'gasto', ref: g.codigo, campo: 'Estado aprobación', a: before, d: APROB[v].l, c: motivo || '' });
  guardarCambio(g.codigo);
  cambiar(() => {});
  if ($('.drawer')) openGasto(g.codigo);
  toast(`${g.codigo}: ${APROB[v].l}.`);
}

function faltaTable() {
  const all = faltaList(), rows = all.slice(0, S.llimite);
  if (!all.length) return `<div class="empty-note">No hay gastos con falta de factura. Todo está relacionado o marcado como "Sin factura".</div>`;
  return `<div class="sheet"><div class="grid-wrap"><table class="list">
    <thead><tr><th>ID</th><th>Fecha</th><th>Días sin factura</th><th>Proveedor</th><th>Descripción</th><th>Método</th><th>Aprobación</th><th style="text-align:right">Total</th><th style="text-align:right">Acciones</th></tr></thead>
    <tbody>${rows.map(g => { const d = daysSince(g.fecha), a = APROB[g.aprob] || APROB.aprob; return `<tr>
      <td class="mono"><button class="btn link" data-open-gasto="${esc(g.codigo)}">${esc(g.codigo)}</button><div class="muted">${esc(g.pestana)}</div></td>
      <td>${dmy(g.fecha)}<div class="muted">${esc(g.vintage)}</div></td>
      <td><span class="age ${d > 30 ? 'old' : ''}">${d} días</span></td>
      <td>${esc(g.proveedor)}</td><td>${esc(g.descripcion)}</td><td>${esc(g.metodo)}</td><td>${st(a.c, a.l)}</td>
      <td class="num">${money(g.total)}</td>
      <td><div class="acts"><button class="btn sm primary" data-act="relate-gasto" data-code="${esc(g.codigo)}">Relacionar factura</button><button class="btn sm" data-act="no-factura" data-code="${esc(g.codigo)}">Sin factura</button></div></td>
    </tr>`; }).join('')}</tbody></table>${masBtn(rows.length, all.length, 'mas-falta')}</div>
    <div class="statusbar"><span>${all.length} gastos · ${money(all.reduce((s, g) => s + (+g.total || 0), 0))}</span><span>Del más reciente al más antiguo · sin Invoice ni Receipt en el Budget</span></div></div>`;
}
function pendTable() {
  const rows = pendList();
  if (!rows.length) return `<div class="empty-note">No hay facturas pendientes de pago ni por validar.</div>`;
  return `<div class="sheet"><div class="grid-wrap"><table class="list">
    <thead><tr><th>Factura</th><th>Fecha</th><th>Emisor</th><th>Estado</th><th>Días</th><th>Banco sugerido</th><th>Gasto</th><th style="text-align:right">Total</th><th style="text-align:right">Acciones</th></tr></thead>
    <tbody>${rows.map(f => { const d = f.fecha ? daysSince(f.fecha) : null, e = estadoDoc(f), gs = gastosDe(f); return `<tr>
      <td><button class="btn link" data-open-factura="${esc(f.id)}">${esc(f.archivo)}</button><div class="muted">${esc(f.carpeta || 'Sin carpeta de mes')}</div></td>
      <td>${f.fecha ? dmy(f.fecha) : '<span class="nodata">sin datos</span>'}</td>
      <td>${f.emisor ? esc(f.emisor) : '<span class="nodata">sin datos</span>'}<div class="muted mono">${esc(f.rfc)}</div></td>
      <td>${st(e.c, e.l)}${f.slackTs ? `<div class="muted">Pedida en Slack</div>` : ''}</td>
      <td>${d === null ? '—' : `<span class="age ${d > 30 ? 'old' : ''}">${d} días</span>`}</td>
      <td>${esc(f.metodoSug || '—')}</td>
      <td>${gs.length ? gs.map(g => `<button class="btn link" data-open-gasto="${esc(g.codigo)}">${esc(g.codigo)}</button>`).join(' ') : '—'}</td>
      <td class="num">${f.total == null || f.total === '' ? '<span class="nodata">sin datos</span>' : money(f.total, f.moneda)}</td>
      <td><div class="acts">${e.k === 'pend'
        ? `<button class="btn sm primary" data-act="marcar-pagada" data-id="${esc(f.id)}">Marcar pagada</button>`
        : `<button class="btn sm primary" data-act="registrar-desde" data-id="${esc(f.id)}">Registrar gasto</button><button class="btn sm" data-act="relate-factura" data-id="${esc(f.id)}">Relacionar</button>`}</div></td>
    </tr>`; }).join('')}</tbody></table></div>
    <div class="statusbar"><span>${rows.length} facturas · ${money(rows.reduce((s, f) => s + (totalMXN(f) || 0), 0))} MXN</span><span>Pendientes de pago (con mensaje en Slack) y por validar (sin gasto todavía)</span></div></div>`;
}
function concTable() {
  const rows = concList();
  if (!rows.length) return `<div class="empty-note">Todas las facturas de tarjeta están conciliadas con su cargo.</div>`;
  return `<div class="sheet"><div class="grid-wrap"><table class="list">
    <thead><tr><th>Factura</th><th>Fecha</th><th>Emisor</th><th>Tarjeta</th><th>Días sin conciliar</th><th>Gasto</th><th style="text-align:right">Total</th><th style="text-align:right">Acciones</th></tr></thead>
    <tbody>${rows.map(f => { const d = f.fecha ? daysSince(f.fecha) : 0, gs = gastosDe(f); return `<tr>
      <td><button class="btn link" data-open-factura="${esc(f.id)}">${esc(f.archivo)}</button><div class="muted">${esc(f.carpeta)}</div></td>
      <td>${dmy(f.fecha)}</td><td>${esc(f.emisor)}</td><td>${esc(f.metodoSug || 'Tarjeta')}</td>
      <td><span class="age ${d > 30 ? 'old' : ''}">${d} días</span></td>
      <td>${gs.length ? gs.map(g => `<button class="btn link" data-open-gasto="${esc(g.codigo)}">${esc(g.codigo)}</button>`).join(' ') : '—'}</td>
      <td class="num">${money(f.total, f.moneda)}${f.moneda === 'USD' ? `<div class="muted">≈ ${money(totalMXN(f))} MXN</div>` : ''}</td>
      <td><div class="acts"><button class="btn sm primary" data-act="marcar-pagada" data-id="${esc(f.id)}">Marcar conciliada</button>${gs.length ? '' : `<button class="btn sm" data-act="relate-factura" data-id="${esc(f.id)}">Relacionar cargo</button>`}</div></td>
    </tr>`; }).join('')}</tbody></table></div>
    <div class="statusbar"><span>${rows.length} facturas de tarjeta ya pagadas</span><span>n8n las concilia con el estado de cuenta cuando llegan los movimientos de Metabase</span></div></div>`;
}

/* ============ Detalle de gasto ============ */
function histFor(ent, ref) {
  const h = bitacora.filter(b => b.ref === ref).slice().reverse();
  if (!h.length) return `<p class="hint">Sin cambios registrados${ent === 'gasto' ? ' desde la carga del histórico' : ''}.</p>`;
  return `<div class="hist"><ul>${h.map(b => `<li><div class="when">${fmtT(b.t)} · ${esc(b.u)}</div><div><b>${esc(b.accion)}</b>${b.campo ? ` ${esc(b.campo)}` : ''}</div>${diffHtml(b)}${b.c ? `<div class="muted">${esc(b.c)}</div>` : ''}</li>`).join('')}</ul></div>`;
}
const diffHtml = b => (b.a || b.d) ? `<div class="diff">${b.a ? `<del>${esc(b.a)}</del> → ` : ''}<ins>${esc(b.d)}</ins></div>` : '';

function openGasto(code) {
  const g = gByCode(code); if (!g) return;
  const ef = estadoFactura(g), ap = APROB[g.aprob] || APROB.aprob, fs = facturasDe(g), tarjeta = esTarjeta(g.metodo);
  let acts = '';
  if (!tarjeta && g.aprob === 'pend_a') acts += `<button class="btn primary" data-act="aprobar" data-code="${esc(code)}">Aprobar</button><button class="btn danger" data-act="rechazar" data-code="${esc(code)}">Rechazar</button>`;
  if (!tarjeta && g.aprob === 'rech') acts += `<button class="btn" data-act="reabrir" data-code="${esc(code)}">Volver a pendiente</button>`;
  if (tarjeta && g.aprob === 'pend_r') acts += `<button class="btn primary" data-act="revisar" data-code="${esc(code)}">Marcar revisado</button>`;
  if (ef.k === 'falta') acts += `<button class="btn" data-act="relate-gasto" data-code="${esc(code)}">Relacionar factura</button><button class="btn" data-act="no-factura" data-code="${esc(code)}">Sin factura (no requiere)</button>`;
  const origen = g.origen === 'interfaz' ? 'Registrado en esta interfaz; todavía no está en el Budget.' : g.n8n ? `Creado por n8n · ${g.ref_banco}` : '';
  drawer(`${code} · ${g.descripcion}`, `${dmy(g.fecha)} · ${g.vintage} · ${g.metodo} · ${g.pestana}`, `
    <div class="acts-row">${st(ef.c, ef.l)}${st(ap.c, ap.l)}</div>
    ${origen ? `<div class="rule">${esc(origen)}</div>` : ''}
    ${g.aprob === 'rech' && g.motivo_rechazo ? `<div class="rule">Motivo del rechazo: ${esc(g.motivo_rechazo)}</div>` : ''}
    ${acts ? `<div class="acts-row">${acts}</div>` : ''}
    <section><h4>Movimiento</h4><dl class="kv">
      <dt>Proveedor</dt><dd>${esc(g.proveedor || '—')}</dd><dt>Amount</dt><dd>${money(g.monto)}</dd><dt>VAT</dt><dd>${money(g.iva) || '—'}</dd>
      <dt>Total</dt><dd><b>${money(g.total)}</b></dd><dt>USD</dt><dd>${money(g.usd) || '—'}</dd><dt>Folio</dt><dd class="mono">${esc(g.folio || '—')}</dd>
      <dt>Receipt</dt><dd>${esc(g.recibo || '—')}</dd><dt>User</dt><dd>${esc(g.usuario || '—')}</dd>
    </dl></section>
    <section><h4>Clasificación</h4><dl class="kv">
      <dt>Category</dt><dd>${esc(g.categoria || '—')}</dd><dt>Area</dt><dd>${esc(g.area || '—')}</dd><dt>Type</dt><dd>${esc(g.tipo || '—')}</dd>
      ${g.eeff ? `<dt>EEFF</dt><dd>${esc(g.eeff)}</dd>` : ''}${g.contpaq ? `<dt>Contpaq</dt><dd class="mono">${esc(g.contpaq)}</dd>` : ''}
      <dt>Notas</dt><dd>${esc(g.notas || '—')}</dd>
    </dl></section>
    <section><h4>Facturas relacionadas</h4>${fs.length ? fs.map(f => `<div class="linked"><span>📄 ${esc(f.archivo)}${f.total != null && f.total !== '' ? ' · ' + money(f.total, f.moneda) : ''}</span><span class="acts-row"><button class="btn sm" data-open-factura="${esc(f.id)}">Ver</button>${f.origen === 'budget' ? '' : `<button class="btn sm danger" data-act="unlink" data-code="${esc(code)}" data-id="${esc(f.id)}">Quitar</button>`}</span></div>`).join('') : `<p class="hint">${ef.k === 'no' ? 'Marcado como gasto que no requiere factura.' : 'Ninguna todavía.'}</p>`}</section>
    <section><h4>Historial</h4>${histFor('gasto', code)}</section>`);
}

/* ============ C. Carpeta ============ */
const enCarpeta = (f, c) => f.carpeta === c || String(f.carpeta || '').startsWith(c + '/');
function folderTree() {
  const counts = {}; facturas.forEach(f => { const k = f.carpeta || '_root'; counts[k] = (counts[k] || 0) + 1; });
  const top = CARPETAS.filter(c => Object.keys(counts).some(k => k === c || k.startsWith(c + '/')));
  let h = `<div class="root">Facturas ${ANIO}</div><button aria-pressed="${S.carpeta === 'all'}" data-folder="all">Todas <span class="n">${facturas.length}</span></button>`;
  top.slice().reverse().forEach(c => {
    const n = facturas.filter(f => enCarpeta(f, c)).length;
    h += `<button aria-pressed="${S.carpeta === c}" data-folder="${c}">${c} <span class="n">${n}</span></button>`;
    Object.keys(counts).filter(k => k.startsWith(c + '/')).forEach(k => {
      h += `<button class="child" aria-pressed="${S.carpeta === k}" data-folder="${esc(k)}">${esc(k.split('/')[1])} <span class="n">${counts[k]}</span></button>`;
    });
  });
  if (counts._root) h += `<button aria-pressed="${S.carpeta === '_root'}" data-folder="_root">Sin carpeta de mes <span class="n">${counts._root}</span></button>`;
  return h;
}
function viewCarpeta() {
  const q = S.fq.trim().toLowerCase();
  const all = facturas.filter(f => {
    if (S.carpeta === '_root') { if (f.carpeta) return false; }
    else if (S.carpeta !== 'all' && !(S.carpeta.includes('/') ? f.carpeta === S.carpeta : enCarpeta(f, S.carpeta))) return false;
    if (S.fEstado && estadoDoc(f).k !== S.fEstado) return false;
    return !q || [f.archivo, f.emisor, f.rfc, f.uuid, f.gastoId].join(' ').toLowerCase().includes(q);
  }).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  const rows = all.slice(0, S.flimite);
  const estados = [['', 'Todos los estados'], ['pend', 'Pendiente de pago'], ['val', 'Por validar'], ['conc', 'Tarjeta · por conciliar'], ['pag', 'Pagada'], ['rel', 'Relacionada'], ['comp', 'Complemento'], ['desc', 'Descartada'], ['nof', 'No es factura']];
  return `
  <div class="folder">
    <nav class="tree" aria-label="Carpetas">${folderTree()}</nav>
    <div style="min-width:0">
      <div class="toolbar">
        <select id="c_est" aria-label="Filtrar por estado">${estados.map(([v, l]) => `<option value="${v}" ${S.fEstado === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <input type="text" id="c_q" placeholder="Archivo, emisor, RFC, UUID o ID de gasto" value="${esc(S.fq)}" aria-label="Buscar factura">
        <span class="grow"></span>
        <a class="btn" href="${CARPETA_DRIVE}" target="_blank" rel="noopener">Abrir carpeta en Drive</a>
      </div>
      ${rows.length ? `<div class="scroll-x" style="border:1px solid var(--line);border-radius:10px;background:var(--surface)"><table class="list">
        <thead><tr><th>Factura</th><th>Emisor</th><th>Fecha</th><th>Origen</th><th>Gasto</th><th>Estado</th><th style="text-align:right">Total</th></tr></thead>
        <tbody>${rows.map(f => { const e = estadoDoc(f), gs = gastosDe(f); return `<tr class="click" data-open-factura="${esc(f.id)}">
          <td><div class="fname"><span class="ico ${f.ext}">${esc(String(f.ext).toUpperCase())}</span><span title="${esc(f.archivo)}">${esc(f.archivo)}</span></div><div class="muted">${esc(f.carpeta || 'Sin carpeta de mes')}</div></td>
          <td>${f.emisor ? esc(f.emisor) : '<span class="nodata">sin datos</span>'}<div class="muted mono">${esc(f.rfc || '')}</div></td>
          <td>${f.fecha ? dmy(f.fecha) : '<span class="nodata">sin datos</span>'}</td>
          <td>${f.origen === 'n8n' ? 'n8n' : 'Budget'}</td><td class="mono">${esc(gs.map(g => g.codigo).join(', ') || '—')}</td><td>${st(e.c, e.l)}</td>
          <td class="num">${f.total == null || f.total === '' ? '<span class="nodata">sin datos</span>' : f.tipo === 'P' ? '—' : money(f.total, f.moneda)}</td>
        </tr>`; }).join('')}</tbody></table>${masBtn(rows.length, all.length, 'mas-facturas')}</div>`
      : `<div class="empty-note">No hay facturas en esta carpeta con ese filtro.</div>`}
    </div>
  </div>`;
}
const tipoLabel = t => ({ I: 'Factura (I)', E: 'Nota de crédito (E)', P: 'Pago', T: 'Traslado', N: 'Nómina', extranjero: 'Invoice' }[t] || '—');

function openFactura(id) {
  const f = fById(id); if (!f) return;
  const e = estadoDoc(f), gs = gastosDe(f);
  const sinIva = f.subtotal !== '' && f.subtotal != null;
  const paper = f.origen === 'n8n' && f.datos ? `
    <div class="paper">
      <div class="ph"><div><b>${esc(f.emisor)}</b><div class="mono">${esc(f.rfc || 'Sin RFC (extranjero)')}</div></div><div style="text-align:right">${tipoLabel(f.tipo)}<div>${dmy(f.fecha)}</div></div></div>
      ${f.uuid ? `<div class="uuid">UUID ${esc(f.uuid.toUpperCase())}</div>` : ''}
      ${f.receptor ? `<div>Receptor: <span class="mono">${esc(f.receptor)}</span></div>` : ''}
      ${f.conceptos ? `<div class="muted">${esc(f.conceptos.slice(0, 220))}</div>` : ''}
      ${sinIva ? `<div class="line"><span>Subtotal</span><span>${money(f.subtotal, f.moneda)}</span></div>` : ''}
      ${f.ivaF !== '' && f.ivaF != null ? `<div class="line"><span>IVA trasladado</span><span>${money(f.ivaF, f.moneda)}</span></div>` : ''}
      <div class="line tot"><span>Total</span><span>${money(f.total, f.moneda)}</span></div>
    </div>` : f.origen === 'budget' ? `<div class="paper blank"><div><b>${esc(f.archivo)}</b><br>Factura registrada en la columna Invoice del Budget.</div></div>`
    : `<div class="paper blank"><div><b>${esc(f.archivo)}</b><br>n8n no pudo leer los datos del CFDI: revisa el PDF.</div></div>`;
  let acts = '';
  if (e.k === 'pend') acts += `<button class="btn primary" data-act="marcar-pagada" data-id="${esc(id)}">Marcar pagada</button>`;
  if (e.k === 'conc') acts += `<button class="btn primary" data-act="marcar-pagada" data-id="${esc(id)}">Marcar conciliada</button>`;
  if (e.k === 'val') acts += `<button class="btn primary" data-act="registrar-desde" data-id="${esc(id)}">Registrar gasto</button><button class="btn" data-act="relate-factura" data-id="${esc(id)}">Relacionar con gasto</button><button class="btn" data-act="descartar" data-id="${esc(id)}">Descartar</button>`;
  if (['pend', 'val', 'conc'].includes(e.k)) acts += `<button class="btn" data-act="no-es-factura" data-id="${esc(id)}">No es factura</button>`;
  if (['pag', 'nof', 'desc'].includes(e.k) && f.estadoUI) acts += `<button class="btn" data-act="reabrir-factura" data-id="${esc(id)}">Deshacer: volver a ${esc(estadoDoc(Object.assign({}, f, { estadoUI: '' })).l.toLowerCase())}</button>`;
  const links = [f.link ? `<a class="btn sm" href="${esc(f.link)}" target="_blank" rel="noopener">Abrir archivo</a>` : '',
    f.slackTs ? `<a class="btn sm" href="${SLACK_CANAL}${esc(f.slackTs.replace('.', ''))}" target="_blank" rel="noopener">Ver en Slack</a>` : ''].join('');
  drawer(f.archivo, `${f.carpeta || 'Sin carpeta de mes'} · ${f.origen === 'n8n' ? 'registrada por n8n' : 'Budget'}`, `
    <div class="acts-row">${st(e.c, e.l)}${links}</div>
    ${f.motivo ? `<div class="rule">${esc(f.motivo)}</div>` : ''}
    ${acts ? `<div class="acts-row">${acts}</div>` : ''}
    ${paper}
    ${f.origen === 'n8n' ? `<section><h4>Datos</h4><dl class="kv">
      <dt>Tipo</dt><dd>${tipoLabel(f.tipo)}</dd><dt>Método / forma</dt><dd>${esc(f.metodo || '—')} · ${esc(f.forma || '—')}</dd>
      <dt>Clasificación</dt><dd>${esc(f.clas || '—')}${f.categoria ? ` · ${esc(f.categoria)}/${esc(f.area)}` : ''}</dd>
      <dt>Destino</dt><dd>${esc(f.destino || '—')}</dd><dt>Banco sugerido</dt><dd>${esc(f.metodoSug || '—')}</dd>
      <dt>Llegó por</dt><dd>${esc(f.origenN8n || '—')}${f.buzon ? ' · ' + esc(f.buzon) : ''}</dd>
      ${f.asunto ? `<dt>Asunto</dt><dd>${esc(f.asunto)}</dd>` : ''}${f.sugerido ? `<dt>Gastos parecidos</dt><dd class="mono">${esc(f.sugerido)}</dd>` : ''}
    </dl></section>` : ''}
    <section><h4>Gastos relacionados</h4>${gs.length ? gs.map(g => `<div class="linked"><span><span class="mono">${esc(g.codigo)}</span> · ${dmy(g.fecha)} · ${money(g.total)}</span><button class="btn sm" data-open-gasto="${esc(g.codigo)}">Ver</button></div>`).join('') : '<p class="hint">Ninguno.</p>'}</section>
    <section><h4>Historial</h4>${histFor('factura', f.id)}</section>`);
}

/* ============ D. Bitácora ============ */
function viewBitacora() {
  const acciones = uniq(bitacora.map(b => b.accion));
  const usuarios = uniq(bitacora.map(b => b.u).concat(USUARIOS));
  const q = S.bq.trim().toLowerCase();
  const all = bitacora.filter(b => (!S.bU || b.u === S.bU) && (!S.bA || b.accion === S.bA) && (!S.bE || b.ent === S.bE) &&
    (!q || [b.ref, b.campo, b.a, b.d, b.c].join(' ').toLowerCase().includes(q))).slice().reverse();
  const rows = all.slice(0, S.blimite);
  return `
  <div class="toolbar">
    <select id="b_u" aria-label="Usuario"><option value="">Todos los usuarios</option>${usuarios.map(u => `<option ${S.bU === u ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select>
    <select id="b_a" aria-label="Acción"><option value="">Todas las acciones</option>${acciones.map(a => `<option ${S.bA === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
    <select id="b_e" aria-label="Objeto"><option value="">Gastos y facturas</option><option value="gasto" ${S.bE === 'gasto' ? 'selected' : ''}>Solo gastos</option><option value="factura" ${S.bE === 'factura' ? 'selected' : ''}>Solo facturas</option></select>
    <input type="text" id="b_q" placeholder="ID de gasto, factura, valor…" value="${esc(S.bq)}" aria-label="Buscar en bitácora">
  </div>
  ${rows.length ? `<div class="scroll-x" style="border:1px solid var(--line);border-radius:10px;background:var(--surface)"><table class="list">
    <thead><tr><th>Fecha y hora</th><th>Usuario</th><th>Acción</th><th>Objeto</th><th>Campo</th><th>Antes → después</th><th>Comentario</th></tr></thead>
    <tbody>${rows.map(b => `<tr>
      <td class="mono">${fmtT(b.t)}</td><td>${esc(b.u)}${b.canal !== 'interfaz' ? `<div class="muted">${esc(b.canal)}</div>` : ''}</td><td><b>${esc(b.accion)}</b></td>
      <td>${b.ent === 'gasto' ? `<button class="btn link" data-open-gasto="${esc(b.ref)}">${esc(b.ref)}</button>` : b.ent === 'factura' ? `<button class="btn link" data-open-factura="${esc(b.ref)}">${esc(fById(b.ref)?.archivo || b.ref)}</button>` : esc(b.ref)}</td>
      <td>${esc(b.campo || '—')}</td><td>${diffHtml(b) || '—'}</td><td class="muted">${esc(b.c || '')}</td>
    </tr>`).join('')}</tbody></table>${masBtn(rows.length, all.length, 'mas-bitacora')}</div>` : `<div class="empty-note">No hay cambios con esos filtros. Aquí aparece lo que hace n8n en cada corrida y lo que se cambia en esta interfaz.</div>`}
  <p class="hint">${bitacora.length} cambios registrados. La bitácora solo se agrega; no tiene botones de editar ni borrar.</p>`;
}

/* ============ Panel y modal ============ */
function drawer(title, sub, html) {
  $('#overlay').innerHTML = `<div class="drawer-bg" data-act="close"></div>
    <aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header><div><h3>${esc(title)}</h3><p>${esc(sub)}</p></div><button class="x" data-act="close" aria-label="Cerrar">×</button></header>
      <div class="body">${html}</div></aside>`;
  $('.drawer .x').focus();
}
function modal(title, html) {
  $('#overlay').insertAdjacentHTML('beforeend', `<div class="drawer-bg" data-act="close-modal" style="z-index:50"></div>
    <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><h3>${esc(title)}</h3><button class="x" data-act="close-modal" aria-label="Cerrar">×</button></header><div class="body">${html}</div></div>`);
}
function closeModal() { document.querySelectorAll('.modal, .drawer-bg[data-act="close-modal"]').forEach(n => n.remove()); }
function closeAll() { $('#overlay').innerHTML = ''; }

function scoreMatch(g, f) {
  const tags = []; let s = 0;
  const gt = Math.abs(+g.total || 0), ft = totalMXN(f);
  if (ft != null && gt) {
    const diff = Math.abs(gt - Math.abs(ft)) / gt;
    if (diff < 0.005) { s += 50; tags.push(['Monto exacto', 1]); } else if (diff < 0.03) { s += 35; tags.push(['Monto ±3%', 1]); } else if (diff < 0.15) { s += 15; tags.push(['Monto cercano', 0]); }
  }
  const w = norm(g.proveedor || g.descripcion).split(/\s+/).find(x => x.length > 3);
  if (w && norm(f.emisor).includes(w)) { s += 35; tags.push(['Mismo proveedor', 1]); }
  if (f.fecha && g.fecha) { const dd = Math.abs((new Date(g.fecha) - new Date(f.fecha)) / 864e5); if (dd <= 5) { s += 15; tags.push([`±${Math.round(dd)} días`, 1]); } else if (dd <= 35) { s += 5; tags.push([`${Math.round(dd)} días de diferencia`, 0]); } }
  if (!f.datos) tags.push(['Sin datos: revisar el PDF', 0]);
  return { s: Math.min(100, s), tags };
}
const tagsHtml = t => t.map(([l, good]) => `<span class="tag ${good ? 'good' : ''}">${esc(l)}</span>`).join('');

function pickFacturaFor(g, onPick) {
  const cands = facturas.filter(f => ['pend', 'val', 'conc'].includes(estadoDoc(f).k) && !gastosDe(f).length)
    .map(f => ({ f, ...scoreMatch(g, f) })).sort((a, b) => b.s - a.s).slice(0, 12);
  modal(`Relacionar factura · ${g.codigo || 'nuevo gasto'}`, `
    <p class="hint">Facturas sin gasto, ordenadas por parecido con ${esc(g.proveedor || 'el gasto')} · ${money(g.total)} · ${dmy(g.fecha)}.</p>
    ${cands.length ? cands.map(c => `<div class="cand">
      <div style="min-width:0"><div class="t">${esc(c.f.archivo)}</div><div class="m">${c.f.emisor ? esc(c.f.emisor) : 'sin datos'} · ${c.f.fecha ? dmy(c.f.fecha) : 'sin fecha'} · ${c.f.total == null || c.f.total === '' ? 'sin monto' : money(c.f.total, c.f.moneda)}</div></div>
      <div style="display:flex;gap:10px;align-items:center"><span class="score" title="Parecido">${c.s}%</span><button class="btn sm primary" data-pick="${esc(c.f.id)}">Relacionar</button></div>
      <div class="tags">${tagsHtml(c.tags)}</div></div>`).join('') : '<div class="empty-note">No hay facturas sin relacionar.</div>'}`);
  document.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => onPick(b.dataset.pick)));
}
function pickGastoFor(f, onPick) {
  const card = estadoDoc(f).k === 'conc';
  const cands = gastos.filter(g => estadoFactura(g).k === 'falta' && (!card || esTarjeta(g.metodo)))
    .map(g => ({ g, ...scoreMatch(g, f) })).sort((a, b) => b.s - a.s).slice(0, 10);
  modal(card ? `Relacionar con cargo de tarjeta` : `Relacionar con gasto`, `
    <p class="hint">${card ? 'Cargos de tarjeta sin factura' : 'Gastos con falta de factura'}, ordenados por parecido con ${esc(f.emisor || f.archivo)}${f.total != null && f.total !== '' ? ' · ' + money(f.total, f.moneda) : ''}.</p>
    ${cands.length ? cands.map(c => `<div class="cand">
      <div style="min-width:0"><div class="t"><span class="mono">${esc(c.g.codigo)}</span> · ${esc(c.g.descripcion)}</div><div class="m">${esc(c.g.proveedor)} · ${dmy(c.g.fecha)} · ${esc(c.g.metodo)} · ${money(c.g.total)}</div></div>
      <div style="display:flex;gap:10px;align-items:center"><span class="score">${c.s}%</span><button class="btn sm primary" data-pick="${esc(c.g.codigo)}">Relacionar</button></div>
      <div class="tags">${tagsHtml(c.tags)}</div></div>`).join('') : `<div class="empty-note">No hay ${card ? 'cargos de tarjeta' : 'gastos'} sin factura. Usa "Registrar gasto".</div>`}`);
  document.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => onPick(b.dataset.pick)));
}
async function link(code, fid) {
  const c = cambio(code), f = fById(fid);
  c.facturas_add = [...new Set([...(c.facturas_add || []), fid])]; c.facturas_del = (c.facturas_del || []).filter(x => x !== fid);
  await guardarCambio(code);
  log({ accion: 'relacionó', ent: 'gasto', ref: code, campo: 'factura', d: f.archivo });
  log({ accion: 'relacionó', ent: 'factura', ref: fid, campo: 'gasto', d: code });
  closeAll(); cambiar(() => {}); toast(`${code} relacionado con ${f.archivo}.`);
}
async function marcarF(f, estado, accion) {
  const before = estadoDoc(f).l;
  await setEstadoF(f, estado);
  f.estadoUI = estado;
  log({ accion, ent: 'factura', ref: f.id, campo: 'Estado', a: before, d: estadoDoc(f).l });
  cambiar(() => {}); openFactura(f.id); toast(`${f.archivo}: ${estadoDoc(f).l}.`);
}

/* ============ Eventos ============ */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-go],[data-tab],[data-mes],[data-hoja],[data-folder],[data-open-gasto],[data-open-factura],[data-act]');
  if (!t || t.tagName === 'A' && t.getAttribute('href') && !t.dataset.go) return;
  if (t.dataset.go) { e.preventDefault(); navTo(t.dataset.go); return; }
  if (t.dataset.tab) { S.tab = t.dataset.tab; S.sel = null; render(); return; }
  if (t.dataset.hoja) { S.hoja = t.dataset.hoja; S.limite = LIMITE; S.mesAuto = false; S.mes = null; S.sel = null; render(); return; }
  if (t.dataset.mes !== undefined) { S.mes = t.dataset.mes ? +t.dataset.mes : null; S.mesAuto = false; S.limite = LIMITE; render(); return; }
  if (t.dataset.folder) { S.carpeta = t.dataset.folder; S.flimite = LIMITE; render(); return; }
  if (t.dataset.openGasto) { e.stopPropagation(); closeModal(); openGasto(t.dataset.openGasto); return; }
  if (t.dataset.openFactura) { e.stopPropagation(); closeModal(); openFactura(t.dataset.openFactura); return; }
  const a = t.dataset.act, code = t.dataset.code, id = t.dataset.id;
  if (a === 'close') closeAll();
  if (a === 'close-modal') closeModal();
  if (a === 'actualizar') { if (mcpRef && mcpRef.invalidate) mcpRef.invalidate(DRIVE).catch(() => {}).finally(vigilarFeed); else vigilarFeed(); }
  if (a === 'mas-opex') { S.limite += LIMITE; render(); }
  if (a === 'mas-falta') { S.llimite += LIMITE; render(); }
  if (a === 'mas-facturas') { S.flimite += LIMITE; render(); }
  if (a === 'mas-bitacora') { S.blimite += LIMITE; render(); }
  if (a === 'aprobar') setAprob(gByCode(code), 'aprob');
  if (a === 'revisar') setAprob(gByCode(code), 'rev');
  if (a === 'reabrir') setAprob(gByCode(code), 'pend_a');
  if (a === 'rechazar') {
    modal(`Rechazar ${code}`, `<label class="f" for="m_motivo">Motivo del rechazo (queda en la bitácora)<textarea id="m_motivo" placeholder="Monto no coincide con la cotización"></textarea></label>
      <div class="acts-row" style="justify-content:flex-end"><button class="btn" data-act="close-modal">Cancelar</button><button class="btn danger" id="m_ok">Rechazar gasto</button></div>`);
    $('#m_motivo').focus();
    $('#m_ok').addEventListener('click', () => { const m = $('#m_motivo').value.trim(); if (!m) { toast('Escribe el motivo del rechazo.'); return; } closeModal(); setAprob(gByCode(code), 'rech', m); });
  }
  if (a === 'no-factura') {
    const g = gByCode(code);
    modal(`${code} no requiere factura`, `<p class="hint">Se guarda "NO FACTURABLE" en Receipt y el gasto sale de la pestaña "Falta factura".</p>
      <label class="f" for="m_nf">Motivo<input type="text" id="m_nf" placeholder="Nómina, impuesto, comisión bancaria…"></label>
      <div class="acts-row" style="justify-content:flex-end"><button class="btn" data-act="close-modal">Cancelar</button><button class="btn primary" id="m_ok">Marcar sin factura</button></div>`);
    $('#m_nf').focus();
    $('#m_ok').addEventListener('click', async () => {
      const m = $('#m_nf').value.trim(); const c = cambio(code); c.campos.recibo = 'NO FACTURABLE';
      await guardarCambio(code);
      log({ accion: 'marcó sin factura', ent: 'gasto', ref: code, campo: 'Receipt', a: g.recibo, d: 'NO FACTURABLE', c: m });
      closeAll(); cambiar(() => {}); toast(`${code} marcado sin factura.`);
    });
  }
  if (a === 'relate-gasto') pickFacturaFor(gByCode(code), fid => link(code, fid));
  if (a === 'relate-factura') { const f = fById(id); pickGastoFor(f, c => link(c, id)); }
  if (a === 'unlink') {
    const f = fById(id), c = cambio(code);
    c.facturas_add = (c.facturas_add || []).filter(x => x !== id); c.facturas_del = [...new Set([...(c.facturas_del || []), id])];
    guardarCambio(code);
    log({ accion: 'desrelacionó', ent: 'gasto', ref: code, campo: 'factura', a: f.archivo, d: '' });
    cambiar(() => {}); openGasto(code); toast('Relación eliminada.');
  }
  if (a === 'marcar-pagada') { const f = fById(id); marcarF(f, 'pagada', estadoDoc(f).k === 'conc' ? 'concilió' : 'marcó pagada'); }
  if (a === 'no-es-factura') marcarF(fById(id), 'no_es_factura', 'editó');
  if (a === 'descartar') marcarF(fById(id), 'descartada', 'descartó');
  if (a === 'reabrir-factura') {
    const f = fById(id); const before = estadoDoc(f).l;
    delete SRC.cambiosF[f.id]; f.estadoUI = '';
    if (SRC.db) SRC.db.doc('cambios_f/' + docId(f.id)).delete().catch(() => toast('No se pudo deshacer. Intenta de nuevo.'));
    log({ accion: 'deshizo', ent: 'factura', ref: f.id, campo: 'Estado', a: before, d: estadoDoc(f).l });
    cambiar(() => {}); openFactura(f.id);
  }
  if (a === 'registrar-desde') {
    const f = fById(id); closeAll();
    const d = blankDraft();
    d.fecha = f.fecha || d.fecha; d.proveedor = f.emisor || ''; d.descripcion = (f.conceptos || f.emisor || f.archivo).split(' | ')[0].toUpperCase().slice(0, 60);
    const t = totalMXN(f);
    d.monto = t != null ? round2((f.subtotal !== '' && f.subtotal != null && f.moneda !== 'USD') ? f.subtotal : t / (f.ivaF ? 1.16 : 1)).toFixed(2) : '';
    d.metodo = f.metodoSug || (f.moneda === 'USD' ? 'BBVA USD' : 'BBVA'); d.categoria = f.categoria; d.area = f.area;
    d.fact = 'con'; d.facturaId = f.id; d.lleva_iva = !!f.ivaF;
    S.draft = d; navTo('registro');
    toast('Formulario llenado con los datos de la factura.');
  }
  if (a === 'pick-factura') {
    readDraft(); const d = S.draft;
    pickFacturaFor({ codigo: '', proveedor: d.proveedor, total: parseFloat(d.monto) || 0, fecha: d.fecha }, fid => { S.draft.facturaId = fid; closeModal(); render(); });
  }
  if (a === 'reset-draft') { S.draft = blankDraft(); render(); }
});
document.addEventListener('dblclick', e => { const td = e.target.closest('#grid td[data-c]'); if (td) editCell(td); });
document.addEventListener('mousedown', e => {
  const td = e.target.closest('#grid td[data-c]'); if (!td || S.editing || e.target.closest('input,select')) return;
  const r = +td.dataset.r, c = +td.dataset.c;
  if (e.shiftKey && S.anchor) { e.preventDefault(); selectCells(S.anchor.r, S.anchor.c, r, c); }
  else { S.anchor = { r, c }; selectCells(r, c, r, c); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if ($('.modal')) closeModal(); else if ($('.drawer')) closeAll(); }
  if (e.key === 'Enter' && S.screen === 'opex' && S.anchor && !S.editing && !$('.drawer') && document.activeElement === document.body) {
    const td = document.querySelector(`#grid td[data-r="${S.anchor.r}"][data-c="${S.anchor.c}"]`); if (td) { e.preventDefault(); editCell(td); }
  }
});
document.addEventListener('input', e => {
  const id = e.target.id;
  if (id === 'o_q') { S.q = e.target.value; S.limite = LIMITE; rerenderKeep(id); }
  if (id === 'c_q') { S.fq = e.target.value; S.flimite = LIMITE; rerenderKeep(id); }
  if (id === 'b_q') { S.bq = e.target.value; S.blimite = LIMITE; rerenderKeep(id); }
  if (e.target.closest('#regForm')) { readDraft(); syncRegistro(); }
});
document.addEventListener('change', e => {
  const id = e.target.id;
  if (id === 'o_met') { S.metodo = e.target.value; S.limite = LIMITE; render(); }
  if (id === 'c_est') { S.fEstado = e.target.value; S.flimite = LIMITE; render(); }
  if (id === 'b_u') { S.bU = e.target.value; render(); }
  if (id === 'b_a') { S.bA = e.target.value; render(); }
  if (id === 'b_e') { S.bE = e.target.value; render(); }
  if (e.target.name === 'fact') { readDraft(); render(); }
  if (id === 'userSel') { S.user = e.target.value; try { localStorage.setItem('mg_user', S.user); } catch (err) {} render(); toast(`Ahora los cambios se firman como ${S.user}.`); }
});
document.addEventListener('submit', e => { if (e.target.id === 'regForm') { e.preventDefault(); saveDraft(); } });
let qTimer;
function rerenderKeep(id) {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => {
    const el = document.getElementById(id), pos = el ? el.selectionStart : 0;
    render(); const n = document.getElementById(id); if (n) { n.focus(); n.setSelectionRange(pos, pos); }
  }, 180);
}

/* ============ Inicio ============ */
if (!USUARIOS.includes(S.user)) USUARIOS.push(S.user);
$('#userSel').innerHTML = USUARIOS.map(u => `<option ${u === S.user ? 'selected' : ''}>${esc(u)}</option>`).join('');
go(location.hash.slice(1) || 'opex');
iniciar().catch(() => { SRC.dbEstado = 'error'; construir(); render(); });
