# Automatización de facturas · n8n

Flujo diario que lee las facturas del correo y del SAT y los movimientos bancarios de Metabase, los clasifica con las
reglas de Atrato y un agente (Claude), sube las facturas a Drive, registra y concilia en el Budget (OPEX, FIXED_ASSETS,
FINANCIAL, INCOME) y avisa en Slack lo que hay que pagar. **OPEX-CONTA no se toca.**

| Archivo | Para qué |
|---|---|
| `flujo_gastos.json` | El flujo diario (se importa en n8n) |
| `flujo_errores.json` | Avisa en Slack si el flujo falla |
| `manejo_gastos.md` | Reglas de clasificación que lee el agente |
| `src/*.js` | Código de cada nodo (fuente) |
| `build.py` | Vuelve a generar los JSON después de cambiar `src/` o las reglas: `python3 build.py` |
| `pruebas/prueba_flujo.py` | Prueba de toda la lógica con datos simulados: `python3 pruebas/prueba_flujo.py` |

## Qué hace cada mañana (lunes a viernes, 9:00 CDMX; festivos se saltan)

1. **Lee el estado** del Budget: última corrida exitosa, facturas ya registradas, OPEX, FIXED_ASSETS, FINANCIAL, INCOME y tipo de cambio.
   Busca desde la última corrida que terminó bien, así que el lunes recoge el fin de semana y nada se pierde si un día falla.
2. **SAT (Todo Conta):** pide la descarga de lo recibido, procesa lo que ya liberó el SAT y baja el CSV de los últimos 45 días.
3. **Correo (alvaro@, incluye el grupo facturacion@):** une XML y PDF del mismo correo. Los PDF que llegan directo a Álvaro solo
   se revisan si parecen factura (asunto, remitente o nombre del archivo).
4. **Clasifica:** primero las reglas fijas (receptor ≠ Atrato, soportefinanzas@, complemento de pago, cancelada, tarjeta de crédito,
   histórico Banregio); después el agente lee los PDF, decide los casos sin regla y asigna **Expense Category, Area y Expense Type**
   con base en el histórico del proveedor y el concepto.
5. **Gasto en el Budget:** el agente decide la pestaña (OPEX, FIXED_ASSETS o FINANCIAL). Si ya existe un gasto sin factura con
   el mismo monto y una fecha compatible, le liga la factura (columna Invoice y el UUID en Folio). Si no, crea el renglón con
   ID `26-####` (Amount sin IVA y positivo; en notas de crédito, negativo) y lo marca en la columna W "Ref banco (n8n)" como
   pendiente de pago o de tarjeta por conciliar.
6. **Drive:** sube PDF y XML a "Facturas conexión AI / 10_Octubre…", renombrados `RFC_SerieFolio_UUID8`.
7. **Slack (#budget-y-presupuestos):** un mensaje por factura pendiente de pago, etiquetando a Caloca.
   ✅ en el mensaje = pagada. Los lunes, recordatorio en el hilo de las que llevan 7 días o más sin ✅.
8. **Bancos (Metabase):** lee el CSV de la alerta diaria de Metabase (lo que Luis subió a `bankMovements`; cargos negativos, abonos positivos) y:
   - liga cada pago con su gasto (el creado por una factura o uno ya capturado) y pone el ID del movimiento en la columna W;
   - registra lo que no tiene gasto: nómina, impuestos y comisiones en OPEX ("NO FACTURA"), intereses y crédito en FINANCIAL,
     abonos en INCOME (los reembolsos, en negativo en OPEX); ignora traspasos propios y aperturas de inversión.
9. **Budget:** escribe los renglones de OPEX, FIXED_ASSETS, FINANCIAL e INCOME. El registro de facturas, la bitácora y las corridas
   van en una hoja aparte y ligera, **"Gastos n8n · control"** (crear pestañas dentro del Budget es tan pesado que Google responde 503).
10. **Validación:** correo a facturacion@ con los gastos nuevos que ninguna regla resolvió.

## Instalación (una sola vez)

### 1. Credenciales en n8n (Credentials → Add credential)
| Nombre exacto | Tipo | Valor |
|---|---|---|
| `Google Sheets (alvaro)` | Google Sheets OAuth2 API | Inicia sesión con alvaro@ |
| `Google Drive (alvaro)` | Google Drive OAuth2 API | Inicia sesión con alvaro@ |
| `Gmail (alvaro)` | Gmail OAuth2 API | Inicia sesión con alvaro@ |
| `Anthropic API` | Header Auth | Name `x-api-key`, Value: la API key de Anthropic |
| `Slack bot` | Header Auth | Name `Authorization`, Value `Bearer xoxb-…` (token del bot) |
| `Todo Conta API key` | Header Auth | Name `X-Api-Key`, Value: la key de app.todoconta.com/cuenta/api |

**Bot de Slack:** crea una app en api.slack.com/apps con los permisos (scopes) `chat:write` y `reactions:read`, instálala en el
workspace, copia el *Bot User OAuth Token* (`xoxb-…`) e **invita al bot al canal privado #budget-y-presupuestos**
(`/invite @nombre-del-bot`). Sin la invitación no puede publicar ni leer las ✅.

### 2. Importar
1. **Workflows → Import from File → `flujo_errores.json`**. Guarda.
2. **Workflows → Import from File → `flujo_gastos.json`**. Guarda.
3. En cada nodo con aviso de credencial, elige la del mismo nombre (n8n suele asignarlas solas si los nombres coinciden).
4. En el flujo de gastos: **⋯ → Settings → Error workflow → "Gastos Atrato · aviso de errores"**.

### 3. Primera corrida (modo prueba)
1. Abre el nodo **Config**. Viene con `modo_prueba: true` y `todoconta_activo: false`.
2. Pulsa **Execute workflow**. La primera vez crea en la hoja "Gastos n8n · control (prueba)" las pestañas FACTURAS, BITACORA, N8N_CORRIDAS y N8N_SAT, y publica en Slack el resumen de lo que habría hecho.
3. Con la credencial de Todo Conta creada, cambia `todoconta_activo: true` y vuelve a correr.
   Cuando ya llegue a tu correo la alerta diaria de Metabase con el CSV, cambia `bancos_activo: true`.

### Alerta de Metabase (bancos)
Metabase está dentro de la red de Atrato y n8n Cloud no puede consultarlo directo, así que los movimientos llegan por correo:
- Pregunta **4645 "Movimientos Bancarios para N8N"** → alerta **diaria a las 8:30**, destinatario alvaro@, con **resultados adjuntos en CSV**.
- n8n busca el correo más reciente de `contacto@atratotech.com` con ese asunto (configurable en `metabase_correo_busqueda`).
4. Activa el flujo (interruptor **Active**). Una semana en modo prueba; si las decisiones son buenas, `modo_prueba: false`.

### 4. Para pasar al Budget real
En **Config** cambia `sheet_id` por el del Budget original y `drive_raiz_por_anio` por la carpeta de facturas real.
La columna W "Ref banco (n8n)" se crea sola en OPEX y FIXED_ASSETS la primera vez que se usa.

## Cómo lo usa el equipo
- **Pagar:** el mensaje de Slack dice qué pagar y por qué banco. Al pagar, reaccionar con ✅. En la siguiente corrida la factura
  pasa a "pagada" en FACTURAS.
- **Validar un gasto nuevo:** en la pestaña FACTURAS, cambiar **Clasificación** a `pagar`, `pagar_banregio`, `pagada_tarjeta`
  o `descartada`. En la siguiente corrida se crea el gasto y, si toca, el mensaje de Slack.
- **Reglas nuevas o casos especiales:** editar el texto `reglas` en el nodo **Config** (o `manejo_gastos.md` y correr `build.py`).
- **Bancos:** Luis sube los movimientos de cada cuenta a Metabase (`bankMovements`, con `account` = el Payment Method del budget,
  cargos en negativo y abonos en positivo). n8n hace el resto; nadie captura ni actualiza renglones a mano. En FINANCIAL e
  INCOME la referencia queda en ORIGEN ("n8n mov #123"); en OPEX y FIXED_ASSETS, en la columna W.
- **Movimientos con categoría vacía:** cuando el agente no está seguro, registra el renglón sin categoría para que el equipo la complete.

## Qué está probado y qué no
- **Probado** con datos simulados (`pruebas/prueba_flujo.py`): lectura de CFDI 4.0 (incluye complementos de pago), unión con el SAT
  por UUID, reglas fijas, uso del resultado del agente, relación con gastos existentes, creación de gastos en las cuatro pestañas,
  conciliación con movimientos de Metabase (cargos, abonos, ignorados, Fidarp), IDs, Slack, ✅, recordatorios y la escritura completa.
- **Por probar en n8n** (la primera corrida en modo prueba lo confirma): que la versión de n8n Cloud acepte la configuración de los
  nodos de Gmail, Drive, IF y HTTP tal como vienen; la sesión con el MCP de Todo Conta usando API key; y la respuesta real de Claude.
