"""Arma los flujos importables de n8n a partir del código de cada nodo (src/*.js).

Uso:  python3 build.py
Genera: flujo_gastos.json (flujo diario) y flujo_errores.json (aviso de errores en Slack).
"""
import json
import uuid
from pathlib import Path

BASE = Path(__file__).parent
SRC = BASE / "src"

CRED = {   # credenciales que ya existen en el n8n de Álvaro (alvarohv1998.app.n8n.cloud)
    "sheets": {"googleSheetsOAuth2Api": {"id": "gJrbRuGGBxcW8WlY", "name": "Google Sheets account 2"}},
    "drive": {"googleDriveOAuth2Api": {"id": "M0dKCQjCJILkbzGy", "name": "Google Drive account"}},
    "gmail": {"gmailOAuth2": {"id": "RTiNi3hQ5peoDnaW", "name": "Cuenta Alvaro"}},
    "anthropic": {"anthropicApi": {"id": "JMisJgRXtnN9r7Ua", "name": "Anthropic account 2"}},
    "slack": {"slackApi": {"id": "kNMBayZDExoYuYM0", "name": "Authorization"}},   # credencial tipo Slack API (token xoxb-)
    "todoconta": {"httpHeaderAuth": {"id": "6v3iP4TkTn2VZamo", "name": "TodoConta"}},
}
CFG = "$('Config').first().json"


def nid():
    return str(uuid.uuid4())


def js(nombre):
    codigo = (SRC / f"{nombre}.js").read_text(encoding="utf-8")
    if "__REGLAS__" in codigo:
        reglas = (BASE / "manejo_gastos.md").read_text(encoding="utf-8")
        reglas = reglas.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")
        codigo = codigo.replace("__REGLAS__", reglas)
    return codigo


class Flujo:
    def __init__(self, nombre):
        self.nombre = nombre
        self.nodes = []
        self.connections = {}

    def add(self, nodo, x, y, **ajustes):
        nodo.setdefault("id", nid())
        nodo["position"] = [x, y]
        nodo.update(ajustes)
        self.nodes.append(nodo)
        return nodo["name"]

    def link(self, origen, destino, salida=0):
        conns = self.connections.setdefault(origen, {"main": []})["main"]
        while len(conns) <= salida:
            conns.append([])
        conns[salida].append({"node": destino, "type": "main", "index": 0})

    def chain(self, *nombres):
        for a, b in zip(nombres, nombres[1:]):
            self.link(a, b)

    def nota(self, texto, x, y, w=420, h=200, color=7):
        self.nodes.append({"id": nid(), "name": f"Nota {len(self.nodes)}", "type": "n8n-nodes-base.stickyNote",
                           "typeVersion": 1, "position": [x, y],
                           "parameters": {"content": texto, "width": w, "height": h, "color": color}})

    def json(self, settings):
        return {"name": self.nombre, "nodes": self.nodes, "connections": self.connections,
                "settings": settings, "pinData": {}, "active": False}


def code(nombre, archivo):
    return {"name": nombre, "type": "n8n-nodes-base.code", "typeVersion": 2,
            "parameters": {"jsCode": js(archivo)}}


def http(nombre, url, metodo="GET", cred=None, cuerpo=None, headers=None, query=None, texto=False,
         completa=False, timeout=60000, lotes=None, archivo=False):
    if cred == "sheets":
        timeout = max(timeout, 300000)      # el Budget es pesado: Google puede tardar minutos en responder
    p = {"method": metodo, "url": url, "options": {"timeout": timeout}}
    creds = None
    if cred in ("sheets", "drive", "anthropic", "slack"):
        p["authentication"] = "predefinedCredentialType"
        p["nodeCredentialType"] = list(CRED[cred].keys())[0]
        creds = CRED[cred]
    elif cred:
        p["authentication"] = "genericCredentialType"
        p["genericAuthType"] = "httpHeaderAuth"
        creds = CRED[cred]
    if headers:
        p["sendHeaders"] = True
        p["headerParameters"] = {"parameters": [{"name": k, "value": v} for k, v in headers.items()]}
    if query:
        p["sendQuery"] = True
        p["queryParameters"] = {"parameters": [{"name": k, "value": v} for k, v in query.items()]}
    if cuerpo:
        p["sendBody"] = True
        p["specifyBody"] = "json"
        p["jsonBody"] = cuerpo
    if texto or completa:
        p["options"]["response"] = {"response": {"responseFormat": "text" if texto else "json", "fullResponse": completa}}
    if archivo:
        p["options"]["response"] = {"response": {"responseFormat": "file", "outputPropertyName": "data"}}
    if lotes:
        p["options"]["batching"] = {"batch": {"batchSize": lotes[0], "batchInterval": lotes[1]}}
    n = {"name": nombre, "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "parameters": p}
    if creds:
        n["credentials"] = creds
    return n


def si(nombre, expresion):
    return {"name": nombre, "type": "n8n-nodes-base.if", "typeVersion": 2, "parameters": {
        "conditions": {
            "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose"},
            "conditions": [{"id": nid(), "leftValue": "={{ " + expresion + " }}", "rightValue": "",
                            "operator": {"type": "boolean", "operation": "true", "singleValue": True}}],
            "combinator": "and"},
        "options": {}}}


UNA_VEZ = {"executeOnce": True}
SIEMPRE = {"alwaysOutputData": True}
SEGUIR = {"onError": "continueRegularOutput"}
REINTENTAR = {"retryOnFail": True, "maxTries": 3, "waitBetweenTries": 5000}
SLACK = "https://slack.com/api/"
SHEETS = "sheets"


def flujo_diario():
    f = Flujo("Gastos Atrato · facturas diarias")
    X = lambda i: 240 + i * 240

    # ---- Inicio y estado ----
    f.nota("## 1. Inicio\nLunes a viernes 9:00 (CDMX). Festivos se saltan.\nTodo lo configurable está en el nodo **Config**.",
           X(0) - 60, -40, 700, 180, 5)
    f.add({"name": "Cada día hábil 9:00", "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.2,
           "parameters": {"rule": {"interval": [{"field": "cronExpression", "expression": "0 9 * * 1-5"}]}}}, X(0), 200)
    f.add({"name": "Ejecutar manualmente", "type": "n8n-nodes-base.manualTrigger", "typeVersion": 1, "parameters": {}}, X(0), 400)
    f.add(code("Config", "config"), X(1), 300)
    f.add(code("¿Día hábil?", "dia_habil"), X(2), 300)
    f.add(http("Sheets: pestañas", f"={{{{ {CFG}.urls.metadatos }}}}", cred=SHEETS), X(3), 300, **UNA_VEZ, **REINTENTAR)
    f.add(http("Sheets: pestañas control", f"={{{{ {CFG}.urls.metadatosControl }}}}", cred=SHEETS), X(4), 300, **UNA_VEZ, **REINTENTAR)
    f.add(code("Pestañas faltantes", "pestanas_faltantes"), X(5), 300)
    f.add(si("¿Crear pestañas?", "$json.crear"), X(6), 300)
    f.add(http("Sheets: crear pestañas", f"={{{{ {CFG}.urls.batchUpdateControl }}}}", "POST", SHEETS,
               "={{ JSON.stringify($json.cuerpo) }}"), X(7), 200, **REINTENTAR)
    f.add(http("Sheets: leer control", f"={{{{ {CFG}.urls.leerControl }}}}", cred=SHEETS), X(8), 300, **UNA_VEZ, **REINTENTAR)
    f.add(http("Sheets: leer estado", f"={{{{ {CFG}.urls.leerEstado }}}}", cred=SHEETS), X(8), 460, **UNA_VEZ, **REINTENTAR)
    f.add(code("Estado", "estado"), X(8), 620)
    f.link("Cada día hábil 9:00", "Config")
    f.link("Ejecutar manualmente", "Config")
    f.chain("Config", "¿Día hábil?", "Sheets: pestañas", "Sheets: pestañas control", "Pestañas faltantes", "¿Crear pestañas?")
    f.link("¿Crear pestañas?", "Sheets: crear pestañas", 0)
    f.link("¿Crear pestañas?", "Sheets: leer control", 1)
    f.chain("Sheets: crear pestañas", "Sheets: leer control", "Sheets: leer estado", "Estado")

    # ---- SAT (Todo Conta por MCP) ----
    f.nota("## 2. SAT (Todo Conta)\nSe activa con `todoconta_activo: true` en Config.\nPide la descarga del día, procesa lo ya descargado y baja el CSV de los últimos 45 días.\nSi falla, la corrida sigue solo con el correo.",
           X(9) - 60, -40, 1700, 180, 4)
    f.add(si("¿Todo Conta activo?", f"{CFG}.todoconta_activo"), X(9), 300)
    mcp_h = {"Accept": "application/json, text/event-stream"}
    ses = {"Accept": "application/json, text/event-stream", "Mcp-Session-Id": "={{ $('SAT: preparar').first().json.sesion }}"}
    init = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
        "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "n8n-gastos-atrato", "version": "1.0"}}})
    f.add(http("SAT: iniciar sesión", f"={{{{ {CFG}.todoconta_url }}}}", "POST", "todoconta", init, mcp_h, texto=True, completa=True),
          X(10), 200, **UNA_VEZ, **SIEMPRE, **SEGUIR)
    f.add(code("SAT: preparar", "sat_preparar"), X(11), 200)
    f.add(http("SAT: confirmar sesión", f"={{{{ {CFG}.todoconta_url }}}}", "POST", "todoconta",
               "={{ JSON.stringify($('SAT: preparar').first().json.inicializado) }}", ses, texto=True), X(12), 200, **UNA_VEZ, **SIEMPRE, **SEGUIR)
    f.add(http("SAT: solicitar descarga", f"={{{{ {CFG}.todoconta_url }}}}", "POST", "todoconta",
               "={{ JSON.stringify($('SAT: preparar').first().json.solicitar) }}", ses, texto=True, timeout=120000), X(13), 200, **UNA_VEZ, **SIEMPRE, **SEGUIR)
    f.add(http("SAT: procesar descargas", f"={{{{ {CFG}.todoconta_url }}}}", "POST", "todoconta",
               "={{ JSON.stringify($('SAT: preparar').first().json.procesar) }}", ses, texto=True, timeout=300000), X(14), 200, **UNA_VEZ, **SIEMPRE, **SEGUIR)
    f.add(http("SAT: pedir CSV", f"={{{{ {CFG}.todoconta_url }}}}", "POST", "todoconta",
               "={{ JSON.stringify($('SAT: preparar').first().json.csv) }}", ses, texto=True, timeout=180000), X(15), 200, **UNA_VEZ, **SIEMPRE, **SEGUIR)
    f.add(code("SAT: leer respuestas", "sat_leer"), X(16), 200)
    f.add(http("SAT: descargar CSV", "={{ $json.url }}", texto=True, timeout=120000), X(17), 200, **UNA_VEZ, **SIEMPRE, **SEGUIR)
    f.add(http("Slack: historial del canal", SLACK + "conversations.history", cred="slack",
               query={"channel": f"={{{{ {CFG}.slack_canal }}}}", "limit": "999",
                      "oldest": f"={{{{ Math.floor(Date.now() / 1000 - {CFG}.slack_dias_historial * 86400) }}}}"}),
          X(8), 780, **UNA_VEZ, **SIEMPRE, **SEGUIR, **REINTENTAR)
    f.chain("Estado", "Slack: historial del canal", "¿Todo Conta activo?")
    f.link("¿Todo Conta activo?", "SAT: iniciar sesión", 0)
    f.link("¿Todo Conta activo?", "¿Bancos activo?", 1)
    f.add(code("SAT: solicitudes ZIP", "sat_zip_solicitudes"), X(17), 40)
    f.add(si("¿Hay ZIP?", "!$json.ninguna"), X(17), -120)
    f.add(http("SAT: pedir ZIP", f"={{{{ {CFG}.todoconta_url }}}}", "POST", "todoconta",
               "={{ JSON.stringify($json.llamada) }}", ses, texto=True, timeout=180000), X(16), -280, **SIEMPRE, **SEGUIR)
    f.add(code("SAT: enlaces ZIP", "sat_zip_enlaces"), X(17), -280)
    f.add(si("¿Hay enlaces ZIP?", "!$json.ninguno"), X(18), -280)
    f.add(http("SAT: descargar ZIP", "={{ $json.url }}", timeout=180000, archivo=True), X(19), -280, **SEGUIR)
    f.add({"name": "SAT: descomprimir", "type": "n8n-nodes-base.compression", "typeVersion": 1.1,
           "parameters": {"operation": "decompress", "binaryPropertyName": "data", "outputPrefix": "xml_"}}, X(20), -280, **SIEMPRE, **SEGUIR)
    f.chain("SAT: iniciar sesión", "SAT: preparar", "SAT: confirmar sesión", "SAT: solicitar descarga", "SAT: procesar descargas",
            "SAT: pedir CSV", "SAT: leer respuestas", "SAT: descargar CSV", "SAT: solicitudes ZIP", "¿Hay ZIP?")
    f.link("¿Hay ZIP?", "SAT: pedir ZIP", 0)
    f.link("¿Hay ZIP?", "¿Bancos activo?", 1)
    f.chain("SAT: pedir ZIP", "SAT: enlaces ZIP", "¿Hay enlaces ZIP?")
    f.link("¿Hay enlaces ZIP?", "SAT: descargar ZIP", 0)
    f.link("¿Hay enlaces ZIP?", "¿Bancos activo?", 1)
    f.chain("SAT: descargar ZIP", "SAT: descomprimir", "¿Bancos activo?")

    # ---- Bancos (Metabase) ----
    f.nota("## Bancos (Metabase)\nLuis sube los movimientos a bankMovements. La alerta diaria de Metabase manda el CSV por correo y n8n lo lee de Gmail.\nSe activa con `bancos_activo: true` en Config.",
           X(18) - 60, -40, 760, 180, 4)
    f.add(si("¿Bancos activo?", f"{CFG}.bancos_activo"), X(18), 120)
    f.add({"name": "Gmail: correo de Metabase", "type": "n8n-nodes-base.gmail", "typeVersion": 2.1, "credentials": CRED["gmail"],
           "parameters": {"operation": "getAll", "returnAll": False, "limit": 1, "simple": False,
                          "filters": {"q": f"={{{{ {CFG}.metabase_correo_busqueda }}}}"},
                          "options": {"downloadAttachments": True}}}, X(19), 40, **UNA_VEZ, **SIEMPRE, **REINTENTAR)
    f.add(code("Metabase: movimientos", "metabase_csv"), X(20), 40, **SIEMPRE)
    f.link("¿Bancos activo?", "Gmail: correo de Metabase", 0)
    f.link("¿Bancos activo?", "Gmail: facturas", 1)
    f.link("Gmail: correo de Metabase", "Metabase: movimientos")
    f.link("Metabase: movimientos", "Gmail: facturas")

    # ---- Correo, IA y plan ----
    f.nota("## 3. Correo + agente\nLee alvaro@ (incluye el grupo facturacion@). Une XML y PDF, junta con el SAT por UUID y el agente (Claude) lee PDFs, clasifica y asigna categoría y área.",
           X(18) - 60, 460, 1500, 160, 6)
    f.add({"name": "Gmail: facturas", "type": "n8n-nodes-base.gmail", "typeVersion": 2.1, "credentials": CRED["gmail"],
           "parameters": {"operation": "getAll", "returnAll": True, "simple": False,
                          "filters": {"q": f"={{{{ {CFG}.gmail_busqueda + ' after:' + Math.floor(new Date($('Estado').first().json.desde).getTime() / 1000) }}}}"},
                          "options": {"downloadAttachments": True}}}, X(18), 300, **UNA_VEZ, **SIEMPRE, **REINTENTAR)
    f.add(code("Leer adjuntos", "leer_adjuntos"), X(19), 300)
    f.add(code("Combinar fuentes", "combinar"), X(20), 300)
    f.add(code("Solicitudes IA", "solicitudes_ia"), X(21), 300)
    f.add(si("¿Usar IA?", "!$json.sin_ia"), X(22), 300)
    f.add(http("Claude", "https://api.anthropic.com/v1/messages", "POST", "anthropic", "={{ JSON.stringify($json.request) }}",
               {"anthropic-version": "2023-06-01", "anthropic-beta": "server-side-fallback-2026-07-01"},
               timeout=300000, lotes=(3, 1500)), X(23), 200, **SEGUIR, **REINTENTAR)
    f.add(code("Plan facturas", "plan_facturas"), X(24), 300)
    f.add(code("PDF a releer", "pdf_a_releer"), X(19), 780)
    f.add(si("¿Releer PDF?", "!$json.ninguno"), X(20), 780)
    f.add(http("Drive: bajar PDF", "=https://www.googleapis.com/drive/v3/files/{{ $json.file_id }}?alt=media&supportsAllDrives=true", cred="drive",
               timeout=120000, archivo=True, lotes=(2, 1000)), X(21), 700, **SEGUIR)
    f.chain("Gmail: facturas", "Leer adjuntos", "PDF a releer", "¿Releer PDF?")
    f.link("¿Releer PDF?", "Drive: bajar PDF", 0)
    f.link("¿Releer PDF?", "Combinar fuentes", 1)
    f.chain("Drive: bajar PDF", "Combinar fuentes", "Solicitudes IA", "¿Usar IA?")
    f.link("¿Usar IA?", "Claude", 0)
    f.link("¿Usar IA?", "Plan facturas", 1)
    f.link("Claude", "Plan facturas")
    f.nota("## Movimientos sin conciliar\nEl agente decide si van a OPEX, FIXED_ASSETS, FINANCIAL, INCOME o se ignoran.", X(25) - 60, 620, 700, 120, 6)
    f.add(code("Solicitudes IA bancos", "solicitudes_bancos"), X(25), 460)
    f.add(si("¿Clasificar movimientos?", "!$json.sin_ia"), X(26), 460)
    f.add(http("Claude bancos", "https://api.anthropic.com/v1/messages", "POST", "anthropic", "={{ JSON.stringify($json.request) }}",
               {"anthropic-version": "2023-06-01", "anthropic-beta": "server-side-fallback-2026-07-01"},
               timeout=300000, lotes=(2, 1500)), X(27), 380, **SEGUIR, **REINTENTAR)
    f.add(code("Plan", "plan"), X(28), 460)
    f.chain("Plan facturas", "Solicitudes IA bancos", "¿Clasificar movimientos?")
    f.link("¿Clasificar movimientos?", "Claude bancos", 0)
    f.link("¿Clasificar movimientos?", "Plan", 1)
    f.link("Claude bancos", "Plan")
    f.add(si("¿Modo prueba?", f"{CFG}.modo_prueba"), X(29), 300)
    f.link("Plan", "¿Modo prueba?")

    # ---- Modo prueba ----
    f.nota("## Modo prueba\nNo escribe nada: publica en Slack lo que habría hecho y registra la corrida.", X(30) - 60, -40, 720, 140, 3)
    f.add(code("Resumen prueba", "resumen_prueba"), X(30), 120)
    f.add(http("Slack: resumen prueba", SLACK + "chat.postMessage", "POST", "slack", "={{ JSON.stringify($json.cuerpo) }}"), X(31), 120, **SEGUIR)
    f.add(http("Sheets: registrar corrida (prueba)", f"={{{{ {CFG}.urls.valoresBatchUpdateControl }}}}", "POST", SHEETS,
               "={{ JSON.stringify($('Resumen prueba').first().json.valores) }}"), X(32), 120, **UNA_VEZ)
    f.link("¿Modo prueba?", "Resumen prueba", 0)
    f.chain("Resumen prueba", "Slack: resumen prueba", "Sheets: registrar corrida (prueba)")

    # ---- Drive ----
    f.nota("## 4. Drive\nSube PDF y XML a la carpeta del mes (la crea si no existe).", X(30) - 60, 620, 1300, 120, 4)
    f.add(http("Drive: carpetas del mes", f"={{{{ {CFG}.urls.carpetasDrive }}}}", cred="drive"), X(30), 460, **UNA_VEZ, **REINTENTAR)
    f.add(code("Carpetas faltantes", "carpetas_faltantes"), X(31), 460)
    f.add(si("¿Crear carpetas?", "!$json.ninguna"), X(32), 460)
    f.add(http("Drive: crear carpeta", "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name,parents", "POST", "drive",
               "={{ JSON.stringify($json.cuerpo) }}"), X(33), 380)
    f.add(code("Archivos a subir", "archivos_a_subir"), X(34), 460)
    f.add(si("¿Hay archivos?", "!$json.ninguno"), X(35), 460)
    f.add({"name": "Drive: subir", "type": "n8n-nodes-base.googleDrive", "typeVersion": 3, "credentials": CRED["drive"],
           "parameters": {"name": "={{ $json.nombre_drive }}",
                          "driveId": {"__rl": True, "mode": "list", "value": "My Drive"},
                          "folderId": {"__rl": True, "mode": "id", "value": "={{ $json.folder_id }}"},
                          "inputDataFieldName": "={{ $json.binary_key }}", "options": {}}}, X(36), 380, **SEGUIR, **REINTENTAR)
    f.link("¿Modo prueba?", "Drive: carpetas del mes", 1)
    f.chain("Drive: carpetas del mes", "Carpetas faltantes", "¿Crear carpetas?")
    f.link("¿Crear carpetas?", "Drive: crear carpeta", 0)
    f.link("¿Crear carpetas?", "Archivos a subir", 1)
    f.chain("Drive: crear carpeta", "Archivos a subir", "¿Hay archivos?")
    f.link("¿Hay archivos?", "Drive: subir", 0)
    f.link("¿Hay archivos?", "Sheets: releer", 1)
    f.add(code("Subidas fallidas", "subidas_fallidas"), X(36), 600)
    f.add(si("¿Reintentar subidas?", "!$json.ninguno"), X(37), 600)
    f.add({"name": "Pausa antes de reintentar", "type": "n8n-nodes-base.wait", "typeVersion": 1.1,
           "parameters": {"resume": "timeInterval", "amount": 45, "unit": "seconds"}}, X(38), 540)
    f.add({"name": "Drive: subir (reintento)", "type": "n8n-nodes-base.googleDrive", "typeVersion": 3, "credentials": CRED["drive"],
           "parameters": {"name": "={{ $json.nombre_drive }}",
                          "driveId": {"__rl": True, "mode": "list", "value": "My Drive"},
                          "folderId": {"__rl": True, "mode": "id", "value": "={{ $json.folder_id }}"},
                          "inputDataFieldName": "={{ $json.binary_key }}", "options": {}}}, X(39), 540, **SEGUIR)
    f.chain("Drive: subir", "Subidas fallidas", "¿Reintentar subidas?")
    f.link("¿Reintentar subidas?", "Pausa antes de reintentar", 0)
    f.link("¿Reintentar subidas?", "Sheets: releer", 1)
    f.chain("Pausa antes de reintentar", "Drive: subir (reintento)", "Sheets: releer")

    # ---- IDs y Slack ----
    f.nota("## 5. Slack\nUn mensaje por factura pendiente (etiqueta a Caloca). ✅ en el mensaje = pagada. Los lunes, recordatorio en el hilo de las que llevan 7+ días sin ✅.",
           X(37) - 60, 620, 2200, 120, 6)
    f.add(http("Sheets: releer", f"={{{{ {CFG}.urls.releer }}}}", cred=SHEETS, timeout=120000), X(37), 460, **UNA_VEZ, **REINTENTAR)
    f.add(code("Asignar IDs", "asignar_ids"), X(39), 460)
    f.add(code("Mensajes Slack", "mensajes_slack"), X(40), 460)
    f.add(si("¿Hay mensajes?", "!$json.ninguno"), X(41), 460)
    f.add(http("Slack: publicar factura", SLACK + "chat.postMessage", "POST", "slack", "={{ JSON.stringify($json.cuerpo) }}",
               lotes=(1, 1200)), X(42), 380, **SEGUIR)
    f.add(code("Revisar ✅", "revisar_reacciones"), X(43), 460)
    f.add(si("¿Hay que revisar?", "!$json.ninguno"), X(44), 460)
    f.add(http("Slack: reacciones", SLACK + "reactions.get", cred="slack",
               query={"channel": f"={{{{ {CFG}.slack_canal }}}}", "timestamp": "={{ $json.ts }}", "full": "true"},
               lotes=(1, 700)), X(45), 380, **SEGUIR)
    f.add(code("Recordatorios", "recordatorios"), X(46), 460)
    f.add(si("¿Recordar?", "!$json.ninguno"), X(47), 460)
    f.add(http("Slack: recordatorio", SLACK + "chat.postMessage", "POST", "slack", "={{ JSON.stringify($json.cuerpo) }}",
               lotes=(1, 1200)), X(48), 380, **SEGUIR)
    f.chain("Sheets: releer", "Asignar IDs", "Mensajes Slack", "¿Hay mensajes?")
    f.link("¿Hay mensajes?", "Slack: publicar factura", 0)
    f.link("¿Hay mensajes?", "Revisar ✅", 1)
    f.chain("Slack: publicar factura", "Revisar ✅", "¿Hay que revisar?")
    f.link("¿Hay que revisar?", "Slack: reacciones", 0)
    f.link("¿Hay que revisar?", "Recordatorios", 1)
    f.chain("Slack: reacciones", "Recordatorios", "¿Recordar?")
    f.link("¿Recordar?", "Slack: recordatorio", 0)
    f.link("¿Recordar?", "Escrituras", 1)
    f.link("Slack: recordatorio", "Escrituras")

    # ---- Budget y validación ----
    f.nota("## 6. Budget + validación\nUna sola escritura: renglones nuevos en OPEX, FIXED_ASSETS, FINANCIAL e INCOME (copiando formato y listas), FACTURAS, BITACORA y N8N_CORRIDAS. OPEX-CONTA no se toca. Después, correo de validación a facturacion@.",
           X(49) - 60, 620, 1700, 120, 5)
    f.add(code("Escrituras", "escrituras"), X(49), 460)
    f.add(si("¿Copiar formato?", "$json.hay_copiar"), X(50), 460)
    f.add(http("Sheets: copiar formato", f"={{{{ {CFG}.urls.batchUpdate }}}}", "POST", SHEETS,
               "={{ JSON.stringify($('Escrituras').first().json.copiar) }}"), X(51), 380, **UNA_VEZ, **REINTENTAR, **SEGUIR)
    f.add(si("¿Hay cambios en el Budget?", "$('Escrituras').first().json.hay_budget"), X(52), 460)
    f.add(http("Sheets: guardar", f"={{{{ {CFG}.urls.valoresBatchUpdate }}}}", "POST", SHEETS,
               "={{ JSON.stringify($('Escrituras').first().json.valores) }}"), X(53), 380, **UNA_VEZ, **REINTENTAR)
    f.add(http("Sheets: guardar control", f"={{{{ {CFG}.urls.valoresBatchUpdateControl }}}}", "POST", SHEETS,
               "={{ JSON.stringify($('Escrituras').first().json.valoresControl) }}"), X(54), 460, **UNA_VEZ, **REINTENTAR)
    f.add(code("Correo de validación", "correo_validacion"), X(55), 460)
    f.add(si("¿Hay por validar?", "!$json.ninguno"), X(56), 460)
    f.add({"name": "Gmail: validación", "type": "n8n-nodes-base.gmail", "typeVersion": 2.1, "credentials": CRED["gmail"],
           "parameters": {"sendTo": "={{ $json.para }}", "subject": "={{ $json.asunto }}", "emailType": "html",
                          "message": "={{ $json.html }}", "options": {"appendAttribution": False}}}, X(57), 380, **UNA_VEZ)
    f.add({"name": "Fin", "type": "n8n-nodes-base.noOp", "typeVersion": 1, "parameters": {}}, X(58), 460)
    f.chain("Escrituras", "¿Copiar formato?")
    f.link("¿Copiar formato?", "Sheets: copiar formato", 0)
    f.link("¿Copiar formato?", "¿Hay cambios en el Budget?", 1)
    f.link("Sheets: copiar formato", "¿Hay cambios en el Budget?")
    f.link("¿Hay cambios en el Budget?", "Sheets: guardar", 0)
    f.link("¿Hay cambios en el Budget?", "Sheets: guardar control", 1)
    f.chain("Sheets: guardar", "Sheets: guardar control", "Correo de validación", "¿Hay por validar?")
    f.link("¿Hay por validar?", "Gmail: validación", 0)
    f.link("¿Hay por validar?", "Fin", 1)
    f.link("Gmail: validación", "Fin")

    # ---- Interfaz ----
    f.nota("## 7. Interfaz\nDeja en Drive (interfaz_gastos.json) los renglones del Budget desde octubre, las facturas, la bitácora y las corridas. El artefacto \"Gastos Atrato\" lo lee al abrirse. Si falla, la corrida no se marca como error.",
           X(59) - 60, 620, 1240, 140, 5)
    f.add(si("¿Actualizar interfaz?", f"{CFG}.interfaz_activa"), X(59), 460, **UNA_VEZ)
    f.add(http("Sheets: Budget para interfaz", f"={{{{ {CFG}.urls.leerEstado }}}}", cred=SHEETS), X(60), 380, **UNA_VEZ, **REINTENTAR, **SEGUIR)
    f.add(http("Sheets: control para interfaz", f"={{{{ {CFG}.urls.leerInterfaz }}}}", cred=SHEETS), X(61), 380, **UNA_VEZ, **REINTENTAR, **SEGUIR)
    f.add(code("Datos interfaz", "datos_interfaz"), X(62), 380, **SEGUIR)
    f.add(si("¿Datos completos?", "!$json.omitir && !$json.error"), X(63), 380)
    f.add(http("Drive: actualizar interfaz", f"={{{{ {CFG}.urls.subirInterfaz }}}}", "PATCH", "drive",
               "={{ JSON.stringify($json.datos) }}", timeout=120000), X(64), 300, **UNA_VEZ, **REINTENTAR, **SEGUIR)
    f.add(code("Pagadas por complemento", "pagadas_complemento"), X(59), 900)
    f.add(si("¿Hay pagadas por complemento?", "!$json.ninguno"), X(60), 900)
    f.add(http("Slack: ✅ pagada", SLACK + "reactions.add", "POST", "slack", "={{ JSON.stringify($json.reaccion) }}", lotes=(1, 700)), X(61), 900, **SEGUIR)
    f.add(http("Slack: aviso pagada", SLACK + "chat.postMessage", "POST", "slack",
               "={{ JSON.stringify($('Pagadas por complemento').item.json.hilo) }}", lotes=(1, 1200)), X(62), 900, **SEGUIR)
    f.link("Fin", "Pagadas por complemento")
    f.link("Pagadas por complemento", "¿Hay pagadas por complemento?")
    f.link("¿Hay pagadas por complemento?", "Slack: ✅ pagada", 0)
    f.link("Slack: ✅ pagada", "Slack: aviso pagada")
    f.link("Fin", "¿Actualizar interfaz?")
    f.link("Sheets: registrar corrida (prueba)", "¿Actualizar interfaz?")
    f.link("¿Actualizar interfaz?", "Sheets: Budget para interfaz", 0)
    f.chain("Sheets: Budget para interfaz", "Sheets: control para interfaz", "Datos interfaz", "¿Datos completos?")
    f.link("¿Datos completos?", "Drive: actualizar interfaz", 0)

    # ---- Avisos ----
    f.nota("## 8. Avisos\nSi algo falló sin detener la corrida (Claude sin saldo, Slack sin permiso, SAT, Drive, formato del Budget, interfaz), manda un resumen a Álvaro por Slack y correo. Las fallas que sí detienen la corrida las avisa el flujo de errores.",
           X(65) - 60, 620, 900, 140, 3)
    f.add(code("Avisos", "avisos"), X(65), 380, **SEGUIR)
    f.add(si("¿Hay avisos?", "!$json.ninguno && !$json.error"), X(66), 380)
    f.add(http("Slack: avisos", SLACK + "chat.postMessage", "POST", "slack", "={{ JSON.stringify($json.cuerpo) }}"), X(67), 300, **SEGUIR)
    f.add({"name": "Gmail: avisos", "type": "n8n-nodes-base.gmail", "typeVersion": 2.1, "credentials": CRED["gmail"],
           "parameters": {"sendTo": "={{ $('Avisos').first().json.para }}", "subject": "={{ $('Avisos').first().json.asunto }}", "emailType": "html",
                          "message": "={{ $('Avisos').first().json.html }}", "options": {"appendAttribution": False}}}, X(68), 300, **UNA_VEZ, **SEGUIR)
    f.link("Drive: actualizar interfaz", "Avisos")
    f.link("¿Datos completos?", "Avisos", 1)
    f.link("¿Actualizar interfaz?", "Avisos", 1)
    f.link("Avisos", "¿Hay avisos?")
    f.link("¿Hay avisos?", "Slack: avisos", 0)
    f.chain("Slack: avisos", "Gmail: avisos")

    return f.json({"executionOrder": "v1", "timezone": "America/Mexico_City", "saveManualExecutions": True,
                   "callerPolicy": "workflowsFromSameOwner"})


def flujo_errores():
    f = Flujo("Gastos Atrato · aviso de errores")
    f.add({"name": "Si falla el flujo de gastos", "type": "n8n-nodes-base.errorTrigger", "typeVersion": 1, "parameters": {}}, 240, 300)
    f.add(code("Mensaje de error", "error_slack"), 480, 300)
    f.add({"name": "Gmail: avisar error", "type": "n8n-nodes-base.gmail", "typeVersion": 2.1, "credentials": CRED["gmail"],
           "parameters": {"sendTo": "={{ $json.para }}", "subject": "={{ $json.asunto }}", "emailType": "html",
                          "message": "={{ $json.html }}", "options": {"appendAttribution": False}}}, 720, 200)
    f.add(http("Slack: avisar error", SLACK + "chat.postMessage", "POST", "slack", "={{ JSON.stringify($json.cuerpo) }}"), 720, 400)
    f.link("Si falla el flujo de gastos", "Mensaje de error")
    f.link("Mensaje de error", "Gmail: avisar error")
    f.link("Mensaje de error", "Slack: avisar error")
    return f.json({"executionOrder": "v1", "timezone": "America/Mexico_City"})


if __name__ == "__main__":
    for archivo, flujo in (("flujo_gastos.json", flujo_diario()), ("flujo_errores.json", flujo_errores())):
        (BASE / archivo).write_text(json.dumps(flujo, ensure_ascii=False, indent=2), encoding="utf-8")
        nombres = [n["name"] for n in flujo["nodes"]]
        assert len(nombres) == len(set(nombres)), "nombres de nodo repetidos"
        import re
        referidos = set(re.findall(r"\$\('([^']+)'\)", json.dumps(flujo, ensure_ascii=False)))
        faltan = referidos - set(nombres)
        assert not faltan, f"el código menciona nodos que no existen: {faltan}"
        for origen, c in flujo["connections"].items():
            assert origen in nombres, f"conexión desde nodo inexistente: {origen}"
            for salida in c["main"]:
                for d in salida:
                    assert d["node"] in nombres, f"conexión a nodo inexistente: {d['node']}"
        print(f"{archivo}: {len([n for n in flujo['nodes'] if 'stickyNote' not in n['type']])} nodos")
