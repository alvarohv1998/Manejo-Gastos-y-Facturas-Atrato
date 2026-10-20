// Un mensaje en Slack por cada factura nueva pendiente de pago, etiquetando al responsable.
const cfg = $('Config').first().json;
const est = $('Estado').first().json;
const { plan } = $('Plan').first().json;
const { codigos } = $('Asignar IDs').first().json;

const enlaces = {};
for (const [subida, entrada] of [['Drive: subir', 'Archivos a subir'], ['Drive: subir (reintento)', 'Subidas fallidas']]) {
  if (!$(subida).isExecuted) continue;
  const subidos = $(entrada).all();
  $(subida).all().forEach((r, i) => {
    const a = subidos[i] && subidos[i].json;
    if (!a || !r.json || !r.json.id) return;
    if (!enlaces[a.key] || a.ext === 'pdf') enlaces[a.key] = `https://drive.google.com/file/d/${r.json.id}/view`;
  });
}
const previas = Object.fromEntries(est.facturas.map(f => [String(f.Clave), f]));
const nuevas = Object.fromEntries(plan.facturas_nuevas.map(f => [f.key, f.valores]));
const gastoDe = k => {
  const n = nuevas[k] && nuevas[k]['Gasto ID'];
  if (n) return codigos[n] || n;
  const u = plan.facturas_actualizar.find(x => x.key === k);
  return u ? (codigos[u.cambios['Gasto ID']] || u.cambios['Gasto ID'] || '') : '';
};
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dinero = (v, m) => (v === '' || v === null || v === undefined) ? 'sin monto'
  : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${m && m !== 'MXN' ? ' ' + m : ''}`;
const dmy = s => (s ? `${String(s).slice(8, 10)}/${String(s).slice(5, 7)}/${String(s).slice(2, 4)}` : 's/f');

const out = [];
for (const k of [...new Set(plan.slack)]) {                 // una factura, un mensaje
  const u = plan.facturas_actualizar.find(x => x.key === k);
  const f = nuevas[k] || (previas[k] && Object.assign({}, previas[k], u ? u.cambios : {}));
  if (!f) continue;
  const link = enlaces[k] || (previas[k] && previas[k]['Link Drive']) || '';
  const gasto = gastoDe(k);
  const lineas = [
    `<@${cfg.slack_mencion}> *Factura pendiente de pago*`,
    `*${esc(f.Emisor || 'Emisor sin datos')}*${f['RFC emisor'] ? ` (${esc(f['RFC emisor'])})` : ''}`,
    `*Total:* ${dinero(f.Total, f.Moneda)} · *Fecha:* ${dmy(f.Fecha)} · *Folio:* ${esc(`${f.Serie || ''}${f.Folio || ''}` || 's/f')}`,
    `*Pagar por:* ${esc(f['Método sugerido'] || 'por definir')} · *Método SAT:* ${esc(f['Método pago'] || '—')}`,
    `*Gasto:* ${esc(gasto || 'sin gasto')} · ${esc(f['Categoría'] || 'sin categoría')} / ${esc(f['Área'] || 'sin área')}`,
    link ? `<${link}|Ver factura>` : '_Sin archivo: solo viene del SAT_'
  ];
  out.push({ json: { key: k, cuerpo: {
    channel: cfg.slack_canal, unfurl_links: false, unfurl_media: false,
    text: `Factura pendiente de pago: ${f.Emisor || ''} · ${dinero(f.Total, f.Moneda)}`,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: lineas.join('\n') } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: 'Cuando esté pagada, reacciona con :white_check_mark: a este mensaje.' }] }
    ]
  } } });
}
return out.length ? out : [{ json: { ninguno: true } }];
