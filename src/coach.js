// Motore adattivo del coach.
//
// Idea di fondo: il coach mantiene uno "stato del piano" per ogni profilo e,
// dopo ogni sessione, lo aggiorna in base a tre segnali misurati realmente:
//   1) completion   = ripetizioni completate / pianificate
//   2) tempo_accuracy = quota di ripetizioni eseguite NEL ritmo ideale
//   3) pace_bias    = quanto in media si è stati più veloci (<0) o più lenti (>0)
//                     del ritmo ideale.  Troppo veloce = poco sforzo reale,
//                     troppo lento = troppa fatica.
//
// Da questi segnali ricalcola: ripetizioni obiettivo, numero di serie, ritmo
// ideale (fase eccentrica/pausa/concentrica), recupero, sessioni al giorno e
// una stima di "fitness" 0..1.  Restituisce anche messaggi motivazionali in
// italiano e decide quando proporre la "modalità MAX".

export const DEFAULT_PLAN = {
  fitness: 0.15,        // 0..1, stima della forma fisica
  target_reps: 5,       // ripetizioni per serie
  target_sets: 2,       // serie per sessione
  rest_ms: 60000,       // recupero tra le serie
  // Ritmo ideale di UNA ripetizione (la barra colorata segue queste fasi)
  tempo_down_ms: 2000,  // discesa (eccentrica)
  tempo_pause_ms: 500,  // pausa in basso
  tempo_up_ms: 1500,    // salita (concentrica)
  sessions_per_day: 1,
  streak: 0,            // sessioni completate consecutive
  total_sessions: 0,
  max_mode_cooldown: 0, // sessioni da attendere prima di riproporre la MAX
  level_name: 'Principiante',
};

// Tolleranza del ritmo: una ripetizione è "ideale" se la sua durata totale è
// entro ±TEMPO_TOLERANCE del totale ideale.
const TEMPO_TOLERANCE = 0.2;

export function idealRepMs(plan) {
  return plan.tempo_down_ms + plan.tempo_pause_ms + plan.tempo_up_ms;
}

// Classifica una singola ripetizione confrontando la durata reale con l'ideale.
export function scoreRep(totalMs, idealMs) {
  const lo = idealMs * (1 - TEMPO_TOLERANCE);
  const hi = idealMs * (1 + TEMPO_TOLERANCE);
  if (totalMs < lo) return 'fast';
  if (totalMs > hi) return 'slow';
  return 'ideal';
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function levelFromFitness(f) {
  if (f < 0.33) return 'Principiante';
  if (f < 0.66) return 'Intermedio';
  return 'Avanzato';
}

// Costruisce il piano della PROSSIMA sessione a partire dallo stato corrente.
// Tiene conto del tempo trascorso dall'ultima sessione (sessioni saltate).
export function nextSessionPlan(plan, { hoursSinceLast = null } = {}) {
  const p = { ...DEFAULT_PLAN, ...plan };
  let target_reps = p.target_reps;
  let target_sets = p.target_sets;
  let note = `Obiettivo: ${target_sets} serie da ${target_reps} ripetizioni, al ritmo guidato dalla barra.`;
  let detraining = false;

  // Se l'utente ha saltato a lungo, si rientra in modo più morbido per non
  // farlo desistere: meno volume questa sessione.
  if (hoursSinceLast != null) {
    if (hoursSinceLast > 24 * 5) {
      target_reps = Math.max(3, Math.round(target_reps * 0.6));
      target_sets = Math.max(1, target_sets - 1);
      detraining = true;
      note = `Bentornato! Ripartiamo con calma: ${target_sets} serie da ${target_reps}. Riprendiamo il ritmo insieme.`;
    } else if (hoursSinceLast > 24 * 2) {
      target_reps = Math.max(3, Math.round(target_reps * 0.85));
      detraining = true;
      note = `Ci sei mancato! Oggi un filo più leggero: ${target_sets} serie da ${target_reps}. Poi ricostruiamo.`;
    }
  }

  return {
    plan: p,
    target_reps,
    target_sets,
    rest_ms: p.rest_ms,
    tempo_down_ms: p.tempo_down_ms,
    tempo_pause_ms: p.tempo_pause_ms,
    tempo_up_ms: p.tempo_up_ms,
    ideal_rep_ms: idealRepMs(p),
    sessions_per_day: p.sessions_per_day,
    detraining,
    level_name: levelFromFitness(p.fitness),
    note,
  };
}

// Decide se proporre la "modalità MAX" (sforzo massimo a fine sessione con
// cambio UI motivazionale). La proponiamo quando l'utente è in forma e in
// striscia positiva, ma non troppo spesso.
export function shouldOfferMax(plan, summary) {
  if (plan.max_mode_cooldown > 0) return false;
  const strong = summary.completion >= 0.9 && summary.tempo_accuracy >= 0.6;
  const inFlow = plan.streak >= 2;
  return strong && inFlow;
}

// Aggiorna lo stato del piano DOPO una sessione completata.
// `summary` = { completion, tempo_accuracy, pace_bias, was_max }
export function adaptAfterSession(plan, summary) {
  const p = { ...DEFAULT_PLAN, ...plan };
  const messages = [];

  const completion = clamp(summary.completion ?? 0, 0, 2);
  const accuracy = clamp(summary.tempo_accuracy ?? 0, 0, 1);
  const bias = summary.pace_bias ?? 0; // <0 veloce, >0 lento

  p.total_sessions = (p.total_sessions || 0) + 1;
  p.streak = completion >= 0.8 ? (p.streak || 0) + 1 : 0;
  if (p.max_mode_cooldown > 0) p.max_mode_cooldown -= 1;

  // --- 1) Aggiornamento stima fitness -------------------------------------
  // Sessione ben completata e a ritmo => sale; incompleta/sfasata => scende.
  let delta = 0;
  if (completion >= 0.95 && accuracy >= 0.7 && Math.abs(bias) <= 0.15) {
    delta = 0.04 + (summary.was_max ? 0.03 : 0);
  } else if (completion >= 0.8 && accuracy >= 0.5) {
    delta = 0.015;
  } else if (completion < 0.6) {
    delta = -0.05;
  } else {
    delta = -0.01;
  }
  p.fitness = clamp(p.fitness + delta, 0.05, 1);

  // --- 2) Volume (ripetizioni e serie) ------------------------------------
  if (completion >= 0.95 && accuracy >= 0.6) {
    // Progressione: aumenta ~15% le ripetizioni; ogni tanto aggiunge una serie.
    p.target_reps = clamp(Math.round(p.target_reps * 1.15 + 0.5), 3, 100);
    if (p.streak >= 4 && p.target_sets < 5) {
      p.target_sets += 1;
      p.streak = 2; // ricomincia a costruire verso la prossima serie
      messages.push('Sblocco una serie in più: stai diventando una macchina! 💪');
    } else {
      messages.push(`Progressione: portiamo l'obiettivo a ${p.target_reps} ripetizioni.`);
    }
  } else if (completion < 0.6) {
    // Troppo difficile: riduci volume e aumenta recupero per non far desistere.
    p.target_reps = clamp(Math.round(p.target_reps * 0.85), 3, 100);
    p.rest_ms = clamp(p.rest_ms + 15000, 30000, 180000);
    messages.push(`Caliamo un attimo a ${p.target_reps} ripetizioni: meglio finire bene che mollare. Ci arriviamo.`);
  } else {
    messages.push('Consolidiamo: stesso obiettivo, miglioriamo la qualità del movimento.');
  }

  // --- 3) Ritmo (in base al pace_bias) ------------------------------------
  // Troppo VELOCE => poco sforzo reale: rallentiamo il ritmo ideale per
  // aumentare il tempo sotto tensione. Troppo LENTO => troppa fatica:
  // rendiamo il ritmo un filo più clemente e aumentiamo il recupero.
  if (bias < -0.18) {
    p.tempo_down_ms = clamp(p.tempo_down_ms + 250, 1500, 5000);
    p.tempo_up_ms = clamp(p.tempo_up_ms + 200, 1000, 4000);
    messages.push('Vai troppo veloce: poco sforzo vero. Rallentiamo la discesa per farti lavorare di più.');
  } else if (bias > 0.22 || completion < 0.6) {
    p.tempo_down_ms = clamp(p.tempo_down_ms - 150, 1500, 5000);
    p.tempo_up_ms = clamp(p.tempo_up_ms - 150, 1000, 4000);
    p.rest_ms = clamp(p.rest_ms + 10000, 30000, 180000);
    messages.push('Sei in affanno: alleggerisco il ritmo e allungo il recupero. Respira e controlla.');
  } else if (accuracy >= 0.75) {
    messages.push('Ritmo perfetto: sei dentro la barra come un metronomo. 🎯');
  }

  // --- 4) Frequenza (anche più volte al giorno) ----------------------------
  // Se recuperi bene e completi con margine, proponiamo una seconda sessione
  // nella stessa giornata; se fatichi, torniamo a una al giorno.
  if (p.fitness > 0.55 && completion >= 0.95 && p.streak >= 3) {
    p.sessions_per_day = clamp(p.sessions_per_day + 1, 1, 3);
    if (p.sessions_per_day >= 2) {
      messages.push(`Recuperi bene: oggi possiamo fare ${p.sessions_per_day} sessioni. Ci sentiamo più tardi!`);
    }
  } else if (completion < 0.6) {
    p.sessions_per_day = 1;
  }

  if (summary.was_max) {
    p.max_mode_cooldown = 3; // non riproporre la MAX troppo spesso
    messages.push('Hai dato il MASSIMO. Questo è il genere di sessione che cambia le cose. 🔥');
  }

  p.level_name = levelFromFitness(p.fitness);

  return { plan: p, messages };
}
