// sw.js — Cascade Hideaway Cleaning Checklist
// Service Worker  v1.1  |  2026-05-28
//
// v1.1: Added Supabase, Telegram, and calendar-sync endpoints to network-only
//       exclusion list — these were missing from v1.0 and could be intercepted.
//       Cache name bumped to ch-shell-v2 to force eviction of v1 cache.
//
// Routing strategy:
//   GAS API / Supabase / Telegram → network-only  (never cache live API calls)
//   CDN assets (fonts/icons)      → cache-first    (stale CDN bytes are fine)
//   Navigation (HTML page)        → stale-while-revalidate  (instant load + background refresh)
//   Everything else               → network-first, cache fallback

const CACHE_NAME = 'ch-shell-v4-fonts';

// App shell: cache these on install for instant offline load
const SHELL_URLS = [
    './',
    './index.html',
    './fonts/cormorant-garamond-600.woff2',
    './fonts/cormorant-garamond-700.woff2',
];

// CDN hostnames whose responses are safe to serve from cache
const CDN_HOSTS = [
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'unpkg.com',
    'cdn.jsdelivr.net',
    'cdnjs.cloudflare.com',
];

// WP4: the two Cormorant Garamond weights moved same-origin, so they no
// longer match CDN_HOSTS above and would otherwise fall through to the
// network-first branch — a revalidation round trip per font on every
// online visit, defeating the point of self-hosting them on slow 3G.
// Matched by path suffix so a GitHub Pages project subpath still works.
const STATIC_ASSET_PATHS = [
    '/fonts/cormorant-garamond-600.woff2',
    '/fonts/cormorant-garamond-700.woff2',
];

// API hostnames that must always go to the network — never cache
const NETWORK_ONLY_HOSTS = [
    'script.google.com',
    'script.googleusercontent.com',
    'supabase.co',              // v1.1: Supabase REST + Edge Functions + Storage
    'api.telegram.org',         // v1.1: Telegram Bot API
];

// ── Install: pre-cache the app shell ─────────────────────────
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(SHELL_URLS))
            .then(() => self.skipWaiting())
            .catch(err => {
                console.warn('[SW] Shell pre-cache partial failure:', err);
                self.skipWaiting();
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
            .then(() => self.clients.claim())
    );
});

// ── Fetch: route by request type ─────────────────────────────
self.addEventListener('fetch', event => {
    const { request } = event;

    // Only intercept GET requests; POST (submissions, uploads) go straight to network
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    // ── 1. Network-only: API endpoints ────────────────────────
    // Never serve cached responses for live data — a stale "success" from cache
    // would silently drop a cleaning report or return stale availability data.
    if (NETWORK_ONLY_HOSTS.some(h => url.hostname.includes(h))) {
        event.respondWith(fetch(request));
        return;
    }

    // ── 2. CDN assets — cache-first ───────────────────────────
    // Fonts and icon bundles rarely change; safe to serve from cache.
    if (CDN_HOSTS.includes(url.hostname)) {
        event.respondWith(
            caches.match(request).then(cached => {
                if (cached) return cached;
                return fetch(request).then(resp => {
                    if (resp && resp.status === 200 && resp.type !== 'opaque') {
                        caches.open(CACHE_NAME)
                            .then(cache => cache.put(request, resp.clone()))
                            .catch(() => {});
                    }
                    return resp;
                });
            })
        );
        return;
    }

    // ── 2b. Same-origin static assets — cache-first ───────────
    // Same reasoning as branch 2, now that these fonts are same-origin.
    if (STATIC_ASSET_PATHS.some(p => url.pathname.endsWith(p))) {
        event.respondWith(
            caches.match(request).then(cached => cached || fetch(request))
        );
        return;
    }

    // ── 3. Navigation — stale-while-revalidate ────────────────
    // Serve cached shell instantly; fetch fresh copy in background.
    // Cleaners always get UI immediately even on slow 3G.
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
                        .catch(() => cached);
                    return cached || networkFetch;
                })
            )
        );
        return;
    }

    // ── 4. Everything else — network-first, cache fallback ────
    event.respondWith(
        fetch(request)
            .then(resp => {
                if (resp && resp.status === 200 && url.origin === self.location.origin) {
                    caches.open(CACHE_NAME)
                        .then(cache => cache.put(request, resp.clone()))
                        .catch(() => {});
                }
                return resp;
            })
            .catch(() => caches.match(request))
    );
});
