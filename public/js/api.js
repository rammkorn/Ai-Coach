// Wrapper minimale sull'API REST con gestione del token in localStorage.
const TOKEN_KEY = 'coach_token';

export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
export function clearToken() { localStorage.removeItem(TOKEN_KEY); }

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Errore ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  listProfiles: () => request('/api/profiles', { auth: false }),
  createProfile: (p) => request('/api/profiles', { method: 'POST', body: p, auth: false }),
  login: (name, password) => request('/api/login', { method: 'POST', body: { name, password }, auth: false }),
  me: () => request('/api/me'),
  startSession: (opts) => request('/api/sessions', { method: 'POST', body: opts }),
  logRep: (id, rep) => request(`/api/sessions/${id}/rep`, { method: 'POST', body: rep }),
  finishSession: (id, reps) => request(`/api/sessions/${id}/finish`, { method: 'POST', body: { reps } }),
  pushKey: () => request('/api/push/key', { auth: false }),
  pushSubscribe: (subscription, interval_hours) =>
    request('/api/push/subscribe', { method: 'POST', body: { subscription, interval_hours } }),
  pushTest: () => request('/api/push/test', { method: 'POST' }),
};
