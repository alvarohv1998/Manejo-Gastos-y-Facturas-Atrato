// Crea en la hoja de control las pestañas que usa el flujo si todavía no existen, con su encabezado.
const cfg = $('Config').first().json;
const hojas = ($('Sheets: pestañas control').first().json.sheets || []).map(s => s.properties);
const existentes = new Set(hojas.map(h => h.title));
const requests = [];
let id = 700000000 + Math.floor(Math.random() * 1000000);

for (const [titulo, columnas] of Object.entries(cfg.pestanas)) {
  if (existentes.has(titulo)) continue;
  const sheetId = id++;
  requests.push({ addSheet: { properties: { sheetId, title: titulo, gridProperties: { frozenRowCount: 1, columnCount: Math.max(26, columnas.length) } } } });
  requests.push({
    updateCells: {
      start: { sheetId, rowIndex: 0, columnIndex: 0 },
      rows: [{ values: columnas.map(c => ({
        userEnteredValue: { stringValue: c },
        userEnteredFormat: { backgroundColor: { red: 0.302, green: 0.271, blue: 0.565 }, textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } } }
      })) }],
      fields: 'userEnteredValue,userEnteredFormat(backgroundColor,textFormat)'
    }
  });
}
return [{ json: { crear: requests.length > 0, cuerpo: { requests }, nuevas: requests.filter(r => r.addSheet).map(r => r.addSheet.properties.title) } }];
