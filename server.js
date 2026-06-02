// Server Express: serve la web app (PWA) e l'API REST.
// Tutto lo stato persiste nell'unico file SQLite gestito da src/db.js.
import express from 'express';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as store from './src/db.js';
import { verifyPassword } from './src/db.js';
import { initPush, getPublicKey, startScheduler, sendToProfile } from './src/push.js';
import {
  DEFAULT_PLAN,
  nextSessionPlan,
  adaptAfterSession,
  shouldOfferMax,
  scoreRep,
  idealRepMs,
} from './src/coach.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// --- Sessioni di autenticazione in memoria (token -> profileId) -------------
// Semplici e sufficienti per un'app personale; i token scadono col riavvio.
const tokens = new Map();
function issueToken(profileId) {
  const token = randomBytes(24).toString('hex');
  tokens.set(token, profileId);
  return token;
}
function auth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '');
  const profileId = tokens.get(token);
  if (!profileId) return res.status(401).json({ error: 'Non autenticato' });
  req.profileId = profileId;
  next();
}

function hoursSince(iso) {
  if (!iso) return null;
  return (Date.now() - new Date(iso + 'Z').getTime()) / 3600000;
}

function buildDashboard(profile) {
  const plan = { ...DEFAULT_PLAN, ...JSON.parse(profile.plan_state || '{}') };
  const next = nextSessionPlan(plan, { hoursSinceLast: hoursSince(profile.last_session_at) });
  return {
    profile: { id: profile.id, name: profile.name, experience: profile.experience },
    stats: store.profileStats(profile.id),
    history: store.recentSessions(profile.id, 20).map((s) => ({
      id: s.id,
      started_at: s.started_at,
      completed_reps: s.completed_reps,
      planned_reps: s.planned_reps,
      tempo_accuracy: s.tempo_accuracy,
      pace_bias: s.pace_bias,
      max_mode: s.max_mode,
      coach_note: s.coach_note,
    })),
    plan,
    next,
    progress: store.progressSeries(profile.id, 30),
  };
}

// --- Profili -----------------------------------------------------------------
app.get('/api/profiles', (req, res) => {
  res.json(store.listProfiles());
});

app.post('/api/profiles', (req, res) => {
  const { name, password, age, weight_kg, experience } = req.body || {};
  if (!name || !password) return res.status(400).json({ error: 'Nome e password obbligatori' });
  if (store.getProfileByName(name)) return res.status(409).json({ error: 'Profilo già esistente' });

  // Piano iniziale calibrato sull'esperienza dichiarata.
  const plan = { ...DEFAULT_PLAN };
  if (experience === 'intermedio') { plan.fitness = 0.4; plan.target_reps = 10; plan.target_sets = 3; }
  if (experience === 'avanzato') { plan.fitness = 0.7; plan.target_reps = 18; plan.target_sets = 4; }

  const profile = store.createProfile({ name, password, age, weight_kg, experience, plan_state: plan });
  const token = issueToken(profile.id);
  res.status(201).json({ token, ...buildDashboard(profile) });
});

app.post('/api/login', (req, res) => {
  const { name, password } = req.body || {};
  const profile = store.getProfileByName(name);
  if (!profile || !verifyPassword(password || '', profile.pass_hash, profile.pass_salt)) {
    return res.status(401).json({ error: 'Nome o password errati' });
  }
  const token = issueToken(profile.id);
  res.json({ token, ...buildDashboard(profile) });
});

app.get('/api/me', auth, (req, res) => {
  res.json(buildDashboard(store.getProfileById(req.profileId)));
});

// --- Sessioni di allenamento -------------------------------------------------
app.post('/api/sessions', auth, (req, res) => {
  const profile = store.getProfileById(req.profileId);
  const plan = { ...DEFAULT_PLAN, ...JSON.parse(profile.plan_state || '{}') };
  const max_mode = !!(req.body && req.body.max_mode);
  const detection = req.body && req.body.detection;
  const next = nextSessionPlan(plan, { hoursSinceLast: hoursSince(profile.last_session_at) });

  // In modalità MAX si punta al massimo sforzo: AMRAP su una serie.
  const planned_reps = max_mode
    ? Math.max(next.target_reps + 5, Math.round(next.target_reps * 1.6))
    : next.target_reps * next.target_sets;
  const planned_sets = max_mode ? 1 : next.target_sets;

  const sessionId = store.createSession(profile.id, {
    planned_reps,
    planned_sets,
    detection,
    max_mode,
    ideal_rep_ms: idealRepMs(plan),
  });

  res.status(201).json({
    session_id: sessionId,
    max_mode,
    plan: {
      target_reps: next.target_reps,
      target_sets: planned_sets,
      planned_reps,
      rest_ms: next.rest_ms,
      tempo_down_ms: next.tempo_down_ms,
      tempo_pause_ms: next.tempo_pause_ms,
      tempo_up_ms: next.tempo_up_ms,
      ideal_rep_ms: next.ideal_rep_ms,
      level_name: next.level_name,
    },
    note: max_mode ? 'MODALITÀ MAX: dai tutto quello che hai. Fino al cedimento!' : next.note,
  });
});

// Registra una singola ripetizione (con la durata reale misurata dal client).
app.post('/api/sessions/:id/rep', auth, (req, res) => {
  const sessionId = Number(req.params.id);
  const session = store.getSession(sessionId);
  if (!session || session.profile_id !== req.profileId) {
    return res.status(404).json({ error: 'Sessione non trovata' });
  }
  const { set_index = 1, rep_index, total_ms, detection } = req.body || {};
  const ideal_ms = session.ideal_rep_ms || 4000;
  const score = scoreRep(total_ms, ideal_ms);
  store.addRep(sessionId, { set_index, rep_index, total_ms, ideal_ms, score, detection });
  res.json({ score, ideal_ms });
});

// Conclude la sessione: calcola i riepiloghi, fa evolvere il piano e restituisce
// il feedback del coach + l'eventuale proposta di modalità MAX.
app.post('/api/sessions/:id/finish', auth, (req, res) => {
  const sessionId = Number(req.params.id);
  const session = store.getSession(sessionId);
  if (!session || session.profile_id !== req.profileId) {
    return res.status(404).json({ error: 'Sessione non trovata' });
  }
  const reps = (req.body && req.body.reps) || []; // [{total_ms, score}]
  const completed = reps.length;
  const ideal = session.ideal_rep_ms || 4000;

  const avg = completed ? Math.round(reps.reduce((a, r) => a + r.total_ms, 0) / completed) : 0;
  const idealCount = reps.filter((r) => (r.score || scoreRep(r.total_ms, ideal)) === 'ideal').length;
  const tempo_accuracy = completed ? idealCount / completed : 0;
  // pace_bias medio: media degli scarti relativi rispetto all'ideale.
  const pace_bias = completed
    ? reps.reduce((a, r) => a + (r.total_ms - ideal) / ideal, 0) / completed
    : 0;
  const completion = session.planned_reps ? completed / session.planned_reps : 0;

  const profile = store.getProfileById(req.profileId);
  const plan = { ...DEFAULT_PLAN, ...JSON.parse(profile.plan_state || '{}') };
  const summary = { completion, tempo_accuracy, pace_bias, was_max: !!session.max_mode };
  const { plan: newPlan, messages } = adaptAfterSession(plan, summary);

  store.finalizeSession(sessionId, {
    completed_reps: completed,
    avg_rep_ms: avg,
    tempo_accuracy,
    pace_bias,
    completion,
    coach_note: messages.join(' '),
  });
  store.savePlanState(profile.id, newPlan);

  // Se i promemoria sono attivi, adatta il prossimo nudge alla frequenza
  // consigliata: più sessioni al giorno => promemoria più ravvicinati.
  if (profile.reminder_interval_h) {
    const adaptiveHours = Math.max(3, Math.round(24 / (newPlan.sessions_per_day + 1)));
    store.rescheduleReminder(profile.id, adaptiveHours);
  }

  const offerMax = !session.max_mode && shouldOfferMax(newPlan, summary);

  res.json({
    summary: {
      completed,
      planned: session.planned_reps,
      completion,
      tempo_accuracy,
      pace_bias,
      avg_rep_ms: avg,
      ideal_rep_ms: ideal,
    },
    messages,
    level_name: newPlan.level_name,
    fitness: newPlan.fitness,
    offer_max: offerMax,
    sessions_per_day: newPlan.sessions_per_day,
  });
});

// --- Web Push / promemoria ---------------------------------------------------
app.get('/api/push/key', (req, res) => {
  res.json({ publicKey: getPublicKey() });
});

app.post('/api/push/subscribe', auth, (req, res) => {
  const { subscription, interval_hours } = req.body || {};
  if (!subscription || !subscription.endpoint) return res.status(400).json({ error: 'Iscrizione non valida' });
  const hours = Math.max(1, Math.min(48, Number(interval_hours) || 8));
  store.savePushSub(req.profileId, subscription, hours);
  res.json({ ok: true, interval_hours: hours });
});

app.post('/api/push/test', auth, async (req, res) => {
  await sendToProfile(req.profileId, { title: 'AI Coach Flessioni', body: 'Notifiche attive! Ti ricorderò di allenarti. 💪', url: '/' });
  res.json({ ok: true });
});

app.post('/api/push/unsubscribe', auth, (req, res) => {
  store.clearReminder(req.profileId);
  res.json({ ok: true });
});

initPush();
startScheduler();

app.listen(PORT, () => {
  console.log(`AI Coach Flessioni in ascolto su http://localhost:${PORT}`);
});
