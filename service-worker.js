// ═══ iCU Calc — Service Worker ═══
// v9 — aggressive cache invalidation: every deploy bumps CACHE_VERSION,
// which forces ALL previous caches (any version, any name) to be wiped
// on activate, and every navigation/asset fetch prefers the network so
// updates show up immediately instead of being stuck behind an old
// cached copy.

const CACHE_VERSION = 'icu-calc-v9';
const CACHE_NAME = CACHE_VERSION;

// Only these are pre-cached for offline fallback. Everything else is
// fetched network-first anyway, so the pre-cache list stays minimal.
const PRECACHE_URLS = [
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

// ═══ INSTALL: pre-cache core shell, then activate immediately ═══
self.addEventListener('install', function (event) {
  self.skipWaiting(); // don't wait for old tabs to close — take over ASAP
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(PRECACHE_URLS).catch(function (err) {
        // Don't let a single missing asset block install
        console.warn('[SW] precache addAll failed:', err);
      });
    })
  );
});

// ═══ ACTIVATE: aggressively nuke every cache that isn't this version ═══
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (key) { return key !== CACHE_NAME; })
          .map(function (key) {
            console.log('[SW] deleting stale cache:', key);
            return caches.delete(key);
          })
      );
    }).then(function () {
      return self.clients.claim(); // take control of all open tabs right away
    })
  );
});

// ═══ FETCH: network-first, falling back to cache only when offline ═══
self.addEventListener('fetch', function (event) {
  // Only handle GET requests — let everything else (POST etc.) pass through
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  // Only handle same-origin requests; let cross-origin (fonts CDN etc.) go straight to network
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .then(function (networkResponse) {
        // Stash a fresh copy for offline fallback, then serve the live response
        const cloned = networkResponse.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(event.request, cloned);
        });
        return networkResponse;
      })
      .catch(function () {
        // Offline (or network failed) — fall back to whatever's cached
        return caches.match(event.request).then(function (cached) {
          return cached || caches.match('./index.html');
        });
      })
  );
});

// ═══ Allow the page to trigger an immediate takeover after update ═══
self.addEventListener('message', function (event) {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
