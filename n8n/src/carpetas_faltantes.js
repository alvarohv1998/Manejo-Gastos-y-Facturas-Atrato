// Revisa qué subcarpetas de mes (01_Enero…) hacen falta en Drive para las facturas de esta corrida.
const cfg = $('Config').first().json;
const { plan } = $('Plan').first().json;
const existentes = ($('Drive: carpetas del mes').first().json.files || []);
const raices = cfg.drive_raiz_por_anio;
const raizDe = anio => raices[anio] || raices[Object.keys(raices).sort().pop()];
const hay = new Set(existentes.map(f => (f.parents || []).map(p => `${p}|${f.name}`)).flat());

const necesarias = new Map();
for (const f of [...plan.facturas_nuevas, ...plan.adjuntar]) {
  if (!(f.archivos || []).length) continue;
  const raiz = raizDe(f.anio);
  const k = `${raiz}|${f.carpeta}`;
  if (!hay.has(k)) necesarias.set(k, { raiz, nombre: f.carpeta });
}
const out = [...necesarias.values()].map(c => ({ json: {
  cuerpo: { name: c.nombre, mimeType: 'application/vnd.google-apps.folder', parents: [c.raiz] }
} }));
return out.length ? out : [{ json: { ninguna: true } }];
