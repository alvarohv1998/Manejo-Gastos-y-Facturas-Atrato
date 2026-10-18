// Decide qué pasa con cada factura: clasificación (reglas fijas + agente), pestaña de destino,
// relación con un gasto ya registrado o creación de uno nuevo, estado, Slack y validación.
// Después concilia los movimientos bancarios de Metabase con los gastos e ingresos que ya existen.
// No escribe nada: arma el plan que ejecutan los nodos siguientes (o que se reporta en modo prueba).
const cfg = $('Config').first().json;
const est = $('Estado').first().json;
const candidatos = $('Combinar fuentes').all().map(i => i.json).filter(c => !c.vacio);
const meta = (($('Combinar fuentes').first() || {}).json || {}).meta || {};
const C = cfg.conciliacion;
const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
const cap = s => s.charAt(0) + s.slice(1).toLowerCase();
const r2 = n => Math.round(n * 100) / 100;
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const esTarjeta = m => cfg.metodos_tarjeta.some(t => norm(m) === norm(t)) || /clara|amex/i.test(String(m || ''));
const dias = (a, b) => Math.round((new Date(a + 'T12:00:00Z') - new Date(b + 'T12:00:00Z')) / 864e5);
const vintage = fecha => { const m = +String(fecha).slice(5, 7); return `${String(m).padStart(2, '0')}_${MESES[m - 1]}`; };
const ahora = new Intl.DateTimeFormat('sv-SE', { timeZone: cfg.zona_horaria, dateStyle: 'short', timeStyle: 'short' }).format(new Date());
const MARCA_PENDIENTE = 'n8n: pendiente de pago', MARCA_TARJETA = 'n8n: tarjeta por conciliar';

// ---------- Resultados del agente ----------
const ia = new Map();
if ($('Claude').isExecuted) {
  const sol = $('Solicitudes IA').all();
  $('Claude').all().forEach((r, i) => {
    const key = sol[i] && sol[i].json.key;
    if (!key) return;
    const j = r.json || {};
    if (j.error) { ia.set(key, { ok: false, error: typeof j.error === 'string' ? j.error : (j.error.description || j.error.message || 'error') }); return; }   // description trae el motivo real (p. ej. PDF con contraseña)
    if (j.stop_reason === 'refusal') { ia.set(key, { ok: false, error: 'el modelo no quiso responder' }); return; }
    const t = (j.content || []).find(b => b.type === 'text');
    try {
      const r = JSON.parse(t.text);
      for (const k of Object.keys(r)) if (r[k] === '') r[k] = null;            // "" = sin dato
      if (r.total === 0) r.total = null;
      ia.set(key, Object.assign({ ok: true }, r));
    }
    catch (e) { ia.set(key, { ok: false, error: 'respuesta ilegible' }); }
  });
}

// ---------- Historial del proveedor ----------
const VACIAS = new Set(['sa', 'de', 'cv', 'rl', 's', 'c', 'v', 'sapi', 'sab', 'sc', 'sas', 'del', 'la', 'el', 'los', 'las', 'y', 'mexico', 'servicios',
  'grupo', 'comercial', 'inc', 'llc', 'ltd', 'corp', 'company', 'technologies', 'tecnologia', 'operadora', 'promotora', 'internacional', 'the', 'and']);
const palabras = nombre => norm(nombre).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length >= 4 && !VACIAS.has(w)).slice(0, 2);
function historial(rfc, nombre) {
  const ids = new Set(est.facturas.filter(f => rfc && String(f['RFC emisor']).toUpperCase() === String(rfc).toUpperCase() && f['Gasto ID']).map(f => String(f['Gasto ID'])));
  const ps = palabras(nombre);
  const filas = est.gastos.filter(o => (o.id && ids.has(o.id)) || (ps.length && ps.some(p => norm(o.proveedor + ' ' + o.descripcion).includes(p))));
  const top = k => { const c = {}; filas.forEach(o => { if (o[k]) c[o[k]] = (c[o[k]] || 0) + 1; }); return (Object.entries(c).sort((a, b) => b[1] - a[1])[0] || [])[0] || null; };
  return { total: filas.length, banregio: filas.filter(o => /banregio/i.test(o.metodo)).length, tarjeta: filas.filter(o => esTarjeta(o.metodo)).length,
    metodo_top: top('metodo'), categoria_top: top('categoria'), area_top: top('area'), tipo_top: top('tipo'), pestana_top: top('tab') };
}

// ---------- Reglas fijas (mandan sobre el agente) ----------
const esPPD = d => cfg.ppd_siempre_slack !== false && String(d.metodo_pago || '').toUpperCase() === 'PPD' && !['P', 'E', 'T', 'N'].includes(d.tipo);
function reglaFija(d, c, h) {
  if (d.receptor_rfc && d.receptor_rfc !== cfg.rfc_atrato) return ['descartada', `El receptor (${d.receptor_rfc}) no es Atrato: no se registra`];
  if (norm(c.buzon).includes(norm(cfg.buzon_descartar))) return ['descartada', 'Llegó a soportefinanzas@: no se registra'];
  if (d.tipo === 'P') return ['complemento', 'Complemento de pago (CFDI tipo P): se registra aparte'];
  if (/cancel/i.test(d.estado_sat || '')) return ['descartada', 'Cancelada en el SAT'];
  if (d.tipo === 'E') return ['nota_credito', 'Nota de crédito (CFDI tipo E): no se paga ni se avisa en Slack; revisar contra la factura original'];
  const txtEmisor = norm(`${d.emisor_nombre || ''} ${d.emisor_rfc || ''}`).toUpperCase();
  const tarjetaFija = (cfg.siempre_tarjeta || []).find(t => new RegExp(t.patron, 'i').test(txtEmisor));
  if (tarjetaFija) return ['pagada_tarjeta', `${tarjetaFija.motivo}: no se paga, se concilia`];
  if (esPPD(d)) {                                             // pago diferido: aún no se paga, siempre va a Slack
    const banregio = h && h.total >= 2 && h.banregio / h.total >= 0.5;
    return [banregio ? 'pagar_banregio' : 'pagar', `Método de pago PPD (pago diferido): siempre se avisa en Slack${banregio ? ' · se paga por Banregio' : ''}`];
  }
  if (['04', '28'].includes(String(d.forma_pago).padStart(2, '0'))) return ['pagada_tarjeta', `Forma de pago ${String(d.forma_pago).padStart(2, '0')} (tarjeta): no se paga, solo se registra`];
  if (h && h.total >= 2 && h.banregio / h.total >= 0.5) return ['pagar_banregio', `Históricamente se paga por Banregio (${h.banregio} de ${h.total} gastos)`];
  return null;
}
const ESTADO = { pagar: 'pendiente_pago', pagar_banregio: 'pendiente_pago', pagada_tarjeta: 'por_conciliar', por_validar: 'por_validar', complemento: 'complemento', descartada: 'descartada', nota_credito: 'nota_credito' };
const enLista = (v, lista) => (v && lista.includes(v) ? v : null);

// ---------- Gastos ya registrados sin factura (para relacionar) ----------
const limite = new Date(Date.now() - C.meses_hacia_atras * 31 * 864e5).toISOString().slice(0, 10);
const sinFactura = est.gastos.filter(o => ['OPEX', 'FIXED_ASSETS'].includes(o.tab) && !o.invoice && !/^no fac/i.test(o.receipt)
  && o.fecha && o.fecha >= limite && o.total !== null);
const usados = new Set();
const fxMes = fecha => est.fx[+String(fecha).slice(5, 7)] || null;
const tcDe = d => (d.moneda === 'USD' ? (d.tipo_cambio && d.tipo_cambio > 1 ? d.tipo_cambio : (fxMes(d.fecha) || 0)) : 1);
function buscarGasto(d, tarjeta) {
  const monto = (d.total || 0) * tcDe(d);
  if (!monto || !d.fecha) return { exactos: [], cercanos: [] };
  const f = String(d.fecha).slice(0, 10);
  const tol = d.moneda === 'USD' ? monto * C.tolerancia_usd_pct : C.tolerancia_mxn;
  const base = sinFactura.filter(o => !usados.has(`${o.tab}:${o.fila}`) && esTarjeta(o.metodo) === tarjeta)
    .filter(o => { const df = dias(o.fecha, f); return df >= -C.dias_despues && df <= C.dias_antes; });
  return { exactos: base.filter(o => Math.abs(Math.abs(o.total) - monto) <= tol), cercanos: base.filter(o => Math.abs(Math.abs(o.total) - monto) / monto <= 0.03) };
}

// ---------- Plan ----------
const plan = { facturas_nuevas: [], facturas_actualizar: [], filas_nuevas: [], actualizar: [], adjuntar: [], slack: [], revisar: [],
  validacion: [], bitacora: [], sin_conciliar: [], ignorados_banco: [], ignoradas: [] };
const res = { facturas_nuevas: 0, gastos_creados: 0, relacionadas: 0, pendientes_pago: 0, por_validar: 0, por_conciliar: 0, descartadas: 0,
  complementos: 0, no_factura: 0, ya_en_slack: 0, pagadas_slack: 0, no_slack: 0, reclasificadas: 0, slack_canal: 'no revisado', duplicadas: meta.duplicadas || 0, anteriores: meta.anteriores || 0, ia_errores: 0, sat_filas: meta.sat_filas || 0,
  conciliadas_banco: 0, filas_banco: 0 };
const bit = (accion, objeto, campo, antes, despues, comentario) => plan.bitacora.push([ahora, 'n8n', 'n8n', accion, objeto, campo || '', antes ?? '', despues ?? '', comentario || '']);
let temp = 0;

function crearGasto(d, key, destino, cat, area, tipo, metodo, estado) {
  const signo = d.tipo === 'E' ? -1 : 1;                     // nota de crédito / reembolso: negativo
  const tc = tcDe(d);
  const fecha = String(d.fecha).slice(0, 10);
  const total = r2(signo * (d.total || 0) * tc);
  const id = `NUEVO-${++temp}`;
  const marca = estado === 'por_conciliar' ? MARCA_TARJETA : MARCA_PENDIENTE;
  const descripcion = String((d.conceptos || '').split(' | ')[0] || d.emisor_nombre || '').toUpperCase().slice(0, 80);
  const campos = {
    id, vintage: vintage(fecha), fecha, categoria: cat || '', area: area || '', descripcion, tipo: tipo || '', metodo: metodo || '',
    amount: r2(signo * ((d.subtotal || 0) - (d.descuento || 0)) * tc), vatq: (d.iva || 0) > 0, vat: r2(signo * (d.iva || 0) * tc),
    vat_ret: d.iva_retenido ? r2(signo * d.iva_retenido * tc) : '', isr: d.isr_retenido ? r2(signo * d.isr_retenido * tc) : '', total,
    usd: d.moneda === 'USD' ? r2(signo * d.total) : (fxMes(fecha) ? r2(total / fxMes(fecha)) : ''), user: 'NA', provider: d.emisor_nombre || '',
    folio: d.uuid || `${d.serie || ''}${d.folio || ''}` || 'NA', invoice: `{{LINK:${key}}}`, receipt: '', prorated: false, prorated_m: '',
    ref_banco: marca, origen: `n8n factura ${d.uuid || key}`
  };
  plan.filas_nuevas.push({ tab: destino, temp: id, factura_key: key, fecha, tarjeta: estado === 'por_conciliar', campos });
  res.gastos_creados++;
  bit('creó gasto', id, cfg.destinos[destino], '', `${total} · ${d.emisor_nombre}`, `Desde la factura ${d.uuid || key}`);
  return id;
}
// Reglas "no mandar a Slack" de Config (bancos, Shipkraken, fideicomiso, compensación…)
const reglasNoSlack = (cfg.no_slack || []).map(r => ({ ...r, re: new RegExp(r.patron, 'i'), ex: r.excepto ? new RegExp(r.excepto, 'i') : null }));
function reglaNoSlack(d) {
  const txt = norm(`${d.emisor_nombre || ''} ${d.emisor_rfc || ''}`).toUpperCase();
  return reglasNoSlack.find(r => r.re.test(txt) && !(r.ex && r.ex.test(txt))) || null;
}
function resolverGasto(d, key, destino, estado, cat, area, tipo, metodo, crear = true) {
  if (['OPEX', 'FIXED_ASSETS'].includes(destino)) {
    const { exactos, cercanos } = buscarGasto(d, estado === 'por_conciliar');
    if (exactos.length === 1) {
      const o = exactos[0];
      usados.add(`${o.tab}:${o.fila}`);
      const cambios = { invoice: `{{LINK:${key}}}` };
      if (!o.folio || o.folio === 'NA') cambios.folio = d.uuid || '';
      if (!o.categoria && cat) cambios.categoria = cat;
      if (!o.area && area) cambios.area = area;
      if (!o.tipo && tipo) cambios.tipo = tipo;
      plan.actualizar.push({ tab: o.tab, fila: o.fila, id: o.id, cambios });
      res.relacionadas++;
      bit('relacionó', o.id || `${o.tab} fila ${o.fila}`, 'Invoice', '', d.uuid || key, 'Monto exacto y fecha dentro de la ventana');
      return { gasto: o.id || `${cfg.destinos[o.tab]} fila ${o.fila}`, sugerido: '', estado: 'pagada' };   // el gasto ya registrado ya está pagado
    }
    if (exactos.length > 1) return { gasto: '', sugerido: exactos.map(o => o.id || o.fila).join(', '), estado, nota: 'Varios gastos con el mismo monto: confirmar a mano' };
    if (!crear) return { gasto: '', sugerido: cercanos.map(o => o.id || o.fila).slice(0, 3).join(', '), estado };
    const gasto = crearGasto(d, key, destino, cat, area, tipo, metodo, estado);
    return { gasto, sugerido: cercanos.map(o => o.id || o.fila).slice(0, 3).join(', '), estado };
  }
  if (!crear) return { gasto: '', sugerido: '', estado };
  return { gasto: crearGasto(d, key, destino, cat, area, tipo, metodo, estado), sugerido: '', estado };
}

const satConsumidos = new Set();
const uuidsVistos = new Set(est.facturas.map(f => String(f.UUID || '').toUpperCase()).filter(Boolean));
const porUuid = new Map(est.facturas.filter(f => f.UUID).map(f => [String(f.UUID).toUpperCase(), f]));
const satPorUuid = new Map(candidatos.filter(c => c.origen === 'sat').map(c => [c.key, c]));
const orden = candidatos.slice().sort((a, b) => (a.origen === 'sat') - (b.origen === 'sat'));
const anio = fecha => String(fecha || est.hoy).slice(0, 4);
const carpeta = fecha => { const m = +String(fecha || est.hoy).slice(5, 7); return `${String(m).padStart(2, '0')}_${cap(MESES[m - 1])}`; };

// ---------- XML del SAT (ZIP de Todo Conta) ----------
// Las facturas que llegaron solo por el SAT no traen archivo: se sube su XML para que Invoice tenga liga a Drive.
const xmlSat = new Set();
if ($('SAT: descomprimir').isExecuted) {
  for (const it of $('SAT: descomprimir').all()) for (const b of Object.values(it.binary || {})) {
    const m = String(b.fileName || '').match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.xml$/i);
    if (m) xmlSat.add(m[1].toUpperCase());
  }
}
const archivoSat = uuid => ({ binary_key: `sat_${uuid.replace(/-/g, '')}`, ext: 'xml', nombre: `${uuid}.xml`, uuid });

// ---------- Slack: lo que la gente ya pidió en el canal ----------
// Antes de avisar de una factura se busca si alguien ya la mandó al canal (PDF con el UUID o la serie y folio en el nombre,
// o el monto y el proveedor en el texto). Si ese mensaje tiene ✅ la factura ya está pagada; si no, se sigue ese mensaje.
const REACCIONES_PAGADA = new Set(cfg.slack_reacciones_pagada);
const compacto = s => norm(s).replace(/[^a-z0-9]/g, '');
const mensajesSlack = [];
if (cfg.slack_revisar_canal && $('Slack: historial del canal').isExecuted) {
  const hist = $('Slack: historial del canal').first().json || {};
  res.slack_canal = hist.ok ? `${(hist.messages || []).length} mensajes revisados` : `no se pudo leer (${hist.error || 'sin respuesta'})`;
  for (const m of hist.messages || []) {
    if (m.bot_id || m.subtype === 'bot_message' || /channel_(join|leave)/.test(m.subtype || '')) continue;   // los mensajes de n8n ya están en FACTURAS
    const adjuntos = m.attachments || [];
    const archivos = [...(m.files || []), ...adjuntos.flatMap(a => a.files || [])].map(f => `${f.name || ''} ${f.title || ''}`);
    const texto = [m.text || '', ...adjuntos.map(a => `${a.text || ''} ${a.fallback || ''}`)].join(' ');
    mensajesSlack.push({ ts: String(m.ts), texto, buscar: compacto(`${texto} ${archivos.join(' ')}`),
      fecha: new Date(+m.ts * 1000).toISOString().slice(0, 10), pagada: (m.reactions || []).some(r => REACCIONES_PAGADA.has(r.name)) });
  }
}
function yaEnSlack(d) {
  if (!mensajesSlack.length) return null;
  const uuid = compacto(d.uuid);
  const serieFolio = compacto(`${d.serie || ''}${d.folio || ''}`);
  const folio = compacto(d.folio);
  const ps = palabras(d.emisor_nombre).map(compacto).filter(p => p.length >= 4);
  const montos = d.total ? [Number(d.total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), Number(d.total).toFixed(2)] : [];
  const fecha = String(d.fecha || est.hoy).slice(0, 10);
  const cerca = m => dias(m.fecha, fecha) >= -15 && dias(m.fecha, fecha) <= 90;
  const proveedor = m => ps.some(p => m.buscar.includes(p));
  const hallado = mensajesSlack.filter(m =>
    (uuid.length >= 32 && (m.buscar.includes(uuid) || m.buscar.includes(uuid.slice(0, 8)))) ||
    (serieFolio.length >= 6 && /\d{3,}/.test(serieFolio) && m.buscar.includes(serieFolio) && cerca(m)) ||
    (folio.length >= 5 && /^\d+$/.test(folio) && m.buscar.includes(folio) && proveedor(m) && cerca(m)) ||
    (montos.some(x => m.texto.includes(x)) && proveedor(m) && cerca(m)));
  return hallado.sort((a, b) => b.pagada - a.pagada)[0] || null;    // si hay varios, gana el que ya tiene ✅
}

// Fila ya registrada que se reclasifica y resulta que no es un gasto (duplicada, anterior o no es factura): se cierra con ese estado
const cerrar = (c, estado, motivo) => {
  plan.facturas_actualizar.push({ fila: c.fila, key: c.key, cambios: { 'Estado': estado, 'Clasificación': estado, 'Motivo': motivo } });
  res.reclasificadas++;
  bit('reclasificó', c.key, 'Estado', 'por_validar', estado, motivo);
};
for (const c of orden) {
  if (c.origen === 'sat' && satConsumidos.has(c.key)) continue;
  const r = ia.get(c.key);
  let d = c.datos, key = c.key, origen = c.origen;

  if (c.accion === 'adjuntar') {
    plan.adjuntar.push({ key, clave_binario: c.key, fila: c.existente.fila, gasto_id: c.existente.gasto_id, archivos: c.archivos, carpeta: carpeta(d.fecha), anio: anio(d.fecha) });
    bit('adjuntó archivo', key, 'Link Drive', '', '(Drive)', 'La factura ya estaba registrada desde el SAT');
    continue;
  }
  if (c.requiere_extraccion) {
    if (!r || !r.ok) {
      d = { uuid: null, tipo: null, fecha: (c.recibido || '').slice(0, 10) || est.hoy, emisor_nombre: '', emisor_rfc: '', total: null, moneda: '' };
    } else if (!r.es_factura || r.clasificacion === 'no_es_factura') {
      if (c.accion === 'reclasificar') { cerrar(c, 'no_es_factura', `Al releer el PDF: ${r.motivo || 'no es factura'}`); continue; }
      res.no_factura++; plan.ignoradas.push({ archivo: (c.archivos[0] || {}).nombre, asunto: c.asunto, motivo: r.motivo }); continue;
    } else {
      d = { uuid: r.uuid ? String(r.uuid).toUpperCase() : null, tipo: r.tipo_comprobante || null, fecha: r.fecha, serie: r.serie || '', folio: r.folio || '',
        emisor_rfc: String(r.rfc_emisor || '').toUpperCase(), emisor_nombre: r.nombre_emisor || '', receptor_rfc: String(r.rfc_receptor || '').toUpperCase(),
        subtotal: r.subtotal, descuento: 0, iva: r.iva, iva_retenido: r.iva_retenido, isr_retenido: r.isr_retenido, total: r.total,
        moneda: r.moneda || 'MXN', tipo_cambio: null, metodo_pago: r.metodo_pago || '', forma_pago: r.forma_pago || '', uso_cfdi: '',
        conceptos: r.conceptos || '', fuente: 'pdf (IA)' };
      if (d.uuid) {
        if (c.accion === 'reclasificar' && porUuid.has(d.uuid) && porUuid.get(d.uuid).fila !== c.fila) {
          cerrar(c, 'descartada', `Duplicada: la factura ${d.uuid} ya está registrada en otra fila`); continue;
        }
        if (c.accion !== 'reclasificar' && porUuid.has(d.uuid)) {
          const ex = porUuid.get(d.uuid);
          const soloXml = ex.Origen === 'sat' && (c.archivos || []).some(a => a.ext === 'pdf');   // ya tenía el XML del SAT y ahora llegó el PDF
          if (!ex['Link Drive'] || soloXml) plan.adjuntar.push({ key: d.uuid, fila: ex.fila, gasto_id: ex['Gasto ID'], archivos: c.archivos, carpeta: carpeta(d.fecha), anio: anio(d.fecha), clave_binario: c.key });
          else res.duplicadas++;
          continue;
        }
        if (uuidsVistos.has(d.uuid) && c.accion !== 'reclasificar') { res.duplicadas++; continue; }
        if (satPorUuid.has(d.uuid)) {
          d = Object.assign({}, satPorUuid.get(d.uuid).datos, { conceptos: d.conceptos, fuente: 'pdf+sat' });
          satConsumidos.add(d.uuid); origen = 'correo+sat';
        }
        if (c.accion !== 'reclasificar') key = d.uuid;          // la fila reclasificada conserva su Clave
      }
      if (d.fecha && String(d.fecha).slice(0, 10) < cfg.fecha_inicio_registro) {
        if (c.accion === 'reclasificar') { cerrar(c, 'descartada', `Fecha ${String(d.fecha).slice(0, 10)} anterior al ${cfg.fecha_inicio_registro}: no se registra`); continue; }
        res.anteriores++; continue;
      }
    }
  }
  if (d.uuid) uuidsVistos.add(d.uuid);

  const h = historial(d.emisor_rfc, d.emisor_nombre);
  const fija = d.uuid || d.emisor_rfc ? reglaFija(d, c, h) : null;
  let clas, motivo, confianza;
  if (c.accion === 'reclasificar' && !fija && !(r && r.ok)) {
    // PDF con contraseña: no se va a poder leer nunca; se deja para revisión a mano y ya no se reintenta
    if (r && /password protected/i.test(String(r.error || ''))) cerrar(c, 'por_validar', 'PDF protegido con contraseña: revisar a mano (el agente no lo puede abrir)');
    continue;                                    // el agente sigue sin responder: se intenta en la siguiente corrida
  }
  if (fija) { [clas, motivo] = fija; confianza = 1; }
  else if (r && r.ok) {
    clas = r.clasificacion === 'no_es_factura' ? 'por_validar' : r.clasificacion;
    motivo = r.motivo; confianza = r.confianza;
    if (confianza < cfg.ia_confianza_minima && clas !== 'por_validar') { motivo = `Confianza baja (${confianza}): ${motivo}`; clas = 'por_validar'; }
  } else if (c.origen === 'sat' && !r) {
    continue;                                     // no alcanzó el tope de IA: se retoma en la siguiente corrida
  } else {
    clas = 'por_validar'; confianza = 0; motivo = `El agente no respondió (${r ? r.error : 'sin datos'}): revisar a mano`; res.ia_errores++;
  }
  // Tarjeta: si antes se le pagó a este proveedor con Clara o Amex (Payment Method del budget) o la factura dice que se cobró
  // a tarjeta, no se paga: queda por conciliar y no va a Slack. Las PPD siempre van a Slack.
  const tarjetaHist = h.total >= 1 && h.tarjeta / h.total >= 0.5;
  const tarjetaFactura = r && r.ok && esTarjeta(r.metodo_pago_sugerido) && r.clasificacion === 'pagada_tarjeta';
  if (!esPPD(d) && ['pagar', 'pagar_banregio', 'por_validar'].includes(clas) && (tarjetaHist || tarjetaFactura)) {
    motivo = `${tarjetaHist ? `Antes se le pagó con tarjeta (${h.tarjeta} de ${h.total} gastos en el budget)` : 'La factura dice que se cobró a tarjeta'}: no se paga, se concilia · ${motivo}`;
    clas = 'pagada_tarjeta';
  }
  // Preferencia de Álvaro: mejor mandar de más que dejar facturas atoradas. Lo que quedaría "por validar" va a Slack.
  if (cfg.por_validar_a_slack !== false && clas === 'por_validar' && Number(d.total) > 0) {
    clas = h.total >= 2 && h.banregio / h.total >= 0.5 ? 'pagar_banregio' : 'pagar';
    motivo = `Se avisa en Slack aunque el agente no estaba seguro (revisar categoría) · ${motivo}`;
  }
  const destino = (r && r.ok && ['OPEX', 'FIXED_ASSETS', 'FINANCIAL'].includes(r.destino)) ? r.destino
    : (['OPEX', 'FIXED_ASSETS', 'FINANCIAL'].includes(h.pestana_top) ? h.pestana_top : 'OPEX');
  const catalogoCat = destino === 'FINANCIAL' ? est.catalogos.categorias_financial : est.catalogos.categorias;
  const cat = enLista(r && r.categoria, catalogoCat) || h.categoria_top;
  const area = enLista(r && r.area, est.catalogos.areas) || h.area_top;
  const tipo = enLista(r && r.tipo_gasto, est.catalogos.tipos) || h.tipo_top;
  let metodo = '';
  if (clas === 'pagar_banregio') metodo = 'Banregio';
  else if (clas === 'pagada_tarjeta') metodo = esTarjeta(r && r.metodo_pago_sugerido) ? r.metodo_pago_sugerido
    : (esTarjeta(h.metodo_top) ? h.metodo_top : (h.tarjeta ? (est.gastos.find(o => esTarjeta(o.metodo)) || {}).metodo || '' : ''));
  else if (clas === 'pagar') metodo = (r && r.metodo_pago_sugerido && !esTarjeta(r.metodo_pago_sugerido) ? r.metodo_pago_sugerido : '') || (h.metodo_top && !esTarjeta(h.metodo_top) ? h.metodo_top : '');
  let estado = ESTADO[clas] || 'por_validar';

  // Facturas que no se mandan a Slack: en $0, sin monto legible o de proveedores en Config → no_slack
  if (estado === 'pendiente_pago' && !(Number(d.total) > 0)) {
    if (d.total === 0 || d.total === '0') { estado = 'descartada'; motivo = `Factura en $0: no hay nada que pagar · ${motivo}`; }
    else { estado = 'por_validar'; motivo = `No se pudo leer el monto: revisar a mano · ${motivo}`; }
  }
  const sinSlack = estado === 'pendiente_pago' ? reglaNoSlack(d) : null;
  if (sinSlack) { motivo = `${sinSlack.motivo} · ${motivo}`; res.no_slack++; }

  let gasto = '', sugerido = '';
  if (['pendiente_pago', 'por_conciliar'].includes(estado) && !['P', 'T', 'N'].includes(d.tipo) && d.total) {
    const g = resolverGasto(d, key, destino, estado, cat, area, tipo, metodo, !sinSlack || !!sinSlack.crear_gasto);
    gasto = g.gasto; sugerido = g.sugerido; estado = g.estado;
    if (g.nota) motivo = `${motivo} · ${g.nota}`;
  }
  // PPD: aunque ya haya un gasto con el mismo monto (que normalmente significa "ya se pagó"), se avisa en Slack
  if (esPPD(d) && estado === 'pagada' && gasto && !sinSlack) {
    estado = 'pendiente_pago';
    motivo = `${motivo} · Ya hay un gasto con el mismo monto (${gasto}); se avisa porque es PPD`;
  }
  if (sinSlack && estado === 'pendiente_pago') {
    estado = sinSlack.estado || 'pagada';
    const nueva = plan.filas_nuevas.find(f => f.temp === gasto);
    if (nueva) nueva.campos.ref_banco = `n8n: ${sinSlack.motivo}`.slice(0, 120);
  }
  let enSlack = null;
  if (estado === 'pendiente_pago' && (enSlack = yaEnSlack(d))) {
    const quien = `mensaje del ${enSlack.fecha} en el canal`;
    res.ya_en_slack++;
    if (enSlack.pagada) {
      estado = 'pagada'; res.pagadas_slack++;
      motivo = `${motivo} · Ya se había pedido en Slack (${quien}) y tiene ✅`;
      const nueva = plan.filas_nuevas.find(f => f.temp === gasto);
      if (nueva) nueva.campos.ref_banco = 'n8n: pagada (✅ en Slack)';
    } else motivo = `${motivo} · Ya se había pedido en Slack (${quien}); se sigue ese mensaje`;
    bit('encontró en Slack', key, 'Slack ts', '', enSlack.ts, enSlack.pagada ? 'El mensaje tiene ✅: pagada' : 'Sin ✅ todavía');
  }
  if (c.accion === 'reclasificar') {
    res.reclasificadas++;
    if (estado === 'por_validar' && Number(d.total) === 0) { estado = 'descartada'; motivo = `Factura en $0: no hay nada que pagar · ${motivo}`; }
    else if (estado === 'por_validar' && !/^No se pudo leer el monto/.test(motivo)) motivo = `No se pudo decidir: revisar a mano · ${motivo}`;   // no se vuelve a intentar
    const avisar = estado === 'pendiente_pago' && !enSlack && (!cfg.slack_desde || String(d.fecha || est.hoy).slice(0, 10) >= cfg.slack_desde);
    const datosLeidos = c.requiere_extraccion ? {
      'UUID': d.uuid || '', 'Tipo': d.tipo || '', 'Fecha': d.fecha ? String(d.fecha).slice(0, 10) : '', 'Serie': d.serie || '', 'Folio': d.folio || '',
      'RFC emisor': d.emisor_rfc || '', 'Emisor': d.emisor_nombre || '', 'RFC receptor': d.receptor_rfc || '', 'Subtotal': d.subtotal ?? '', 'IVA': d.iva ?? '',
      'IVA retenido': d.iva_retenido ?? '', 'ISR retenido': d.isr_retenido ?? '', 'Total': d.total ?? '', 'Moneda': d.moneda || '',
      'Método pago': d.metodo_pago || '', 'Forma pago': d.forma_pago || '', 'Conceptos': d.conceptos || '' } : {};
    plan.facturas_actualizar.push({ fila: c.fila, key, cambios: { ...datosLeidos,
      'Clasificación': clas, 'Motivo': motivo, 'Confianza': confianza ?? '', 'Destino': cfg.destinos[destino], 'Categoría': cat || '', 'Área': area || '',
      'Tipo gasto': tipo || '', 'Método sugerido': metodo, 'Estado': estado, 'Gasto ID': gasto, 'Gasto sugerido': sugerido,
      ...(avisar ? { 'Slack ts': `{{SLACK:${key}}}` } : enSlack && !enSlack.pagada ? { 'Slack ts': `'${enSlack.ts}` } : {})
    } });
    if (avisar) plan.slack.push(key);
    if (estado === 'pendiente_pago') res.pendientes_pago++;
    bit('reclasificó', key, 'Estado', 'por_validar', estado, `El agente ya respondió: ${motivo}`.slice(0, 300));
    continue;
  }
  res.facturas_nuevas++;
  if (estado === 'pendiente_pago') res.pendientes_pago++;
  if (estado === 'por_validar') res.por_validar++;
  if (estado === 'por_conciliar') res.por_conciliar++;
  if (estado === 'descartada') res.descartadas++;
  if (estado === 'complemento') res.complementos++;

  let archivos = c.archivos || [], claveBinario = c.key;
  if (!archivos.length && d.uuid && xmlSat.has(String(d.uuid).toUpperCase())) { archivos = [archivoSat(String(d.uuid).toUpperCase())]; claveBinario = 'sat'; }
  const conArchivo = archivos.length > 0;
  // slack_desde: las facturas con fecha anterior quedan pendientes de pago en la interfaz, pero sin mensaje en Slack
  const slack = estado === 'pendiente_pago' && !enSlack && (!cfg.slack_desde || String(d.fecha || est.hoy).slice(0, 10) >= cfg.slack_desde);
  plan.facturas_nuevas.push({ key, clave_binario: claveBinario, archivos, carpeta: carpeta(d.fecha), anio: anio(d.fecha), slack, valores: {
    'Clave': key, 'UUID': d.uuid || '', 'Tipo': d.tipo || '', 'Fecha': d.fecha ? String(d.fecha).slice(0, 10) : '', 'Serie': d.serie || '', 'Folio': d.folio || '',
    'RFC emisor': d.emisor_rfc || '', 'Emisor': d.emisor_nombre || '', 'RFC receptor': d.receptor_rfc || '', 'Subtotal': d.subtotal ?? '', 'IVA': d.iva ?? '',
    'IVA retenido': d.iva_retenido ?? '', 'ISR retenido': d.isr_retenido ?? '', 'Total': d.total ?? '', 'Moneda': d.moneda || '', 'Tipo de cambio': d.tipo_cambio ?? '',
    'Método pago': d.metodo_pago || '', 'Forma pago': d.forma_pago || '', 'Uso CFDI': d.uso_cfdi || '', 'Conceptos': d.conceptos || '',
    'Clasificación': clas, 'Motivo': motivo, 'Confianza': confianza ?? '', 'Destino': cfg.destinos[destino], 'Categoría': cat || '', 'Área': area || '',
    'Tipo gasto': tipo || '', 'Método sugerido': metodo, 'Estado': estado, 'Gasto ID': gasto, 'Gasto sugerido': sugerido,
    'Link Drive': conArchivo ? `{{LINK:${key}}}` : '', 'Carpeta': conArchivo ? carpeta(d.fecha) : '', 'Origen': origen, 'Buzón': c.buzon || '',
    'Remitente': c.remitente || '', 'Asunto': c.asunto || '', 'Recibida': c.recibido || '', 'Registrada': ahora, 'Corrida': est.corrida,
    'Slack ts': slack ? `{{SLACK:${key}}}` : (enSlack && !enSlack.pagada ? `'${enSlack.ts}` : ''), 'Estado SAT': d.estado_sat || ''
  } });
  bit('registró factura', key, 'Estado', '', estado, motivo);
  if (slack) plan.slack.push(key);
  if (estado === 'por_validar') plan.validacion.push({ key, emisor: d.emisor_nombre, rfc: d.emisor_rfc, total: d.total, moneda: d.moneda, fecha: d.fecha, motivo, asunto: c.asunto });
}

// ---------- Facturas ya registradas sin archivo en Drive: se sube su XML del SAT y se liga ----------
let xmlPendientes = 0;
for (const f of est.facturas) {
  const u = String(f.UUID || '').toUpperCase();
  const tieneLiga = /^https?:/i.test(String(f['Link Drive'] || ''));   // "UUID …" = la subida falló: se reintenta con el XML
  if (tieneLiga || !xmlSat.has(u) || xmlPendientes >= 150 || plan.adjuntar.some(a => a.fila === f.fila)) continue;
  const fecha = String(f.Fecha || '').slice(0, 10);
  plan.adjuntar.push({ key: f.Clave, fila: f.fila, gasto_id: f['Gasto ID'], archivos: [archivoSat(u)], carpeta: carpeta(fecha), anio: anio(fecha), clave_binario: 'sat' });
  xmlPendientes++;
  bit('adjuntó archivo', f.Clave, 'Link Drive', '', '(XML del SAT)', 'La factura llegó solo por el SAT');
}

// ---------- Facturas que una persona ya validó (cambió "Clasificación" en FACTURAS) ----------
for (const f of est.facturas) {
  if (f.Estado !== 'por_validar' || f['Gasto ID']) continue;
  if (plan.facturas_actualizar.some(u => u.fila === f.fila)) continue;      // ya se reclasificó en esta corrida
  const clas = String(f['Clasificación'] || '');
  if (clas === 'descartada' || clas === 'no_es_factura') {
    plan.facturas_actualizar.push({ fila: f.fila, cambios: { 'Estado': clas } });
    bit('cambió estado', f.Clave, 'Estado', 'por_validar', clas, 'Validada a mano');
    continue;
  }
  if (!['pagar', 'pagar_banregio', 'pagada_tarjeta'].includes(clas)) continue;
  const d = { uuid: f.UUID, tipo: f.Tipo, fecha: f.Fecha, serie: f.Serie, folio: f.Folio, emisor_rfc: f['RFC emisor'], emisor_nombre: f.Emisor,
    subtotal: Number(f.Subtotal) || 0, descuento: 0, iva: Number(f.IVA) || 0, iva_retenido: Number(f['IVA retenido']) || 0, isr_retenido: Number(f['ISR retenido']) || 0,
    total: Number(f.Total) || 0, moneda: f.Moneda || 'MXN', tipo_cambio: Number(f['Tipo de cambio']) || null, conceptos: f.Conceptos };
  if (!d.total || !d.fecha) continue;
  const destino = Object.keys(cfg.destinos).find(k => cfg.destinos[k] === f.Destino && k !== 'INCOME') || 'OPEX';
  const metodo = clas === 'pagar_banregio' ? 'Banregio' : (f['Método sugerido'] || '');
  const sinSlack = ESTADO[clas] === 'pendiente_pago' ? reglaNoSlack(d) : null;
  const g = resolverGasto(d, f.Clave, destino, ESTADO[clas], f['Categoría'], f['Área'], f['Tipo gasto'], metodo, !sinSlack || !!sinSlack.crear_gasto);
  if (sinSlack && g.estado === 'pendiente_pago') g.estado = sinSlack.estado || 'pagada';
  plan.facturas_actualizar.push({ fila: f.fila, key: f.Clave, cambios: { 'Estado': g.estado, 'Gasto ID': g.gasto, 'Gasto sugerido': g.sugerido,
    ...(g.estado === 'pendiente_pago' ? { 'Slack ts': `{{SLACK:${f.Clave}}}` } : {}) } });
  if (g.estado === 'pendiente_pago') plan.slack.push(f.Clave);
  bit('cambió estado', f.Clave, 'Estado', 'por_validar', g.estado, 'Validada a mano: se generó el gasto');
}

// ---------- Facturas pendientes con mensaje en Slack: revisar si ya tienen ✅ ----------
for (const f of est.facturas) {
  if (f.Estado === 'pendiente_pago' && f['Slack ts'] && !String(f['Slack ts']).startsWith('{{')) {
    plan.revisar.push({ fila: f.fila, key: f.Clave, ts: String(f['Slack ts']), registrada: String(f.Registrada || '').slice(0, 10),
      emisor: f.Emisor, total: f.Total, moneda: f.Moneda, gasto: f['Gasto ID'] });
  }
}
plan.revisar = plan.revisar.slice(0, 150);

// ---------- Movimientos bancarios (Metabase · bankMovements; cargos negativos, abonos positivos) ----------
if (cfg.bancos_activo && $('Metabase: movimientos').isExecuted) {
  const M = cfg.metabase_columnas;
  const crudos = $('Metabase: movimientos').all().map(i => i.json).filter(j => j && !j.error && j[M.monto] !== undefined && j[M.monto] !== null);
  if (!crudos.length) meta.bancos_error = 'Metabase no devolvió movimientos';
  const desde = [cfg.bancos_inicio, new Date(Date.now() - cfg.bancos_dias * 864e5).toISOString().slice(0, 10)].sort().pop();
  const ignorar = new RegExp(cfg.bancos_ignorar, 'i');
  const refs = new Set([...est.gastos, ...est.ingresos].map(o => o.ref).filter(r => r && !r.startsWith('n8n:')));
  const movs = crudos.map(j => ({ id: String(j[M.id]), fecha: String(j[M.fecha] || '').slice(0, 10), cuenta: String(j[M.cuenta] || '').trim(),
      monto: Number(j[M.monto]), moneda: String(j[M.moneda] || 'MXN'), referencia: String(j[M.referencia] || ''), descripcion: String(j[M.descripcion] || '') }))
    .filter(m => m.fecha >= desde && m.monto !== 0 && !refs.has(m.id))
    .filter(m => !(m.monto > 0 && (cfg.bancos_solo_cargos || []).some(c => norm(c) === norm(m.cuenta))))   // cobranza de clientes
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  const nuevasPorTemp = new Map(plan.facturas_nuevas.map(f => [f.valores['Gasto ID'], f]));
  // Gastos que esperan su pago: los que creó n8n (marca en "Ref banco"), los capturados a mano y los de esta corrida
  const gastos = [
    ...plan.filas_nuevas.map(g => ({ nuevo: true, id: g.temp, g, tab: g.tab, fecha: g.fecha, total: Math.abs(g.campos.total), metodo: g.campos.metodo, n8n: true, tarjeta: g.tarjeta })),
    ...est.gastos.filter(o => (!o.ref || o.ref.startsWith('n8n:')) && o.total !== null && o.fecha && o.fecha >= limite).map(o => ({
      nuevo: false, id: o.id, fila: o.fila, tab: o.tab, fecha: o.fecha, total: Math.abs(o.total), metodo: o.metodo, origen: o.origen,
      n8n: o.ref.startsWith('n8n:'), tarjeta: o.ref.startsWith('n8n:') ? /tarjeta/.test(o.ref) : esTarjeta(o.metodo) }))
  ];
  const ingresos = est.ingresos.filter(o => !o.ref && o.total !== null);
  const tomados = new Set();
  const llave = g => g.nuevo ? g.id : `${g.tab}:${g.fila}`;
  for (const m of movs) {
    if (ignorar.test(m.descripcion)) { plan.ignorados_banco.push(m); continue; }
    if (m.monto > 0) {                              // abono: ¿ya está en INCOME (capturado a mano)?
      const c = ingresos.filter(o => !tomados.has(`INCOME:${o.fila}`) && o.vintage === vintage(m.fecha) && Math.abs(Math.abs(o.total) - m.monto) <= C.tolerancia_mxn);
      if (c.length === 1) {
        tomados.add(`INCOME:${c[0].fila}`);
        plan.actualizar.push({ tab: 'INCOME', fila: c[0].fila, cambios: { origen: `${c[0].origen ? c[0].origen + ' · ' : ''}n8n mov #${m.id}` } });
        res.conciliadas_banco++;
        bit('concilió con banco', `${cfg.destinos.INCOME} fila ${c[0].fila}`, 'ORIGEN', '', `mov #${m.id}`, `${m.cuenta} · ${m.fecha} · ${m.monto}`);
      } else plan.sin_conciliar.push({ ...m, tipo: 'abono' });
      continue;
    }
    const tarjeta = esTarjeta(m.cuenta);
    const cand = gastos.filter(g => {
      if (tomados.has(llave(g)) || Math.abs(g.total - Math.abs(m.monto)) > C.tolerancia_mxn || g.tarjeta !== tarjeta) return false;
      const df = dias(m.fecha, g.fecha);
      if (g.n8n) return df >= -C.dias_despues && df <= C.dias_antes && (!g.metodo || !tarjeta || norm(g.metodo) === norm(m.cuenta));
      return Math.abs(df) <= 3 && norm(g.metodo) === norm(m.cuenta);    // capturado a mano: misma cuenta y fecha cercana
    });
    if (cand.length !== 1) { plan.sin_conciliar.push({ ...m, tipo: 'cargo', candidatos: cand.map(llave) }); continue; }
    const g = cand[0];
    tomados.add(llave(g));
    res.conciliadas_banco++;
    if (g.nuevo) {                                  // el pago ya estaba en el banco: el gasto nace pagado
      Object.assign(g.g.campos, { fecha: m.fecha, vintage: vintage(m.fecha), metodo: m.cuenta, ref_banco: m.id, origen: `n8n mov #${m.id}` });
      g.g.fecha = m.fecha;
      const f = nuevasPorTemp.get(g.id);
      if (f) {
        if (f.valores.Estado === 'pendiente_pago') res.pendientes_pago--;
        if (f.valores.Estado === 'por_conciliar') res.por_conciliar--;
        f.valores.Estado = 'pagada'; f.valores['Slack ts'] = ''; f.slack = false;
        plan.slack = plan.slack.filter(k => k !== f.key);
      }
      const u = plan.facturas_actualizar.find(x => x.cambios['Gasto ID'] === g.id);
      if (u) { u.cambios.Estado = 'pagada'; delete u.cambios['Slack ts']; plan.slack = plan.slack.filter(k => k !== u.key); }
    } else {
      const cambios = g.tab === 'FINANCIAL'
        ? { origen: `${g.origen ? g.origen + ' · ' : ''}n8n mov #${m.id}` }
        : { ref_banco: m.id, ...(g.n8n ? { fecha: m.fecha, vintage: vintage(m.fecha), metodo: m.cuenta } : {}) };
      plan.actualizar.push({ tab: g.tab, fila: g.fila, id: g.id, cambios });
      for (const f of est.facturas) {
        if (g.id && String(f['Gasto ID']) === g.id && ['pendiente_pago', 'por_conciliar'].includes(f.Estado)) {
          plan.facturas_actualizar.push({ fila: f.fila, cambios: { 'Estado': 'pagada' } });
          bit('cambió estado', f.Clave, 'Estado', f.Estado, 'pagada', `Pago encontrado en ${m.cuenta} el ${m.fecha}`);
        }
      }
    }
    bit('concilió con banco', g.id || `${g.tab} fila ${g.fila}`, 'Ref banco', '', m.id, `${m.cuenta} · ${m.fecha} · ${m.monto} · ${m.descripcion.slice(0, 60)}`);
  }
}

return [{ json: { plan, resumen: res, meta } }];
