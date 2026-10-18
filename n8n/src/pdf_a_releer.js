// Facturas que quedaron "por validar" porque el agente no pudo leer su PDF (sin datos: ni RFC ni total) y que no están en el SAT.
// Su PDF ya está en Drive: se baja para volver a dárselo al agente.
const cfg = $('Config').first().json;
const est = $('Estado').first().json;
const out = [];
for (const f of est.facturas) {
  if (out.length >= (cfg.max_releer_pdf || 40)) break;
  if (f.Estado !== 'por_validar' || !/^El agente no respondió/.test(String(f.Motivo || ''))) continue;
  if (f['RFC emisor'] && Number(f.Total) > 0) continue;          // ya tiene datos: se reclasifica sin el PDF
  const id = (String(f['Link Drive'] || '').match(/\/d\/([A-Za-z0-9_-]{20,})/) || [])[1];
  if (!id) continue;
  out.push({ json: { clave: String(f.Clave), fila: f.fila, file_id: id, nombre: String(f.Clave).split(':').pop() || `${id}.pdf`,
    origen: f.Origen || 'correo', buzon: f['Buzón'] || '', remitente: f.Remitente || '', asunto: f.Asunto || '', recibido: f.Recibida || '' } });
}
return out.length ? out : [{ json: { ninguno: true } }];
