/* Service worker — met en cache l'interface (fonctionne hors ligne pour l'ouverture).
 * Les appels à api.openai.com ne sont JAMAIS mis en cache.
 * Incrémenter VERSION à chaque déploiement pour forcer la mise à jour. */
const VERSION = 'tl-v1.0.0';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Uniquement les GET de notre propre origine ; tout le reste passe en direct
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Réseau d'abord (toujours la dernière version en ligne), cache en secours hors ligne
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
  );
});
