// Rilevamento del completamento del movimento.
//
// Ordine di comodità richiesto dall'utente:
//   1) Sensore di prossimità  (il telefono appoggiato a terra: il petto/mento
//      che si avvicina copre il sensore)
//   2) Telecamera frontale    (il volto che riempie/svuota il quadro)
//   3) Microfono              (l'utente conta i piegamenti a voce)
//   4) Touch col naso         (pulsante grande, sempre disponibile)
//
// Ogni detector è una macchina a stati che emette un evento "rep" quando rileva
// un ciclo completo giù→su. Espone start()/stop() e un onRep callback.
// Tutti gli oggetti restituiscono anche un valore 0..1 (onLevel) per animare
// l'indicatore di movimento a schermo.

function makeDetector({ name, available, startImpl }) {
  return { name, available, start: startImpl };
}

// ---- 1) Prossimità ----------------------------------------------------------
// Prova prima la Generic Sensor API (ProximitySensor), poi l'evento legacy
// `userproximity`/`deviceproximity`.
export function proximityDetector() {
  const hasGeneric = 'ProximitySensor' in window;
  const hasLegacy = 'ondeviceproximity' in window || 'onuserproximity' in window;
  return makeDetector({
    name: 'proximity',
    available: hasGeneric || hasLegacy,
    startImpl: ({ onRep, onLevel }) => {
      let near = false;
      const trigger = (isNear, normalized) => {
        if (typeof normalized === 'number') onLevel(normalized);
        if (isNear && !near) { near = true; }
        else if (!isNear && near) { near = false; onRep(); } // ciclo completo all'allontanarsi
      };
      if (hasGeneric) {
        let sensor;
        try {
          sensor = new window.ProximitySensor({ frequency: 20 });
          sensor.addEventListener('reading', () => {
            const max = sensor.max || 10;
            const d = sensor.distance == null ? max : sensor.distance;
            const lvl = 1 - Math.min(1, d / max);
            trigger(sensor.near === true || d < (max * 0.2), lvl);
          });
          sensor.start();
          return () => sensor.stop();
        } catch { /* cade nel legacy */ }
      }
      const handler = (e) => {
        const max = e.max || 10;
        const val = e.value == null ? max : e.value;
        const lvl = 1 - Math.min(1, val / max);
        trigger(e.near === true || val < max * 0.2, lvl);
      };
      window.addEventListener('userproximity', handler);
      window.addEventListener('deviceproximity', handler);
      return () => {
        window.removeEventListener('userproximity', handler);
        window.removeEventListener('deviceproximity', handler);
      };
    },
  });
}

// ---- 2) Telecamera frontale -------------------------------------------------
// Misura la luminosità media del quadro: avvicinando il volto il fotogramma si
// scurisce/cambia in modo marcato. Quando il livello supera una soglia (giù) e
// poi torna sotto (su) conta una ripetizione. Calibrazione automatica.
export function cameraDetector(videoEl, canvasEl) {
  return makeDetector({
    name: 'camera',
    available: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
    startImpl: async ({ onRep, onLevel }) => {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 160, height: 120 },
        audio: false,
      });
      videoEl.srcObject = stream;
      await videoEl.play();
      const ctx = canvasEl.getContext('2d', { willReadFrequently: true });
      canvasEl.width = 64; canvasEl.height = 48;

      let baseline = null;   // luminosità a riposo
      let down = false;
      let raf;
      const THRESH = 0.18;   // variazione relativa per considerare "giù"

      const loop = () => {
        ctx.drawImage(videoEl, 0, 0, 64, 48);
        const { data } = ctx.getImageData(0, 0, 64, 48);
        let sum = 0;
        for (let i = 0; i < data.length; i += 4) sum += (data[i] + data[i + 1] + data[i + 2]);
        const bright = sum / (data.length / 4) / (3 * 255); // 0..1
        if (baseline == null) baseline = bright;
        baseline = baseline * 0.98 + bright * 0.02; // adattamento lento

        const delta = Math.abs(bright - baseline) / (baseline + 0.001);
        onLevel(Math.min(1, delta / (THRESH * 1.6)));

        if (!down && delta > THRESH) down = true;
        else if (down && delta < THRESH * 0.5) { down = false; onRep(); }

        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);

      return () => {
        cancelAnimationFrame(raf);
        stream.getTracks().forEach((t) => t.stop());
        videoEl.srcObject = null;
      };
    },
  });
}

// ---- 3) Microfono -----------------------------------------------------------
// L'utente conta i piegamenti a voce. Rileviamo i picchi di volume: ogni picco
// (oltre soglia, con debounce) = una ripetizione. Va detto all'utente di
// contare ad alta voce quando seleziona questa modalità.
export function micDetector() {
  return makeDetector({
    name: 'mic',
    available: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
    startImpl: async ({ onRep, onLevel }) => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);

      let loud = false;
      let lastRep = 0;
      let noiseFloor = 0.05;
      let raf;

      const loop = () => {
        analyser.getByteFrequencyData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i];
        const level = sum / buf.length / 255; // 0..1
        noiseFloor = noiseFloor * 0.995 + level * 0.005; // rumore di fondo
        const over = level - noiseFloor;
        onLevel(Math.min(1, over / 0.25));

        const now = performance.now();
        if (!loud && over > 0.12 && now - lastRep > 450) {
          loud = true; lastRep = now; onRep();
        } else if (loud && over < 0.05) {
          loud = false;
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);

      return () => {
        cancelAnimationFrame(raf);
        stream.getTracks().forEach((t) => t.stop());
        ctx.close();
      };
    },
  });
}

// ---- 4) Touch col naso ------------------------------------------------------
// Sempre disponibile: il grande pulsante centrale. Lo colleghiamo altrove
// (workout.js) ma lo modelliamo qui per uniformità.
export function touchDetector(buttonEl) {
  return makeDetector({
    name: 'touch',
    available: true,
    startImpl: ({ onRep }) => {
      const handler = (e) => { e.preventDefault(); onRep(); };
      buttonEl.addEventListener('pointerdown', handler);
      return () => buttonEl.removeEventListener('pointerdown', handler);
    },
  });
}

// Sceglie automaticamente il detector migliore disponibile, nell'ordine voluto.
export function pickBestDetector({ videoEl, canvasEl, noseBtn }) {
  const candidates = [
    proximityDetector(),
    cameraDetector(videoEl, canvasEl),
    micDetector(),
    touchDetector(noseBtn),
  ];
  return candidates.find((d) => d.available) || touchDetector(noseBtn);
}

export const detectors = {
  proximity: proximityDetector,
  camera: cameraDetector,
  mic: micDetector,
  touch: touchDetector,
};
