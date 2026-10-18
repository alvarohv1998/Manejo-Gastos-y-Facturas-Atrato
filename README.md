# Manejo de gastos · Atrato

Automatización del registro de gastos de Atrato Technologies (FinOps): lee las facturas del correo y del SAT, avisa en Slack las que están pendientes de pago, las sube a Drive, crea el gasto en el Budget y deja los datos para la interfaz.

## Contenido

| Carpeta / archivo | Qué es |
|---|---|
| `n8n/` | Flujo de n8n: código de cada nodo (`src/*.js`), generador (`build.py`), pruebas y los JSON listos para importar |
| `n8n/flujo_gastos.json` | Flujo diario "Gastos Atrato · facturas diarias" (se genera con `python3 n8n/build.py`) |
| `n8n/flujo_errores.json` | Flujo "Gastos Atrato · aviso de errores" |
| `n8n/manejo_gastos.md` | Reglas de clasificación que lee el agente |
| `interfaz/` | Interfaz publicada como artefacto (`index.html`; el script está también en `app.js`) |
| `prototipo/` | Prototipo de diseño con datos de ejemplo |
| `SPEC.md` | Spec de la interfaz |
| `MODELO_DATOS.md` | Modelo de datos |

## Cómo se actualiza el flujo

1. Cambia el código en `n8n/src/` (o los valores en `n8n/src/config.js`).
2. Genera los JSON: `python3 n8n/build.py`.
3. Corre la prueba simulada: `python3 n8n/pruebas/prueba_flujo.py` (debe terminar con `"ok": true`).
4. En n8n, borra el lienzo del flujo, pega `n8n/flujo_gastos.json`, guarda y publica.

Las credenciales (Google, Gmail, Anthropic, Slack, Todo Conta) viven solo en n8n; este repositorio guarda sus IDs, nunca las llaves.
