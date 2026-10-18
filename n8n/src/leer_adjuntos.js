// Toma los correos de Gmail y arma una lista de facturas: une el XML y el PDF del mismo correo
// y lee los datos del CFDI del XML. Los PDF sin XML se mandan a la IA más adelante.
const cfg = $('Config').first().json;
const pista = new RegExp(cfg.pista_factura, 'i');
const grupo = cfg.buzon_grupo.toLowerCase();

// ---------- Lector de CFDI (3.3 / 4.0, con complemento de pagos 1.0 / 2.0) ----------
const des = s => String(s).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&amp;/g, '&');
function etiquetas(xml, nombre) {
  const re = new RegExp('<(?:[\\w]+:)?' + nombre + '\\b([^>]*?)/?>', 'g');
  const out = [];
  let m;
  while ((m = re.exec(xml))) {
    const a = {};
    for (const p of m[1].matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)) a[p[1].replace(/^.*:/, '')] = des(p[2]);
    out.push(a);
  }
  return out;
}
const n = v => (v === undefined || v === null || v === '' ? null : Number(v));
function leerCfdi(xml) {
  const c = etiquetas(xml, 'Comprobante')[0];
  if (!c) return null;
  const emisor = etiquetas(xml, 'Emisor')[0] || {};
  const receptor = etiquetas(xml, 'Receptor')[0] || {};
  const timbre = etiquetas(xml, 'TimbreFiscalDigital')[0] || {};
  const impuestos = etiquetas(xml, 'Impuestos').find(t => 'TotalImpuestosTrasladados' in t || 'TotalImpuestosRetenidos' in t) || {};
  // Retenciones a nivel comprobante: no traen "Base"
  const retenciones = etiquetas(xml, 'Retencion').filter(r => !('Base' in r));
  const ret = imp => retenciones.filter(r => r.Impuesto === imp).reduce((s, r) => s + (n(r.Importe) || 0), 0) || null;
  const conceptos = etiquetas(xml, 'Concepto').map(x => x.Descripcion).filter(Boolean);
  const docs = etiquetas(xml, 'DoctoRelacionado').map(dr => ({
    uuid: (dr.IdDocumento || '').toUpperCase(), parcialidad: n(dr.NumParcialidad),
    saldo_anterior: n(dr.ImpSaldoAnt), importe_pagado: n(dr.ImpPagado), saldo_insoluto: n(dr.ImpSaldoInsoluto)
  }));
  return {
    uuid: (timbre.UUID || '').toUpperCase() || null, tipo: c.TipoDeComprobante || null,
    fecha: c.Fecha || null, serie: c.Serie || '', folio: c.Folio || '',
    emisor_rfc: (emisor.Rfc || '').toUpperCase(), emisor_nombre: emisor.Nombre || '',
    receptor_rfc: (receptor.Rfc || '').toUpperCase(), uso_cfdi: receptor.UsoCFDI || '',
    subtotal: n(c.SubTotal), descuento: n(c.Descuento) || 0,
    iva: n(impuestos.TotalImpuestosTrasladados), iva_retenido: ret('002'), isr_retenido: ret('001'),
    total: n(c.Total), moneda: c.Moneda || 'MXN', tipo_cambio: n(c.TipoCambio),
    metodo_pago: c.MetodoPago || '', forma_pago: c.FormaPago || '',
    conceptos: conceptos.slice(0, 5).join(' | ').slice(0, 400), docs_relacionados: docs, fuente: 'xml'
  };
}
const texto = x => (!x ? '' : typeof x === 'string' ? x : x.text || (x.value || []).map(v => v.address).join(', ') || JSON.stringify(x));
const tallo = s => String(s).toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]/g, '');

const out = [];
const vistos = new Set();
const entradas = $input.all();
for (let i = 0; i < entradas.length; i++) {
  const it = entradas[i];
  const m = it.json || {};
  if (!m.id || !it.binary || vistos.has(m.id)) continue;
  vistos.add(m.id);

  const destinatarios = (texto(m.to) + ' ' + texto(m.cc) + ' ' + JSON.stringify(m.headers || {})).toLowerCase();
  const viaGrupo = destinatarios.includes(grupo);
  const remitente = texto(m.from);
  const asunto = m.subject || '';
  const recibido = m.date ? new Date(m.date).toISOString() : '';

  const xmls = [], pdfs = [];
  for (const [clave, bin] of Object.entries(it.binary)) {
    const nombre = bin.fileName || clave;
    const ext = (bin.fileExtension || nombre.split('.').pop() || '').toLowerCase();
    if (ext === 'xml' || /xml/.test(bin.mimeType || '')) {
      try {
        const buf = await this.helpers.getBinaryDataBuffer(i, clave);
        const cfdi = leerCfdi(buf.toString('utf8').replace(/^\uFEFF/, ''));
        if (cfdi) xmls.push({ clave, nombre, cfdi, bin });
      } catch (e) { /* XML ilegible: se ignora */ }
    } else if (ext === 'pdf' || /pdf/.test(bin.mimeType || '')) {
      pdfs.push({ clave, nombre, bin });
    }
  }
  const pdfsRelevantes = (viaGrupo || xmls.length || pista.test(asunto) || pista.test(remitente))
    ? pdfs : pdfs.filter(p => pista.test(p.nombre));

  // Empareja cada XML con su PDF (mismo nombre, o el PDF menciona el UUID o el folio)
  const usados = new Set();
  for (const x of xmls) {
    let pdf = pdfsRelevantes.find(p => !usados.has(p.clave) && tallo(p.nombre) === tallo(x.nombre));
    if (!pdf) pdf = pdfsRelevantes.find(p => !usados.has(p.clave) && x.cfdi.uuid && tallo(p.nombre).includes(tallo(x.cfdi.uuid)));
    if (!pdf && x.cfdi.folio) pdf = pdfsRelevantes.find(p => !usados.has(p.clave) && tallo(p.nombre).includes(tallo(x.cfdi.folio)));
    if (!pdf && xmls.length === 1 && pdfsRelevantes.length === 1) pdf = pdfsRelevantes[0];
    if (pdf) usados.add(pdf.clave);
    const binary = { [x.clave]: x.bin };
    const archivos = [{ binary_key: x.clave, nombre: x.nombre, ext: 'xml' }];
    if (pdf) { binary[pdf.clave] = pdf.bin; archivos.unshift({ binary_key: pdf.clave, nombre: pdf.nombre, ext: 'pdf' }); }
    out.push({ json: {
      key: x.cfdi.uuid || `${m.id}:${x.nombre}`, origen: 'correo', mensaje_id: m.id, asunto, remitente,
      buzon: viaGrupo ? cfg.buzon_grupo : 'directo', recibido, cfdi: x.cfdi, archivos, requiere_extraccion: false
    }, binary });
  }
  for (const p of pdfsRelevantes.filter(p => !usados.has(p.clave))) {
    out.push({ json: {
      key: `${m.id}:${p.nombre}`, origen: 'correo', mensaje_id: m.id, asunto, remitente,
      buzon: viaGrupo ? cfg.buzon_grupo : 'directo', recibido, cfdi: null,
      archivos: [{ binary_key: p.clave, nombre: p.nombre, ext: 'pdf' }], requiere_extraccion: true
    }, binary: { [p.clave]: p.bin } });
  }
}
return out.length ? out : [{ json: { vacio: true, correos: vistos.size } }];
