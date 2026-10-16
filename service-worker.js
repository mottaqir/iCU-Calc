// ═══ iCU Calc — Service Worker (auto-updating: NO manual version bump needed) ═══
// Strategy: cache-first for instant, always-works opens (works with zero connectivity). In parallel a
// network fetch runs in the background to refresh the cache. If it fails (offline / flaky signal) it is
// swallowed silently — the page already got its response from cache.
//
// AUTO-UPDATE (replaces the old hand-edited VERSION): the app shell (index.html) is re-fetched with
// cache:'no-store' and compared by SHA-256 against the cached copy — on every open AND whenever the page sends
// 'CHECK_UPDATE' (page becomes visible, network comes back, and every 5 s while the app is open and online). If the content differs, the cache
// is updated and every open page gets an APP_UPDATED message; index.html then reloads itself, so a deploy
// reaches an already-open (active) session as soon as it is online. CACHE_NAME is constant on purpose — change it ONLY if you ever need a full forced wipe.
const CACHE_NAME = 'icu-calc-rt';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-72x72.png',
  './icon-96x96.png',
  './icon-128x128.png',
  './icon-144x144.png',
  './icon-152x152.png',
  './icon-180x180.png',
  './icon-192x192.png',
  './icon-384x384.png',
  './icon-512x512.png',
  './icon-1024x1024.png'
];

const SHELL_URL = new URL('./index.html', self.location).href;
const SCOPE_PATH = new URL('./', self.location).pathname;

self.addEventListener('install', (event) => {
  // Take over immediately, don't wait for old tabs to close.
  self.skipWaiting();
  event.waitUntil(
    // cache:'reload' = bypass the HTTP cache so the precached copy is never a stale 10-minute-old one.
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(APP_SHELL.map((u) => new Request(u, { cache: 'reload' })))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Wipe this app's caches from every earlier naming scheme (icu-calc-v113 etc.). Scoped by name because
      // github.io origins are shared with the other tools — their caches are left alone.
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => {
        if (key !== CACHE_NAME && /icu|syringe|pump|calc|^v\d+$/i.test(key)) return caches.delete(key);
      }));
      await self.clients.claim();
    })()
  );
});

// Let the page force an update check / immediate activation on demand.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  // The page asks for an update check whenever it becomes visible / comes back online / on a timer, so an
  // ALREADY-OPEN app notices a new deploy without needing a navigation (fetch event) first.
  if (event.data === 'CHECK_UPDATE') event.waitUntil(checkShellNow());
});

async function sha256(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function notifyUpdated() {
  const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  list.forEach((c) => c.postMessage({ type: 'APP_UPDATED' }));
}

// Fetch the app shell from the network, store it, and tell the pages if its content changed.
// oldCopy = a clone of the cached response that was just served (null on first install).
async function refreshShell(oldCopy, extraHeaders) {
  try {
    // Unique query string = also bypasses the GitHub Pages CDN's ~10-min cache, so a fresh deploy is seen at once.
    // (The response is still stored under the plain SHELL_URL key below.)
    const res = await fetch(SHELL_URL + '?_=' + Date.now(), extraHeaders ? { cache: 'no-store', headers: extraHeaders } : { cache: 'no-store' });
    if (!res || res.status !== 200) return null; // 304 = server says "unchanged" → nothing to do
    let changed = false;
    if (oldCopy) {
      const [a, b] = await Promise.all([res.clone().arrayBuffer(), oldCopy.arrayBuffer()]);
      changed = (await sha256(a)) !== (await sha256(b));
    }
    const cache = await caches.open(CACHE_NAME);
    await cache.put(SHELL_URL, res.clone());
    if (changed) await notifyUpdated();
    return res;
  } catch (err) {
    return null; // offline / network error — never surfaced to the page
  }
}

// Page-triggered check (no navigation involved): compare the network copy with whatever is cached right now.
// De-duplicated so overlapping triggers (visibilitychange + online + timer) share one network round-trip.
let checking = null;
function checkShellNow() {
  if (checking) return checking;
  checking = (async () => {
    try {
      const cached = await caches.match(SHELL_URL);
      // Page polls every ~5 s, so ask conditionally: if the cached copy's ETag / Last-Modified still matches the
      // server, the reply is a tiny 304 (no 1.6 MB download). A 200 means the file changed → full hash-compare path.
      // If the server sends neither header, this falls back to a plain full fetch.
      let cond = null;
      if (cached) {
        const etag = cached.headers.get('etag');
        const lm = cached.headers.get('last-modified');
        if (etag) cond = { 'If-None-Match': etag };
        else if (lm) cond = { 'If-Modified-Since': lm };
      }
      await refreshShell(cached ? cached.clone() : null, cond);
    } finally {
      checking = null;
    }
  })();
  return checking;
}

const OFFLINE_503 = () => new Response(
  'iCU Calc is offline and this page has not been cached yet. Please connect to the internet once to finish installing.',
  { status: 503, headers: { 'Content-Type': 'text/plain' } }
);

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isNav = req.mode === 'navigate';
  const isShell = isSameOrigin && (url.pathname === SCOPE_PATH || url.pathname === SCOPE_PATH + 'index.html');

  // App shell (the page itself): cache-first, then re-fetch + hash-compare in the background.
  if ((isNav && isSameOrigin) || isShell) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(SHELL_URL);
        if (cached) {
          event.waitUntil(refreshShell(cached.clone()));
          return cached;
        }
        // Nothing cached yet (first install) — this request has to wait on the network.
        const fresh = await refreshShell(null);
        return fresh || OFFLINE_503();
      })()
    );
    return;
  }

  // Other same-origin files (manifest, icons, the app's own assets): cache-first, then silently refresh the
  // cache in the background for next time.
  if (isSameOrigin) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);

        const revalidate = fetch(req, { cache: 'no-store' })
          .then((res) => {
            if (res && res.status === 200) {
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
        return fresh || OFFLINE_503();
      })()
    );
    return;
  }

  // Cross-origin (e.g. fonts/CDN): same cache-first + background-refresh approach. Only cache successful,
  // cacheable responses — an error response (4xx/5xx) or an unusable opaque-redirect must never overwrite a
  // good cached copy, otherwise a transient failure "poisons" the offline fallback permanently.
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
