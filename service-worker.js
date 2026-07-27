// ═══ iCU Calc — Service Worker (v6, aggressive cache cleaner) ═══
// Strategy: network-first for everything, so the app never gets stuck
// showing stale HTML/icons/manifest while online. Cache is only a
// fallback for offline use. Every activation nukes ANY cache that isn't
// the current version — no accumulation of old app-shell caches ever.
const VERSION = 'v6';
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
      // routes through it) — no explicit reload needed. Forcing
      // client.navigate(client.url) here used to fire a second, SW-driven
      // reload on top of whatever navigation the user/browser was already
      // doing (e.g. a pull-to-refresh), and two overlapping navigations to
      // the same window can tear the render — which is the most likely
      // explanation for the duplicated rows / stretched-then-scrollable
      // layout seen right after pull-to-refresh.
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

  // Network-first for navigations and same-origin app-shell files
  // (HTML, manifest, icons): always try to get the freshest copy first,
  // update the cache in the background, and only fall back to cache
  // when the network is unreachable (offline).
  if (req.mode === 'navigate' || isSameOrigin) {
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => {
              const key = req.mode === 'navigate' ? './index.html' : req;
              cache.put(key, copy);
            });
          }
          return res;
        })
        .catch(() =>
          caches.match(req.mode === 'navigate' ? './index.html' : req)
        )
    );
    return;
  }

  // Cross-origin (e.g. fonts/CDN): network first, cache as fallback.
  // Only cache successful, cacheable responses — an error response (4xx/5xx)
  // or an unusable opaque-redirect must never overwrite a good cached copy,
  // otherwise a transient failure "poisons" the offline fallback permanently.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && (res.status === 200 || res.type === 'opaque') && res.type !== 'opaqueredirect') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
