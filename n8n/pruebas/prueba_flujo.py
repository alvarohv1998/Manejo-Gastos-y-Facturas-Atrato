"""Prueba de punta a punta de la lógica de los nodos Code con datos simulados.

Corre el código real de src/*.js en el motor JavaScript de macOS (osascript), simulando lo que
devuelven Gmail, Sheets, el SAT, Claude, Drive y Slack. No llama a ningún servicio.
Uso:  python3 pruebas/prueba_flujo.py
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))
from build import js  # noqa: E402  (mismo código que va a n8n, con las reglas incrustadas)

ATE = "ATE1905076I1"
U_RUIZ = "4C09E7D2-8B13-4F6A-B2D0-9E5A1C7F3B48"
U_UBER = "CADA9C25-B297-43DB-8578-C16CC2CD5DE5"
U_TELCEL = "5E1C0A42-7D0B-4C8E-9B41-0F6B2A9D3C11"
U_MOTO = "E4A91C37-0D28-4B6F-8C15-2F7E9A3D6B01"
U_PAGO = "B7D40E93-2F61-4C55-9E08-6A1F3C0D8E72"
U_VIEJA = "11111111-2222-3333-4444-555555555555"

XML_RUIZ = f"""<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Serie="A" Folio="1188" Fecha="2026-10-08T10:00:00" SubTotal="33000.00" Descuento="0.00" Moneda="MXN" Total="38280.00" TipoDeComprobante="I" MetodoPago="PPD" FormaPago="99" LugarExpedicion="06600">
  <cfdi:Emisor Rfc="DRA120514HJ2" Nombre="DESPACHO RUIZ Y ASOCIADOS" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="{ATE}" Nombre="ATRATO TECHNOLOGIES" UsoCFDI="G03"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="84111500" Cantidad="1" Descripcion="Honorarios contables octubre &amp; cierre" ValorUnitario="33000.00" Importe="33000.00">
      <cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado Base="33000.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="5280.00"/></cfdi:Traslados></cfdi:Impuestos>
    </cfdi:Concepto>
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="5280.00"><cfdi:Traslados><cfdi:Traslado Base="33000.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="5280.00"/></cfdi:Traslados></cfdi:Impuestos>
  <cfdi:Complemento><tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" UUID="{U_RUIZ.lower()}"/></cfdi:Complemento>
</cfdi:Comprobante>"""
XML_PAGO = f"""<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Folio="P-55" Fecha="2026-10-09T09:00:00" SubTotal="0" Moneda="XXX" Total="0" TipoDeComprobante="P">
  <cfdi:Emisor Rfc="CON150220HIA" Nombre="CONTALINK"/><cfdi:Receptor Rfc="{ATE}" UsoCFDI="CP01"/>
  <cfdi:Complemento><pago20:Pagos xmlns:pago20="http://www.sat.gob.mx/Pagos20"><pago20:Pago FechaPago="2026-10-09T00:00:00" Monto="1160.00">
  <pago20:DoctoRelacionado IdDocumento="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" NumParcialidad="1" ImpSaldoAnt="1160.00" ImpPagado="1160.00" ImpSaldoInsoluto="0.00"/>
  </pago20:Pago></pago20:Pagos><tfd:TimbreFiscalDigital UUID="{U_PAGO}"/></cfdi:Complemento></cfdi:Comprobante>"""

SAT_CSV = "﻿UUID,Tipo,Fecha,Serie,Folio,RFC Emisor,Nombre Emisor,RFC Receptor,Nombre Receptor,Subtotal,Descuento,IVA Trasladado,IEPS Trasladado,IVA Retenido,ISR Retenido,Total,Moneda,Tipo de Cambio,Forma de Pago,Método de Pago,Uso CFDI,Lugar Expedición,Estado SAT,Deducible,DIOT\n" + "\n".join([
    f"{U_RUIZ},I,2026-10-08T10:00:00,A,1188,DRA120514HJ2,DESPACHO RUIZ Y ASOCIADOS,{ATE},ATRATO,33000.0,0.0,5280.0,0.0,0.0,0.0,38280.0,MXN,1.0,99,PPD,G03,06600,,Sin analizar,Pasa a DIOT",
    f"{U_UBER},I,2026-10-07T20:10:00,,,UMT140725LP3,UBER MEXICO TECHNOLOGY & SOFTWARE,{ATE},ATRATO,530.43,0.0,84.87,0.0,0.0,0.0,615.3,MXN,1.0,04,PUE,G03,11000,,Sin analizar,Pasa a DIOT",
    f"{U_TELCEL},I,2026-10-04T08:00:00,F,9921,RDI841003QJ4,\"RADIOMOVIL DIPSA, S.A. DE C.V.\",{ATE},ATRATO,2782.79,0.0,445.25,0.0,0.0,0.0,3228.04,MXN,1.0,03,PUE,G03,11529,,Sin analizar,Pasa a DIOT",
    f"{U_MOTO},I,2026-10-06T08:00:00,V,8812,MBA150611QW3,MOTOS DEL BAJIO,GALJ900101AB3,CLIENTE,50775.86,0.0,8124.14,0.0,0.0,0.0,58900.0,MXN,1.0,03,PUE,G03,37000,,Sin analizar,No aplica",
    f"{U_VIEJA},I,2026-09-15T08:00:00,,77,XAXX010101000,PROVEEDOR VIEJO,{ATE},ATRATO,100,0,16,0,0,0,116,MXN,1.0,03,PUE,G03,1,,Sin analizar,Pasa a DIOT",
])

RESUMEN = [["", "01_ENERO"], ["Dolar", 17.23]] + [[""]] * 8          # filas 1-10: bloque de resumen
OPEX_HDR = ["VINTAGE", "DATE", "Expense Category", "Area", "Description", "Expense Type", "Payment Method", "Amount", "", "VAT",
            "VAT Withheld", "ISR", "Total Amount", "USD", "User", "Provider", "Folio", "Invoice", "Receipt", "Prorated", "Prorated periods", "ID"]
def opex(id_, fecha, cat, area, desc, tipo, metodo, total, prov, inv="", rec="", ref=None):
    r = [""] * 22
    r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7] = "x", fecha, cat, area, desc, tipo, metodo, total
    r[12], r[15], r[17], r[18], r[21] = total, prov, inv, rec, id_
    if ref is not None:
        r.append(ref)
    return r
OPEX_ROWS = RESUMEN + [OPEX_HDR,
    opex("26-1240", "12/03/26", "Professional Services", "Finance", "HONORARIOS CONTABLES MARZO", "Fixed", "Banregio", 38280, "Despacho Ruiz y Asociados", "link"),
    opex("26-2950", "05/09/26", "Technology", "Data", "FIVETRAN", "Variable", "Clara Cards", 1850, "Fivetran Inc"),
    opex("26-2001", "10/06/26", "Professional Services", "Finance", "HONORARIOS CONTABLES JUNIO", "Fixed", "Banregio", 38280, "Despacho Ruiz y Asociados", "link"),
    opex("26-2810", "05/08/26", "Technology", "Tech", "TELCEL PLAN EMPRESARIAL", "Fixed", "BBVA", 3228.04, "Telcel", "link"),
    opex("26-3080", "09/10/26", "", "", "SPEI DESPACHO RUIZ", "", "Banregio", 38280, "SPEI ENVIADO DESPACHO RUIZ"),
    opex("26-3094", "07/10/26", "Travel", "Operations", "UBER OCTUBRE", "Variable", "Clara Cards", 615.3, "Uber"),
    opex("26-3101", "08/10/26", "Transaction costs", "General", "COMISION SPEI", "Variable", "BBVA", 58, "BBVA", "", "NO FACTURA"),
    opex("26-3050", "28/09/26", "Rent", "General", "ESPACIOS REFORMA", "Fixed", "", 18560, "ESPACIOS REFORMA", "https://drive.google.com/file/d/abc/view", "", "n8n: pendiente de pago"),
]
FA_ROWS = [["", "01_ENERO"], ["Dolar", 17.23]] + [[""]] * 6 + [
    ["VINTAGE", "DATE", "Expense Category", "Area", "Description", "Expense Type", "Payment Method", "Amount", "VAT ?", "VAT", "VAT Withholding",
     "ISR", "Total Amount", "USD", "User", "Provider", "Folio", "Invoice", "Receipt", "Prorated", "Prorated periods", "ID"],
    ["09_SEPTIEMBRE", "24/09/26", "Equipment", "General", "CYBERPUERTA", "One Time", "Banregio", 114874.14, True, 18379.86, "", "", 133254, "", "NA", "Cyberpuerta", "", "link", "", False, "", "26-3000"]]
FIN_ROWS = [["", "01_ENERO"], ["Dolar", 17.23], ["Monto"], ["VAT"], ["TOTAL"],
    ["VINTAGE", "Fecha", "Categoría de Compra", "Subcategoría", "Descripción", "Método de pago", "Monto", "VAT", "Total MXN", "TOTAL USD", "Folio", "EEFF", "Contpaq", "ORIGEN"],
    ["09_SEPTIEMBRE", "15/09/26", "Interest expense", "Amortizado", "Pago intereses Fidarp", "FIDEICOMISO", 9800000, "", 9800000, "", "", "pasivo", "2101-9015-00", "De Movimientos de FIDEICOMISO"],
    ["10_OCTUBRE", "08/10/26", "Hedging Expense", "RForwards", "Banco Base F/1573", "Covalto", 1000000, "", 1000000, "", "", "activo", "1102-5000-02", "De Movimientos de BANREGIO"]]
INC_ROWS = [["", "01_ENERO"], ["Dolar", 17.23], ["INGRESO"], ["IVA"], ["ISR"],
    ["VINTAGE", "Concept", "Monto MXN", "Monto USD", "IVA", "ISR", "Ingreso", "ORIGEN", "GL"],
    ["10_OCTUBRE", "Intereses Fondeadora", 242.52, "", "", 40.42, 202.10, "*Estado de Cuenta", "resultados"]]
DOLAR = [["Dolar", "01_ENERO", "02_FEBRERO", "03_MARZO", "04_ABRIL", "05_MAYO", "06_JUNIO", "07_JULIO", "08_AGOSTO", "09_SEPTIEMBRE", "10_OCTUBRE"],
         ["Dolar", 17.23, 17.17, 18.07, 17.40, 17.38, 17.47, 17.51, 16.97, 18.07, 18.05]]
MOVS = [
    {"id": 1, "account": "Banregio", "date": "2026-10-09T00:00:00Z", "reference": "0001", "amount": -38280, "currency": "MXN", "description": "SPEI DESPACHO RUIZ"},
    {"id": 2, "account": "BBVA", "date": "2026-10-10T00:00:00Z", "reference": "0002", "amount": -3228.04, "currency": "MXN", "description": "PAGO TELCEL"},
    {"id": 3, "account": "BBVA", "date": "2026-10-09T00:00:00Z", "reference": "0003", "amount": -18560, "currency": "MXN", "description": "SPEI ESPACIOS REFORMA"},
    {"id": 4, "account": "Clara Cards", "date": "2026-10-08T00:00:00Z", "reference": "0004", "amount": -999, "currency": "MXN", "description": "RESTAURANTE LA MAR"},
    {"id": 5, "account": "FIDEICOMISO", "date": "2026-10-06T00:00:00Z", "reference": "0005", "amount": -10000000, "currency": "MXN", "description": "PAGO INTERESES FIDARP"},
    {"id": 6, "account": "Covalto", "date": "2026-10-08T00:00:00Z", "reference": "0006", "amount": -1000000, "currency": "MXN", "description": "BANCO BASE F/1573"},
    {"id": 7, "account": "Fondeadora", "date": "2026-10-05T00:00:00Z", "reference": "0007", "amount": 202.10, "currency": "MXN", "description": "INTERESES FONDEADORA"},
    {"id": 8, "account": "BBVA", "date": "2026-10-07T00:00:00Z", "reference": "0008", "amount": 5000, "currency": "MXN", "description": "DEVOLUCION PROVEEDOR"},
    {"id": 9, "account": "BBVA", "date": "2026-10-07T00:00:00Z", "reference": "0009", "amount": 1000000, "currency": "MXN", "description": "TRASPASO ENTRE CUENTAS PROPIAS"},
    {"id": 10, "account": "BBVA", "date": "2026-10-08T00:00:00Z", "reference": "0010", "amount": -58, "currency": "MXN", "description": "COMISION SPEI"},
    {"id": 11, "account": "Clara Cards", "date": "2026-10-07T00:00:00Z", "reference": "0011", "amount": -615.30, "currency": "MXN", "description": "UBER TRIP"},
    {"id": 12, "account": "BBVA", "date": "2026-09-01T00:00:00Z", "reference": "0012", "amount": -77, "currency": "MXN", "description": "ANTERIOR AL INICIO"},
]

HARNESS = r"""
var OUT = {}; var LOG = [];
function mk(name){ return { first(){ var a = OUT[name]; if(!a) throw new Error('nodo sin ejecutar: '+name); return a[0]; },
  all(){ var a = OUT[name]; if(!a) throw new Error('nodo sin ejecutar: '+name); return a; }, get isExecuted(){ return name in OUT; } }; }
var $ = mk;
function buf(s){ return { length: s.length, toString(enc){ return enc==='base64' ? 'QkFTRTY0' : s; } }; }
var BIN = {};
async function correr(nombre, fn, entrada){
  var ctx = { helpers: { getBinaryDataBuffer: async (i, k) => { var it = entrada[i]; return buf(BIN[it.binary[k].id]); } } };
  var $input = { all(){ return entrada; }, first(){ return entrada[0]; } };
  var r = await fn.call(ctx, $input, (entrada[0]||{}).json, mk);
  OUT[nombre] = r; return r;
}
"""

def nodo_fn(nombre, archivo):
    return f"var F_{archivo} = async function($input, $json, $) {{\nconst $execution = {{ id: 'prueba', mode: 'production' }}, $workflow = {{ id: 'prueba' }};\n{js(archivo)}\n}};\n"

ARCHIVOS = ["config", "dia_habil", "pestanas_faltantes", "estado", "sat_preparar", "sat_leer", "leer_adjuntos", "pdf_a_releer", "combinar", "solicitudes_ia",
            "plan_facturas", "solicitudes_bancos", "plan", "metabase_csv", "carpetas_faltantes", "archivos_a_subir", "asignar_ids", "mensajes_slack", "revisar_reacciones", "recordatorios",
            "escrituras", "correo_validacion", "resumen_prueba", "error_slack"]

ESCENARIO = r"""
(async function(){
 try {
  await correr('Config', F_config, [{json:{}}]);
  var cfg = OUT['Config'][0].json;
  cfg.modo_prueba = false; cfg.todoconta_activo = true; cfg.bancos_activo = true; cfg.slack_dia_recordatorio = DIA_SEMANA;
  await correr('¿Día hábil?', F_dia_habil, OUT['Config']);
  OUT['Sheets: pestañas'] = [{json:{sheets:[{properties:{sheetId:11,title:'OPEX',gridProperties:{rowCount:5975,columnCount:22}}},{properties:{sheetId:12,title:'FIXED_ASSETS',gridProperties:{rowCount:109,columnCount:26}}},{properties:{sheetId:13,title:'FINANCIAL',gridProperties:{rowCount:9,columnCount:14}}},{properties:{sheetId:14,title:'INCOME',gridProperties:{rowCount:81,columnCount:14}}}]}}];
  OUT['Sheets: pestañas control'] = [{json:{sheets:[{properties:{sheetId:0,title:'Hoja 1'}}]}}];
  await correr('Pestañas faltantes', F_pestanas_faltantes, OUT['Sheets: pestañas control']);
  var FH = cfg.pestanas.FACTURAS;
  function filaFac(o){ return FH.map(h => o[h] === undefined ? '' : o[h]); }
  OUT['Sheets: leer control'] = [{json:{valueRanges:[
    {values:[cfg.pestanas.N8N_CORRIDAS, [1,'2026-10-09T15:00:00.000Z','2026-10-09T15:05:00.000Z','ok','2026-10-08T15:00:00.000Z','NO','programado']]},
    {values:[FH,
      filaFac({Clave:'VAL-1',UUID:'99999999-0000-0000-0000-000000000001',Tipo:'I',Fecha:'2026-10-05',Emisor:'PROVEEDOR NUEVO SA','RFC emisor':'PNU010101AAA',Subtotal:1000,IVA:160,Total:1160,Moneda:'MXN','Clasificación':'pagar','Estado':'por_validar','Método sugerido':'BBVA','Categoría':'Administrative','Área':'General'}),
      filaFac({Clave:'55300B91-6F6D-4362-9D97-97DC2631F7C9',UUID:'55300B91-6F6D-4362-9D97-97DC2631F7C9',Tipo:'I',Fecha:'2026-10-15',Emisor:'BT CDMX','RFC emisor':'BCD170331S54','RFC receptor':'ATE1905076I1',Subtotal:8500,IVA:1360,Total:9860,Moneda:'USD','Tipo de cambio':18.3528,'Método pago':'PPD','Forma pago':99,'Clasificación':'por_validar','Estado':'por_validar','Motivo':'El agente no respondió (Bad request - please check your parameters): revisar a mano','Origen':'correo','Link Drive':'https://drive.google.com/file/d/bt/view'}),
      filaFac({Clave:'PPD-1',UUID:'77777777-0000-0000-0000-000000000001',Tipo:'I',Fecha:'2026-10-10',Emisor:'PROVEEDOR PPD','RFC emisor':'PPD010101AAA','RFC receptor':'ATE1905076I1',Subtotal:1000,IVA:160,Total:1160,Moneda:'MXN','Método pago':'PPD','Forma pago':99,'Clasificación':'por_validar','Estado':'por_validar','Motivo':'Aplica la regla 5: proveedor nuevo','Origen':'sat'}),
      filaFac({Clave:'msg9:invoice-oct.pdf',Fecha:'',Estado:'por_validar','Clasificación':'por_validar','Motivo':'El agente no respondió (Bad request): revisar a mano','Origen':'correo','Link Drive':'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view'}),
      filaFac({Clave:'PEND-1',UUID:'99999999-0000-0000-0000-000000000002',Tipo:'I',Fecha:'2026-09-28',Emisor:'ESPACIOS REFORMA',Total:18560,Moneda:'MXN','Estado':'pendiente_pago','Slack ts':'1791000000.000100','Registrada':'2026-09-28 09:05','Gasto ID':'26-3050','Link Drive':'https://drive.google.com/file/d/abc/view'})
    ]},
    {values:[cfg.pestanas.BITACORA]},
    {values:[cfg.pestanas.N8N_SAT]}
  ]}}];
  OUT['Sheets: leer estado'] = [{json:{valueRanges:[{values: OPEX}, {values: FA}, {values: FIN}, {values: INC}, {values: DOLAR}]}}];
  await correr('Estado', F_estado, OUT['Sheets: leer estado']);
  OUT['SAT: iniciar sesión'] = [{json:{body:'{}', headers:{'mcp-session-id':'ses-123'}, statusCode:200}}];
  await correr('SAT: preparar', F_sat_preparar, OUT['SAT: iniciar sesión']);
  OUT['SAT: confirmar sesión'] = [{json:{data:''}}];
  OUT['SAT: solicitar descarga'] = [{json:{data:'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"{\'result\': \'Solicitud 62ea454c-d0d7-4231-a1b9-87b0aa09e0cd creada para ATE1905076I1.\'}"}]}}\n'}}];
  OUT['SAT: procesar descargas'] = [{json:{data:'{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"Procesados: 5 nuevos"}]}}'}}];
  OUT['SAT: pedir CSV'] = [{json:{data:'{"jsonrpc":"2.0","id":4,"result":{"content":[{"type":"text","text":"Descárgalo aquí: https://api.todoconta.com/v1/descargas/firmada?t=abc.def[Resource]"}]}}'}}];
  await correr('SAT: leer respuestas', F_sat_leer, OUT['SAT: pedir CSV']);
  OUT['SAT: descargar CSV'] = [{json:{data: SATCSV}}];
  BIN.mb = 'ID,Account,Date,Reference,Amount,Currency,Description\n1,Banregio,"October 9, 2026, 12:00 AM",0001,"-38,280.00",MXN,SPEI DESPACHO RUIZ\n7,Fondeadora,2026-10-05T00:00:00Z,0007,202.10,MXN,"INTERESES, FONDEADORA"\n';
  var MB = await correr('Metabase CSV (prueba)', F_metabase_csv, [{json:{id:'mb1'}, binary:{attachment_0:{id:'mb', fileName:'Movimientos Bancarios para N8N.csv', mimeType:'text/csv'}}}]);
  OUT['Metabase: movimientos'] = MOVS.map(m => ({json:m}));
  var _ignorar = [
    {json:{id:1, account:'BANREGIO', date:'2026-10-09T00:00:00Z', reference:'0001', amount:-38280, currency:'MXN', description:'SPEI DESPACHO RUIZ'}},
    {json:{id:2, account:'BBVA', date:'2026-10-10T00:00:00Z', reference:'0002', amount:-3228.04, currency:'MXN', description:'PAGO TELCEL'}},
    {json:{id:3, account:'BBVA', date:'2026-10-09T00:00:00Z', reference:'0003', amount:-18560, currency:'MXN', description:'SPEI ESPACIOS REFORMA'}},
    {json:{id:4, account:'AMEX', date:'2026-10-08T00:00:00Z', reference:'0004', amount:-999, currency:'MXN', description:'CARGO SIN FACTURA'}},
    {json:{id:5, account:'BBVA', date:'2026-10-08T00:00:00Z', reference:'0005', amount:5000, currency:'MXN', description:'ABONO'}}
  ];
  BIN = {x1: XMLRUIZ, p1: '%PDF ruiz', p2: '%PDF uber', p3: '%PDF contrato', x4: XMLPAGO};
  OUT['Gmail: facturas'] = [
    {json:{id:'m1', subject:'Factura A-1188', from:{text:'cxc@ruiz.mx'}, to:{text:'facturacion@atratopago.com'}, date:'2026-10-10T16:00:00Z'},
     binary:{attachment_0:{id:'x1', fileName:'A1188.xml', fileExtension:'xml', mimeType:'text/xml'}, attachment_1:{id:'p1', fileName:'A1188.pdf', fileExtension:'pdf', mimeType:'application/pdf'}}},
    {json:{id:'m2', subject:'Tu factura de Uber', from:{text:'uber@uber.com'}, to:{text:'alvaro@atratopago.com'}, date:'2026-10-10T17:00:00Z'},
     binary:{attachment_0:{id:'p2', fileName:'invoice-oct.pdf', fileExtension:'pdf', mimeType:'application/pdf'}}},
    {json:{id:'m3', subject:'Contrato de servicios', from:{text:'legal@algo.com'}, to:{text:'alvaro@atratopago.com'}, date:'2026-10-10T18:00:00Z'},
     binary:{attachment_0:{id:'p3', fileName:'contrato.pdf', fileExtension:'pdf', mimeType:'application/pdf'}}},
    {json:{id:'m4', subject:'REP', from:{text:'contalink'}, to:{text:'facturacion@atratopago.com'}, date:'2026-10-10T19:00:00Z'},
     binary:{attachment_0:{id:'x4', fileName:'REP.xml', fileExtension:'xml', mimeType:'text/xml'}}}
  ];
  await correr('Leer adjuntos', F_leer_adjuntos, OUT['Gmail: facturas']);
  BIN.pd = '%PDF releido';
  await correr('PDF a releer', F_pdf_a_releer, [{json:{}}]);
  OUT['Drive: bajar PDF'] = OUT['PDF a releer'].filter(x => !x.json.ninguno).map(x => ({json: x.json, binary: {data: {id:'pd', fileName:'invoice-oct.pdf', mimeType:'application/pdf'}}}));
  await correr('Combinar fuentes', F_combinar, OUT['Leer adjuntos']);
  await correr('Solicitudes IA', F_solicitudes_ia, OUT['Combinar fuentes']);
  // Claude simulado
  OUT['Claude'] = OUT['Solicitudes IA'].map(function(it){
    var k = it.json.key, r;
    var base = {es_factura:true,uuid:null,tipo_comprobante:null,fecha:null,serie:null,folio:null,rfc_emisor:null,nombre_emisor:null,rfc_receptor:null,subtotal:null,iva:null,iva_retenido:null,isr_retenido:null,total:null,moneda:null,forma_pago:null,metodo_pago:null,conceptos:null,clasificacion:'pagar',categoria:null,area:null,tipo_gasto:null,metodo_pago_sugerido:null,confianza:0.9,motivo:'prueba'};
    if (k === 'msg9:invoice-oct.pdf') r = Object.assign(base, {tipo_comprobante:'extranjero', fecha:'2026-10-03', nombre_emisor:'Fivetran Inc', total:1940.57, moneda:'USD', clasificacion:'por_validar', categoria:'Technology', area:'Data', tipo_gasto:'Variable', confianza:0.6, motivo:'Proveedor sin historial claro'});
    else if (k === '55300B91-6F6D-4362-9D97-97DC2631F7C9') r = Object.assign(base, {uuid:k, tipo_comprobante:'I', fecha:'2026-10-15', rfc_emisor:'BCD170331S54', nombre_emisor:'BT CDMX', rfc_receptor:'ATE1905076I1', total:9860, moneda:'USD', clasificacion:'pagar', categoria:'Professional Services', area:'Finance', tipo_gasto:'Fixed', metodo_pago_sugerido:'BBVA', confianza:0.9, motivo:'Baker Tilly: servicios contables, se paga por transferencia en USD'});
    else if (k.indexOf('m2:') === 0) r = Object.assign(base, {uuid: UUBER.toLowerCase(), tipo_comprobante:'I', fecha:'2026-10-07', rfc_emisor:'UMT140725LP3', nombre_emisor:'Uber', rfc_receptor:'ATE1905076I1', total:615.3, moneda:'MXN', forma_pago:'04', conceptos:'Viaje CDMX', clasificacion:'pagada_tarjeta', categoria:'Travel', area:'Operations', tipo_gasto:'Variable', metodo_pago_sugerido:'Clara'});
    else if (k === UTELCEL) r = Object.assign(base, {clasificacion:'pagar', categoria:'Technology', area:'Tech', tipo_gasto:'Fixed', metodo_pago_sugerido:'BBVA', confianza:0.92, motivo:'Historial Telcel en Technology/Tech'});
    else if (k === URUIZ) r = Object.assign(base, {clasificacion:'pagar', categoria:'Professional Services', area:'Finance', tipo_gasto:'Fixed'});
    else r = base;
    return {json:{stop_reason:'end_turn', content:[{type:'thinking',thinking:''},{type:'text', text: JSON.stringify(r)}]}};
  });
  OUT['SAT: descomprimir'] = [{json:{}, binary:{xml_0:{fileName: UTELCEL.toLowerCase() + '.xml', mimeType:'application/xml'}, xml_1:{fileName: URUIZ.toLowerCase() + '.xml'}, xml_2:{fileName:'ffffffff-0000-0000-0000-000000000000.xml'}}}];
  OUT['Slack: historial del canal'] = [{json:{ok:true, messages:[
    {ts:'1791500000.000100', user:'U054G8LV7DY', text:'Pago Telcel', files:[{name: UTELCEL + '.pdf'}], reactions:[{name:'white_check_mark', count:1}]},
    {ts:'1791500000.000200', bot_id:'B0', text:'mensaje de n8n ' + URUIZ},
    {ts:'1791500000.000300', user:'U015JLVJHA7', text:'Pago DHL', files:[{name:'MEXR006961123.pdf'}]}]}}];
  await correr('Plan facturas', F_plan_facturas, [{json:{}}]);
  await correr('Solicitudes IA bancos', F_solicitudes_bancos, OUT['Plan facturas']);
  OUT['Claude bancos'] = OUT['Solicitudes IA bancos'].filter(x => !x.json.sin_ia).map(function(it){
    var res = it.json.ids.map(function(id){
      var b = {id:id, destino:'IGNORAR', categoria:null, subcategoria:null, area:null, tipo_gasto:null, descripcion:'X', requiere_factura:true, confianza:0.9, motivo:'prueba'};
      if (id === '4') return Object.assign(b, {destino:'OPEX', categoria:'Travel', area:'Operations', tipo_gasto:'Variable', descripcion:'RESTAURANTE LA MAR'});
      if (id === '5') return Object.assign(b, {destino:'FINANCIAL', categoria:'Interest expense', subcategoria:'Amortizado', descripcion:'INTERESES FIDARP', requiere_factura:false});
      if (id === '8') return Object.assign(b, {destino:'OPEX', descripcion:'DEVOLUCION PROVEEDOR', requiere_factura:false, confianza:0.5});
      return b;
    });
    return {json:{stop_reason:'end_turn', content:[{type:'text', text: JSON.stringify({movimientos: res})}]}};
  });
  await correr('Plan', F_plan, [{json:{}}]);
  OUT['Drive: carpetas del mes'] = [{json:{files:[{id:'fold-oct', name:'10_Octubre', parents:['1-MhGV88LInkbTagUcAg5LETJLJ2djjhr']}]}}];
  await correr('Carpetas faltantes', F_carpetas_faltantes, OUT['Drive: carpetas del mes']);
  await correr('Archivos a subir', F_archivos_a_subir, OUT['Carpetas faltantes']);
  OUT['Drive: subir'] = OUT['Archivos a subir'].filter(x => !x.json.ninguno).map((x, i) => ({json:{id:'drv'+i, name:x.json.nombre_drive}}));
  OUT['Sheets: releer'] = [{json:{valueRanges:[{values: OPEX}, {values: FA}, {values: FIN}, {values: INC}]}}];
  await correr('Asignar IDs', F_asignar_ids, OUT['Sheets: releer']);
  await correr('Mensajes Slack', F_mensajes_slack, OUT['Asignar IDs']);
  OUT['Slack: publicar factura'] = OUT['Mensajes Slack'].filter(x => !x.json.ninguno).map((x, i) => ({json:{ok:true, ts:'1791700000.00'+i}}));
  await correr('Revisar ✅', F_revisar_reacciones, OUT['Mensajes Slack']);
  OUT['Slack: reacciones'] = OUT['Revisar ✅'].map(() => ({json:{ok:true, message:{reactions:[{name:'eyes'}]}}}));
  await correr('Recordatorios', F_recordatorios, OUT['Slack: reacciones']);
  await correr('Escrituras', F_escrituras, OUT['Recordatorios']);
  await correr('Correo de validación', F_correo_validacion, OUT['Escrituras']);
  await correr('Resumen prueba', F_resumen_prueba, OUT['Plan']);
  // escenario de día inhábil programado
  OUT['Cada día hábil 9:00'] = [{json:{}}];
  await correr('Config', F_config, [{json:{}}]);
  var conf2 = OUT['Config'][0].json;
  var r2 = await correr('¿Día hábil?', F_dia_habil, OUT['Config']);
  RESULT = JSON.stringify({ok:true, dia_habil_programado: r2.length, disparo2: conf2.disparo,
    pestanas: OUT['Pestañas faltantes'][0].json.nuevas, estado: {desde: OUT['Estado'][0].json.desde, corrida: OUT['Estado'][0].json.corrida, gastos: OUT['Estado'][0].json.gastos.length, pest: OUT['Estado'][0].json.pestanas, max: OUT['Estado'][0].json.max_codigo, fx10: OUT['Estado'][0].json.fx[10], cat: OUT['Estado'][0].json.catalogos, errores: OUT['Estado'][0].json.errores},
    sat: {preparar: OUT['SAT: preparar'][0].json.solicitar.params.arguments, leer: OUT['SAT: leer respuestas'][0].json},
    adjuntos: OUT['Leer adjuntos'].map(x => ({key:x.json.key, req:x.json.requiere_extraccion, arch:x.json.archivos.map(a=>a.nombre), cfdi: x.json.cfdi && {uuid:x.json.cfdi.uuid, iva:x.json.cfdi.iva, conceptos:x.json.cfdi.conceptos, tipo:x.json.cfdi.tipo, docs:x.json.cfdi.docs_relacionados}})),
    combinar: OUT['Combinar fuentes'].map(x => ({key:x.json.key, origen:x.json.origen, accion:x.json.accion, hist: x.json.historial && {t:x.json.historial.total, b:x.json.historial.banregio}, meta:x.json.meta})),
    ia: OUT['Solicitudes IA'].map(x => x.json.key || x.json),
    metabase_csv: MB.map(x => x.json), plan: OUT['Plan'][0].json, bancos_ia: OUT['Solicitudes IA bancos'].map(x => x.json.ids || x.json),
    carpetas: OUT['Carpetas faltantes'].map(x=>x.json), subir: OUT['Archivos a subir'].map(x=>x.json),
    ids: OUT['Asignar IDs'][0].json, slack: OUT['Mensajes Slack'].map(x=>x.json), recordatorios: OUT['Recordatorios'].map(x=>x.json),
    escrituras: OUT['Escrituras'][0].json,  correo: OUT['Correo de validación'][0].json.asunto, prueba: OUT['Resumen prueba'][0].json.cuerpo.text});
 } catch(e) { RESULT = JSON.stringify({ok:false, error: String(e), stack: e.stack}); }
})();
var RESULT = 'sin terminar';
function run(argv){ return RESULT; }
"""


def main():
    import datetime
    dia = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=-6))).isoweekday() % 7
    partes = [HARNESS]
    for a in ARCHIVOS:
        partes.append(nodo_fn(a, a))
    consts = {"OPEX": OPEX_ROWS, "FA": FA_ROWS, "FIN": FIN_ROWS, "INC": INC_ROWS, "MOVS": MOVS, "DOLAR": DOLAR, "SATCSV": SAT_CSV, "XMLRUIZ": XML_RUIZ, "XMLPAGO": XML_PAGO,
              "UUBER": U_UBER, "UTELCEL": U_TELCEL, "URUIZ": U_RUIZ, "DIA_SEMANA": dia}
    partes.append("".join(f"var {k} = {json.dumps(v, ensure_ascii=False)};\n" for k, v in consts.items()))
    partes.append(ESCENARIO)
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as t:
        t.write("\n".join(partes))
        ruta = t.name
    salida = subprocess.run(["osascript", "-l", "JavaScript", ruta], capture_output=True, text=True)
    if salida.returncode != 0:
        print(salida.stderr)
        sys.exit(1)
    r = json.loads(salida.stdout)
    print(json.dumps(r, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
