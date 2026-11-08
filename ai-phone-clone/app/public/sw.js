/* Lien Interprète service worker: installability + offline notice.
   Network only: calls, API and auth must never be served from cache. */
const OFFLINE_HTML = `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hors ligne</title><body style="font-family:system-ui,sans-serif;padding:24px;max-width:480px;margin:auto">
<h1>Pas de connexion</h1><p>Un appel traduit a besoin d'Internet. Vérifiez votre réseau puis rechargez la page.</p></body></html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(
      () => new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } }),
    ),
  );
});
