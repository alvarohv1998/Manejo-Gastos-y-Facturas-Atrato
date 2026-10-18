// Justo antes de escribir se vuelven a leer las pestañas (por si alguien capturó mientras corría el flujo):
// se asigna el ID definitivo (26-####) a cada gasto nuevo de OPEX y FIXED_ASSETS y el renglón donde va cada fila nueva.
const cfg = $('Config').first().json;
const est = $('Estado').first().json;
const { plan } = $('Plan').first().json;
const rangos = $('Sheets: releer').first().json.valueRanges || [];
const TABS = ['OPEX', 'FIXED_ASSETS', 'FINANCIAL', 'INCOME'];
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const fresco = {};
const max = Object.assign({}, est.max_codigo);
TABS.forEach((t, i) => {
  const p = est.pestanas[t];
  const vals = (rangos[i] && rangos[i].values) || [];
  if (!p || p.error) { fresco[t] = null; return; }
  const h = vals.findIndex((r, j) => j < 25 && norm(r && r[0]) === 'vintage');
  const col = p.col;
  const claves = ['fecha', 'descripcion', 'amount', 'total'].map(k => col[k]).filter(x => x >= 0);
  let ultima = h + 1;
  const filaPorId = {};
  for (let j = h + 1; j < vals.length; j++) {
    const r = vals[j] || [];
    if (claves.some(c => r[c] !== '' && r[c] !== undefined && r[c] !== null)) ultima = j + 1;
    const id = col.id >= 0 ? String(r[col.id] ?? '').trim() : '';
    if (id) {
      filaPorId[id] = j + 1;
      const m = id.match(/^(\d{2})-(\d+)$/);
      if (m) max[m[1]] = Math.max(max[m[1]] || 0, +m[2]);
    }
  }
  const ult = vals[ultima - 1] || [];
  const nCols = Math.max((vals[h] || []).length, ...Object.values(col).map(x => x + 1));
  fresco[t] = { ultima, fila_por_id: filaPorId, nCols, formulas: Array.from({ length: nCols }, (_, k) => typeof ult[k] === 'string' && ult[k].startsWith('=')) };
});

const nuevas = plan.filas_nuevas.slice().sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
const siguiente = Object.fromEntries(TABS.map(t => [t, fresco[t] ? fresco[t].ultima + 1 : null]));
const filas = {}, codigos = {};
for (const f of nuevas) {
  if (!fresco[f.tab]) continue;
  filas[f.temp] = siguiente[f.tab]++;
  if (['OPEX', 'FIXED_ASSETS'].includes(f.tab) && est.pestanas[f.tab].col.id >= 0) {
    const pre = String(f.fecha).slice(2, 4);
    max[pre] = (max[pre] || 0) + 1;
    codigos[f.temp] = `${pre}-${max[pre]}`;
  } else {
    codigos[f.temp] = `${cfg.destinos[f.tab]} fila ${filas[f.temp]}`;
  }
}
return [{ json: { codigos, filas, fresco } }];
