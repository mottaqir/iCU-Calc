// ─── ICU Calc Service Worker ───────────────────────────────────────────────
// Bump CACHE_VERSION whenever you deploy a new build so users get fresh files
const CACHE_VERSION = 'v1';
const CACHE_NAME    = 'icu-calc-' + CACHE_VERSION;

const PRECACHE_URLS = [
  './index.html',
  './manifest.json'
];

// ── Install: pre-cache core files ──────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())   // activate immediately
  );
});

// ── Activate: delete old caches ────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())  // take control of all open tabs
  );
});

// ── Fetch: cache-first, network fallback ───────────────────────────────────
self.addEventListener('fetch', event => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  // Skip cross-origin requests (analytics, CDNs, etc.)
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      // Serve from cache immediately; refresh cache in background
      const networkFetch = fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);  // offline: fall back to cache

      return cached || networkFetch;
    })
  );
});
