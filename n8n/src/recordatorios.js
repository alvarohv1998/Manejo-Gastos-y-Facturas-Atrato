// ✅ en el mensaje = pagada. Sin ✅: recordatorio en el hilo a los N días de pedida y luego cada N días
// (slack_recordatorio_dias), etiquetando a quienes pagan. Va en la primera corrida después de cada marca de N días,
// así un fin de semana o festivo no se salta el recordatorio ni lo repite.
const cfg = $('Config').first().json;
const est = $('Estado').first().json;
const pagadaSi = new Set(cfg.slack_reacciones_pagada);
const DIA = 864e5, cada = (cfg.slack_recordatorio_dias || 7) * DIA;
const menciones = (cfg.slack_recordatorio_menciones || [cfg.slack_mencion]).map(u => `<@${u}>`).join(' ');
const ahora = Date.now(), anterior = new Date(est.desde).getTime() || (ahora - DIA);
const pagadas = [];
const out = [];
if ($('Slack: reacciones').isExecuted) {
  const revisar = $('Revisar ✅').all();
  $('Slack: reacciones').all().forEach((r, i) => {
    const f = revisar[i] && revisar[i].json;
    if (!f || f.ninguno) return;
    const j = r.json || {};
    if (!j.ok) return;                                        // sin permiso o mensaje borrado: se deja igual
    const reacciones = ((j.message || {}).reactions || []).map(x => String(x.name).split('::')[0]);
    if (reacciones.some(n => pagadaSi.has(n))) { pagadas.push(f); return; }
    // Desde cuándo se pidió: la hora del mensaje de Slack (el ts es un epoch en segundos)
    const pedida = Number(String(f.ts).split('.')[0]) * 1000 || new Date(f.registrada || est.hoy).getTime();
    const semanas = t => Math.floor((t - pedida) / cada);
    if (semanas(ahora) < 1 || semanas(ahora) <= semanas(anterior)) return;
    const dias = Math.floor((ahora - pedida) / DIA);
    const monto = f.total !== '' && f.total != null
      ? `$${Number(f.total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${f.moneda && f.moneda !== 'MXN' ? ' ' + f.moneda : ''}` : '';
    out.push({ json: { key: f.key, cuerpo: { channel: cfg.slack_canal, thread_ts: f.ts,
      text: `${menciones} Recordatorio de pago: esta factura lleva ${dias} días sin :white_check_mark:.` +
        `${f.emisor ? ` *${f.emisor}*` : ''}${monto ? ` · ${monto}` : ''}${f.gasto ? ` · gasto ${f.gasto}` : ''}. Si ya se pagó, pónganle :white_check_mark: al mensaje.` } } });
  });
}
if (!out.length) return [{ json: { ninguno: true, pagadas } }];
out[0].json.pagadas = pagadas;
return out;
