// Single-file database layer (SQLite). Everything — profili, sessioni, ripetizioni,
// stato del coach e iscrizioni alle notifiche — vive in un unico file `coach.db`.
import Database from 'better-sqlite3';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.COACH_DB || join(__dirname, '..', 'coach.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS profiles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE,
  pass_hash     TEXT NOT NULL,
  pass_salt     TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  -- Dati anagrafici / di partenza
  age           INTEGER,
  weight_kg     REAL,
  experience    TEXT,                 -- principiante | intermedio | avanzato
  -- Stato adattivo del coach (JSON serializzato)
  plan_state    TEXT NOT NULL DEFAULT '{}',
  last_session_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id      INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at        TEXT,
  planned_reps    INTEGER NOT NULL DEFAULT 0,
  completed_reps  INTEGER NOT NULL DEFAULT 0,
  planned_sets    INTEGER NOT NULL DEFAULT 1,
  detection       TEXT,               -- proximity | camera | mic | touch
  max_mode        INTEGER NOT NULL DEFAULT 0,
  -- Riepilogo ritmo
  ideal_rep_ms    INTEGER,
  avg_rep_ms      INTEGER,
  tempo_accuracy  REAL,               -- 0..1 quota di rip. nel ritmo ideale
  pace_bias       REAL,               -- <0 troppo veloce, >0 troppo lento
  completion      REAL,               -- completed/planned
  coach_note      TEXT
);

CREATE TABLE IF NOT EXISTS reps (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  set_index   INTEGER NOT NULL DEFAULT 1,
  rep_index   INTEGER NOT NULL,
  total_ms    INTEGER NOT NULL,
  ideal_ms    INTEGER NOT NULL,
  score       TEXT NOT NULL,          -- fast | ideal | slow
  detection   TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_profile ON sessions(profile_id);
CREATE INDEX IF NOT EXISTS idx_reps_session ON reps(session_id);

-- Coppie chiave/valore a livello app (es. chiavi VAPID stabili).
CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Iscrizioni Web Push (una per dispositivo/browser).
CREATE TABLE IF NOT EXISTS push_subs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id  INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  sub         TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_push_profile ON push_subs(profile_id);
`);

// Migrazioni leggere: aggiunge colonne ai profili esistenti se mancano.
function ensureColumn(table, column, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  }
}
ensureColumn('profiles', 'reminder_interval_h', 'REAL');
ensureColumn('profiles', 'next_reminder_at', 'TEXT');

// ---- Password helpers (scrypt, niente dipendenze esterne) -------------------
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password, hash, salt) {
  const candidate = scryptSync(password, salt, 64);
  const known = Buffer.from(hash, 'hex');
  return candidate.length === known.length && timingSafeEqual(candidate, known);
}

// ---- Profili ----------------------------------------------------------------
export function listProfiles() {
  return db
    .prepare('SELECT id, name, created_at, last_session_at FROM profiles ORDER BY name')
    .all();
}

export function getProfileByName(name) {
  return db.prepare('SELECT * FROM profiles WHERE name = ?').get(name);
}

export function getProfileById(id) {
  return db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
}

export function createProfile({ name, password, age, weight_kg, experience, plan_state }) {
  const { hash, salt } = hashPassword(password);
  const stmt = db.prepare(`
    INSERT INTO profiles (name, pass_hash, pass_salt, age, weight_kg, experience, plan_state)
    VALUES (@name, @hash, @salt, @age, @weight_kg, @experience, @plan_state)
  `);
  const info = stmt.run({
    name,
    hash,
    salt,
    age: age ?? null,
    weight_kg: weight_kg ?? null,
    experience: experience ?? null,
    plan_state: JSON.stringify(plan_state ?? {}),
  });
  return getProfileById(info.lastInsertRowid);
}

export function savePlanState(profileId, planState) {
  db.prepare('UPDATE profiles SET plan_state = ?, last_session_at = datetime(\'now\') WHERE id = ?')
    .run(JSON.stringify(planState), profileId);
}

// ---- Sessioni ---------------------------------------------------------------
export function createSession(profileId, { planned_reps, planned_sets, detection, max_mode, ideal_rep_ms }) {
  const info = db.prepare(`
    INSERT INTO sessions (profile_id, planned_reps, planned_sets, detection, max_mode, ideal_rep_ms)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(profileId, planned_reps, planned_sets, detection ?? null, max_mode ? 1 : 0, ideal_rep_ms ?? null);
  return info.lastInsertRowid;
}

export function finalizeSession(sessionId, summary) {
  db.prepare(`
    UPDATE sessions SET
      ended_at = datetime('now'),
      completed_reps = @completed_reps,
      avg_rep_ms = @avg_rep_ms,
      tempo_accuracy = @tempo_accuracy,
      pace_bias = @pace_bias,
      completion = @completion,
      coach_note = @coach_note
    WHERE id = @id
  `).run({ id: sessionId, ...summary });
}

export function addRep(sessionId, rep) {
  db.prepare(`
    INSERT INTO reps (session_id, set_index, rep_index, total_ms, ideal_ms, score, detection)
    VALUES (@session_id, @set_index, @rep_index, @total_ms, @ideal_ms, @score, @detection)
  `).run({ session_id: sessionId, ...rep });
}

export function getSession(sessionId) {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
}

export function recentSessions(profileId, limit = 30) {
  return db.prepare(`
    SELECT * FROM sessions
    WHERE profile_id = ? AND ended_at IS NOT NULL
    ORDER BY started_at DESC LIMIT ?
  `).all(profileId, limit);
}

export function profileStats(profileId) {
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS sessions,
      COALESCE(SUM(completed_reps), 0) AS total_reps,
      COALESCE(AVG(tempo_accuracy), 0) AS avg_accuracy,
      COALESCE(AVG(completion), 0) AS avg_completion
    FROM sessions WHERE profile_id = ? AND ended_at IS NOT NULL
  `).get(profileId);
  const best = db.prepare(`
    SELECT MAX(completed_reps) AS best_reps FROM sessions WHERE profile_id = ?
  `).get(profileId);
  return { ...totals, best_reps: best.best_reps || 0 };
}

// ---- App meta (chiave/valore) ----------------------------------------------
export function getMeta(key) {
  const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key);
  return row ? row.value : null;
}
export function setMeta(key, value) {
  db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

// ---- Iscrizioni push e promemoria ------------------------------------------
export function savePushSub(profileId, subscription, intervalHours) {
  db.prepare(`
    INSERT INTO push_subs (profile_id, endpoint, sub) VALUES (?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET profile_id = excluded.profile_id, sub = excluded.sub
  `).run(profileId, subscription.endpoint, JSON.stringify(subscription));
  const next = new Date(Date.now() + intervalHours * 3600000).toISOString();
  db.prepare('UPDATE profiles SET reminder_interval_h = ?, next_reminder_at = ? WHERE id = ?')
    .run(intervalHours, next, profileId);
}

export function clearReminder(profileId) {
  db.prepare('UPDATE profiles SET next_reminder_at = NULL WHERE id = ?').run(profileId);
}

export function subsForProfile(profileId) {
  return db.prepare('SELECT * FROM push_subs WHERE profile_id = ?').all(profileId)
    .map((r) => ({ ...r, sub: JSON.parse(r.sub) }));
}

export function deleteSub(endpoint) {
  db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(endpoint);
}

// Profili con un promemoria scaduto (per lo scheduler).
export function dueReminders(nowIso) {
  return db.prepare(`
    SELECT p.id, p.name, p.reminder_interval_h, p.last_session_at
    FROM profiles p
    WHERE p.next_reminder_at IS NOT NULL AND p.next_reminder_at <= ?
  `).all(nowIso);
}

export function rescheduleReminder(profileId, intervalHours) {
  const next = new Date(Date.now() + (intervalHours || 8) * 3600000).toISOString();
  db.prepare('UPDATE profiles SET next_reminder_at = ? WHERE id = ?').run(next, profileId);
}

// Serie storica per i grafici dei progressi (ordine cronologico crescente).
export function progressSeries(profileId, limit = 30) {
  return db.prepare(`
    SELECT started_at, completed_reps, planned_reps, tempo_accuracy, max_mode
    FROM sessions WHERE profile_id = ? AND ended_at IS NOT NULL
    ORDER BY started_at ASC LIMIT ?
  `).all(profileId, limit);
}

export default db;
