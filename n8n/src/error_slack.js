// Flujo de errores: avisa por correo (y en Slack, cuando el bot esté aprobado) en qué paso falló la corrida de gastos.
const CANAL = 'C03KJNZRX5J';   // #budget-y-presupuestos
const e = $json.execution || {};
const err = e.error || {};
const texto = [
  ':rotating_light: *El flujo de gastos falló*',
  `*Paso:* ${e.lastNodeExecuted || 'desconocido'}`,
  `*Error:* ${String(err.message || 'sin mensaje').slice(0, 500)}`,
  e.url ? `<${e.url}|Ver la ejecución en n8n>` : '',
  'Lo que no se procesó se recoge en la siguiente corrida.'
].filter(Boolean).join('\n');
const esc = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333">
<p><b>El flujo de gastos falló.</b></p>
<p><b>Paso:</b> ${esc(e.lastNodeExecuted || 'desconocido')}<br><b>Error:</b> ${esc(String(err.message || 'sin mensaje').slice(0, 500))}</p>
${e.url ? `<p><a href="${esc(e.url)}">Ver la ejecución en n8n</a></p>` : ''}
<p style="color:#667085">Lo que no se procesó se recoge en la siguiente corrida.</p></div>`;
return [{ json: { cuerpo: { channel: CANAL, text: texto }, para: 'alvaro@atratopago.com', asunto: `Falló el flujo de gastos · ${e.lastNodeExecuted || ''}`.trim(), html } }];
