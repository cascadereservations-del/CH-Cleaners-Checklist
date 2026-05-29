// sw.js — Cascade Hideaway Cleaning Checklist
// Service Worker  v1.0  |  2026-04-15
//
// Routing strategy:
//   GAS API (script.google.com)  → network-only  (never cache live submission data)
//   CDN assets (fonts/icons)     → cache-first    (stale CDN bytes are fine)
//   Navigation (HTML page)       → stale-while-revalidate  (instant load + background refresh)
//   Everything else              → network-first, cache fallback

const CACHE_NAME = 'ch-shell-v1';

// App shell: cache these on install for instant offline load
const SHELL_URLS = [
    './',          // root → index.html
    './index.html',
    './install.js'
];

// CDN hostnames whose responses are safe to serve from cache
const CDN_HOSTS = [
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'unpkg.com',
    'cdn.jsdelivr.net',
    'cdnjs.cloudflare.com',
];

// ── Install: pre-cache the app shell ─────────────────────────
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(SHELL_URLS))
            // skipWaiting: activate the new SW immediately on first install
            // rather than waiting for existing tabs to close
            .then(() => self.skipWaiting())
            .catch(err => {
                // Shell caching is best-effort; a missing install.js (optional file)
                // should not block the SW from activating
                console.warn('[SW] Shell pre-cache partial failure:', err);
            })
    );
});

// ── Activate: evict stale caches from previous SW versions ───
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys
                    .filter(k => k !== CACHE_NAME)
                    .map(k => {
                        console.log('[SW] Evicting old cache:', k);
                        return caches.delete(k);
                    })
            ))
            // clients.claim: take control of all open tabs without requiring a reload
            .then(() => self.clients.claim())
    );
});

// ── Fetch: route by request type ─────────────────────────────
self.addEventListener('fetch', event => {
    const { request } = event;

    // Only intercept GET requests; let POST (GAS submissions) go straight to network
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    // ── 1. GAS API — always network-only ──────────────────────
    // Never serve a cached response to a submission or lastReadings call.
    // A stale "success" from the cache would silently drop a cleaning report.
    if (url.hostname === 'script.google.com' || url.hostname === 'script.googleusercontent.com') {
        event.respondWith(fetch(request));
        return;
    }

    // ── 2. CDN assets — cache-first ───────────────────────────
    // Fonts and icon bundles rarely change and are safe to serve from cache.
    // On a cache miss, fetch from network and store for next time.
    if (CDN_HOSTS.includes(url.hostname)) {
        event.respondWith(
            caches.match(request).then(cached => {
                if (cached) return cached;
                return fetch(request).then(resp => {
                    // Only cache successful, non-opaque (same-origin or CORS) responses
                    if (resp && resp.status === 200 && resp.type !== 'opaque') {
                        caches.open(CACHE_NAME)
                            .then(cache => cache.put(request, resp.clone()))
                            .catch(() => {}); // storage failure is non-fatal
                    }
                    return resp;
                });
            })
        );
        return;
    }

    // ── 3. Navigation — stale-while-revalidate ────────────────
    // Serve the cached shell instantly so the app feels instant on revisit,
    // while simultaneously fetching a fresh copy in the background.
    // This means cleaners always get the UI immediately even on slow 4G.
    if (request.mode === 'navigate') {
        event.respondWith(
            caches.open(CACHE_NAME).then(cache =>
                cache.match(request).then(cached => {
                    const networkFetch = fetch(request)
                        .then(resp => {
                            if (resp && resp.status === 200) {
                                cache.put(request, resp.clone()).catch(() => {});
                            }
                            return resp;
                        })
                        .catch(() => cached); // network gone? fall back to stale shell

                    // Return stale immediately if available, otherwise wait for network
                    return cached || networkFetch;
                })
            )
        );
        return;
    }

    // ── 4. Everything else — network-first, cache fallback ────
    // Covers same-origin images, manifests, etc.
    event.respondWith(
        fetch(request)
            .then(resp => {
                // Opportunistically cache successful same-origin responses
                if (resp && resp.status === 200 && url.origin === self.location.origin) {
                    caches.open(CACHE_NAME)
                        .then(cache => cache.put(request, resp.clone()))
                        .catch(() => {});
                }
                return resp;
            })
            .catch(() => caches.match(request)) // offline fallback
    );
});
