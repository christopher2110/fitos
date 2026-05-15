// sw.js — FitOS offline shell
// Caches all PWA screens + Chart.js for offline-first load on second visit

const CACHE = 'fitos-v2';
const OFFLINE_SHELL = [
  '/workouts',
  '/checkin',
  '/history',
  '/messages',
  '/manifest.json',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js',
  'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600&display=swap',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(OFFLINE_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

const CDN_ORIGINS = [
  'https://cdn.jsdelivr.net',
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
];

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const isSameOrigin = url.origin === location.origin;
  const isCDN        = CDN_ORIGINS.includes(url.origin);

  if (e.request.method !== 'GET' || (!isSameOrigin && !isCDN)) return;

  // Network-first for API calls (same-origin only)
  if (isSameOrigin && url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request).catch(() => new Response(JSON.stringify({ error: 'offline' }), {
        headers: { 'Content-Type': 'application/json' }
      }))
    );
    return;
  }

  // Cache-first for shell pages + CDN assets
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request, { mode: isCDN ? 'cors' : 'same-origin' }).then(res => {
        // Cache CDN assets and shell pages
        const inShell = OFFLINE_SHELL.includes(url.pathname) ||
                        OFFLINE_SHELL.includes(e.request.url);
        if (res.ok && inShell) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
