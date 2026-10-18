// Movimientos bancarios que no corresponden a ningún gasto o ingreso registrado: el agente decide en qué
// pestaña van (OPEX, FIXED_ASSETS, FINANCIAL, INCOME) o si se ignoran, en lotes de 25.
const cfg = $('Config').first().json;
const est = $('Estado').first().json;
const { plan } = $('Plan facturas').first().json;
const movs = plan.sin_conciliar.slice(0, cfg.max_movimientos_ia);
if (!movs.length) return [{ json: { sin_ia: true } }];

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const GENERICAS = new Set(['spei', 'enviado', 'recibido', 'pago', 'pagos', 'transferencia', 'traspaso', 'cargo', 'abono', 'deposito', 'compra',
  'servicio', 'servicios', 'mexico', 'banco', 'cuenta', 'referencia', 'concepto', 'para', 'desde']);
const palabras = s => norm(s).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length >= 4 && !GENERICAS.has(w) && !/^\d+$/.test(w)).slice(0, 3);
const todas = [...est.gastos, ...est.ingresos];
const ejemplos = m => {
  const ps = palabras(m.descripcion);
  if (!ps.length) return [];
  return todas.filter(o => ps.some(p => norm(o.descripcion + ' ' + o.proveedor).includes(p)))
    .sort((a, b) => String(b.fecha || b.vintage).localeCompare(String(a.fecha || a.vintage))).slice(0, 4)
    .map(o => ({ pestana: o.tab, descripcion: o.descripcion, categoria: o.categoria, subcategoria: o.subcategoria || undefined, area: o.area, tipo: o.tipo,
      metodo: o.metodo, total: o.total, factura: o.receipt && /^no fac/i.test(o.receipt) ? 'NO FACTURA' : undefined }));
};
const lista = vals => ({ type: 'string', enum: ['', ...(vals || []).slice(0, 150)] });   // "" = sin dato (sin uniones de tipos)
const c = est.catalogos;
const esquema = {
  type: 'object', additionalProperties: false, required: ['movimientos'],
  properties: { movimientos: { type: 'array', items: {
    type: 'object', additionalProperties: false,
    required: ['id', 'destino', 'categoria', 'subcategoria', 'area', 'tipo_gasto', 'descripcion', 'requiere_factura', 'confianza', 'motivo'],
    properties: {
      id: { type: 'string' },
      destino: { type: 'string', enum: ['OPEX', 'FIXED_ASSETS', 'FINANCIAL', 'INCOME', 'IGNORAR'] },
      categoria: lista([...new Set([...c.categorias, ...c.categorias_financial, ...c.categorias_activos])]),
      subcategoria: lista(c.subcategorias_financial), area: lista(c.areas), tipo_gasto: lista(c.tipos),
      descripcion: { type: 'string' }, requiere_factura: { type: 'boolean' }, confianza: { type: 'number' }, motivo: { type: 'string' }
    } } } }
};
const sistema = `Eres el agente de tesorería del equipo de finanzas de Atrato Technologies. Recibes movimientos bancarios
(cargos en negativo, abonos en positivo) que no corresponden a ningún gasto ni ingreso ya registrado en el budget.
Para cada uno decides:
- "destino": OPEX (gasto de operación: proveedores, nómina, impuestos, comisiones bancarias, tarjetas), FIXED_ASSETS (compra de activo fijo),
  FINANCIAL (intereses, pagos de crédito o derivados), INCOME (ingreso de tesorería: intereses ganados, rendimientos, compensaciones; solo abonos)
  o IGNORAR (traspasos entre cuentas propias de Atrato o del fideicomiso, aperturas o vencimientos de inversión, movimientos que no son ni gasto ni ingreso).
  Un abono que es devolución o reembolso de un gasto va a OPEX (se registrará en negativo).
- "categoria", "subcategoria" (solo FINANCIAL), "area" y "tipo_gasto": solo valores del catálogo; guíate por los ejemplos históricos. Si no hay forma razonable, "".
- "descripcion": texto corto en MAYÚSCULAS para el budget (por ejemplo "COMISION SPEI", "NOMINA 1A QUINCENA OCTUBRE", "INTERESES FIDARP").
- "requiere_factura": false para nómina, impuestos, comisiones bancarias, intereses y movimientos que nunca traen factura; true si el proveedor debería facturar.
- "confianza" de 0 a 1 y "motivo" en una frase.
Contexto de Atrato: los gastos de intereses casi siempre son un pago grande a Fidarp que sale del fideicomiso (alrededor de $10,000,000)
y otro que equivale al 4.9% de esos intereses (retención); ambos van a FINANCIAL.

REGLAS DEL BUDGET
${cfg.reglas}`;

const out = [];
for (let i = 0; i < movs.length; i += 25) {
  const lote = movs.slice(i, i + 25).map(m => ({ id: m.id, tipo: m.tipo, cuenta: m.cuenta, fecha: m.fecha, monto: m.monto, moneda: m.moneda,
    referencia: m.referencia, descripcion: m.descripcion, ejemplos_historicos: ejemplos(m) }));
  out.push({ json: { ids: lote.map(m => m.id), request: {
    model: cfg.ia_modelo, max_tokens: 16000,
    output_config: { effort: cfg.ia_esfuerzo, format: { type: 'json_schema', schema: esquema } },
    fallbacks: 'default',
    system: [{ type: 'text', text: sistema, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify({ catalogos: c, movimientos: lote }, null, 1) }] }]
  } } });
}
return out;
