// ═══ iCU Calc — Service Worker (v24, cache-first + silent revalidate) ═══
// Strategy: cache-first for instant, always-works opens. Every request
// (navigation, app-shell, cross-origin) is answered from cache immediately
// if a cached copy exists — no waiting on the network, and it works with
// zero connectivity. In parallel, a network fetch runs in the background to
// refresh the cache for the *next* open. If that background fetch fails
// (offline, flaky signal), it's swallowed silently — the page already got
// its response from cache, so nothing errors or crashes.
// Only on the very first install, before anything is cached, does a
// request wait on the network (there is nothing else to serve yet).
// Every activation nukes ANY cache that isn't the current version — no
// accumulation of old app-shell caches ever.
const VERSION = 'v27';
const CACHE_NAME = 'icu-calc-' + VERSION;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-72x72.png',
  './icon-96x96.png',
  './icon-128x128.png',
  './icon-144x144.png',
  './icon-152x152.png',
  './icon-192x192.png',
  './icon-384x384.png',
  './icon-512x512.png'
];

self.addEventListener('install', (event) => {
  // Take over immediately, don't wait for old tabs to close.
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Aggressively wipe every cache that isn't this exact version —
      // including caches from any earlier naming scheme.
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => {
        if (key !== CACHE_NAME) return caches.delete(key);
      }));
      // clients.claim() alone is enough for this new worker to start
      // controlling already-open pages (their next fetch/navigation
      // routes through it) — no explicit reload needed.
      await self.clients.claim();
    })()
  );
});

// Let the page force an update check / immediate activation on demand.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isNav = req.mode === 'navigate';

  // Same-origin (navigations, HTML, manifest, icons, and all the app's own
  // assets): cache-first, then silently refresh the cache in the
  // background for next time.
  if (isNav || isSameOrigin) {
    const cacheKey = isNav ? './index.html' : req;
    event.respondWith(
      (async () => {
        const cached = await caches.match(cacheKey);

        const revalidate = fetch(req, { cache: 'no-store' })
          .then((res) => {
            if (res && res.status === 200) {
              const copy = res.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, copy));
            }
            return res;
          })
          .catch(() => null); // offline / network error — never surfaced to the page

        if (cached) {
          // Instant response now; update happens quietly behind it.
          event.waitUntil(revalidate);
          return cached;
        }

        // Nothing cached yet (first install, or this exact asset was never
        // cached) — this request has to wait on the network.
        const fresh = await revalidate;
        if (fresh) return fresh;
        // No cache AND no network: nothing we can do, but still respond
        // instead of leaving the request to fail as an unhandled error.
        return new Response(
          'iCU Calc is offline and this page has not been cached yet. Please connect to the internet once to finish installing.',
          { status: 503, headers: { 'Content-Type': 'text/plain' } }
        );
      })()
    );
    return;
  }

  // Cross-origin (e.g. fonts/CDN): same cache-first + background-refresh
  // approach. Only cache successful, cacheable responses — an error
  // response (4xx/5xx) or an unusable opaque-redirect must never overwrite
  // a good cached copy, otherwise a transient failure "poisons" the
  // offline fallback permanently.
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);

      const revalidate = fetch(req)
        .then((res) => {
          if (res && (res.status === 200 || res.type === 'opaque') && res.type !== 'opaqueredirect') {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => null);

      if (cached) {
        event.waitUntil(revalidate);
        return cached;
      }

      const fresh = await revalidate;
      return fresh || Response.error();
    })()
  );
});
