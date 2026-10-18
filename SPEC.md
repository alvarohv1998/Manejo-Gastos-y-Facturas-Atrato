# Spec de interfaz — Manejo de Gastos (Atrato)

> Versión 0.2 · 11-oct-2026 · Borrador para revisión antes de construir. La v0.2 incorpora tus respuestas sobre permisos y bitácora, gastos sin factura y la carpeta de Drive.
> Qué hace la interfaz, no cómo está hecha. Las preguntas abiertas se marcan con **[P#]** y están juntas al final.

**Contexto leído**
- *Proyecto gastos IPO*: el problema y el proceso actual, en 5 actividades.
- *Mapa de tu sistema*: los 5 pasos y su tipo de solución.
- *Reglas de clasificación de facturas/invoices*.
- *Budget Opex 2026* (Google Sheets): pestañas OPEX-CONTA, OPEX-VIEW, Bizpoint, FOLIOS MANUALES, Categorias, LOE y Q_Check.
- Datos dados en conversación: RFC de Atrato **ATE1905076I1**, roles y reglas de aprobación.

---

## 1. Qué es esto

Una aplicación interna para manejar los gastos de Atrato. Reúne en un solo lugar:
- los gastos registrados,
- las facturas o invoices que los respaldan,
- y lo que está pendiente: gastos sin factura y facturas sin pagar.

Atiende el problema del documento IPO: *"el proceso actual de registro de facturas y pagos pendientes es tardado, tedioso, susceptible a errores y con mucha dependencia humana de seguimiento"*.

Esta primera versión es **solo la interfaz**, para validar el diseño. La información se carga a mano o viene del histórico del Budget Opex 2026. Las automatizaciones de los pasos 1 a 4 del mapa se construyen aparte.

## 2. Usuarios

Equipo FinOps, con uso diario.

**Todo el equipo de finanzas puede hacer cualquier cosa en la app.** No hay permisos por rol. A cambio, **cada cambio queda en una bitácora** (ver pantalla D).

| Usuario | Actividad habitual (no es una restricción) |
|---|---|
| **Luis Caloca** | Registra los gastos que salen en bancos |
| **Álvaro Hernández** | Aprueba los gastos por transferencia y revisa los de tarjeta |
| **Gilberto Retamoza** | Equipo de finanzas; también sube facturas a la carpeta de Drive |
| **Isabel Torres** | Equipo de finanzas; hoy captura en el budget |

**La app es solo registro.** Marcar algo, por ejemplo "Aprobado" o "Pagado", no ejecuta nada: no paga, no envía, no mueve dinero. Solo deja constancia.

## 3. Trazabilidad con el mapa

En el *Mapa de tu sistema*, el único paso marcado como **Interfaz** es el **paso 5, "Aplicación interna de gestión de facturas"**. Su contexto es *"un aplicativo con toda la información que muestre facturas, pendientes de pago, complementos de pago, etc."*. Todas las pantallas cuelgan de ese paso. Algunas, además, muestran el resultado de un paso de automatización.

| Pantalla / pestaña | Paso del mapa | Qué del paso 5 cubre | Estado |
|---|---|---|---|
| **A. Registro de gastos** | 5 (y muestra la salida del paso 3, "Relacionar con bancos") | Gastos registrados con su factura relacionada | Definida |
| **B. Opex (vista tipo Excel)** | 5 | *"Aplicación con todos los gastos pendientes y registrados con sus facturas/invoice relacionados"* (salida de la actividad 5 del IPO) | Definida |
| **B1. Pestaña "Falta factura"** | 5 (equivale a la actividad 4 del IPO, "Cuadrar gastos y facturas") | Gastos sin factura | Definida (caso borde 1) |
| **B2. Pestaña "Pendientes de pago"** | 5 (y muestra la salida del paso 4, "Slack: facturas pendientes de pago") | *"pendientes de pago"* | Definida (caso borde 2) |
| **B3. Pestaña "Por conciliar (tarjeta)"** | 5 (y muestra la salida del paso 3, "Relacionar con bancos") | Facturas de tarjeta ya pagadas sin cargo ligado | Definida (P6) |
| **C. Carpeta de facturas** | 5 (y muestra la salida del paso 2, "Registrar facturas en carpetas") | *"facturas"* | Definida |
| **D. Bitácora de cambios** | 5 | Requisito directo: "cualquier cambio se debe registrar en un log de cambios" | Definida |
| Complementos de pago | 5 (*"complementos de pago"*) | Está en el contexto del paso 5, pero no la pediste como pantalla | **Pregunta [P3]** |
| Bandeja de validación de gastos nuevos (regla 5) | Paso 1 (Agente), no es interfaz | — | **Pregunta [P4]** |
| Budget contra real (CON-ADJ / SUMMARY) | Ningún paso | — | **Fuera del alcance** salvo que digas lo contrario |

---

## 4. Pantallas

### Navegación general
- Menú lateral con cuatro secciones: **Registro de gastos · Opex · Carpeta de facturas · Bitácora**.
- Junto a "Opex" aparecen dos contadores: gastos con *falta factura* y facturas *pendientes de pago*. Así se ve lo pendiente sin entrar a la pantalla.
- Arriba se muestra quién está usando la app. Todos ven las mismas acciones; el nombre solo sirve para firmar cada cambio en la bitácora.

---

### A. Registro de gastos

**Para qué:** dar de alta un gasto y relacionarlo con su factura. Mientras no existan las conexiones a bancos, correo y SAT, el alta es manual.

**Quién la usa:** cualquiera del equipo. En la práctica Luis registra y Álvaro aprueba o revisa.

**Contenido**
1. **Formulario de gasto.** Usa los mismos campos que OPEX-CONTA, en dos bloques:
   - **Datos del movimiento** (se llenan al registrar):
     - Fecha.
     - Vintage o mes, que se calcula de la fecha con el formato `01_ENERO`.
     - Método de pago, del catálogo de bancos y tarjetas.
     - Proveedor.
     - Descripción.
     - Amount: sin IVA y en positivo para gastos; en negativo solo en reembolsos o notas de crédito (igual el IVA).
     - Moneda.
     - USD, que se calcula con el dólar del mes.
     - Folio.
     - Usuario.
   - **Clasificación contable** (se puede completar después):
     - Categoría, Área y Tipo de gasto (Variable / Fijo / One Time).
     - ¿Lleva IVA?, IVA, IVA retenido, ISR y Total.
     - Prorrateado (sí/no) y meses de prorrateo.
     - Provisión, EEFF, cuenta Contpaq, Periodo y Fluctuación.
     - Notas.
2. **Factura del gasto.** Tiene tres estados posibles:
   - **Con factura**: se relaciona con un buscador de la carpeta (pantalla C) que ofrece primero las coincidencias por proveedor o RFC, monto y fecha cercana. La factura queda *Relacionada*.
   - **Sin factura (no requiere)**: gastos que por naturaleza no llevan factura (nómina, impuestos, comisiones). Se registra como hoy, con "NO FACTURA" en la columna *Receipt*. **No cuenta como pendiente.**
   - **Falta factura**: es el valor por omisión mientras no se haya hecho ninguna de las dos anteriores.
3. **ID del gasto.** Se asigna solo, con el formato actual `26-####`.
4. **Estado de aprobación**, según el método de pago. Es solo registro y no ejecuta el pago:
   - Transferencia: *Pendiente de aprobación*, luego *Aprobado* o *Rechazado*.
   - Tarjeta (Clara, Amex): *Pendiente de revisión*, luego *Revisado*. Siguiendo la regla "tarjeta de crédito: no pagar, solo registrar", no requiere aprobación.
5. **Lista de gastos recientes** debajo del formulario, con chips de estado (factura y aprobación) y acciones rápidas: editar, aprobar o rechazar, marcar como revisado.

**Lee:** catálogos, carpeta de facturas, tipo de cambio mensual.
**Escribe:** gasto nuevo o editado, relación gasto–factura, aprobación o revisión. Todo queda en la bitácora.

---

### B. Opex (vista tipo Excel)

**Para qué:** ver y editar todos los gastos como hoy se trabaja OPEX-CONTA, pero con el estado de factura y de aprobación a la vista.

**Quién la usa:** todo el equipo.

**Contenido**
- Una tabla con **las mismas columnas y en el mismo orden que OPEX-CONTA**:
  > ID · VINTAGE · DATE · Expense Category · Area · Description · Expense Type · Payment Method · Amount · VAT? · VAT · VAT Withheld · ISR · Total · USD · User · Provider · Folio · Invoice · Receipt · Prorated · Prorated months · Provision · EEFF · Contpaq · Periodo · Fluctuación · Notes · CHECK
  
  Agrega dos columnas nuevas, fijas a la izquierda: **Estado factura** y **Estado aprobación**.
- **Comportamiento de hoja de cálculo:**
  - Encabezado y columna ID congelados.
  - Edición directa en la celda; los catálogos se eligen de una lista.
  - Filtro y orden por columna, búsqueda global.
  - Selección de rango con suma visible (como la barra de estado de Excel).
- **Fila de totales** que respeta el filtro activo: Amount, VAT, Total y USD.
- **Filtro rápido por mes** (chips de 01_ENERO a 12_DICIEMBRE) y por método de pago.
- **Pestañas abajo, como hojas de Excel:**
  - **OPEX**: todos los gastos.
  - **Falta factura** (B1).
  - **Pendientes de pago** (B2).
- Tiene que moverse fluido con unos **6,000 renglones**, el tamaño actual de OPEX-CONTA 2026.

#### B1. Pestaña "Falta factura" (caso borde 1)
- **Entra aquí** todo gasto sin factura relacionada. En la vista OPEX esos gastos muestran el chip **"Falta factura"**.
- **No entran** los gastos marcados como **Sin factura (no requiere)** ("NO FACTURA" en *Receipt*). Siguen visibles en la pestaña OPEX con su chip neutro.
- **Columnas:** las de OPEX, más **días sin factura** (antigüedad desde la fecha del gasto).
- **Orden:** del más antiguo al más reciente.
- **Acciones:**
  - **Relacionar factura**: abre el buscador de la carpeta.
  - **Marcar "Sin factura (no requiere)"**: el gasto sale de esta pestaña y el cambio queda en la bitácora.

#### B2. Pestaña "Pendientes de pago" (caso borde 2)
- **Entra aquí** toda factura de la carpeta que **no tiene gasto registrado**.
- **No entran:**
  - complementos de pago,
  - facturas no dirigidas a ATE1905076I1 o recibidas en soportefinanzas@ (descartadas),
  - facturas de tarjeta de crédito, que se marcan **ya pagadas** y van a B3.
- **Columnas:**
  - Fecha de factura, emisor, RFC del emisor, folio o UUID, total, moneda, método (PUE/PPD).
  - **Días pendiente**.
  - **Banco sugerido**: Banregio si el proveedor tiene historial pagado por Banregio, según la regla.
- **Acciones:**
  - **Registrar gasto**: abre la pantalla A con los datos de la factura ya llenados.
  - **Ver factura**: abre la vista previa.

#### B3. Pestaña "Por conciliar (tarjeta)"
- **Entra aquí** toda factura pagada con tarjeta de crédito (Clara, Amex). Se marca **Pagada**, porque no hay que pagarla, pero todavía no está ligada al cargo del estado de cuenta.
- **Columnas:** fecha de factura, emisor, total, moneda, tarjeta, días sin conciliar.
- **Acciones:**
  - **Conciliar**: liga la factura con el cargo correspondiente del estado de cuenta, que ya es un gasto en OPEX.
  - **Registrar cargo**: crea el gasto desde la factura si el cargo todavía no está registrado.
- Al conciliar, la factura sale de la pestaña y queda *Relacionada*. Más adelante, la conexión a la información de bancos hará este paso sola (paso 3 del mapa).

---

### C. Carpeta de facturas

**Para qué:** ver la carpeta de facturas que hoy vive en Google Drive como un solo lugar donde buscar y abrir cualquier factura o invoice, y saber si ya está relacionada con un gasto.

**Quién la usa:** todo el equipo.

**Cómo está hoy la carpeta de Drive** (revisada el 11-oct-2026)
- Una carpeta raíz con **una subcarpeta por mes**: `01_Enero` … `10_Octubre`. No hay subcarpetas por proveedor.
- Casi todo son **PDF**. Las subcarpetas por proveedor son la excepción, por ejemplo "Factura uber" dentro de `08_Agosto`, y hay algunos archivos sueltos en la raíz, como "Latinometrics Julio 2026".
- **Los nombres de archivo no siguen un patrón.** Algunos son el UUID (`CADA9C25-….pdf`), otros RFC + folio (`PLO170816D91FF005623.pdf`), otros texto libre (`Telcel $3,228.04`, `FACTURA_ 41260 (1).pdf`). El nombre no siempre dice el proveedor ni el monto.

**Contenido**
- **Árbol de carpetas** a la izquierda, **igual que en Drive**: meses `01_Enero` … `12_Diciembre`, sus subcarpetas, y una entrada "Sin carpeta de mes" para los archivos sueltos de la raíz.
- **Lista de facturas** a la derecha, con:
  - **nombre del archivo, tal como está en Drive**,
  - fecha, emisor, RFC, folio, UUID, total, moneda. Cuando no se conocen se muestran como *"sin datos"*; leer el PDF para llenarlos es una automatización y queda fuera de esta versión,
  - tipo de comprobante (Ingreso / Egreso / Pago),
  - método de pago (PUE/PPD),
  - **estado**: *Relacionada* · *Pendiente de pago* · *Pagada (tarjeta) · por conciliar* · *Complemento* · *Descartada* · *No es factura*.
- **Vista previa** del PDF y descarga del PDF y del XML.
- **Si está relacionada**, la ficha muestra el gasto o gastos ligados (ID, fecha, monto) con enlace a la fila en Opex.
- **Filtros:** estado, proveedor, rango de fechas, moneda, monto.
- **Subir factura a mano** (XML, PDF o ambos) mientras no exista la descarga automática **[P8]**.

**Lee:** facturas y sus archivos, relaciones con gastos.
**Escribe:** factura nueva subida a mano, estado de la factura y datos capturados a mano. Todo queda en la bitácora.

---

### D. Bitácora de cambios

**Para qué:** como todos pueden cambiar todo, que siempre se sepa quién cambió qué, cuándo, y qué valor había antes.

**Quién la usa:** todo el equipo, normalmente para revisar o auditar.

**Contenido**
- **Vista general**: una lista cronológica, la más reciente arriba. Cada renglón tiene:
  - fecha y hora, usuario,
  - acción (creó / editó / relacionó / desrelacionó / aprobó / rechazó / revisó / marcó sin factura / subió factura / eliminó),
  - objeto (gasto `26-####` o archivo de factura),
  - campo, **valor anterior → valor nuevo**,
  - comentario opcional.
- **Filtros:** usuario, rango de fechas, tipo de acción, gasto o factura específica.
- **Historial por registro**: desde cualquier gasto (pantallas A y B) o factura (pantalla C) se abre un panel lateral con solo sus cambios.
- **No se puede editar ni borrar.** Si algo se eliminó, la bitácora conserva cómo estaba.

**Lee:** todos los cambios.
**Escribe:** nada directamente. Las otras pantallas la alimentan con cada cambio.

---

## 5. Qué NO construir en esta interfaz

- Conexiones o automatizaciones con **Slack, Budget en Google Sheets, correo, SAT, bancos o Drive**.
- El **agente clasificador** (paso 1). Las reglas de clasificación se reflejan solo como **estados** que se asignan a mano.
- El envío de correos de validación y los mensajes de Slack.
- Los reportes de budget contra real, los estados financieros, los saldos bancarios (pestaña BANKS) y los activos fijos.
- Un sistema de login real. En esta versión basta con elegir el usuario para ver el diseño por rol.

## 6. Datos que la interfaz lee y escribe

| Dato | Lee | Escribe | Origen del histórico (Budget Opex 2026) |
|---|---|---|---|
| **Gasto** (todas las columnas de OPEX-CONTA, más estado de factura y de aprobación) | ✓ | ✓ | Pestaña **OPEX-CONTA**, ~6,000 renglones de enero a septiembre 2026 |
| **Factura / invoice** (archivo y su carpeta de mes, UUID, tipo de CFDI, emisor y RFC, receptor y RFC, fecha, subtotal, IVA, total, moneda, tipo de cambio, método y forma de pago, uso de CFDI) | ✓ | ✓ (alta manual, estado) | **Archivos:** la carpeta de Drive de facturas (meses `01_Enero` … `10_Octubre` de 2026, casi todo PDF). **Datos del CFDI:** pestañas **Bizpoint** y **FOLIOS MANUALES**, donde existan. La columna *Invoice* de OPEX-CONTA da la referencia **[P12]** |
| **Relación gasto ↔ factura** (puede ser 1 a 1, 1 a varios o varios a 1) | ✓ | ✓ | Columna *Invoice* y *Folio* de OPEX-CONTA, y Bizpoint |
| **Aprobación / revisión** (quién, cuándo, resultado) | ✓ | ✓ | No existe hoy; empieza vacía |
| **Bitácora de cambios** (quién, cuándo, objeto, campo, valor anterior y nuevo) | ✓ | ✓ (solo agregar, nunca editar) | Empieza vacía; la carga del histórico queda registrada como una sola entrada |
| **Catálogos**: categorías, áreas, tipos de gasto, métodos de pago, proveedores | ✓ | — | Pestañas **Categorias** y **LOE** |
| **Tipo de cambio mensual** | ✓ | — | Renglón "Dolar" de la pestaña **OPEX** |
| **Usuarios y rol** | ✓ | — | Sección 2 |

Más adelante estos datos se irán cargando conforme salgan de bancos, correo, SAT y Slack. **Para esta versión solo se usa el histórico del Budget Opex 2026.**

## 7. Casos borde a probar

**Pedidos por ti**
1. **Gasto sin factura relacionada**: muestra el chip "Falta factura" y aparece en la pestaña **Falta factura**. Al relacionarle una factura, sale de la pestaña.
2. **Factura sin gasto registrado**: aparece en la pestaña **Pendientes de pago**. Al registrarle un gasto, desde la misma factura o relacionándola después, sale de la pestaña y queda *Relacionada*.

**Derivados del contexto (confirmar cuáles aplican)**

3. **Un pago que cubre varias facturas, o una factura pagada en varias partes**: el contador de pendientes no debe duplicar ni perder ninguna.
4. **Complemento de pago (CFDI tipo P)**: no cuenta como "pendiente de pago". Se muestra como *Complemento* ligado a su factura original. Ver [P3].
5. **Factura de tarjeta de crédito sin gasto registrado**: queda como **Pagada · por conciliar** y aparece en la pestaña B3, nunca en "Pendientes de pago". Al ligarla con el cargo del estado de cuenta, sale de B3.
6. **Factura no dirigida a ATE1905076I1 o recibida en soportefinanzas@**: queda *Descartada* y no aparece en ninguna pestaña de pendientes.
7. **Gasto que por naturaleza no lleva factura** (nómina, impuestos, comisiones): se marca **Sin factura (no requiere)** ("NO FACTURA" en *Receipt*). Aparece en OPEX pero **nunca** en "Falta factura".
8. **Factura en USD**: se muestran el monto original y su equivalente en MXN con el dólar del mes.
9. **Misma factura cargada dos veces** (mismo UUID): aviso de duplicado; no se crea otra.
10. **Gasto prorrateado**: se registra una vez y muestra en cuántos meses se reparte.
11. **Signos**: los gastos van en positivo y sin IVA en Amount; los reembolsos y notas de crédito, en negativo. Los totales y filtros respetan el signo.
12. **Filtro sin resultados o pestaña vacía**: mensaje claro, por ejemplo "No hay gastos sin factura este mes", nunca una tabla en blanco sin explicación.
13. **Gasto por transferencia rechazado**: sigue visible con estado *Rechazado* y su motivo, y no cuenta como aprobado en los totales **[P9]**.
14. **Factura en Drive sin datos de CFDI** (solo el PDF, con un nombre que no dice proveedor ni monto): aparece en la carpeta con campos *"sin datos"*, se puede relacionar a mano y cuenta para "Pendientes de pago" mientras no esté relacionada.
15. **Archivo de la carpeta que no es factura** (por ejemplo, un reporte suelto en la raíz): se puede marcar como *No es factura* para que no aparezca en pendientes.
16. **Bitácora**: un cambio y luego otro que lo revierte dejan dos entradas. Eliminar un gasto deja su último estado completo en la bitácora.

---

## 8. Design system (identidad Atrato)

### Color

| Token | Valor | Uso |
|---|---|---|
| `purple` | `#6941C6` | Acento principal: botones primarios, links, selección, foco |
| `purple-dark` | `#4D4590` | Encabezados de tabla (texto blanco), menú activo, botones secundarios |
| `purple-mid` | `#6F6CB0` | Iconografía y elementos secundarios |
| `lavender` | `#D2C5E2` | Bordes suaves, separadores, chips neutros |
| `lavender-light` | `#F4EBFF` | Filas alternas de tabla, fondos de tarjeta, celda seleccionada |
| `ink` | `#333333` | Texto principal y títulos |
| `ink-2` | `#475467` | Texto secundario |
| `ink-3` | `#667085` | Etiquetas, texto terciario, texto deshabilitado |
| `night` | `#161B26` | Menú lateral; fondo en modo oscuro |
| `white` | `#FFFFFF` | Fondo general |

**Colores de estado.** La marca permite verde y rojo solo como color semántico.

| Estado | Color | Ejemplos |
|---|---|---|
| OK | verde | Relacionada · Aprobado · Revisado |
| Atención | ámbar | Pendiente de aprobación · Pendiente de revisión · Pendiente de pago · Pagada · por conciliar |
| Problema | rojo | Falta factura · Rechazado · Duplicado |
| Neutro | lavanda | Sin factura (no requiere) · Complemento · Descartada · No es factura |

**Modo oscuro:** fondo `night`. Los morados se aclaran un paso para mantener el contraste.

### Tipografía
- **Títulos:** Montserrat Light o Regular, el sustituto de Mabry Pro. Peso ligero, sin negritas pesadas.
- **Cuerpo y tablas:** Source Sans 3, interlineado 1.4–1.5.
- **Números:** cifras tabulares, alineadas a la derecha. Formato `$1,234,567.89` y negativos (reembolsos) `-$11,458.32`.
- **Fechas:** `dd/mm/aa`, como en OPEX-CONTA.

### Componentes base
- **Tabla tipo Excel:**
  - encabezado `purple-dark` con texto blanco, filas alternas blanco y `lavender-light`,
  - celda activa con borde `purple`,
  - fila de totales fija abajo,
  - pestañas tipo hoja abajo.
- **Chip de estado**: los cinco colores semánticos de arriba, siempre con texto, nunca solo color.
- **Botones:**
  - primario `purple` relleno,
  - secundario con borde `purple-dark`,
  - destructivo rojo (rechazar).
- **Menú lateral:** fondo `night`, ítem activo con barra `purple`, contadores de pendientes en chip.
- **Ficha de factura:** vista previa del PDF, datos del CFDI y gastos relacionados.
- **Buscador para relacionar factura:** lista de coincidencias ordenada por qué tanto se parecen (RFC, monto, fecha).
- **Estados vacíos y de carga** en cada tabla.

---

## 9. Preguntas abiertas

**Resueltas el 11-oct-2026**
- ~~P1, P2~~: todo el equipo de finanzas puede hacer todo, cada cambio va a la bitácora, y la app es solo registro.
- ~~P5~~: los gastos que no llevan factura se registran como "Sin factura" y no aparecen en "Falta factura".
- ~~P7~~: la carpeta es la de Drive, organizada por mes. Se consideran sus archivos históricos.
- ~~P6~~: la factura de tarjeta se marca **ya pagada** y se concilia contra el estado de cuenta o, después, contra la conexión a la información de bancos. Va en la pestaña B3.

**Abiertas**
- **[P3]** **Complementos de pago**: están en el contexto del paso 5. ¿Los quieres como pestaña dentro de la Carpeta de facturas, o fuera de esta versión?
- **[P4]** **Gastos nuevos que no cumplen ninguna regla** (regla 5, "enviar a validación con un correo"): ¿necesitan una bandeja en la interfaz o se quedan solo en el agente o el correo?
- **[P8]** **Subir factura a mano**: ¿lo incluimos en esta versión de diseño o solo se muestra lo que ya existe?
- **[P9]** **Gasto rechazado por Álvaro**: ¿qué pasa después? ¿Se corrige y vuelve a aprobación, o se elimina?
- **[P10]** **Columna CHECK** de OPEX-CONTA: ¿qué significa y quién la marca? ¿Se conserva en la vista Opex?
- **[P11]** **Exportar la vista Opex** (por ejemplo, para pegar en el Budget mientras se migra): ¿lo incluimos? No es una conexión, pero quiero confirmarlo.
- **[P12]** **Columna *Invoice* de OPEX-CONTA**: ¿qué guarda, el link al PDF en Drive, el nombre del archivo o el UUID? De eso depende si podemos relacionar automáticamente el histórico de gastos con los archivos de la carpeta, o si el histórico arranca con todo en "Falta factura".
- **[P13]** **XML de las facturas**: en Drive casi solo hay PDF. ¿Los XML se guardan en otro lugar, o no se guardan?
