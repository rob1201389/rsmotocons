/* Recomp service worker. Bump CACHE when you deploy a change. */
const CACHE = 'recomp-v3';
const SHELL = ['./','./index.html','./app.js','./core.js','./engine.js','./exercises.js',
  './figure.js','./lifts.js','./stretches.js','./manifest.webmanifest',
  './icon-180.png','./icon-192.png','./icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin && !/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) return;
  if (url.origin === location.origin) {
    // network first so a deploy is picked up, cache as the offline fallback
    e.respondWith(fetch(req).then(res => {
      if (res && res.ok) { const c = res.clone(); caches.open(CACHE).then(k => k.put(req, c)).catch(()=>{}); }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('./index.html'))));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) {
      const c = res.clone(); caches.open(CACHE).then(k => k.put(req, c)).catch(()=>{});
    }
    return res;
  }).catch(() => hit)));
});
