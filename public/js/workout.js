// Controller della sessione di allenamento.
// Gestisce: la barra del ritmo (animazione colorata che mostra il tempo ideale),
// la cronometrazione di ogni ripetizione, le serie e il recupero, e l'invio
// delle ripetizioni al server.
import { api } from './api.js';
import { pickBestDetector, detectors } from './detection.js';

const PHASE_COLORS = {
  down: getVar('--down', '#f59e0b'),
  pause: getVar('--pause', '#a78bfa'),
  up: getVar('--up', '#34d399'),
};
function getVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export class Workout {
  constructor(els, { sessionId, plan, maxMode, onFinish }) {
    this.els = els;
    this.sessionId = sessionId;
    this.plan = plan;
    this.maxMode = maxMode;
    this.onFinish = onFinish;

    this.totalSets = plan.target_sets;
    this.repsPerSet = maxMode ? plan.planned_reps : plan.target_reps;
    this.setIndex = 1;
    this.repInSet = 0;
    this.reps = [];               // {total_ms, score, set_index}
    this.lastRepTime = null;      // per misurare la cadenza
    this.resting = false;
    this.stopDetector = null;
    this.rafBar = null;
    this.finished = false;
  }

  async start(preferred) {
    this.bindNose();
    await this.startDetector(preferred);
    this.startBar();
    this.lastRepTime = performance.now();
    this.updateLabels();
  }

  // La barra scorre in ciclo continuo giù→pausa→su per dettare il ritmo ideale.
  startBar() {
    const { tempo_down_ms: down, tempo_pause_ms: pause, tempo_up_ms: up } = this.plan;
    const cycle = down + pause + up;
    const bar = this.els.tempoBar;
    const label = this.els.phaseLabel;
    const t0 = performance.now();

    const tick = (now) => {
      if (this.finished) return;
      if (this.resting) { this.rafBar = requestAnimationFrame(tick); return; }
      const t = (now - t0) % cycle;
      let pct, color, phase;
      if (t < down) {
        pct = (t / down) * 100; color = PHASE_COLORS.down; phase = 'GIÙ ↓';
      } else if (t < down + pause) {
        pct = 100; color = PHASE_COLORS.pause; phase = 'PAUSA';
      } else {
        pct = 100 - ((t - down - pause) / up) * 100; color = PHASE_COLORS.up; phase = 'SU ↑';
      }
      bar.style.width = pct + '%';
      bar.style.background = color;
      label.textContent = phase;
      this.rafBar = requestAnimationFrame(tick);
    };
    this.rafBar = requestAnimationFrame(tick);
  }

  async startDetector(preferred) {
    const { videoEl, canvasEl, noseBtn, detectBadge, motionFill, motionText } = this.els;
    let detector;
    if (preferred && detectors[preferred]) {
      const cand = preferred === 'camera'
        ? detectors.camera(videoEl, canvasEl)
        : preferred === 'touch'
          ? detectors.touch(noseBtn)
          : detectors[preferred]();
      detector = cand.available ? cand : pickBestDetector({ videoEl, canvasEl, noseBtn });
    } else {
      detector = pickBestDetector({ videoEl, canvasEl, noseBtn });
    }
    detectBadge.textContent = detector.name;

    if (detector.name === 'mic') motionText.textContent = 'Conta i piegamenti a voce! 🎤';
    else if (detector.name === 'camera') motionText.textContent = 'Tieni il volto nel quadro 📷';
    else if (detector.name === 'proximity') motionText.textContent = 'Avvicina il petto al telefono 📱';
    else motionText.textContent = 'Premi col naso ad ogni piegamento 👃';

    try {
      this.stopDetector = await detector.start({
        onRep: () => this.countRep(detector.name),
        onLevel: (lvl) => { motionFill.style.width = Math.round(lvl * 100) + '%'; },
      });
    } catch (e) {
      // Permesso negato o sensore assente: il pulsante naso resta come fallback.
      detectBadge.textContent = 'touch';
      motionText.textContent = 'Sensore non disponibile: usa il pulsante naso 👃';
    }
  }

  // Il pulsante naso è SEMPRE attivo come fallback, anche con altri sensori.
  bindNose() {
    this._noseHandler = (e) => { e.preventDefault(); this.countRep('touch'); };
    this.els.noseBtn.addEventListener('pointerdown', this._noseHandler);
  }

  countRep(detection) {
    if (this.resting || this.finished) return;
    const now = performance.now();
    const total_ms = this.lastRepTime ? Math.round(now - this.lastRepTime) : this.plan.ideal_rep_ms;
    this.lastRepTime = now;

    this.repInSet += 1;
    const rep = { total_ms, set_index: this.setIndex, rep_index: this.repInSet, detection };
    this.reps.push(rep);

    // Feedback visivo immediato.
    this.els.noseCount.textContent = this.repInSet;
    this.els.noseBtn.classList.remove('counted');
    void this.els.noseBtn.offsetWidth; // restart animazione
    this.els.noseBtn.classList.add('counted');
    this.flashScore(total_ms);
    if (navigator.vibrate) navigator.vibrate(15);

    // Persistenza (best-effort, non blocca l'allenamento).
    api.logRep(this.sessionId, rep).catch(() => {});

    this.updateLabels();

    if (this.repInSet >= this.repsPerSet) this.endSet();
  }

  flashScore(total_ms) {
    const ideal = this.plan.ideal_rep_ms;
    const t = this.els.motionText;
    if (total_ms < ideal * 0.8) { t.textContent = '⚡ Troppo veloce — rallenta!'; t.style.color = 'var(--warn)'; }
    else if (total_ms > ideal * 1.2) { t.textContent = '🐢 Troppo lento — spingi!'; t.style.color = 'var(--bad)'; }
    else { t.textContent = '🎯 Ritmo perfetto!'; t.style.color = 'var(--good)'; }
  }

  endSet() {
    if (this.setIndex >= this.totalSets) { this.finish(); return; }
    this.resting = true;
    let remaining = Math.round(this.plan.rest_ms / 1000);
    const { phaseLabel, restSkip, motionText } = this.els;
    restSkip.classList.remove('hidden');
    const render = () => { phaseLabel.textContent = `Recupero: ${remaining}s`; motionText.textContent = 'Respira. Prossima serie in arrivo.'; };
    render();
    this._restTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) this.nextSet();
      else render();
    }, 1000);
    this._restSkip = () => this.nextSet();
    restSkip.addEventListener('click', this._restSkip);
  }

  nextSet() {
    clearInterval(this._restTimer);
    this.els.restSkip.classList.add('hidden');
    if (this._restSkip) this.els.restSkip.removeEventListener('click', this._restSkip);
    this.resting = false;
    this.setIndex += 1;
    this.repInSet = 0;
    this.els.noseCount.textContent = '0';
    this.lastRepTime = performance.now();
    this.updateLabels();
  }

  updateLabels() {
    this.els.setLabel.textContent = this.maxMode ? 'MODALITÀ MAX' : `Serie ${this.setIndex} / ${this.totalSets}`;
    this.els.repLabel.textContent = `${this.repInSet} / ${this.repsPerSet}`;
  }

  async finish() {
    if (this.finished) return;
    this.finished = true;
    this.cleanup();
    let result = null;
    try {
      result = await api.finishSession(this.sessionId, this.reps.map((r) => ({ total_ms: r.total_ms, score: r.score })));
    } catch (e) {
      result = { error: e.message };
    }
    if (this.onFinish) this.onFinish(result, { reps: this.reps, maxMode: this.maxMode });
  }

  cleanup() {
    if (this.rafBar) cancelAnimationFrame(this.rafBar);
    if (this._restTimer) clearInterval(this._restTimer);
    if (this.stopDetector) { try { this.stopDetector(); } catch {} }
    if (this._noseHandler) this.els.noseBtn.removeEventListener('pointerdown', this._noseHandler);
  }
}
