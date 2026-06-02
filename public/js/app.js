// Controller principale della SPA: routing tra le schermate, autenticazione,
// dashboard, avvio dell'allenamento e overlay dei risultati / modalità MAX.
import { api, getToken, setToken, clearToken } from './api.js';
import { Workout } from './workout.js';

const $ = (id) => document.getElementById(id);
const screens = {
  auth: $('screen-auth'),
  dash: $('screen-dash'),
  workout: $('screen-workout'),
};

let state = { dashboard: null, selectedName: null, currentWorkout: null };

function show(name) {
  Object.values(screens).forEach((s) => s.classList.remove('active'));
  screens[name].classList.add('active');
  window.scrollTo(0, 0);
}

// ---------- Schermata 1: autenticazione --------------------------------------
async function renderProfiles() {
  const ul = $('profiles');
  ul.innerHTML = '<li class="muted">Caricamento…</li>';
  try {
    const profiles = await api.listProfiles();
    if (!profiles.length) {
      ul.innerHTML = '<li class="muted">Nessun profilo. Creane uno!</li>';
      return;
    }
    ul.innerHTML = '';
    for (const p of profiles) {
      const li = document.createElement('li');
      const last = p.last_session_at ? `Ultimo: ${fmtDate(p.last_session_at)}` : 'Mai allenato';
      li.innerHTML = `<span class="pname">${escapeHtml(p.name)}</span><span class="pmeta">${last}</span>`;
      li.addEventListener('click', () => openLogin(p.name));
      ul.appendChild(li);
    }
  } catch {
    ul.innerHTML = '<li class="error">Impossibile caricare i profili</li>';
  }
}

function openLogin(name) {
  state.selectedName = name;
  $('login-name').textContent = name;
  $('login-pass').value = '';
  $('login-error').textContent = '';
  $('auth-list').classList.add('hidden');
  $('auth-create').classList.add('hidden');
  $('auth-login').classList.remove('hidden');
  $('login-pass').focus();
}

function backToAuthList() {
  $('auth-login').classList.add('hidden');
  $('auth-create').classList.add('hidden');
  $('auth-list').classList.remove('hidden');
  renderProfiles();
}

async function doLogin() {
  const pass = $('login-pass').value;
  $('login-error').textContent = '';
  try {
    const data = await api.login(state.selectedName, pass);
    setToken(data.token);
    enterDashboard(data);
  } catch (e) {
    $('login-error').textContent = e.message;
  }
}

async function doCreate() {
  const name = $('new-name').value.trim();
  const password = $('new-pass').value;
  $('create-error').textContent = '';
  if (!name || !password) { $('create-error').textContent = 'Nome e password obbligatori'; return; }
  try {
    const data = await api.createProfile({
      name, password,
      age: numOrNull($('new-age').value),
      weight_kg: numOrNull($('new-weight').value),
      experience: $('new-exp').value,
    });
    setToken(data.token);
    enterDashboard(data);
  } catch (e) {
    $('create-error').textContent = e.message;
  }
}

// ---------- Schermata 2: dashboard -------------------------------------------
function enterDashboard(data) {
  state.dashboard = data;
  document.body.classList.remove('max-mode');
  $('dash-name').textContent = data.profile.name;
  $('dash-level').textContent = data.next.level_name || data.plan.level_name || 'Principiante';

  const s = data.stats;
  $('stat-sessions').textContent = s.sessions;
  $('stat-reps').textContent = s.total_reps;
  $('stat-best').textContent = s.best_reps;
  $('stat-accuracy').textContent = Math.round((s.avg_accuracy || 0) * 100) + '%';

  // Banner del coach
  const banner = $('coach-banner');
  const n = data.next;
  let msg = n.note || '';
  if (n.sessions_per_day > 1) msg += ` Oggi puoi fare fino a ${n.sessions_per_day} sessioni.`;
  banner.textContent = msg;

  // Piano
  $('plan-summary').textContent = `${n.target_sets} serie × ${n.target_reps} ripetizioni — recupero ${Math.round(n.rest_ms / 1000)}s tra le serie.`;
  $('plan-tempo').textContent = `${(n.tempo_down_ms / 1000).toFixed(1)}s giù · ${(n.tempo_pause_ms / 1000).toFixed(1)}s pausa · ${(n.tempo_up_ms / 1000).toFixed(1)}s su`;

  renderHistory(data.history);
  show('dash');
}

function renderHistory(history) {
  const ul = $('history');
  ul.innerHTML = '';
  if (!history.length) { ul.innerHTML = '<li class="muted">Ancora nessuna sessione.</li>'; return; }
  for (const h of history) {
    const li = document.createElement('li');
    const acc = Math.round((h.tempo_accuracy || 0) * 100);
    let tag = '<span class="h-tag tag-warn">da rivedere</span>';
    if (h.max_mode) tag = '<span class="h-tag tag-max">MAX</span>';
    else if (acc >= 60) tag = '<span class="h-tag tag-good">ritmo ok</span>';
    li.innerHTML = `<span class="h-date">${fmtDate(h.started_at)}</span>
      <span class="h-reps">${h.completed_reps}/${h.planned_reps}</span> ${tag}`;
    ul.appendChild(li);
  }
}

async function refreshDashboard() {
  try { enterDashboard(await api.me()); } catch { logout(); }
}

function logout() {
  clearToken();
  state.dashboard = null;
  document.body.classList.remove('max-mode');
  backToAuthList();
  show('auth');
}

// ---------- Scelta del metodo di rilevamento ---------------------------------
function chooseDetection() {
  return new Promise((resolve) => {
    const options = [
      { key: 'auto', label: '✨ Automatico (consigliato)', desc: 'Sceglie il sensore migliore disponibile' },
      { key: 'camera', label: '📷 Telecamera frontale', desc: 'Rileva il volto che sale e scende' },
      { key: 'mic', label: '🎤 Microfono', desc: 'Conta i piegamenti a VOCE ad alta voce' },
      { key: 'proximity', label: '📱 Sensore di prossimità', desc: 'Telefono a terra, avvicina il petto' },
      { key: 'touch', label: '👃 Solo naso (touch)', desc: 'Premi il pulsante col naso' },
    ];
    const actions = options.map((o) =>
      `<button class="btn ghost" data-det="${o.key}" style="text-align:left">
        <strong>${o.label}</strong><br><span class="muted small">${o.desc}</span>
      </button>`).join('');
    openOverlay('Come conto le ripetizioni?',
      '<p class="muted">Il pulsante naso resta sempre attivo come riserva.</p>',
      actions);
    $('ov-actions').querySelectorAll('[data-det]').forEach((b) => {
      b.addEventListener('click', () => { closeOverlay(); resolve(b.dataset.det); });
    });
  });
}

// ---------- Schermata 3: allenamento -----------------------------------------
async function startWorkout(maxMode = false) {
  const detPref = await chooseDetection();
  let session;
  try {
    session = await api.startSession({ max_mode: maxMode, detection: detPref });
  } catch (e) {
    alert('Impossibile avviare: ' + e.message);
    return;
  }

  document.body.classList.toggle('max-mode', maxMode);
  $('nose-count').textContent = '0';
  $('motion-fill').style.width = '0%';
  $('tempo-bar').style.width = '0%';
  $('phase-label').textContent = maxMode ? 'DAI IL MASSIMO!' : 'Preparati…';
  show('workout');

  const els = {
    tempoBar: $('tempo-bar'), phaseLabel: $('phase-label'),
    setLabel: $('set-label'), repLabel: $('rep-label'),
    noseBtn: $('nose-btn'), noseCount: $('nose-count'),
    motionFill: $('motion-fill'), motionText: $('motion-text'),
    detectBadge: $('detect-badge'), restSkip: $('btn-rest-skip'),
    videoEl: $('cam'), canvasEl: $('cam-canvas'),
  };

  const workout = new Workout(els, {
    sessionId: session.session_id,
    plan: session.plan,
    maxMode,
    onFinish: (result, ctx) => onWorkoutFinish(result, ctx),
  });
  state.currentWorkout = workout;
  await workout.start(detPref === 'auto' ? null : detPref);
}

function quitWorkout() {
  if (state.currentWorkout) { state.currentWorkout.finish(); }
}

// ---------- Overlay risultati / MAX ------------------------------------------
function onWorkoutFinish(result, ctx) {
  document.body.classList.remove('max-mode');
  if (!result || result.error) {
    openOverlay('Sessione salvata', '<p class="muted">Connessione assente, ma i tuoi sforzi contano comunque!</p>',
      '<button class="btn primary" id="ov-close">Torna alla dashboard</button>');
    $('ov-close').addEventListener('click', () => { closeOverlay(); refreshDashboard(); });
    return;
  }

  const sm = result.summary;
  const stats = `
    <div class="ov-stat"><span>Ripetizioni</span><strong>${sm.completed} / ${sm.planned}</strong></div>
    <div class="ov-stat"><span>Ritmo corretto</span><strong>${Math.round(sm.tempo_accuracy * 100)}%</strong></div>
    <div class="ov-stat"><span>Cadenza media</span><strong>${(sm.avg_rep_ms / 1000).toFixed(1)}s (ideale ${(sm.ideal_rep_ms / 1000).toFixed(1)}s)</strong></div>
    <div class="ov-stat"><span>Livello</span><strong>${result.level_name}</strong></div>`;
  const msgs = (result.messages || []).map((m) => `<div class="ov-msg">${escapeHtml(m)}</div>`).join('');

  if (result.offer_max) {
    // Proposta modalità MAX a fine sessione, con UI motivazionale.
    openOverlay('Sei in forma oggi 🔥',
      `${stats}${msgs}<p><strong>Ti senti di chiudere col MASSIMO?</strong> Una serie fino al cedimento.</p>`,
      `<button class="btn primary big" id="ov-max">💥 SÌ, DO IL MASSIMO</button>
       <button class="btn ghost" id="ov-skip">No, ho finito</button>`);
    $('ov-max').addEventListener('click', () => { closeOverlay(); startWorkout(true); });
    $('ov-skip').addEventListener('click', () => { closeOverlay(); refreshDashboard(); });
  } else {
    const title = ctx.maxMode ? '💥 MAX completato!' : 'Sessione completata 💪';
    const flag = ctx.maxMode ? '<div class="max-flag">MODALITÀ MAX</div>' : '';
    openOverlay(title, `${flag}${stats}${msgs}`,
      '<button class="btn primary" id="ov-close">Torna alla dashboard</button>');
    $('ov-close').addEventListener('click', () => { closeOverlay(); refreshDashboard(); });
  }
}

function openOverlay(title, body, actions) {
  $('ov-title').innerHTML = title;
  $('ov-body').innerHTML = body;
  $('ov-actions').innerHTML = actions;
  $('overlay').classList.remove('hidden');
}
function closeOverlay() { $('overlay').classList.add('hidden'); }

// ---------- Notifiche / promemoria -------------------------------------------
async function setupNotifications() {
  if (!('Notification' in window)) { alert('Le notifiche non sono supportate su questo dispositivo.'); return; }
  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();
  if (perm !== 'granted') { alert('Permesso notifiche negato.'); return; }

  // Promemoria locale: in base alle sessioni/giorno consigliate, ricorda di
  // riprendere. (Per notifiche push reali servirebbe un server di push.)
  const perDay = (state.dashboard && state.dashboard.next.sessions_per_day) || 1;
  const hours = Math.max(3, Math.round(24 / (perDay + 1)));
  alert(`Promemoria attivato! Ti ricorderò di allenarti tra circa ${hours} ore.`);
  const delay = hours * 3600 * 1000;
  setTimeout(() => {
    const reg = navigator.serviceWorker && navigator.serviceWorker.ready;
    const text = 'È ora di allenarsi! Le tue flessioni ti aspettano. 💪';
    if (reg) reg.then((r) => r.showNotification('AI Coach Flessioni', { body: text, icon: '/icon.png' }));
    else new Notification('AI Coach Flessioni', { body: text });
  }, delay);
}

// ---------- Util -------------------------------------------------------------
function fmtDate(iso) {
  const d = new Date(iso.includes('T') ? iso : iso + 'Z');
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function numOrNull(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : null; }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ---------- Wiring ------------------------------------------------------------
function wire() {
  $('btn-show-create').addEventListener('click', () => {
    $('auth-list').classList.add('hidden');
    $('auth-login').classList.add('hidden');
    $('auth-create').classList.remove('hidden');
    $('new-name').focus();
  });
  document.querySelectorAll('[data-back="auth"]').forEach((b) => b.addEventListener('click', backToAuthList));
  $('btn-login').addEventListener('click', doLogin);
  $('login-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  $('btn-create').addEventListener('click', doCreate);

  $('btn-logout').addEventListener('click', logout);
  $('btn-start').addEventListener('click', () => startWorkout(false));
  $('btn-notify').addEventListener('click', setupNotifications);

  $('btn-quit').addEventListener('click', quitWorkout);
  $('btn-finish').addEventListener('click', quitWorkout);
}

async function init() {
  wire();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  // Sessione già attiva? Vai diretto alla dashboard.
  if (getToken()) {
    try { enterDashboard(await api.me()); return; } catch { clearToken(); }
  }
  await renderProfiles();
  show('auth');
}

init();
