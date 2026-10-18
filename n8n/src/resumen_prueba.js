// Modo prueba: un solo mensaje en Slack con lo que la corrida HABRÍA hecho, y el registro de la corrida.
const cfg = $('Config').first().json;
const est = $('Estado').first().json;
const { plan, resumen, meta } = $('Plan').first().json;
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dinero = (v, m) => (v === '' || v === null || v === undefined) ? 'sin monto'
  : `${Number(v) < 0 ? '-' : ''}$${Math.abs(Number(v)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${m && m !== 'MXN' ? ' ' + m : ''}`;
const ESTADOS = { pendiente_pago: 'pendiente de pago', por_conciliar: 'tarjeta · por conciliar', por_validar: 'por validar', pagada: 'pagada',
  complemento: 'complemento', descartada: 'descartada' };

const lineas = plan.facturas_nuevas.slice(0, 25).map(f => {
  const v = f.valores;
  const gasto = /^NUEVO-/.test(v['Gasto ID']) ? 'crearía gasto' : v['Gasto ID'] ? `relacionaría con ${v['Gasto ID']}` : (v['Gasto sugerido'] ? `sugerencia: ${v['Gasto sugerido']}` : 'sin gasto');
  return `• *${esc(v.Emisor || 'Sin datos')}* · ${dinero(v.Total, v.Moneda)} · ${ESTADOS[v.Estado] || v.Estado} · ${gasto}` +
    `${v['Categoría'] ? ` · ${esc(v['Categoría'])}/${esc(v['Área'] || '—')}` : ''}\n   _${esc(String(v.Motivo || '').slice(0, 140))}_`;
});
const extra = plan.facturas_nuevas.length > 25 ? `\n…y ${plan.facturas_nuevas.length - 25} más` : '';
const banco = plan.filas_nuevas.filter(f => f.desde_banco);
const lineasBanco = banco.slice(0, 20).map(f => `• ${esc(f.campos.descripcion)} · ${dinero(f.campos.total)} → *${esc(cfg.destinos[f.tab])}*` +
  `${f.campos.categoria ? ` · ${esc(f.campos.categoria)}${f.campos.area ? '/' + esc(f.campos.area) : ''}` : ' · _sin categoría_'}${f.campos.receipt === 'NO FACTURA' ? ' · NO FACTURA' : ''}`);
const conciliados = plan.actualizar.filter(u => u.cambios.ref_banco || /n8n mov/.test(u.cambios.origen || '')).length;
const texto = [
  `:test_tube: *Modo prueba · corrida ${est.corrida}* (no se escribió nada). Esto habría hecho:`,
  `*${resumen.facturas_nuevas}* facturas nuevas · *${resumen.gastos_creados}* gastos creados · *${resumen.relacionadas}* relacionadas con gastos existentes · *${resumen.pendientes_pago}* pendientes de pago (mensaje a <@${cfg.slack_mencion}>) · *${resumen.por_validar}* por validar · *${resumen.por_conciliar}* de tarjeta`,
  `Duplicadas: ${resumen.duplicadas} · Anteriores al ${cfg.fecha_inicio_registro}: ${resumen.anteriores} · PDF que no eran factura: ${resumen.no_factura} · Errores de IA: ${resumen.ia_errores}` +
    ` · SAT: ${cfg.todoconta_activo ? (meta.sat_error || `${resumen.sat_filas} CFDIs revisados`) : 'apagado'}` +
    ` · Bancos: ${cfg.bancos_activo ? (meta.bancos_error || 'ver abajo') : 'apagado'}` +
    `\nSlack: canal ${resumen.slack_canal} · ${resumen.ya_en_slack} facturas ya se habían pedido ahí (${resumen.pagadas_slack} con ✅, se marcan pagadas; las demás no se vuelven a mandar) · ${resumen.no_slack} sin mensaje por regla (bancos, Shipkraken, fideicomiso, compensación)`,
  '',
  ...lineas,
  ...(extra ? [extra] : []),
  ...(cfg.bancos_activo ? ['', `*Bancos:* ${conciliados} pagos ligados a gastos existentes · ${banco.length} renglones nuevos · ${plan.ignorados_banco.length} ignorados · ${(plan.movimientos_sin_clasificar || []).length} para la siguiente corrida`, ...lineasBanco] : [])
].join('\n');
const fila = est.filas.corridas + 1;
return [{ json: {
  cuerpo: { channel: cfg.slack_canal, text: texto.slice(0, 3900), unfurl_links: false },
  valores: { valueInputOption: 'USER_ENTERED', data: [{ range: `'N8N_CORRIDAS'!A${fila}:O${fila}`, values: [[
    est.corrida, cfg.inicio_utc, new Date().toISOString(), 'ok', est.desde, 'SÍ', cfg.disparo, '', resumen.facturas_nuevas, resumen.gastos_creados,
    resumen.relacionadas, resumen.pendientes_pago, resumen.por_validar, resumen.ia_errores, 'Modo prueba: no se escribió nada'
  ]] }] }
} }];
