/* Ancien service worker de /traducteur-live/prospect/ : Radar B2B a déménagé vers /radar-b2b/.
 * Cette version se désinstalle et supprime son ancien cache. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.delete('rb-v1.0.0').then(() => self.registration.unregister()));
});
