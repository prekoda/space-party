// Service worker: makes the app installable and lets Local Party run offline.
// Network-first for app files (so updates land immediately), cache fallback when offline.
const CACHE = 'spaceparty-v10';
const SHELL = [
  '/', '/index.html', '/style.css', '/manifest.webmanifest',
  '/js/sim.js', '/js/audio.js', '/js/input.js', '/js/render.js', '/js/net.js', '/js/editor.js', '/js/main.js',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-180.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Live game traffic never goes through the cache.
  if (url.pathname.startsWith('/socket.io/') && url.search) return;

  // Google Fonts: cache-first
  if (url.host.includes('fonts.googleapis.com') || url.host.includes('fonts.gstatic.com')) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res;
    })));
    return;
  }
  if (url.origin !== location.origin) return;

  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || (req.mode === 'navigate' ? caches.match('/') : Response.error()))));
});
