/* Recomp service worker.
   Three things the independent review caught, and how they are handled:
   1. activate() used to delete EVERY cache on the origin. It now only touches
      caches it owns, matched by prefix.
   2. A failed request for any same-origin GET fell back to index.html, so a
      missing .js returned HTML and a missing .png returned HTML. Fallbacks are
      now resource-specific.
   3. skipWaiting() ran unconditionally, so deploying mid-workout could swap the
      running code. The new worker waits, and activates only when the page says
      it is safe. */
const VERSION = 'v6';
const CACHE_PREFIX = 'recomp-';
const CACHE = CACHE_PREFIX + VERSION;

const SHELL = ['./', './index.html', './app.js', './core.js', './engine.js', './exercises.js',
  './authclient.js', './figure.js', './lifts.js', './stretches.js', './manifest.webmanifest',
  './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  // No skipWaiting here. The new worker sits in "waiting" until the page tells
  // it to take over, so an update cannot replace code during a live session.
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(SHELL.map(u => c.add(u)))));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE)   // scoped
            .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* The page controls when an update lands. app.js posts SKIP_WAITING once no
   workout is in progress (or once the user accepts the prompt). */
self.addEventListener('message', e => {
  if (!e.data) return;
  if (e.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (e.data.type === 'VERSION') {
    if (e.source && e.source.postMessage) e.source.postMessage({ type: 'VERSION', version: VERSION });
  }
});

function offlineJSON() {
  return new Response(JSON.stringify({ offline: true, error: 'No cached copy of this resource.' }),
    { status: 503, headers: { 'Content-Type': 'application/json' } });
}
function offlineText(type) {
  return new Response('', { status: 503, headers: { 'Content-Type': type } });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  const isFont = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!sameOrigin && !isFont) return;        // never touch anything else

  /* Authenticated API responses are never cached, never served from cache and
     never revalidated in the background. A shared device must not be able to
     read the previous account's data out of the cache, and a revoked account
     must not keep working because its last response is still sitting here. */
  if (sameOrigin && url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(req).catch(() => new Response(
      JSON.stringify({ error: 'offline', offline: true }),
      { status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })));
    return;
  }

  // Navigations: network first, fall back to the cached page. This is the ONLY
  // case where returning index.html is correct.
  if (req.mode === 'navigate' || (sameOrigin && req.destination === 'document')) {
    e.respondWith(
      fetch(req).then(res => {
        if (res && res.ok) { const c = res.clone(); caches.open(CACHE).then(k => k.put(req, c)).catch(() => {}); }
        return res;
      }).catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // Google Fonts: cache first, they are immutable.
  if (isFont) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res && (res.ok || res.type === 'opaque')) {
        const c = res.clone(); caches.open(CACHE).then(k => k.put(req, c)).catch(() => {});
      }
      return res;
    }).catch(() => hit || offlineText('text/css'))));
    return;
  }

  // Everything else same-origin: stale-while-revalidate, with a fallback that
  // matches what was actually asked for.
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(res => {
      if (res && res.ok) { const c = res.clone(); caches.open(CACHE).then(k => k.put(req, c)).catch(() => {}); }
      return res;
    }).catch(() => null);
    if (hit) { net.catch(() => {}); return hit; }
    return net.then(res => {
      if (res) return res;
      switch (req.destination) {
        case 'script': return offlineText('text/javascript');
        case 'style':  return offlineText('text/css');
        case 'image':  return offlineText('image/png');
        case 'font':   return offlineText('font/woff2');
        default:
          if (/\.json$|\.webmanifest$/.test(url.pathname)) return offlineJSON();
          return new Response('', { status: 503 });
      }
    });
  }));
});
