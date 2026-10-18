# Reglas de clasificación de facturas · Atrato

Estas reglas las lee el agente de n8n en cada factura. Las primeras cinco las aplica el flujo directamente,
sin depender del agente; el agente las usa para entender el contexto y para los casos que ninguna regla cubre.

## Reglas
1. **Tarjeta de crédito** (forma de pago 04, o pagada con Clara o Amex): no se paga, solo se registra.
   Clasificación `pagada_tarjeta`. Se concilia después contra el estado de cuenta de la tarjeta.
2. **Complementos de pago** (CFDI tipo P): se registran aparte como complemento. Clasificación `complemento`.
3. **No se registran** (`descartada`):
   - facturas recibidas en soportefinanzas@atratopago.com;
   - cualquier factura cuyo receptor no sea Atrato (RFC ATE1905076I1), por ejemplo facturas por ventas de motos dirigidas a clientes;
   - facturas canceladas en el SAT.
4. **Histórico Banregio**: si en el budget los gastos anteriores del mismo proveedor se pagaron por Banregio,
   la factura se paga por Banregio (`pagar_banregio`), siempre que no aplique ninguna de las reglas anteriores.
5. **Gasto nuevo** que no cumple ninguno de los puntos anteriores y no tiene historial claro: `por_validar`.
   Se envía a validación por correo a facturacion@atratopago.com para que respondan si sí es necesario o no.

## Criterios para los casos que no cubren las reglas
- Si hay historial del proveedor pagado por transferencia (BBVA, BBVA USD, STP u otra cuenta), la clasificación es `pagar`
  y el método sugerido es el más usado en el historial.
- Nota de crédito (CFDI tipo E): en el budget va en negativo. Si corresponde a un gasto conocido, clasifícala como ese gasto;
  si no, `por_validar`.
- Facturas de proveedores extranjeros (invoices sin UUID): `pagar` si hay historial; si no, `por_validar`.
- Un documento que no es factura (contrato, cotización, estado de cuenta, reporte) es `no_es_factura`.

## Categoría, área y tipo de gasto
- Usa solo valores del catálogo del budget (Expense Category, Area, Expense Type).
- Primero copia cómo se clasificaron los gastos anteriores del mismo proveedor; si cambió con el tiempo, usa el más reciente.
- Sin historial, decide por el concepto de la factura. Ejemplos de criterio: software y nube → la categoría de tecnología y el área que la usa;
  honorarios legales o contables → servicios profesionales y Finance o General; renta y mantenimiento de oficina → General.
- Si no hay forma razonable de decidir, deja el campo vacío para que lo complete el equipo.

## Casos especiales
_(Agrega aquí los casos que vayan apareciendo. El agente los lee en la siguiente corrida.)_
