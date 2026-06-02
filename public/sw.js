// Service worker minimale: abilita le notifiche e una cache di base per l'uso
// offline dell'interfaccia.
const CACHE = 'coach-v2';
const ASSETS = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/app.js',
  '/js/api.js',
  '/js/workout.js',
  '/js/detection.js',
  '/js/audio.js',
  '/js/chart.js',
  '/manifest.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Le chiamate API vanno sempre alla rete (dati sempre freschi).
  if (url.pathname.startsWith('/api/')) return;
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request).catch(() => cached))
  );
});

// Notifica push in arrivo dal server (promemoria allenamento).
self.addEventListener('push', (e) => {
  let data = { title: 'AI Coach Flessioni', body: 'È ora di allenarsi! 💪', url: '/' };
  try { if (e.data) data = { ...data, ...e.data.json() }; } catch { /* payload testuale */ }
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/icon.svg',
    badge: '/icon.svg',
    vibrate: [80, 40, 80],
    data: { url: data.url || '/' },
    tag: 'coach-reminder',
    renotify: true,
  }));
});

// Tap sulla notifica: porta in primo piano l'app.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(clients.matchAll({ type: 'window' }).then((list) => {
    for (const c of list) if ('focus' in c) return c.focus();
    if (clients.openWindow) return clients.openWindow(url);
  }));
});
