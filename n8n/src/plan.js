// Completa el plan con los movimientos bancarios que clasificó el agente: crea su renglón en OPEX,
// FIXED_ASSETS, FINANCIAL o INCOME (o los ignora). Los nodos siguientes leen el plan de aquí.
const cfg = $('Config').first().json;
const est = $('Estado').first().json;
const base = $('Plan facturas').first().json;
const plan = JSON.parse(JSON.stringify(base.plan));
const res = Object.assign({}, base.resumen);
const meta = Object.assign({}, base.meta);
const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
const vintage = fecha => { const m = +String(fecha).slice(5, 7); return `${String(m).padStart(2, '0')}_${MESES[m - 1]}`; };
const r2 = n => Math.round(n * 100) / 100;
const ahora = new Intl.DateTimeFormat('sv-SE', { timeZone: cfg.zona_horaria, dateStyle: 'short', timeStyle: 'short' }).format(new Date());
const bit = (accion, objeto, campo, antes, despues, comentario) => plan.bitacora.push([ahora, 'n8n', 'n8n', accion, objeto, campo || '', antes ?? '', despues ?? '', comentario || '']);
const enLista = (v, lista) => (v && lista.includes(v) ? v : '');

// Respuestas del agente por id de movimiento
const clasif = new Map();
if ($('Claude bancos').isExecuted) {
  const sol = $('Solicitudes IA bancos').all();
  $('Claude bancos').all().forEach((r, i) => {
    const j = r.json || {};
    const t = (j.content || []).find(b => b.type === 'text');
    if (j.error || j.stop_reason === 'refusal' || !t) { res.ia_errores++; return; }
    try { for (const m of (JSON.parse(t.text).movimientos || [])) clasif.set(String(m.id), m); }
    catch (e) { res.ia_errores++; }
  });
}

const fxMes = fecha => est.fx[+String(fecha).slice(5, 7)] || null;
let temp = plan.filas_nuevas.filter(f => /^NUEVO-/.test(f.temp || '')).length;
plan.movimientos_sin_clasificar = [];
for (const m of plan.sin_conciliar) {
  const k = clasif.get(m.id);
  if (!k) { plan.movimientos_sin_clasificar.push(m); continue; }       // se retoma en la siguiente corrida
  if (k.destino === 'IGNORAR' || (k.destino === 'INCOME' && m.monto < 0)) {
    plan.ignorados_banco.push({ ...m, motivo: k.motivo });
    bit('ignoró movimiento', `mov #${m.id}`, '', '', '', `${m.cuenta} · ${m.fecha} · ${m.monto} · ${k.motivo}`);
    continue;
  }
  const dudoso = k.confianza < cfg.ia_confianza_minima;               // con duda: se registra, pero sin categoría para que la complete el equipo
  const monto = r2(-m.monto);                                         // cargo (negativo) → gasto positivo; abono → negativo (reembolso)
  const usd = /usd/i.test(m.moneda) || /usd/i.test(m.cuenta);
  const tc = usd ? (fxMes(m.fecha) || 0) : 1;
  const mxn = r2(monto * tc);
  const origen = `n8n mov #${m.id} · ${m.cuenta} · ${m.descripcion.slice(0, 80)}`;
  const descripcion = (k.descripcion || m.descripcion).toUpperCase().slice(0, 80);
  let campos;
  if (k.destino === 'INCOME') {
    campos = { vintage: vintage(m.fecha), fecha: m.fecha, descripcion, amount: r2(m.monto * tc), usd: usd ? r2(m.monto) : '', vat: '', isr: '',
      total: r2(m.monto * tc), origen };
  } else if (k.destino === 'FINANCIAL') {
    campos = { vintage: vintage(m.fecha), fecha: m.fecha, categoria: dudoso ? '' : enLista(k.categoria, est.catalogos.categorias_financial),
      subcategoria: dudoso ? '' : enLista(k.subcategoria, est.catalogos.subcategorias_financial), descripcion, metodo: m.cuenta,
      amount: mxn, vat: 0, total: mxn, usd: usd ? monto : (fxMes(m.fecha) ? r2(mxn / fxMes(m.fecha)) : ''), folio: m.referencia, origen };
  } else {
    const lista = k.destino === 'FIXED_ASSETS' ? [...est.catalogos.categorias_activos, ...est.catalogos.categorias] : est.catalogos.categorias;
    campos = { id: `NUEVO-${++temp}`, vintage: vintage(m.fecha), fecha: m.fecha, categoria: dudoso ? '' : enLista(k.categoria, lista),
      area: dudoso ? '' : enLista(k.area, est.catalogos.areas), descripcion, tipo: dudoso ? '' : enLista(k.tipo_gasto, est.catalogos.tipos),
      metodo: m.cuenta, amount: mxn, vatq: false, vat: 0, vat_ret: '', isr: '', total: mxn,
      usd: usd ? monto : (fxMes(m.fecha) ? r2(mxn / fxMes(m.fecha)) : ''), user: 'NA', provider: '', folio: 'NA', invoice: '',
      receipt: k.requiere_factura ? '' : 'NO FACTURA', prorated: false, prorated_m: '', ref_banco: m.id };
  }
  plan.filas_nuevas.push({ tab: k.destino, temp: campos.id || `MOV-${m.id}`, fecha: m.fecha, desde_banco: true, campos });
  res.filas_banco++;
  bit('registró movimiento', campos.id || `mov #${m.id}`, cfg.destinos[k.destino], '', `${monto} · ${descripcion}`,
    `${dudoso ? 'Sin categoría (confianza baja). ' : ''}${k.motivo}`);
}
res.movimientos_ignorados = plan.ignorados_banco.length;
res.movimientos_pendientes = plan.movimientos_sin_clasificar.length;
return [{ json: { plan, resumen: res, meta } }];
