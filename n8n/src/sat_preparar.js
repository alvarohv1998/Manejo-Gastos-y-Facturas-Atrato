// Arma las llamadas al MCP de Todo Conta (SAT) para esta corrida.
// 1) solicitar la descarga de lo recibido desde la última corrida (el SAT la libera en horas;
//    Todo Conta la baja sola), 2) procesar lo ya descargado, 3) pedir el CSV de los últimos N días.
const cfg = $('Config').first().json;
const est = $('Estado').first().json;
const inicio = $('SAT: iniciar sesión').first().json || {};
const encabezados = inicio.headers || {};
const sesion = encabezados['mcp-session-id'] || encabezados['Mcp-Session-Id'] || '';

const dia = iso => new Intl.DateTimeFormat('en-CA', { timeZone: cfg.zona_horaria, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const hoy = est.hoy;
const desdeSolicitud = dia(new Date(new Date(est.desde).getTime() - 864e5).toISOString());
const desdeCsv = dia(new Date(Date.now() - cfg.sat_dias_csv * 864e5).toISOString());
const llamada = (id, name, args) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });

return [{ json: {
  sesion,
  inicializado: { jsonrpc: '2.0', method: 'notifications/initialized' },
  solicitar: llamada(2, 'solicitar_cfdis', { rfc: cfg.rfc_atrato, fecha_inicio: desdeSolicitud, fecha_fin: hoy, tipo: 'R' }),
  procesar: llamada(3, 'procesar_cfdis', { rfc: cfg.rfc_atrato, desde: desdeCsv, hasta: hoy, tipo: 'R' }),
  csv: llamada(4, 'excel_cfdis', { rfc: cfg.rfc_atrato, direccion: 'R', formato: 'csv', desde: desdeCsv, hasta: hoy }),
  zips: (est.sat_solicitudes || []).slice(0, cfg.sat_zip_solicitudes || 3)
    .map((id, i) => llamada(10 + i, 'descargar_zip_cfdis', { rfc: cfg.rfc_atrato, id_solicitud: id })),
  ventana: { solicitud: [desdeSolicitud, hoy], csv: [desdeCsv, hoy] }
} }];
