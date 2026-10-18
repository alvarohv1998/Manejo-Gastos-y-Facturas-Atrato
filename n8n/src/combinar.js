// Junta las facturas del SAT (Todo Conta) y las del correo, quita las que ya están registradas
// y agrega el historial del proveedor en el budget, que usan las reglas y el agente.
const cfg = $('Config').first().json;
const est = $('Estado').first().json;

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const num = v => (v === undefined || v === null || v === '' || isNaN(Number(v)) ? null : Number(v));

// ---------- CSV del SAT ----------
function parseCsv(t) {
  const filas = []; let fila = [], campo = '', comillas = false;
  t = String(t || '').replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (comillas) {
      if (c === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else comillas = false; } else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === ',') { fila.push(campo); campo = ''; }
    else if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }
  if (!filas.length) return [];
  const h = filas[0];
  return filas.slice(1).filter(r => r.length > 1).map(r => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ''])));
}
let satFilas = [];
let satError = null;
try {
  if ($('SAT: descargar CSV').isExecuted) {
    const r = $('SAT: descargar CSV').first().json;
    if (r && typeof r.data === 'string' && r.data.includes('UUID')) satFilas = parseCsv(r.data);
    else satError = 'El CSV del SAT no llegó';
  }
} catch (e) { satError = 'No se pudo leer el CSV del SAT'; }

const desdeSat = s => ({
  uuid: (s['UUID'] || '').toUpperCase(), tipo: s['Tipo'] || null, fecha: s['Fecha'] || null, serie: s['Serie'] || '', folio: s['Folio'] || '',
  emisor_rfc: (s['RFC Emisor'] || '').toUpperCase(), emisor_nombre: s['Nombre Emisor'] || '', receptor_rfc: (s['RFC Receptor'] || '').toUpperCase(),
  uso_cfdi: s['Uso CFDI'] || '', subtotal: num(s['Subtotal']), descuento: num(s['Descuento']) || 0, iva: num(s['IVA Trasladado']),
  iva_retenido: num(s['IVA Retenido']), isr_retenido: num(s['ISR Retenido']), total: num(s['Total']), moneda: s['Moneda'] || 'MXN',
  tipo_cambio: num(s['Tipo de Cambio']), metodo_pago: s['Método de Pago'] || '', forma_pago: s['Forma de Pago'] || '',
  conceptos: '', docs_relacionados: [], estado_sat: s['Estado SAT'] || '', fuente: 'sat'
});
const sat = new Map(satFilas.map(s => [String(s['UUID'] || '').toUpperCase(), desdeSat(s)]).filter(([k]) => k));

// ---------- Lo que ya está registrado ----------
const porUuid = new Map(est.facturas.filter(f => f.UUID).map(f => [String(f.UUID).toUpperCase(), f]));
const claves = new Set(est.facturas.map(f => String(f.Clave)));

// ---------- Historial del proveedor en el budget (OPEX, FIXED_ASSETS, FINANCIAL) ----------
const VACIAS = new Set(['sa', 'de', 'cv', 'rl', 's', 'c', 'v', 'sapi', 'sab', 'sc', 'sas', 'del', 'la', 'el', 'los', 'las', 'y', 'mexico', 'servicios',
  'grupo', 'comercial', 'inc', 'llc', 'ltd', 'corp', 'company', 'technologies', 'tecnologia', 'operadora', 'promotora', 'internacional', 'the', 'and']);
const palabras = nombre => norm(nombre).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length >= 4 && !VACIAS.has(w)).slice(0, 2);
function historial(rfc, nombre) {
  const claveRfc = String(rfc || '').toUpperCase();
  const ids = new Set(est.facturas.filter(f => claveRfc && String(f['RFC emisor']).toUpperCase() === claveRfc && f['Gasto ID']).map(f => String(f['Gasto ID'])));
  const ps = palabras(nombre);
  const filas = est.gastos.filter(o => ids.has(o.id) || (ps.length && ps.some(p => norm(o.proveedor + ' ' + o.descripcion).includes(p))));
  const cuenta = k => { const c = {}; filas.forEach(o => { if (o[k]) c[o[k]] = (c[o[k]] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1]); };
  const metodos = cuenta('metodo');
  const total = filas.length;
  const banregio = metodos.filter(([mt]) => /banregio/i.test(mt)).reduce((s, [, n]) => s + n, 0);
  return {
    total, banregio, palabras: ps,
    metodo_top: metodos[0] ? metodos[0][0] : null,
    categoria_top: (cuenta('categoria')[0] || [])[0] || null,
    area_top: (cuenta('area')[0] || [])[0] || null,
    tipo_top: (cuenta('tipo')[0] || [])[0] || null,
    pestana_top: (cuenta('tab')[0] || [])[0] || null,
    ejemplos: filas.slice().sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, 8)
      .map(o => ({ pestana: o.tab, id: o.id, fecha: o.fecha, descripcion: o.descripcion, proveedor: o.proveedor, categoria: o.categoria, area: o.area, tipo: o.tipo, metodo: o.metodo, total: o.total }))
  };
}

// ---------- Armar candidatos ----------
const out = [];
const usadosSat = new Set();
let duplicadas = 0, anteriores = 0;
const fechaOk = d => !d || !d.fecha || String(d.fecha).slice(0, 10) >= cfg.fecha_inicio_registro;

for (const it of $('Leer adjuntos').all()) {
  const c = it.json;
  if (c.vacio) continue;
  if (claves.has(c.key)) { duplicadas++; continue; }
  let datos = c.cfdi;
  if (datos && datos.uuid && sat.has(datos.uuid)) {
    datos = Object.assign({}, sat.get(datos.uuid), datos, { estado_sat: sat.get(datos.uuid).estado_sat, fuente: 'xml+sat' });
    usadosSat.add(datos.uuid);
  }
  let accion = 'nuevo', existente = null;
  if (datos && datos.uuid && porUuid.has(datos.uuid)) {
    existente = porUuid.get(datos.uuid);
    if (existente['Link Drive']) { duplicadas++; continue; }
    accion = 'adjuntar';                       // ya estaba (llegó antes por el SAT) pero sin archivo
  }
  if (accion === 'nuevo' && !fechaOk(datos)) { anteriores++; continue; }
  out.push({
    json: {
      key: datos && datos.uuid ? datos.uuid : c.key, clave_correo: c.key, origen: datos && datos.fuente === 'xml+sat' ? 'correo+sat' : 'correo',
      datos, archivos: c.archivos, mensaje_id: c.mensaje_id, asunto: c.asunto, remitente: c.remitente, buzon: c.buzon, recibido: c.recibido,
      requiere_extraccion: !datos, accion, existente: existente ? { fila: existente.fila, gasto_id: existente['Gasto ID'], estado: existente.Estado } : null,
      historial: datos ? historial(datos.emisor_rfc, datos.emisor_nombre) : null
    },
    binary: it.binary
  });
}
// Facturas que solo vienen del SAT (no llegaron por correo, o llegaron solo en PDF: eso se resuelve después por UUID)
for (const [uuid, d] of sat) {
  if (usadosSat.has(uuid)) continue;
  if (porUuid.has(uuid)) { continue; }
  if (!fechaOk(d)) { anteriores++; continue; }
  out.push({ json: {
    key: uuid, clave_correo: null, origen: 'sat', datos: d, archivos: [], requiere_extraccion: false, accion: 'nuevo', existente: null,
    buzon: '', remitente: '', asunto: '', recibido: '', historial: historial(d.emisor_rfc, d.emisor_nombre)
  } });
}
// Facturas "por validar" que se vuelven a evaluar: las que quedaron así porque el agente no respondió (por ejemplo, sin saldo
// en Anthropic) y las PPD, que por regla siempre van a Slack.
// se vuelven a clasificar con sus datos (del SAT o de FACTURAS); el PDF ya no hace falta porque los datos ya se leyeron.
const desdeFila = f => ({
  uuid: String(f.UUID || '').toUpperCase() || null, tipo: f.Tipo || null, fecha: String(f.Fecha || '').slice(0, 10) || null, serie: f.Serie || '', folio: f.Folio || '',
  emisor_rfc: String(f['RFC emisor'] || '').toUpperCase(), emisor_nombre: f.Emisor || '', receptor_rfc: String(f['RFC receptor'] || '').toUpperCase(),
  uso_cfdi: f['Uso CFDI'] || '', subtotal: num(f.Subtotal), descuento: 0, iva: num(f.IVA), iva_retenido: num(f['IVA retenido']),
  isr_retenido: num(f['ISR retenido']), total: num(f.Total), moneda: f.Moneda || 'MXN', tipo_cambio: num(f['Tipo de cambio']),
  metodo_pago: f['Método pago'] || '', forma_pago: f['Forma pago'] === '' || f['Forma pago'] == null ? '' : String(f['Forma pago']).padStart(2, '0'),
  conceptos: f.Conceptos || '', docs_relacionados: [], estado_sat: f['Estado SAT'] || '', fuente: 'reintento'
});
let reclasificar = 0, sinDatos = 0;
for (const f of est.facturas) {
  const fallaAgente = /^El agente no respondió/.test(String(f.Motivo || ''));
  const ppdPendiente = cfg.ppd_siempre_slack !== false && String(f['Método pago'] || '').toUpperCase() === 'PPD' && !f['Gasto ID'];   // regla PPD: se avisa en Slack
  // Las que quedaron "por validar" antes de las reglas nuevas (mandar de más, tarjeta, notas de crédito) pasan por ellas una vez.
  // No se repiten: las que ya se revisaron con las reglas nuevas tienen otro estado o un motivo de "revisar a mano".
  const yaRevisada = /^(PDF protegido|No se pudo leer el monto|No se pudo decidir)|Se avisa en Slack aunque/.test(String(f.Motivo || ''));
  const sinTocar = ['', 'por_validar'].includes(String(f['Clasificación'] || ''));   // si una persona ya cambió la clasificación, manda la persona
  const reglasNuevas = cfg.por_validar_a_slack !== false && !yaRevisada && sinTocar;
  if (f.Estado !== 'por_validar' || !(fallaAgente || ppdPendiente || reglasNuevas)) continue;
  if (reclasificar >= (cfg.max_reclasificar || 40)) break;
  const u = String(f.UUID || '').toUpperCase();
  const conTotal = f.Total !== '' && f.Total !== null && f.Total !== undefined && !isNaN(Number(f.Total));
  const d = (u && sat.get(u)) || (f['RFC emisor'] && conTotal ? desdeFila(f) : null);
  if (!d) { sinDatos++; continue; }          // el PDF no se pudo leer y no está en el SAT: se queda para revisión a mano
  reclasificar++;
  out.push({ json: {
    key: String(f.Clave), clave_correo: null, origen: f.Origen || 'sat', datos: d, archivos: [], requiere_extraccion: false,
    accion: 'reclasificar', fila: f.fila, existente: { fila: f.fila, gasto_id: f['Gasto ID'], estado: f.Estado },
    buzon: f['Buzón'] || '', remitente: f.Remitente || '', asunto: f.Asunto || '', recibido: f.Recibida || '', historial: historial(d.emisor_rfc, d.emisor_nombre)
  } });
}
// PDF bajados de Drive para volver a leerlos (facturas sin datos porque el agente no respondió)
let releidos = 0;
if ($('Drive: bajar PDF').isExecuted) {
  const pedidos = $('PDF a releer').all();
  $('Drive: bajar PDF').all().forEach((it, i) => {
    const p = (pedidos[i] || {}).json || {};
    const bin = it.binary && (it.binary.data || Object.values(it.binary)[0]);
    if (!p.clave || !bin) return;
    releidos++;
    out.push({ json: {
      key: p.clave, clave_correo: null, origen: p.origen, datos: null, archivos: [{ binary_key: 'data', ext: 'pdf', nombre: p.nombre }],
      requiere_extraccion: true, accion: 'reclasificar', fila: p.fila, existente: { fila: p.fila, gasto_id: '', estado: 'por_validar' },
      buzon: p.buzon, remitente: p.remitente, asunto: p.asunto, recibido: p.recibido, historial: null
    }, binary: { data: bin } });
  });
}
const meta = { duplicadas, anteriores, sat_filas: satFilas.length, sat_error: satError, reclasificar, reclasificar_sin_datos: sinDatos - releidos, pdf_releidos: releidos };
if (!out.length) return [{ json: { vacio: true, meta } }];
out[0].json.meta = meta;
return out;
