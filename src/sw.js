// FishtankVR service worker.
//
// Why this exists: we're installable as a PWA (Add to Home Screen on iOS,
// "Install" on Android / desktop). Without a service worker, iOS would
// still aggressively cache the app shell and we'd have no good way to
// ship updates — users would be stuck on whatever version was live the
// day they installed.
//
// Caching strategy:
//   • HTML, KioskConfig.json, manifest   → network-first (so deploys land
//     immediately, with cached fallback if offline).
//   • /vendor/* and /assets/*       → cache-first with stale-while-revalidate
//     (the ~44 MB Three.js + MediaPipe bundle and media files rarely change;
//     we refresh them in the background for next load).
//   • Everything else               → network-first.
//
// Update flow:
//   1. User launches PWA.
//   2. Browser fetches sw.js and byte-compares to the installed copy.
//      Any diff → treat as new version.
//   3. New SW installs silently, `skipWaiting()` fires so it activates
//      immediately and the old SW is evicted.
//   4. We notify the page via a `controllerchange` event; the page shows
//      a small "New version available — reload" banner rather than
//      auto-reloading (don't yank the rug out during a live interaction).
//
// Version bump protocol: change VERSION below to purge all caches. Also
// bump this on any breaking change to the caching rules.

const VERSION = 'v4';
const STATIC_CACHE  = `fishtank-static-${VERSION}`;
const RUNTIME_CACHE = `fishtank-runtime-${VERSION}`;

// Minimum app-shell — everything needed to render the first offline load.
// Deliberately small; vendor/ is populated on-demand by cacheFirst() as the
// page requests individual modules.
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './KioskConfig.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// ─── install ────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    // `addAll` is atomic — if any one fetch fails, none are cached. We
    // keep the shell list short enough that this is reliable.
    await cache.addAll(APP_SHELL);
    // Don't wait for all open tabs to close before activating — take over
    // on the next navigation so updates land quickly.
    await self.skipWaiting();
  })());
});

// ─── activate ───────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE)
        .map((k) => caches.delete(k))
    );
    // `clients.claim()` makes the newly-activated SW control existing
    // pages without requiring a reload — together with skipWaiting this
    // gives us "next launch is up to date" without a double-reload dance.
    await self.clients.claim();
  })());
});

// ─── fetch ──────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Cross-origin requests (e.g. CDN fallbacks) pass through untouched.
  // MediaPipe ships with its own WASM under vendor/ so in practice we
  // never hit this branch in production.
  if (url.origin !== self.location.origin) return;

  const path = url.pathname;

  const isShell =
    req.mode === 'navigate' ||
    path.endsWith('.html') ||
    path.endsWith('/KioskConfig.json') ||
    path.endsWith('/manifest.webmanifest');

  const isHeavyAsset =
    path.includes('/vendor/') ||
    path.includes('/assets/') ||
    path.includes('/icons/');

  if (isShell)             event.respondWith(networkFirst(req));
  else if (isHeavyAsset)   event.respondWith(cacheFirst(req));
  else                     event.respondWith(networkFirst(req));
});

// ─── message handling (manual skip-waiting, if the page asks for it) ────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// ─── strategies ─────────────────────────────────────────────────────────

/** Network-first: prefer fresh, fall back to cached copy for offline. */
async function networkFirst(req) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const fresh = await fetch(req);
    // Only cache successful same-origin GETs; opaque/error responses are
    // useless to serve from cache later.
    if (fresh.ok) cache.put(req, fresh.clone()).catch(() => {});
    return fresh;
  } catch (err) {
    const cached = await cache.match(req) || await caches.match(req);
    if (cached) return cached;
    // Last resort: if a navigation request fails entirely, serve the
    // cached shell so the app still boots and can explain it's offline.
    if (req.mode === 'navigate') {
      const shell = await caches.match('./index.html');
      if (shell) return shell;
    }
    throw err;
  }
}

/** Cache-first with stale-while-revalidate — big bundles load instantly,
    next page load gets the fresh copy if any. */
async function cacheFirst(req) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(req);
  const revalidate = fetch(req)
    .then((fresh) => {
      if (fresh.ok) cache.put(req, fresh.clone()).catch(() => {});
      return fresh;
    })
    .catch(() => null);
  return cached || (await revalidate) || Response.error();
}
