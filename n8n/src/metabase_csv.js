// Lee el CSV que manda la alerta diaria de Metabase ("Movimientos Bancarios para N8N") por correo
// y devuelve un elemento por movimiento, con los nombres de columna en minúsculas (id, account, date…).
const entradas = $input.all();
const correo = entradas.find(it => it.json && it.json.id && it.binary);
if (!correo) return [{ json: { error: 'No llegó el correo de Metabase con el CSV de movimientos' } }];
const i = entradas.indexOf(correo);
const adjunto = Object.entries(correo.binary).find(([k, b]) => /\.csv$/i.test(b.fileName || '') || /csv/.test(b.mimeType || ''));
if (!adjunto) return [{ json: { error: 'El correo de Metabase no trae el CSV adjunto (activa "Attach results / CSV" en la alerta)' } }];
const texto = (await this.helpers.getBinaryDataBuffer(i, adjunto[0])).toString('utf8').replace(/^﻿/, '');

function parseCsv(t) {
  const filas = []; let fila = [], campo = '', comillas = false;
  for (let k = 0; k < t.length; k++) {
    const c = t[k];
    if (comillas) { if (c === '"') { if (t[k + 1] === '"') { campo += '"'; k++; } else comillas = false; } else campo += c; }
    else if (c === '"') comillas = true;
    else if (c === ',') { fila.push(campo); campo = ''; }
    else if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}
const MESES = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
const mes = t => { t = String(t).toLowerCase().replace(/\.$/, ''); if (MESES[t]) return MESES[t];
  const k = Object.keys(MESES).find(m => m.startsWith(t) && t.length >= 3); return k ? MESES[k] : (t === 'sept' ? 9 : 0); };
function fecha(v) {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^([A-Za-zé]+)\.?\s+(\d{1,2}),?\s+(\d{4})/);                    // "Jun 30, 2026, 12:00 AM" / "October 9, 2026"
  if (m && mes(m[1])) return `${m[3]}-${String(mes(m[1])).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\s+(?:de\s+)?([a-zé]+)\.?,?\s+(?:de\s+)?(\d{4})/i);      // "9 de octubre de 2026" / "9 oct 2026"
  if (m && mes(m[2])) return `${m[3]}-${String(mes(m[2])).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);                              // 10/9/2026 (formato de EE. UU.)
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return '';
}
const numero = v => {
  let s = String(v ?? '').trim();
  const negativo = /^\(.*\)$/.test(s) || s.startsWith('-');
  s = s.replace(/[()$,\s-]/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? null : (negativo ? -n : n);
};
const filas = parseCsv(texto).filter(r => r.length > 1);
if (filas.length < 2) return [{ json: { error: 'El CSV de Metabase llegó vacío' } }];
const enc = filas[0].map(h => String(h).trim().toLowerCase().replace(/\s+/g, '_'));
const out = filas.slice(1).map(r => {
  const o = Object.fromEntries(enc.map((h, j) => [h, r[j] ?? '']));
  if ('date' in o) o.date = fecha(o.date);
  if ('amount' in o) o.amount = numero(o.amount);
  if ('id' in o) o.id = String(o.id).replace(/[,\s]/g, '');
  return { json: o };
}).filter(x => x.json.amount !== null && x.json.date);
return out.length ? out : [{ json: { error: 'No pude leer movimientos del CSV de Metabase' } }];
