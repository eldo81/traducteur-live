/* Service worker Radar B2B — cache l'interface uniquement.
 * Les appels API (OpenAI, OpenStreetMap) ne sont jamais mis en cache.
 * Incrémenter VERSION à chaque déploiement. */
const VERSION = 'rb-v1.0.0';
const SHELL = ['./', './index.html', './style.css', './app.js', './manifest.json',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('rb-') && k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const fromCache = () => caches.match(e.request, { ignoreSearch: true })
    .then((r) => r || (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()));
  const net = fetch(e.request, { cache: 'no-cache' }).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
    return res;
  });
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000));
  e.respondWith(Promise.race([net, timeout]).catch(() => fromCache().then((r) => (r && r.type !== 'error' ? r : net))));
});
