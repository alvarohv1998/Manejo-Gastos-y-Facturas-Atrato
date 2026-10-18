// Facturas pendientes que ya tienen mensaje en Slack: se revisa si alguien les puso ✅.
const { plan } = $('Plan').first().json;
const out = plan.revisar.map(r => ({ json: r }));
return out.length ? out : [{ json: { ninguno: true } }];
