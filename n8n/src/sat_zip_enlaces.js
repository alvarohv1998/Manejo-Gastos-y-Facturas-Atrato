// Saca el enlace de descarga (válido 1 hora) de cada respuesta de descargar_zip_cfdis.
const out = [];
for (const it of $input.all()) {
  const j = it.json || {};
  const cuerpo = typeof j.data === 'string' ? j.data : typeof j.body === 'string' ? j.body : JSON.stringify(j);
  const url = (cuerpo.match(/https:\/\/api\.todoconta\.com\/[^\s\[\]\)"'\\]+/) || [])[0];
  if (url && !out.some(o => o.json.url === url)) out.push({ json: { url } });
}
return out.length ? out : [{ json: { ninguno: true } }];
