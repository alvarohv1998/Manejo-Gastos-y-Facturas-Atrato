// Prepara una consulta al agente (Claude) por factura: lee el PDF cuando no hay XML, decide la
// clasificación con las reglas y asigna Expense Category, Area y Expense Type con base en el histórico.
const cfg = $('Config').first().json;
const est = $('Estado').first().json;
const entradas = $input.all();

// Sin campos "o null": la API de Anthropic limita a 16 los campos con unión de tipos. Lo desconocido va como "" o 0.
const lista = vals => ({ type: 'string', enum: ['', ...(vals || []).slice(0, 120)] });
const S = { type: 'string' }, N = { type: 'number' };
const esquema = {
  type: 'object', additionalProperties: false,
  required: ['es_factura', 'uuid', 'tipo_comprobante', 'fecha', 'serie', 'folio', 'rfc_emisor', 'nombre_emisor', 'rfc_receptor',
    'subtotal', 'iva', 'iva_retenido', 'isr_retenido', 'total', 'moneda', 'forma_pago', 'metodo_pago', 'conceptos',
    'clasificacion', 'destino', 'categoria', 'area', 'tipo_gasto', 'metodo_pago_sugerido', 'confianza', 'motivo'],
  properties: {
    es_factura: { type: 'boolean' },
    uuid: S, tipo_comprobante: S, fecha: S, serie: S, folio: S, rfc_emisor: S, nombre_emisor: S, rfc_receptor: S,
    subtotal: N, iva: N, iva_retenido: N, isr_retenido: N, total: N, moneda: S, forma_pago: S, metodo_pago: S, conceptos: S,
    clasificacion: { type: 'string', enum: ['pagar', 'pagar_banregio', 'pagada_tarjeta', 'complemento', 'descartada', 'por_validar', 'no_es_factura'] },
    destino: { type: 'string', enum: ['OPEX', 'FIXED_ASSETS', 'FINANCIAL'] },
    categoria: lista([...new Set([...est.catalogos.categorias, ...est.catalogos.categorias_financial])]), area: lista(est.catalogos.areas),
    tipo_gasto: lista(est.catalogos.tipos), metodo_pago_sugerido: lista(est.catalogos.metodos),
    confianza: N, motivo: S
  }
};
const sistema = `Eres el agente de cuentas por pagar del equipo de finanzas de Atrato Technologies (RFC ${cfg.rfc_atrato}).
Para cada factura (CFDI mexicano o invoice extranjero) haces tres cosas:
1. Si recibes un PDF, extraes sus datos tal como aparecen (UUID o folio fiscal en mayúsculas, RFC, fecha YYYY-MM-DD, montos sin signo, moneda, forma y método de pago, conceptos). Si el documento no es una factura, contesta es_factura = false y clasificacion = "no_es_factura". Si ya te doy los datos, cópialos y no los inventes. Lo que no aparezca va como texto vacío "" (o 0 en montos).
2. Decides la clasificación con las reglas de abajo. Si es un invoice o recibo que dice que ya se cobró a una tarjeta (paid, charged to card, autopay, "Visa/Mastercard/Amex ending in…"), la clasificación es "pagada_tarjeta" y en metodo_pago_sugerido pones la tarjeta del catálogo que corresponda (Clara o Amex). Las reglas mandan; si ninguna aplica, usa el historial. Si no hay historial y el gasto es nuevo, la clasificación es "por_validar".
3. Decides en qué pestaña del budget va el gasto ("destino"): OPEX (gastos de operación, la gran mayoría), FIXED_ASSETS (compra de activo fijo: equipo de cómputo, mobiliario) o FINANCIAL (intereses y pagos de crédito o derivados).
4. Asignas Expense Category, Area y Expense Type usando solo valores del catálogo (para FINANCIAL, la categoría es la "Categoría de Compra" de esa pestaña). Apóyate primero en cómo se clasificaron gastos anteriores del mismo proveedor y después en el concepto. Si no hay forma razonable de decidir, deja "".
"confianza" va de 0 a 1 y refleja qué tan seguro estás de la clasificación. "motivo" es una o dos frases en español que citan la regla o el gasto histórico en que te basaste.

REGLAS DE CLASIFICACIÓN
${cfg.reglas}`;

const prioridad = c => (c.accion === 'reclasificar' ? 2 : c.origen === 'sat' ? 1 : 0);
const pendientes = entradas.map((it, i) => ({ it, i })).filter(({ it }) => {
  const c = it.json;
  if (c.vacio || c.accion === 'adjuntar') return false;
  const d = c.datos;
  if (d && (d.tipo === 'P' || (d.receptor_rfc && d.receptor_rfc !== cfg.rfc_atrato) || /cancel/i.test(d.estado_sat || ''))) return false;  // reglas fijas, sin IA
  return true;
}).sort((a, b) => prioridad(a.it.json) - prioridad(b.it.json));

const out = [];
for (const { it, i } of pendientes) {
  const c = it.json;
  if (out.length >= cfg.max_ia_por_corrida && (c.origen === 'sat' || c.accion === 'reclasificar')) continue;   // se retoman en la siguiente corrida
  const contenido = [];
  const pdf = (c.archivos || []).find(a => a.ext === 'pdf');
  if (pdf && (c.requiere_extraccion || !(c.datos && c.datos.conceptos))) {
    try {
      const buf = await this.helpers.getBinaryDataBuffer(i, pdf.binary_key);
      if (buf.length < 20 * 1024 * 1024) {
        contenido.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } });
      }
    } catch (e) { /* sin PDF legible: se clasifica con los datos que haya */ }
  }
  if (c.requiere_extraccion && !contenido.length) continue;
  contenido.push({ type: 'text', text: JSON.stringify({
    datos_conocidos: c.datos || 'Extráelos del PDF adjunto',
    recibida: { origen: c.origen, buzon: c.buzon, remitente: c.remitente, asunto: c.asunto, archivo: pdf ? pdf.nombre : null },
    historial_proveedor: c.historial || 'Sin datos todavía: se calcula con lo que extraigas del PDF',
    catalogos: est.catalogos
  }, null, 1) });
  out.push({ json: { key: c.key, request: {
    model: cfg.ia_modelo,
    max_tokens: 8000,
    output_config: { effort: cfg.ia_esfuerzo, format: { type: 'json_schema', schema: esquema } },
    fallbacks: 'default',
    system: [{ type: 'text', text: sistema, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: contenido }]
  } } });
}
return out.length ? out : [{ json: { sin_ia: true } }];
