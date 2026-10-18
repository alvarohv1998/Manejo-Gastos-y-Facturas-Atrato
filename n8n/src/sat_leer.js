// Lee las respuestas del MCP (pueden venir como JSON o como eventos SSE) y saca el enlace del CSV.
function texto(nodo) {
  let it;
  try { it = $(nodo).first().json; } catch (e) { return { ok: false, texto: `${nodo}: no se ejecutó` }; }
  if (!it) return { ok: false, texto: `${nodo}: sin respuesta` };
  if (it.error) return { ok: false, texto: `${nodo}: ${typeof it.error === 'string' ? it.error : (it.error.message || JSON.stringify(it.error))}` };
  const cuerpo = typeof it.data === 'string' ? it.data : typeof it.body === 'string' ? it.body : JSON.stringify(it);
  const mensajes = [];
  for (const linea of cuerpo.split(/\r?\n/)) {
    if (linea.startsWith('data:')) { try { mensajes.push(JSON.parse(linea.slice(5).trim())); } catch (e) {} }
  }
  if (!mensajes.length) { try { mensajes.push(JSON.parse(cuerpo)); } catch (e) {} }
  const r = mensajes.find(x => x && (x.result || x.error)) || {};
  if (r.error) return { ok: false, texto: `${nodo}: ${r.error.message || JSON.stringify(r.error)}` };
  const partes = ((r.result && r.result.content) || []).map(c => c.text || (c.resource && (c.resource.uri || '')) || '').join('\n');
  const esError = r.result && r.result.isError;
  return { ok: !esError && !!partes, texto: partes || cuerpo.slice(0, 500) };
}
const solicitar = texto('SAT: solicitar descarga');
const procesar = texto('SAT: procesar descargas');
const csv = texto('SAT: pedir CSV');
const url = (csv.texto.match(/https:\/\/api\.todoconta\.com\/[^\s\[\]\)"']+/) || [])[0] || null;
const solicitud = (solicitar.texto.match(/Solicitud\s+([0-9a-f-]{36})/i) || [])[1] || '';
return [{ json: { url, solicitud, respuestas: { solicitar, procesar, csv }, ventana: $('SAT: preparar').first().json.ventana } }];
