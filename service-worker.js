/* ICU Calc — Service Worker
   Bump CACHE_VERSION whenever index.html/manifest.json/icons change so
   clients pick up the new files instead of serving stale cache. */
const CACHE_VERSION = 'icu-calc-v2';
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

// ── Install: pre-cache the app shell ──
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(function (cache) { return cache.addAll(APP_SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

// ── Activate: drop old caches, take control immediately ──
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (key) { return key !== CACHE_VERSION; })
            .map(function (key) { return caches.delete(key); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

// ── Fetch strategy ──
// HTML (navigations): network-first so updates show up as soon as they're
// published, falling back to the cached shell when offline.
// Everything else (icons, manifest, static assets): cache-first for speed,
// with a background network update to keep the cache fresh.
self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;

  const isNavigation = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').indexOf('text/html') !== -1;

  if (isNavigation) {
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .then(function (res) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(function (cache) { cache.put('./index.html', copy); });
          return res;
        })
        .catch(function () { return caches.match('./index.html'); })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(function (cached) {
      const fetchPromise = fetch(req).then(function (res) {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      }).catch(function () { return cached; });
      return cached || fetchPromise;
    })
  );
});
