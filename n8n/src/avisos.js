// Avisos de la corrida: lo que falló sin detener el flujo (los nodos siguen aunque fallen para no perder el resto).
// Se mandan a Álvaro por mensaje directo de Slack y por correo. Si todo salió bien no se manda nada.
const cfg = $('Config').first().json;
const est = $('Estado').first().json;
const corrio = n => { try { return $(n).isExecuted; } catch (e) { return false; } };
const items = n => (corrio(n) ? $(n).all().map(i => i.json || {}) : []);
const errorDe = j => {
  if (!j || !j.error) return '';
  if (typeof j.error === 'string') return j.error;
  return String(j.error.description || j.error.message || JSON.stringify(j.error));
};
const avisos = [];

// 1. Claude: facturas y movimientos bancarios
for (const [nodo, que] of [['Claude', 'leer facturas'], ['Claude bancos', 'clasificar movimientos del banco']]) {
  const todos = items(nodo), errores = todos.map(errorDe).filter(Boolean);
  if (!errores.length) continue;
  const sinSaldo = errores.some(e => /credit balance/i.test(e));
  avisos.push(`*Claude (${que})*: fallaron ${errores.length} de ${todos.length} llamadas. ` +
    (sinSaldo ? 'No hay saldo en la cuenta de Anthropic: recarga en console.anthropic.com → Plans & Billing. Las facturas afectadas quedaron "por validar".'
      : `Error: ${errores[0].slice(0, 200)}`));
}

// 2. Slack: lectura del canal
const hist = items('Slack: historial del canal')[0];
if (cfg.slack_revisar_canal && hist && hist.ok === false) {
  avisos.push(`*Slack*: no se pudo leer el canal (${hist.error}${hist.needed ? `, falta el permiso ${hist.needed}` : ''}). ` +
    'Sin esto n8n no revisa si alguien ya pidió una factura. Agrega el permiso a la app y dale "Reinstall to Atrato".');
} else if (hist && errorDe(hist)) avisos.push(`*Slack*: no se pudo leer el canal: ${errorDe(hist).slice(0, 200)}`);

// 3. SAT, Metabase y XML del SAT
const planOut = corrio('Plan') ? $('Plan').first().json : {};
const meta = planOut.meta || {};
if (meta.sat_error) avisos.push(`*SAT (Todo Conta)*: ${meta.sat_error}`);
if (meta.bancos_error) avisos.push(`*Bancos (Metabase)*: ${meta.bancos_error}`);
const zip = [...items('SAT: descargar ZIP'), ...items('SAT: descomprimir')].map(errorDe).filter(Boolean);
if (zip.length) avisos.push(`*XML del SAT*: no se pudo bajar o abrir el ZIP (${zip[0].slice(0, 150)}). Las facturas sin PDF se quedan sin liga hasta la siguiente corrida.`);

// 4. Budget, Drive y Slack de esta corrida
const copiar = items('Sheets: copiar formato')[0];
if (copiar && errorDe(copiar)) {
  avisos.push(`*Budget*: no se copió el formato de los renglones nuevos (${errorDe(copiar).slice(0, 150)}). ` +
    (/filtered out row/i.test(errorDe(copiar)) ? 'Hay un filtro activo en OPEX: quítalo. Los datos sí se guardaron.' : 'Los datos sí se guardaron.'));
}
const esc = corrio('Escrituras') ? ($('Escrituras').first().json.totales || {}) : {};
if (esc.erroresDrive) avisos.push(`*Drive*: ${esc.erroresDrive} archivos no se pudieron subir. Sus facturas quedaron sin liga en Invoice.`);
if ((esc.bloqueados || []).length) avisos.push(`*Budget (candado)*: se bloquearon ${esc.bloqueados.length} cambios a celdas que ya tenían datos de una persona (${esc.bloqueados.slice(0, 5).join(', ')}${esc.bloqueados.length > 5 ? '…' : ''}). No se modificaron.`);
if (esc.erroresSlack) avisos.push(`*Slack*: ${esc.erroresSlack} mensajes de facturas pendientes no se pudieron publicar.`);
const resumenPrueba = items('Slack: resumen prueba')[0];
if (resumenPrueba && resumenPrueba.ok === false) avisos.push(`*Slack*: no se publicó el resumen de prueba (${resumenPrueba.error || errorDe(resumenPrueba)}).`);

const reacciones = items('Slack: ✅ pagada');
const sinPermiso = reacciones.find(j => j.ok === false && /missing_scope|not_allowed/.test(j.error || ''));
if (sinPermiso) avisos.push(`*Slack*: no se pudo poner ✅ a las facturas pagadas por complemento (falta el permiso ${sinPermiso.needed || 'reactions:write'}). Sí se avisó en el hilo. Agrega el permiso a la app y dale "Reinstall to Atrato".`);

// 5. Interfaz (artefacto)
const datosInterfaz = items('Datos interfaz')[0];
if (datosInterfaz && datosInterfaz.omitir) avisos.push(`*Interfaz*: ${datosInterfaz.motivo}`);
else if (datosInterfaz && errorDe(datosInterfaz)) avisos.push(`*Interfaz*: no se armaron los datos (${errorDe(datosInterfaz).slice(0, 150)}).`);
const subida = items('Drive: actualizar interfaz')[0];
if (subida && errorDe(subida)) avisos.push(`*Interfaz*: no se actualizó interfaz_gastos.json en Drive (${errorDe(subida).slice(0, 150)}). El artefacto muestra los datos de la corrida anterior.`);

if (!avisos.length) return [{ json: { ninguno: true } }];
const url = `https://alvarohv1998.app.n8n.cloud/workflow/${$workflow.id}/executions/${$execution.id}`;
const titulo = `:warning: *Avisos del flujo de gastos · corrida ${est.corrida}${cfg.modo_prueba ? ' (modo prueba)' : ''}*`;
const texto = [titulo, 'La corrida terminó, pero esto no salió bien:', ...avisos.map(a => `• ${a}`), `<${url}|Ver la ejecución en n8n>`].join('\n');
const h = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\*([^*]+)\*/g, '<b>$1</b>');
const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333">
<p><b>Avisos del flujo de gastos · corrida ${h(est.corrida)}</b></p><p>La corrida terminó, pero esto no salió bien:</p>
<ul>${avisos.map(a => `<li style="margin-bottom:6px">${h(a)}</li>`).join('')}</ul>
<p><a href="${url}">Ver la ejecución en n8n</a></p></div>`;
return [{ json: { cuerpo: { channel: cfg.avisos_slack, text: texto }, para: cfg.avisos_correo, asunto: `Avisos del flujo de gastos · corrida ${est.corrida}`, html, avisos } }];
