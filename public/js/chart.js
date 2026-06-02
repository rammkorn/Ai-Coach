// Grafico dei progressi in puro SVG (nessuna dipendenza).
// Mostra le ripetizioni completate per sessione nel tempo e, in trasparenza,
// la precisione del ritmo. I punti delle sessioni MAX sono evidenziati.
export function renderProgressChart(container, series) {
  container.innerHTML = '';
  if (!series || series.length < 2) {
    container.innerHTML = '<p class="muted small">Completa almeno 2 sessioni per vedere i progressi.</p>';
    return;
  }

  const W = 320, H = 140, padL = 28, padB = 22, padT = 12, padR = 8;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const reps = series.map((s) => s.completed_reps);
  const maxReps = Math.max(5, ...reps);
  const n = series.length;

  const x = (i) => padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yReps = (v) => padT + innerH - (v / maxReps) * innerH;
  const yAcc = (a) => padT + innerH - (a || 0) * innerH;

  const svg = (tag, attrs, children = '') => {
    const a = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
    return `<${tag} ${a}>${children}</${tag}>`;
  };

  // Griglia orizzontale + etichette asse Y (ripetizioni).
  let grid = '';
  for (let g = 0; g <= 2; g++) {
    const val = Math.round((maxReps / 2) * g);
    const yy = yReps(val);
    grid += svg('line', { x1: padL, y1: yy, x2: W - padR, y2: yy, stroke: 'rgba(255,255,255,0.08)', 'stroke-width': 1 });
    grid += svg('text', { x: 4, y: yy + 4, fill: '#8aa0c6', 'font-size': 10 }, val);
  }

  // Area + linea della precisione del ritmo (sfondo tenue).
  const accLine = series.map((s, i) => `${x(i)},${yAcc(s.tempo_accuracy)}`).join(' ');
  const accArea = `M ${padL},${padT + innerH} L ${accLine.replace(/ /g, ' L ')} L ${W - padR},${padT + innerH} Z`;

  // Linea delle ripetizioni.
  const repsLine = series.map((s, i) => `${x(i)},${yReps(s.completed_reps)}`).join(' ');

  // Punti (MAX evidenziati).
  const dots = series.map((s, i) => svg('circle', {
    cx: x(i), cy: yReps(s.completed_reps), r: s.max_mode ? 4.5 : 3,
    fill: s.max_mode ? '#f87171' : '#22d3ee',
    stroke: '#0e1726', 'stroke-width': 1.5,
  })).join('');

  container.innerHTML = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': 'Grafico progressi' },
    grid +
    svg('path', { d: accArea, fill: 'rgba(167,139,250,0.12)' }) +
    svg('polyline', { points: accLine, fill: 'none', stroke: 'rgba(167,139,250,0.5)', 'stroke-width': 1.5, 'stroke-dasharray': '3 3' }) +
    svg('polyline', { points: repsLine, fill: 'none', stroke: '#22d3ee', 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }) +
    dots
  ) + `<div class="chart-legend">
      <span><i style="background:#22d3ee"></i> Ripetizioni</span>
      <span><i style="background:#a78bfa"></i> Ritmo corretto</span>
      <span><i style="background:#f87171"></i> MAX</span>
    </div>`;
}
