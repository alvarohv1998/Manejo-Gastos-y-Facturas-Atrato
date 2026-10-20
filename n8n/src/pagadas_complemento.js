// Facturas que ya tenían mensaje en Slack y que un complemento de pago (CFDI tipo P) acaba de liquidar:
// se les pone ✅ y se avisa en el hilo. La reacción necesita el permiso reactions:write del bot.
const cfg = $('Config').first().json;
const { plan } = $('Plan').first().json;
const dinero = (v, m) => (v === '' || v == null) ? '' : ` · $${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${m && m !== 'MXN' ? ' ' + m : ''}`;
const out = (plan.pagadas_complemento || []).map(p => ({ json: { key: p.key,
  reaccion: { channel: cfg.slack_canal, timestamp: p.ts, name: 'white_check_mark' },
  hilo: { channel: cfg.slack_canal, thread_ts: p.ts,
    text: `:white_check_mark: Pagada: llegó el complemento de pago ${p.complemento}${p.emisor ? ` de *${p.emisor}*` : ''}${dinero(p.total, p.moneda)}.` } } }));
return out.length ? out : [{ json: { ninguno: true } }];
