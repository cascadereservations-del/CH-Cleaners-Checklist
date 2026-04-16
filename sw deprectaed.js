/* PWA SW with auto asset discovery */
const CACHE_NAME = 'ch-checklist-v3'; // bump to refresh
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './install.js'
];

async function discoverAndCache(cache) {
  try {
    const res = await fetch('./index.html', { cache: 'no-cache' });
    const html = await res.text();
    const urls = new Set();

    const add = (u) => {
      try {
        const url = new URL(u, self.registration.scope).href;
        if (new URL(url).origin === self.location.origin) urls.add(url);
      } catch (_) {}
    };

    const linkRe = /<link[^>]+(?:rel=["'](?:stylesheet|preload)["'][^>]*href=["']([^"']+)["'])/gi;
    const scriptRe = /<script[^>]+src=["']([^"']+)["']/gi;
    const imgRe = /<img[^>]+src=["']([^"']+)["']/gi;

    let m;
    while ((m = linkRe.exec(html))) add(m[1]);
    while ((m = scriptRe.exec(html))) add(m[1]);
    while ((m = imgRe.exec(html))) add(m[1]);

    // Icons & images commonly used by PWAs
    ['icons/icon-192.png','icons/icon-512.png','icons/icon-512-maskable.png','icons/apple-touch-icon-180.png'].forEach(add);

    if (urls.size) await cache.addAll(Array.from(urls));
  } catch (e) {
    // ignore parse/fetch errors
  }
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_ASSETS);
    await discoverAndCache(cache);
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // App-shell for navigations
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put('./index.html', net.clone());
        return net;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  // Same-origin GET: stale-while-revalidate
  if (req.method === 'GET' && new URL(req.url).origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      const fetchPromise = fetch(req).then(res => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      return cached || fetchPromise || Response.error();
    })());
  }
});
