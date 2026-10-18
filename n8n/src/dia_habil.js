// Corre de lunes a viernes; los días festivos oficiales (LFT art. 74) se saltan.
// No se pierde nada: la siguiente corrida busca desde la última que terminó bien.
const cfg = $('Config').first().json;
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: cfg.zona_horaria, year: 'numeric', month: '2-digit', day: '2-digit' })
  .format(new Date());
const [y, m, d] = hoy.split('-').map(Number);
const iso = dt => dt.toISOString().slice(0, 10);
// n-ésimo lunes del mes
const lunes = (mes, n) => {
  const primero = new Date(Date.UTC(y, mes - 1, 1));
  const desfase = (1 - primero.getUTCDay() + 7) % 7;
  return iso(new Date(Date.UTC(y, mes - 1, 1 + desfase + 7 * (n - 1))));
};
const festivos = [
  `${y}-01-01`, lunes(2, 1), lunes(3, 3), `${y}-05-01`, `${y}-09-16`, lunes(11, 3), `${y}-12-25`,
  ...((y - 2024) % 6 === 0 ? [`${y}-10-01`] : []),      // transmisión del Poder Ejecutivo
  ...(cfg.festivos_extra || [])
];
const diaSemana = new Date(Date.UTC(y, m - 1, d)).getUTCDay();   // 0 domingo … 6 sábado
const finDeSemana = diaSemana === 0 || diaSemana === 6;
const festivo = festivos.includes(hoy);

if (cfg.disparo === 'programado' && (finDeSemana || festivo)) {
  return [];   // detiene la corrida sin error
}
return [{ json: { hoy, dia_semana: diaSemana, festivo, fin_de_semana: finDeSemana } }];
