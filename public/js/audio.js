// Segnali audio per seguire il ritmo SENZA guardare lo schermo (durante una
// flessione si guarda il pavimento). Combina:
//   - brevi "beep" sintetizzati (Web Audio) a inizio di ogni fase,
//   - voce sintetica in italiano ("giù", "su") tramite SpeechSynthesis,
//   - un suono di conferma quando una ripetizione viene contata.
export class Cues {
  constructor() {
    this.enabled = true;
    this.ctx = null;
    this.voice = null;
    this._pickVoice();
  }

  // Va inizializzato dopo un gesto utente (autoplay policy).
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setEnabled(v) { this.enabled = v; }

  _pickVoice() {
    if (!('speechSynthesis' in window)) return;
    const choose = () => {
      const voices = speechSynthesis.getVoices();
      this.voice = voices.find((v) => /^it/i.test(v.lang)) || voices[0] || null;
    };
    choose();
    speechSynthesis.onvoiceschanged = choose;
  }

  _beep(freq, durMs = 120, gain = 0.15) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.frequency.value = freq;
    osc.type = 'sine';
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + durMs / 1000);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + durMs / 1000);
  }

  _say(text) {
    if (!this.enabled || !('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'it-IT';
    if (this.voice) u.voice = this.voice;
    u.rate = 1.1; u.volume = 1;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  down() { this._beep(330, 140); this._say('giù'); }
  pause() { this._beep(440, 90, 0.08); }
  up() { this._beep(660, 140); this._say('su'); }

  // Conferma di una ripetizione, con tono diverso a seconda del ritmo.
  rep(score) {
    if (score === 'ideal') this._beep(880, 110, 0.2);
    else if (score === 'fast') this._beep(520, 90, 0.18);
    else this._beep(300, 160, 0.18);
  }

  say(text) { this._say(text); }
}
