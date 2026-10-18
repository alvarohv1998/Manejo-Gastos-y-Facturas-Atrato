// Archivos que Drive rechazó en el primer intento (casi siempre por subir muchos seguidos: 403 por límite de velocidad).
// Se vuelven a mandar después de una pausa.
const entrada = $('Archivos a subir').all();
const out = [];
$('Drive: subir').all().forEach((r, i) => {
  const a = entrada[i];
  if (!a || !a.json || a.json.ninguno || (r.json && r.json.id)) return;
  out.push({ json: a.json, binary: a.binary });
});
return out.length ? out : [{ json: { ninguno: true } }];
