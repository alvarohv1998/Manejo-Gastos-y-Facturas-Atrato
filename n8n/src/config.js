// =====================================================================
//  CONFIGURACIÓN DEL FLUJO DE GASTOS · cambia los valores solo aquí
// =====================================================================
const config = {
  // true = corre completo pero NO sube a Drive, NO escribe en el Budget (salvo el registro de la corrida),
  //        NO manda mensajes por factura ni correos. Solo publica en Slack un resumen de lo que habría hecho.
  modo_prueba: false,

  rfc_atrato: 'ATE1905076I1',
  zona_horaria: 'America/Mexico_City',
  fecha_inicio_registro: '2026-10-01',  // no se registran facturas con fecha anterior a esta
  dias_primera_corrida: 1,              // si nunca ha corrido, busca correos de los últimos N días
  festivos_extra: [],                   // fechas adicionales a saltar, formato 'YYYY-MM-DD'

  // Budget (Google Sheets). OPEX-CONTA NO se toca (es de contabilidad).
  // Budget ORIGINAL. Con modo_prueba: true solo se LEE; no se escribe nada hasta apagar el modo prueba.
  // (La copia de prueba no responde a la API de Google: es demasiado pesada recién copiada.)
  sheet_id: '1h87MTSe9qTBp7z94SNgzf1ccV7g27Hm8EBccyPKJNrI',
  // Pestañas donde n8n registra. El encabezado se busca solo (el renglón cuya columna A dice VINTAGE).
  destinos: {
    OPEX: 'OPEX',                       // gastos de operación
    FIXED_ASSETS: 'FIXED_ASSETS',       // activos fijos
    FINANCIAL: 'FINANCIAL',             // gastos financieros de crédito y derivados
    INCOME: 'INCOME'                    // ingresos de tesorería (abonos)
  },
  columna_ref_banco: 'Ref banco (n8n)', // columna W de OPEX y FIXED_ASSETS; se crea si no existe
  pestana_dolar: 'OPEX',                // renglón "Dolar" con el tipo de cambio de cada mes
  // Hoja aparte y ligera con las pestañas de control de n8n (FACTURAS, BITACORA, N8N_CORRIDAS, N8N_SAT).
  // Crear pestañas dentro del Budget es demasiado pesado para Google (responde 503).
  control_sheet_id: '1zVzFCBrGX_gUr9w5gdwYiNAx6T5JmpOb9Bj8AN2XxyY',

  // Correo (una sola cuenta: facturacion@ es un grupo que llega al buzón de Álvaro)
  buzon_grupo: 'facturacion@atratopago.com',
  buzon_descartar: 'soportefinanzas@atratopago.com',
  gmail_busqueda: 'has:attachment (filename:pdf OR filename:xml) -in:sent -in:chats',
  // Los PDF que llegan directo a Álvaro (no por el grupo) solo se revisan si el asunto, el remitente
  // o el nombre del archivo coinciden con esto. Los XML y lo que llega por el grupo siempre se revisan.
  pista_factura: 'factur|cfdi|comprobante|invoice|recibo|receipt|xml|folio|timbrado',
  max_reclasificar: 40,                 // facturas que quedaron por validar porque el agente no respondió: se reclasifican N por corrida
  max_ia_por_corrida: 80,               // tope de facturas que lee la IA por corrida (control de costo)

  // Drive: carpeta raíz por año; dentro se crean subcarpetas 01_Enero, 02_Febrero…
  drive_raiz_por_anio: { '2026': '1-MhGV88LInkbTagUcAg5LETJLJ2djjhr' },   // "Facturas conexión AI"
  renombrar_archivos: true,             // RFC_SerieFolio_UUID8.pdf ; false = nombre original

  // Slack
  slack_canal: 'C03KJNZRX5J',           // #budget-y-presupuestos (privado: invita al bot de n8n)
  slack_mencion: 'U054G8LV7DY',         // Caloca - FyL
  slack_revisar_canal: true,            // antes de avisar, busca si alguien ya pidió la factura en el canal (y si tiene ✅)
  slack_dias_historial: 90,             // días de mensajes del canal que se revisan
  slack_desde: '',                      // 'YYYY-MM-DD': solo se avisan facturas con fecha desde ese día ('' = todas)
  // Facturas con método de pago PPD (pago en parcialidades o diferido): siempre son pendientes de pago y van a Slack,
  // salvo las de no_slack (bancos, Shipkraken, fideicomiso, compensación) y las ya pedidas en el canal (se sigue ese mensaje)
  // Proveedores que siempre se pagan con tarjeta: quedan "tarjeta por conciliar" y nunca van a Slack (aunque sean PPD).
  // "patron" se busca en el nombre y el RFC del emisor, sin acentos ni mayúsculas.
  siempre_tarjeta: [
    { patron: 'AMAZON WEB SERVICES|\\bAWS\\b', motivo: 'Amazon Web Services siempre se paga con tarjeta' }
  ],
  ppd_siempre_slack: true,
  // Lo que el agente dejaría "por validar" se manda a Slack como pendiente de pago (mejor de más que atorado),
  // salvo tarjeta: proveedor que antes se pagó con Clara/Amex, o factura que dice que se cobró a tarjeta
  por_validar_a_slack: true,
  max_releer_pdf: 40,                   // PDF que el agente no pudo leer: se bajan de Drive y se vuelven a leer, N por corrida
  // Facturas que NUNCA se mandan a Slack. "patron" se busca en el nombre y el RFC del emisor (sin acentos, sin importar
  // mayúsculas); "excepto" saca de la regla a quien coincida. Quedan registradas con el "estado" indicado y se relacionan con
  // un gasto ya capturado si el monto coincide; solo se crea gasto nuevo si "crear_gasto" es true.
  // Además, nunca se mandan facturas en $0 (se descartan) ni facturas cuyo monto no se pudo leer (van a validación).
  no_slack: [
    { patron: 'SHIPKRAKEN', estado: 'pagada', crear_gasto: false, motivo: 'Shipkraken factura después de recibir el pago' },
    { patron: '\\b(BBVA|BANCOMER|ACTINVER|BANREGIO|BANORTE|SANTANDER|HSBC|SCOTIABANK|INBURSA|BANAMEX|BANBAJIO|AFIRME|MONEX|INTERCAM|BANCO|BANCA MULTIPLE|CASA DE BOLSA)\\b',
      excepto: 'COVALTO', estado: 'pagada', crear_gasto: false, motivo: 'Factura de banco: la comisión se cobra en automático (Covalto sí se paga por transferencia)' },
    { patron: 'TECNOLOGIA EN CUENTAS POR COBRAR', estado: 'pagada', crear_gasto: false, motivo: 'La paga el fideicomiso' },
    { patron: 'FMO240626PM2', estado: 'pagada', crear_gasto: false, motivo: 'Se cobra por compensación' }
  ],
  // Recordatorio en el hilo de cada factura que sigue sin ✅: a los 7 días de pedida y después cada 7 días
  slack_recordatorio_dias: 7,
  slack_recordatorio_menciones: ['U054G8LV7DY', 'U015JLVJHA7'],   // Caloca - FyL y Alvaro - FyL
  slack_reacciones_pagada: ['white_check_mark', 'heavy_check_mark', 'ballot_box_with_check', 'check', 'done'],

  // Avisos: si algo falla sin detener la corrida (Claude sin saldo, Slack sin permiso, SAT, Drive…), llega un resumen aquí
  avisos_slack: 'U015JLVJHA7',          // Álvaro (mensaje directo del bot)
  avisos_correo: 'alvaro@atratopago.com',

  // Correo de validación (gastos nuevos que ninguna regla resuelve). Sale desde la cuenta de Gmail conectada.
  correo_validacion_para: 'facturacion@atratopago.com',

  // IA (Claude): lee los PDF y asigna clasificación, categoría y área
  ia_modelo: 'claude-opus-5-5',
  ia_esfuerzo: 'medium',
  ia_confianza_minima: 0.8,             // abajo de esto la factura queda "por validar"

  // Conciliación factura ↔ gasto ya registrado en OPEX / FIXED_ASSETS
  conciliacion: {
    tolerancia_mxn: 0.5,                // diferencia máxima en pesos para "monto exacto"
    tolerancia_usd_pct: 0.01,           // facturas en USD, por el tipo de cambio
    dias_antes: 45,                     // la factura puede ser hasta 45 días anterior al pago (PPD)
    dias_despues: 5,                    // o hasta 5 días posterior
    meses_hacia_atras: 4                // gastos sin factura que se consideran
  },
  metodos_tarjeta: ['Clara', 'Clara Cards', 'Amex'],

  // Todo Conta (SAT) vía MCP. Ponlo en true cuando la credencial "Todo Conta API key" exista en n8n.
  todoconta_activo: true,
  todoconta_url: 'https://agente.todoconta.com/mcp',
  sat_dias_csv: 45,                     // días hacia atrás que se revisan en el SAT en cada corrida
  sat_zip_solicitudes: 3,               // XML de las últimas N descargas del SAT: se suben a Drive para las facturas que no llegaron por correo

  // Bancos: Luis sube los movimientos a la base de Metabase (tabla bankMovements). Metabase manda cada mañana
  // una alerta por correo con el CSV de la pregunta "Movimientos Bancarios para N8N" (4645) y n8n lo lee de Gmail.
  bancos_activo: true,
  metabase_correo_busqueda: 'from:contacto@atratotech.com subject:"Movimientos Bancarios para N8N" has:attachment newer_than:3d',
  metabase_columnas: { id: 'id', fecha: 'date', cuenta: 'account', monto: 'amount', moneda: 'currency', referencia: 'reference', descripcion: 'description' },
  bancos_dias: 60,                      // movimientos de los últimos N días que se revisan
  bancos_inicio: '2026-10-01',          // no se registran movimientos anteriores a esta fecha (el histórico ya está capturado)
  // "account" en bankMovements usa los mismos nombres que Payment Method del budget (Clara Cards, BBVA, Banregio…).
  // Cargos en negativo y abonos en positivo. Estos movimientos se ignoran (no son gasto ni ingreso):
  bancos_ignorar: 'APERTURA DE INVERSION|TRASPASO ENTRE CUENTAS|TRASPASO PROPIO|REMANENTE',
  // Cuentas de las que solo interesan los CARGOS: sus abonos son pagos de clientes (cobranza), no ingresos de tesorería
  bancos_solo_cargos: ['FIDEICOMISO'],
  max_movimientos_ia: 150,              // tope de movimientos que clasifica el agente por corrida

  // Interfaz (artefacto "Gastos Atrato"): al final de cada corrida n8n deja en este archivo de Drive los renglones
  // del Budget desde interfaz_desde_mes, las facturas, la bitácora y las corridas. La interfaz lo lee al abrirse.
  interfaz_activa: true,
  interfaz_archivo_id: '1-8_ymzdcIWNxUGYMi4xV1NieVnZSRLHc',   // "interfaz_gastos.json" en "Facturas conexión AI"
  interfaz_desde_mes: 10,               // el histórico anterior (enero–septiembre) ya está cargado en la interfaz

  // Reglas de clasificación (contenido de manejo_gastos.md). Edítalas aquí: las lee la IA en cada factura.
  reglas: `__REGLAS__`
};

// ----- No hace falta tocar nada debajo de esta línea -----
config.pestanas = {
  FACTURAS: ['Clave', 'UUID', 'Tipo', 'Fecha', 'Serie', 'Folio', 'RFC emisor', 'Emisor', 'RFC receptor',
    'Subtotal', 'IVA', 'IVA retenido', 'ISR retenido', 'Total', 'Moneda', 'Tipo de cambio', 'Método pago',
    'Forma pago', 'Uso CFDI', 'Conceptos', 'Clasificación', 'Motivo', 'Confianza', 'Destino', 'Categoría', 'Área',
    'Tipo gasto', 'Método sugerido', 'Estado', 'Gasto ID', 'Gasto sugerido', 'Link Drive', 'Carpeta', 'Origen',
    'Buzón', 'Remitente', 'Asunto', 'Recibida', 'Registrada', 'Corrida', 'Slack ts', 'Estado SAT'],
  BITACORA: ['Fecha', 'Usuario', 'Canal', 'Acción', 'Objeto', 'Campo', 'Antes', 'Después', 'Comentario'],
  N8N_CORRIDAS: ['Corrida', 'Inicio (UTC)', 'Fin (UTC)', 'Estado', 'Desde (UTC)', 'Modo prueba', 'Disparo',
    'Correos revisados', 'Facturas nuevas', 'Gastos creados', 'Relacionadas con gastos existentes',
    'Pendientes de pago', 'Por validar', 'Errores', 'Notas'],
  N8N_SAT: ['Fecha', 'Paso', 'Desde', 'Hasta', 'Respuesta']
};
const q = r => encodeURIComponent(r);
const base = `https://sheets.googleapis.com/v4/spreadsheets/${config.sheet_id}`;
const control = `https://sheets.googleapis.com/v4/spreadsheets/${config.control_sheet_id}`;
const raices = Object.values(config.drive_raiz_por_anio);
const D = config.destinos;
config.urls = {
  metadatos: `${base}?fields=${q('sheets.properties(sheetId,title,gridProperties)')}`,
  metadatosControl: `${control}?fields=${q('sheets.properties(sheetId,title,gridProperties)')}`,
  batchUpdate: `${base}:batchUpdate`,
  batchUpdateControl: `${control}:batchUpdate`,
  valoresBatchUpdate: `${base}/values:batchUpdate`,
  valoresBatchUpdateControl: `${control}/values:batchUpdate`,
  leerControl: `${control}/values:batchGet?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING` +
    [`'N8N_CORRIDAS'!A:O`, `'FACTURAS'!A:AP`, `'BITACORA'!A:A`, `'N8N_SAT'!A:E`].map(r => '&ranges=' + q(r)).join(''),
  leerEstado: `${base}/values:batchGet?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING` +
    [`'${D.OPEX}'!A:X`, `'${D.FIXED_ASSETS}'!A:X`, `'${D.FINANCIAL}'!A:P`, `'${D.INCOME}'!A:K`, `'${config.pestana_dolar}'!A1:N2`]
      .map(r => '&ranges=' + q(r)).join(''),
  // Se vuelve a leer justo antes de escribir (con fórmulas) por si alguien capturó mientras corría el flujo
  releer: `${base}/values:batchGet?valueRenderOption=FORMULA` +
    [`'${D.OPEX}'!A:X`, `'${D.FIXED_ASSETS}'!A:X`, `'${D.FINANCIAL}'!A:P`, `'${D.INCOME}'!A:K`].map(r => '&ranges=' + q(r)).join(''),
  leerInterfaz: `${control}/values:batchGet?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING` +
    [`'FACTURAS'!A:AP`, `'BITACORA'!A:I`, `'N8N_CORRIDAS'!A:O`].map(r => '&ranges=' + q(r)).join(''),
  subirInterfaz: `https://www.googleapis.com/upload/drive/v3/files/${config.interfaz_archivo_id}?uploadType=media&supportsAllDrives=true&fields=id,modifiedTime,size`,
  carpetasDrive: 'https://www.googleapis.com/drive/v3/files?pageSize=500&supportsAllDrives=true&includeItemsFromAllDrives=true' +
    '&fields=' + q('files(id,name,parents)') +
    '&q=' + q(`(${raices.map(r => `'${r}' in parents`).join(' or ')}) and mimeType='application/vnd.google-apps.folder' and trashed=false`)
};
// Una corrida lanzada a mano desde el editor ($execution.mode 'test') siempre corre, aunque sea fin de semana o festivo
config.disparo = $execution.mode !== 'test' && $('Cada día hábil 9:00').isExecuted ? 'programado' : 'manual';
config.inicio_utc = new Date().toISOString();
return [{ json: config }];
