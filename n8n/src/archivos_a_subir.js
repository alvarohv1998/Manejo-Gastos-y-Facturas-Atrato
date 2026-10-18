// Un elemento por archivo a subir, con su carpeta de mes y su nombre final.
const cfg = $('Config').first().json;
const est = $('Estado').first().json;
const { plan } = $('Plan').first().json;
const raices = cfg.drive_raiz_por_anio;
const raizDe = anio => raices[anio] || raices[Object.keys(raices).sort().pop()];

const carpetas = new Map();
for (const f of ($('Drive: carpetas del mes').first().json.files || [])) for (const p of (f.parents || [])) carpetas.set(`${p}|${f.name}`, f.id);
if ($('Drive: crear carpeta').isExecuted) {
  for (const it of $('Drive: crear carpeta').all()) {
    const f = it.json || {};
    if (f.id) for (const p of (f.parents || [])) carpetas.set(`${p}|${f.name}`, f.id);
  }
}
const candidatos = new Map($('Combinar fuentes').all().map(it => [it.json.key, it]));
const xmlPorUuid = new Map();
if ($('SAT: descomprimir').isExecuted) {
  for (const it of $('SAT: descomprimir').all()) for (const b of Object.values(it.binary || {})) {
    const m = String(b.fileName || '').match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.xml$/i);
    if (m) xmlPorUuid.set(m[1].toUpperCase(), b);
  }
}
const filaFactura = new Map(est.facturas.map(f => [f.fila, f]));
const limpio = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '').slice(0, 60);

const out = [];
for (const f of [...plan.facturas_nuevas.map(x => ({ ...x, datos: x.valores })), ...plan.adjuntar.map(x => ({ ...x, datos: filaFactura.get(x.fila) || {} }))]) {
  const deSat = f.clave_binario === 'sat';
  const cand = deSat ? null : candidatos.get(f.clave_binario || f.key);
  if (!deSat && (!cand || !cand.binary)) continue;
  const folderId = carpetas.get(`${raizDe(f.anio)}|${f.carpeta}`);
  if (!folderId) continue;
  const d = f.datos;
  for (const a of (f.archivos || [])) {
    const bin = deSat ? xmlPorUuid.get(a.uuid) : cand.binary[a.binary_key];
    if (!bin) continue;
    const uuid8 = String(d.UUID || '').slice(0, 8);
    const nombre = cfg.renombrar_archivos && (d['RFC emisor'] || uuid8)
      ? `${limpio(d['RFC emisor']) || 'SINRFC'}_${limpio(`${d.Serie || ''}${d.Folio || ''}`) || 'SF'}_${uuid8 || limpio(d.Fecha)}.${a.ext}`
      : a.nombre;
    out.push({ json: { key: f.key, ext: a.ext, nombre_drive: nombre, folder_id: folderId, carpeta: f.carpeta, binary_key: a.binary_key },
      binary: { [a.binary_key]: bin } });
  }
}
return out.length ? out : [{ json: { ninguno: true } }];
