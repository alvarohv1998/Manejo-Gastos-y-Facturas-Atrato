// Correo a facturacion@ con los gastos nuevos que ninguna regla resolvió (regla 5).
const cfg = $('Config').first().json;
const est = $('Estado').first().json;
const { plan } = $('Plan').first().json;
if (!plan.validacion.length) return [{ json: { ninguno: true } }];
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dinero = (v, m) => (v === null || v === undefined || v === '') ? 'sin monto'
  : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${m && m !== 'MXN' ? ' ' + m : ''}`;
const filas = plan.validacion.map(v => `<tr>
  <td style="padding:6px 10px;border-bottom:1px solid #E6E2F0">${esc(v.emisor || 'Sin datos')}<br><span style="color:#667085;font-size:12px">${esc(v.rfc || '')}</span></td>
  <td style="padding:6px 10px;border-bottom:1px solid #E6E2F0;text-align:right;white-space:nowrap">${dinero(v.total, v.moneda)}</td>
  <td style="padding:6px 10px;border-bottom:1px solid #E6E2F0;white-space:nowrap">${esc(String(v.fecha || '').slice(0, 10))}</td>
  <td style="padding:6px 10px;border-bottom:1px solid #E6E2F0;color:#475467">${esc(v.motivo)}</td></tr>`).join('');
const html = `<div style="font-family:Arial,sans-serif;color:#333;font-size:14px">
<p>Hola,</p>
<p>Estas facturas llegaron hoy y ninguna regla las resuelve. ¿Hay que registrarlas y pagarlas?</p>
<table style="border-collapse:collapse;font-size:13px">
<tr style="background:#4D4590;color:#fff"><th style="padding:6px 10px;text-align:left">Emisor</th><th style="padding:6px 10px;text-align:right">Total</th><th style="padding:6px 10px;text-align:left">Fecha</th><th style="padding:6px 10px;text-align:left">Por qué está aquí</th></tr>
${filas}</table>
<p>Para resolverlas, en la pestaña <b>FACTURAS</b> del Budget cambia la columna <b>Clasificación</b> a <i>pagar</i>, <i>pagar_banregio</i>, <i>pagada_tarjeta</i> o <i>descartada</i>. En la siguiente corrida se genera el gasto y, si hay que pagarla, el aviso en Slack.</p>
<p style="color:#667085;font-size:12px">Mensaje automático del flujo de gastos (n8n) · corrida ${est.corrida}</p></div>`;
return [{ json: { para: cfg.correo_validacion_para, asunto: `Validar ${plan.validacion.length} gasto(s) nuevo(s) · ${est.hoy}`, html } }];
