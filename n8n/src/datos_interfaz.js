// Datos para la interfaz (artefacto "Gastos Atrato"): renglones del Budget desde interfaz_desde_mes, más las
// facturas, la bitácora y las corridas de la hoja de control, tal como están en las hojas (encabezado + filas).
// La interfaz junta esto con el histórico que ya tiene cargado y reemplaza los meses desde interfaz_desde_mes.
const cfg = $('Config').first().json;
const budget = $('Sheets: Budget para interfaz').first().json.valueRanges || [];
const control = $('Sheets: control para interfaz').first().json.valueRanges || [];
const desde = cfg.interfaz_desde_mes;
const mes = v => { const m = String(v ?? '').match(/^(\d{1,2})_/); return m ? +m[1] : 0; };
const vacia = f => !f.some((v, i) => i > 0 && v !== '' && v !== null && v !== undefined && v !== false);

function tablaBudget(valores) {
  const filas = valores || [];
  const h = filas.findIndex(f => String(f[0] ?? '').trim().toUpperCase() === 'VINTAGE');
  if (h < 0) return { enc: [], filas: [] };
  return { enc: filas[h], filas: filas.slice(h + 1).filter(f => mes(f[0]) >= desde && !vacia(f)) };
}
function tablaControl(valores, max) {
  const [enc = [], ...filas] = valores || [];
  const llenas = filas.filter(f => f.some(v => v !== '' && v !== null && v !== undefined));
  return { enc, filas: max ? llenas.slice(-max) : llenas };
}
const D = cfg.destinos;
// Si la lectura falló (por ejemplo un 503 de Google) no se sube nada: mejor datos de ayer que un archivo vacío.
const opex = tablaBudget(budget[0] && budget[0].values);
if (!budget.length || !opex.enc.length || !control.length) {
  return [{ json: { omitir: true, motivo: 'No se pudo leer el Budget o la hoja de control; la interfaz conserva los datos anteriores' } }];
}
const datos = {
  version: 1,
  generado: new Date().toISOString(),
  corrida: $('Estado').first().json.corrida,
  modo_prueba: cfg.modo_prueba,
  desde_mes: desde,
  fx: (budget[4] && budget[4].values) || [],
  tabs: {
    [D.OPEX]: opex,
    [D.FIXED_ASSETS]: tablaBudget(budget[1] && budget[1].values),
    [D.FINANCIAL]: tablaBudget(budget[2] && budget[2].values),
    [D.INCOME]: tablaBudget(budget[3] && budget[3].values)
  },
  control: {
    FACTURAS: tablaControl(control[0] && control[0].values),
    BITACORA: tablaControl(control[1] && control[1].values, 3000),
    N8N_CORRIDAS: tablaControl(control[2] && control[2].values, 60)
  }
};
return [{ json: { datos, resumen: Object.fromEntries(Object.entries(datos.tabs).map(([k, t]) => [k, t.filas.length])),
  facturas: datos.control.FACTURAS.filas.length } }];
