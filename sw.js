/* Offline shell & cache-first for static assets */
const CACHE_NAME = 'ch-checklist-v1';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './install.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // App-shell strategy for navigations
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const network = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put('./index.html', network.clone());
        return network;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  // Cache-first for same-origin GET requests
  if (req.method === 'GET' && new URL(req.url).origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const network = await fetch(req);
        if (network.ok) cache.put(req, network.clone());
        return network;
      } catch {
        return cached || Response.error();
      }
    })());
  }
});
