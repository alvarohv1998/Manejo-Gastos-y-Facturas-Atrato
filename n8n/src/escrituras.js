// Arma TODO lo que se escribe en el Budget en una sola operación: renglones nuevos en OPEX, FIXED_ASSETS,
// FINANCIAL e INCOME (con el formato del renglón anterior), cambios en renglones existentes, FACTURAS,
// BITACORA y el registro de la corrida. OPEX-CONTA no se toca.
const cfg = $('Config').first().json;
const est = $('Estado').first().json;
const { plan, resumen, meta } = $('Plan').first().json;
const asig = $('Asignar IDs').first().json;
const T = s => `'${s}'`;
const letra = i => { let s = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
const ahoraIso = new Date().toISOString();
const seguro = v => (typeof v === 'string' && (/^[=+@]/.test(v) || /^-[^\d]/.test(v)) ? `'${v}` : v);    // un texto de correo no se vuelve fórmula
// En el Budget la fecha es texto dd/mm/aa (columna con formato texto); el apóstrofo evita que Sheets la convierta en número
const fechaTexto = iso => `'${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}/${String(iso).slice(2, 4)}`;
const comoTexto = v => (typeof v === 'string' && v && !v.startsWith("'") ? `'${v}` : v);

// ---------- Enlaces de Drive, ts de Slack y códigos ----------
const enlaces = {};
let erroresDrive = 0;
// Primer intento y reintento (los que Drive rechazó por límite de velocidad se mandan otra vez tras una pausa)
for (const [subida, entrada, reintento] of [['Drive: subir', 'Archivos a subir', false], ['Drive: subir (reintento)', 'Subidas fallidas', true]]) {
  if (!$(subida).isExecuted) continue;
  const subidos = $(entrada).all();
  $(subida).all().forEach((r, i) => {
    const a = subidos[i] && subidos[i].json;
    if (!a || a.ninguno) return;
    if (!r.json || !r.json.id) { if (reintento || !$('Drive: subir (reintento)').isExecuted) erroresDrive++; return; }
    if (!enlaces[a.key] || a.ext === 'pdf') enlaces[a.key] = `https://drive.google.com/file/d/${r.json.id}/view`;
  });
}
for (const f of est.facturas) if (f['Link Drive'] && !enlaces[f.Clave]) enlaces[f.Clave] = f['Link Drive'];
const tsSlack = {};
let erroresSlack = 0;
if ($('Slack: publicar factura').isExecuted) {
  const msgs = $('Mensajes Slack').all();
  $('Slack: publicar factura').all().forEach((r, i) => {
    const m = msgs[i] && msgs[i].json;
    if (!m || m.ninguno) return;
    if (r.json && r.json.ok && r.json.ts) tsSlack[m.key] = r.json.ts; else erroresSlack++;
  });
}
const resolver = v => {
  if (typeof v !== 'string') return v;
  return v.replace(/\{\{LINK:([^}]+)\}\}/g, (_, k) => enlaces[k] || (/^[0-9A-F-]{36}$/.test(k) ? `UUID ${k}` : ''))
    .replace(/\{\{SLACK:([^}]+)\}\}/g, (_, k) => (tsSlack[k] ? `'${tsSlack[k]}` : ''))
    .replace(/NUEVO-\d+/g, t => asig.codigos[t] || t);
};
const data = [], dataControl = [];
const CONTROL = /^'(FACTURAS|BITACORA|N8N_CORRIDAS|N8N_SAT)'!/;     // pestañas que viven en la hoja de control
const poner = (rango, fila) => (CONTROL.test(rango) ? dataControl : data).push({ range: rango, values: [fila.map(v => (v === null ? null : seguro(resolver(v))))] });

// ---------- Renglones nuevos en las pestañas de registro ----------
const hojas = (($('Sheets: pestañas').first().json || {}).sheets || []).map(s => s.properties);
const requests = [];
const nuevasPorTab = {};
for (const f of plan.filas_nuevas) {
  const fila = asig.filas[f.temp];
  if (!fila) continue;
  (nuevasPorTab[f.tab] = nuevasPorTab[f.tab] || []).push({ ...f, fila });
}
for (const [tab, filas] of Object.entries(nuevasPorTab)) {
  const p = est.pestanas[tab], fr = asig.fresco[tab];
  const nCols = fr.nCols;
  for (const f of filas) {
    const valoresFila = Array(nCols).fill('');
    for (const [k, v] of Object.entries(f.campos)) {
      const j = p.col[k];
      if (j === undefined || j < 0 || j >= nCols) continue;
      valoresFila[j] = k === 'fecha' ? fechaTexto(v) : k === 'id' ? comoTexto(resolver(v)) : v;
    }
    for (let j = 0; j < nCols; j++) if (fr.formulas[j]) valoresFila[j] = null;     // se queda la fórmula copiada
    poner(`${T(p.nombre)}!A${f.fila}:${letra(nCols - 1)}${f.fila}`, valoresFila);
  }
  // Formato, listas desplegables, casillas y fórmulas: se copian del último renglón capturado
  const hoja = hojas.find(h => h.title === p.nombre) || {};
  if (hoja.sheetId === undefined) continue;
  const grid = hoja.gridProperties || {};
  const ultimaNueva = Math.max(...filas.map(f => f.fila));
  if (grid.rowCount && ultimaNueva > grid.rowCount) requests.push({ appendDimension: { sheetId: hoja.sheetId, dimension: 'ROWS', length: ultimaNueva - grid.rowCount } });
  if (grid.columnCount && nCols > grid.columnCount) requests.push({ appendDimension: { sheetId: hoja.sheetId, dimension: 'COLUMNS', length: nCols - grid.columnCount } });
  const copia = tipo => ({ copyPaste: {
    source: { sheetId: hoja.sheetId, startRowIndex: fr.ultima - 1, endRowIndex: fr.ultima, startColumnIndex: 0, endColumnIndex: nCols },
    destination: { sheetId: hoja.sheetId, startRowIndex: fr.ultima, endRowIndex: ultimaNueva, startColumnIndex: 0, endColumnIndex: nCols },
    pasteType: tipo, pasteOrientation: 'NORMAL' } });
  requests.push(copia('PASTE_FORMAT'), copia('PASTE_DATA_VALIDATION'));
  if (fr.formulas.some(Boolean)) requests.push(copia('PASTE_FORMULA'));
}

// ---------- Cambios en renglones existentes ----------
let noEncontrados = 0;
const usaRef = new Set();
for (const u of plan.actualizar) {
  const p = est.pestanas[u.tab], fr = asig.fresco[u.tab];
  if (!p || !fr) { noEncontrados++; continue; }
  const fila = u.id ? fr.fila_por_id[u.id] : u.fila;          // con ID se ubica de nuevo por si el renglón se movió
  if (!fila) { noEncontrados++; continue; }
  for (const [k, v] of Object.entries(u.cambios)) {
    const L = p.letras[k];
    if (!L) continue;
    if (k === 'ref_banco') usaRef.add(u.tab);
    poner(`${T(p.nombre)}!${L}${fila}`, [k === 'fecha' ? fechaTexto(v) : v]);
  }
}
// Renglones que n8n escribió antes con la fecha como número (se veía 46296): se pasan a texto dd/mm/aa
for (const o of est.gastos) {
  const p = est.pestanas[o.tab];
  if (!o.fecha_num || !o.fecha || !String(o.ref).startsWith('n8n') || !p || !p.letras.fecha) continue;
  poner(`${T(p.nombre)}!${p.letras.fecha}${o.fila}`, [fechaTexto(o.fecha)]);
}
// Columna "Ref banco (n8n)" (W) en OPEX y FIXED_ASSETS: se crea el encabezado la primera vez
for (const tab of ['OPEX', 'FIXED_ASSETS']) {
  const p = est.pestanas[tab];
  if (!p || !p.crear_ref || !(usaRef.has(tab) || (nuevasPorTab[tab] || []).length)) continue;
  poner(`${T(p.nombre)}!${p.letras.ref_banco}${p.fila_encabezado}`, [cfg.columna_ref_banco]);
  const hoja = hojas.find(h => h.title === p.nombre) || {};
  const g = hoja.gridProperties || {};
  if (g.columnCount && g.columnCount < p.col.ref_banco + 1 && !(nuevasPorTab[tab] || []).length) {
    requests.push({ appendDimension: { sheetId: hoja.sheetId, dimension: 'COLUMNS', length: p.col.ref_banco + 1 - g.columnCount } });
  }
}
// El gasto de una factura que acaba de recibir su archivo también recibe el enlace
for (const a of plan.adjuntar) {
  if (!a.gasto_id || !enlaces[a.key]) continue;
  for (const tab of ['OPEX', 'FIXED_ASSETS']) {
    const fila = asig.fresco[tab] && asig.fresco[tab].fila_por_id[a.gasto_id];
    if (fila && est.pestanas[tab].letras.invoice) poner(`${T(est.pestanas[tab].nombre)}!${est.pestanas[tab].letras.invoice}${fila}`, [enlaces[a.key]]);
  }
}

// ---------- FACTURAS ----------
const enc = est.encabezado_facturas;
const letraFac = h => { const i = enc.indexOf(h); return i >= 0 ? letra(i) : null; };
let filaFac = est.filas.facturas + 1;
for (const f of plan.facturas_nuevas) {
  poner(`'FACTURAS'!A${filaFac}:${letra(enc.length - 1)}${filaFac}`,
    enc.map(h => (['Clave', 'Gasto ID'].includes(h) ? comoTexto(resolver(f.valores[h] ?? '')) : (f.valores[h] ?? ''))));
  filaFac++;
}
const pagadas = (($('Recordatorios').first() || {}).json || {}).pagadas || [];
const cambiosFac = [
  ...plan.facturas_actualizar,
  ...plan.adjuntar.map(a => ({ fila: a.fila, cambios: { 'Link Drive': `{{LINK:${a.key}}}`, 'Carpeta': a.carpeta } })),
  ...pagadas.map(p => ({ fila: p.fila, cambios: { 'Estado': 'pagada' } }))
];
for (const u of cambiosFac) {
  for (const [h, v] of Object.entries(u.cambios)) {
    const L = letraFac(h);
    if (L) poner(`'FACTURAS'!${L}${u.fila}`, [h === 'Gasto ID' ? comoTexto(resolver(v)) : v]);
  }
}

// ---------- BITACORA ----------
const ahora = new Intl.DateTimeFormat('sv-SE', { timeZone: cfg.zona_horaria, dateStyle: 'short', timeStyle: 'short' }).format(new Date());
const bitacora = plan.bitacora.slice();
for (const p of pagadas) bitacora.push([ahora, 'n8n', 'n8n', 'cambió estado', p.key, 'Estado', 'pendiente_pago', 'pagada', 'Tiene ✅ en Slack']);
let filaBit = est.filas.bitacora + 1;
for (const b of bitacora) { poner(`'BITACORA'!A${filaBit}:I${filaBit}`, b); filaBit++; }

// ---------- Registro de la corrida y del SAT ----------
const notas = [
  meta.sat_error ? `SAT: ${meta.sat_error}` : (cfg.todoconta_activo ? `SAT: ${resumen.sat_filas} CFDIs revisados` : 'SAT apagado'),
  resumen.reclasificadas ? `${resumen.reclasificadas} facturas reclasificadas (el agente no había respondido)` : '',
  `Slack: canal ${resumen.slack_canal}, ${resumen.ya_en_slack || 0} ya pedidas ahí (${resumen.pagadas_slack || 0} con ✅)`,
  cfg.bancos_activo ? (meta.bancos_error ? `Bancos: ${meta.bancos_error}` : `Bancos: ${resumen.conciliadas_banco} conciliados, ${resumen.filas_banco} registrados, ${resumen.movimientos_ignorados || 0} ignorados, ${resumen.movimientos_pendientes || 0} para la siguiente corrida`) : 'Bancos apagado',
  plan.ignoradas.length ? `${plan.ignoradas.length} PDF no eran factura` : '',
  noEncontrados ? `${noEncontrados} renglones no encontrados al escribir` : '',
  pagadas.length ? `${pagadas.length} marcadas pagadas por ✅` : '',
  ...(est.errores || [])
].filter(Boolean).join(' · ');
const correos = $('Gmail: facturas').all().filter(i => i.json && i.json.id).length;
const errores = resumen.ia_errores + erroresDrive + erroresSlack;
poner(`'N8N_CORRIDAS'!A${est.filas.corridas + 1}:O${est.filas.corridas + 1}`, [
  est.corrida, cfg.inicio_utc, ahoraIso, 'ok', est.desde, 'NO', cfg.disparo, correos, resumen.facturas_nuevas, resumen.gastos_creados + resumen.filas_banco,
  resumen.relacionadas, resumen.pendientes_pago, resumen.por_validar, errores, notas
]);
if (cfg.todoconta_activo && $('SAT: leer respuestas').isExecuted) {
  const s = $('SAT: leer respuestas').first().json;
  let filaSat = est.filas.sat + 1;
  for (const [paso, x] of Object.entries(s.respuestas || {})) {
    poner(`'N8N_SAT'!A${filaSat}:E${filaSat}`, [ahora, paso, (s.ventana || {}).csv ? s.ventana.csv[0] : '', est.hoy, String((x || {}).texto || '').slice(0, 450)]);
    filaSat++;
  }
}

// ---------- Candado: en el Budget n8n solo agrega renglones ----------
// Nunca borra renglones, columnas ni pestañas, y nunca vacía ni reemplaza lo que capturó una persona.
// En renglones existentes solo llena celdas vacías (Invoice, Folio, Ref banco…) o agrega texto al final (ORIGEN);
// los renglones que creó n8n (marca "n8n" en Ref banco u ORIGEN) sí los puede completar.
const TIPOS_OK = new Set(['appendDimension', 'copyPaste']);
const primeraNueva = {};                                    // sheetId → índice (base 0) del primer renglón nuevo
for (const tab of Object.keys(nuevasPorTab)) {
  const hoja = hojas.find(h => h.title === est.pestanas[tab].nombre);
  if (hoja) primeraNueva[hoja.sheetId] = asig.fresco[tab].ultima;
}
for (const r of requests) {
  const tipo = Object.keys(r)[0];
  if (!TIPOS_OK.has(tipo)) throw new Error(`Candado del Budget: operación no permitida (${tipo}). No se escribió nada.`);
  if (tipo === 'copyPaste') {
    const dst = r.copyPaste.destination;
    if (!(dst.startRowIndex >= primeraNueva[dst.sheetId])) throw new Error('Candado del Budget: se intentó copiar formato sobre renglones existentes. No se escribió nada.');
  }
}
const actuales = {};                                        // nombre de pestaña → valores actuales (releídos con fórmulas)
['OPEX', 'FIXED_ASSETS', 'FINANCIAL', 'INCOME'].forEach((t, i) => {
  const p = est.pestanas[t];
  if (p) actuales[p.nombre] = (($('Sheets: releer').first().json.valueRanges || [])[i] || {}).values || [];
});
const tabPorNombre = Object.fromEntries(Object.entries(est.pestanas).map(([t, p]) => [p.nombre, t]));
const colIndex = L => [...L].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const vacio = v => v === '' || v === null || v === undefined || /^na$/i.test(String(v).trim());
const bloqueados = [];
for (const w of data) {
  const m = w.range.match(/^'(.+)'!([A-Z]+)(\d+)/);
  if (!m) continue;
  const [, hojaNombre, L, filaTxt] = m;
  const tab = tabPorNombre[hojaNombre], fila = +filaTxt;
  if (!tab || !asig.fresco[tab]) continue;
  if (fila > asig.fresco[tab].ultima) continue;              // renglón nuevo: permitido
  const p = est.pestanas[tab], cur = actuales[hojaNombre][fila - 1] || [];
  const marca = String((p.col.ref_banco >= 0 ? cur[p.col.ref_banco] : '') || (p.col.origen >= 0 ? cur[p.col.origen] : '') || '');
  const deN8n = /n8n/i.test(marca);
  const esEncabezado = fila === p.fila_encabezado;
  w.values[0] = w.values[0].map((v, k) => {
    if (v === null) return null;                             // null = no tocar la celda
    const col = colIndex(L) + k, antes = cur[col];
    const nuevoVacio = vacio(v) && !/^na$/i.test(String(v).trim());
    let ok;
    if (nuevoVacio) ok = vacio(antes);                       // nunca vaciar una celda con datos
    else if (deN8n || vacio(antes) || String(v) === String(antes)) ok = true;
    else if (esEncabezado) ok = vacio(antes);
    else ok = typeof v === 'string' && String(v).startsWith(String(antes));   // solo agregar texto al final (ORIGEN)
    if (!ok) bloqueados.push(`${hojaNombre}!${letra(col)}${fila}`);
    return ok ? v : null;
  });
}

return [{ json: {
  hay_copiar: requests.length > 0,
  copiar: { requests },
  hay_budget: data.length > 0,
  valores: { valueInputOption: 'USER_ENTERED', data },
  valoresControl: { valueInputOption: 'USER_ENTERED', data: dataControl },
  totales: { escrituras: data.length + dataControl.length, filas_nuevas: Object.fromEntries(Object.entries(nuevasPorTab).map(([t, f]) => [t, f.length])),
    codigos: Object.values(asig.codigos), erroresDrive, erroresSlack, bloqueados }
} }];
