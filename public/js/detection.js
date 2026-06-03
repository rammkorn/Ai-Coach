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
    startImpl: ({ onRep, onLevel, onStatus }) => {
      // Isteresi + tempo di permanenza per evitare conteggi rapidissimi su
      // posizioni instabili: serve scendere SOTTO "vicino" e poi risalire SOPRA
      // "lontano", restando vicino almeno MIN_NEAR_MS.
      const NEAR = 0.6;       // soglia per considerare "petto vicino" (giù)
      const FAR = 0.3;        // soglia per considerare "risalito" (su)
      const MIN_NEAR_MS = 180;
      let near = false;
      let nearSince = 0;

      const feed = (lvlRaw) => {
        const lvl = Math.max(0, Math.min(1, lvlRaw));
        onLevel(lvl);
        const now = performance.now();
        if (!near && lvl > NEAR) {
          near = true; nearSince = now;
          if (onStatus) onStatus({ ok: true, text: 'Giù… 📱' });
        } else if (near && lvl < FAR) {
          near = false;
          if (now - nearSince > MIN_NEAR_MS) {
            if (onStatus) onStatus({ ok: true, text: 'Su! ✓' });
            onRep();
          }
        }
      };

      if (hasGeneric) {
        let sensor;
        try {
          sensor = new window.ProximitySensor({ frequency: 20 });
          sensor.addEventListener('reading', () => {
            const max = sensor.max || 10;
            const d = sensor.distance == null ? max : sensor.distance;
            feed(sensor.near === true ? 1 : 1 - Math.min(1, d / max));
          });
          sensor.start();
          return () => sensor.stop();
        } catch { /* cade nel legacy */ }
      }
      const handler = (e) => {
        const max = e.max || 10;
        const val = e.value == null ? max : e.value;
        feed(e.near === true ? 1 : 1 - Math.min(1, val / max));
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
// Strategia preferita: FaceDetector API — segue la dimensione del volto, che
// AUMENTA scendendo (volto più vicino) e DIMINUISCE risalendo. Più robusto della
// sola luminosità. Se FaceDetector non è disponibile, ripiega sull'analisi della
// luminosità media del fotogramma. In entrambi i casi: superata la soglia "giù"
// e tornati sotto "su" => una ripetizione. Calibrazione automatica continua.
export function cameraDetector(videoEl, canvasEl) {
  return makeDetector({
    name: 'camera',
    available: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
    startImpl: async ({ onRep, onLevel, onStatus }) => {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 320, height: 240 },
        audio: false,
      });
      videoEl.srcObject = stream;
      await videoEl.play();
      const ctx = canvasEl.getContext('2d', { willReadFrequently: true });
      canvasEl.width = 64; canvasEl.height = 48;

      const faceDetector = ('FaceDetector' in window)
        ? new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 })
        : null;

      let baseline = null;   // riferimento a riposo (dimensione volto o luminosità)
      let down = false;
      let running = true;
      let calibFrames = 0;
      let lastFace = true;   // per il fallback luminosità consideriamo "qualità ok"
      const THRESH = faceDetector ? 0.22 : 0.18; // variazione relativa per "giù"

      // Misura il segnale corrente (0..1) e aggiorna lo stato "qualità posizione".
      const measure = async () => {
        if (faceDetector) {
          try {
            const faces = await faceDetector.detect(videoEl);
            lastFace = faces.length > 0;
            if (lastFace) {
              const b = faces[0].boundingBox;
              const vw = videoEl.videoWidth || 320, vh = videoEl.videoHeight || 240;
              return (b.width * b.height) / (vw * vh); // frazione di quadro occupata
            }
            return null; // nessun volto: non aggiorniamo la baseline
          } catch { /* fallback luminosità sotto */ }
        }
        ctx.drawImage(videoEl, 0, 0, 64, 48);
        const { data } = ctx.getImageData(0, 0, 64, 48);
        let sum = 0;
        for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
        return sum / (data.length / 4) / (3 * 255);
      };

      const loop = async () => {
        if (!running) return;
        const value = await measure();

        if (value == null) {
          // Volto non rilevato: avvisa di sistemarsi, non contare nulla.
          onLevel(0);
          if (onStatus) onStatus({ ok: false, text: '👀 Non ti vedo — inquadra testa e spalle' });
        } else {
          if (baseline == null) { baseline = value; calibFrames = 0; }
          baseline = baseline * 0.97 + value * 0.03; // adattamento lento
          calibFrames++;

          const delta = Math.abs(value - baseline) / (baseline + 0.001);
          const quality = Math.min(1, delta / (THRESH * 1.4));
          onLevel(quality);

          if (onStatus) {
            if (calibFrames < 25) onStatus({ ok: true, text: '🎯 Calibrazione… resta fermo un attimo' });
            else if (down) onStatus({ ok: true, text: 'Giù… mantieni' });
            else onStatus({ ok: true, text: faceDetector ? '✅ Ti vedo — vai col movimento' : '✅ Telecamera attiva' });
          }

          if (calibFrames >= 15) { // conta solo dopo una minima calibrazione
            if (!down && delta > THRESH) down = true;
            else if (down && delta < THRESH * 0.5) { down = false; onRep(); }
          }
        }

        // FaceDetector è asincrono e più pesante: cadenziamo a ~20fps.
        setTimeout(() => requestAnimationFrame(loop), faceDetector ? 50 : 0);
      };
      requestAnimationFrame(loop);

      return () => {
        running = false;
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
    startImpl: async ({ onRep, onLevel, onStatus }) => {
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
      if (onStatus) onStatus({ ok: true, text: '🎤 Conta a voce: uno, due, tre…' });

      const loop = () => {
        analyser.getByteFrequencyData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i];
        const level = sum / buf.length / 255; // 0..1
        noiseFloor = noiseFloor * 0.995 + level * 0.005; // rumore di fondo
        const over = level - noiseFloor;
        onLevel(Math.min(1, over / 0.25));

        const now = performance.now();
        // Picco di voce (oltre soglia, con pausa minima) = una ripetizione.
        if (!loud && over > 0.14 && now - lastRep > 500) {
          loud = true; lastRep = now;
          if (onStatus) onStatus({ ok: true, text: '🔊 …ti sento!' });
          onRep();
        } else if (loud && over < 0.06) {
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
