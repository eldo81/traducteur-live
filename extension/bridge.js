/* Interprète Live — pont entre la page (script « MAIN ») et l'extension. */
window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || e.data.__il !== 'req') return;
  const { id, payload } = e.data;
  if (!payload || !['settings', 'connect', 'openOptions', 'openApp', 'cmdTab'].includes(payload.type)) return;
  try {
    chrome.runtime.sendMessage(payload, (res) => {
      const err = chrome.runtime.lastError;
      window.postMessage({ __il: 'res', id, res: err ? { ok: false, error: 'Extension : ' + err.message + ' — rechargez la page.' } : res }, '*');
    });
  } catch (err) {
    window.postMessage({ __il: 'res', id, res: { ok: false, error: 'Extension mise à jour : rechargez la page.' } }, '*');
  }
});

/* Événements de la page → fenêtre « application » de l'extension */
window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || e.data.__il !== 'evt') return;
  try { chrome.runtime.sendMessage({ type: 'evt', evt: e.data.evt }).catch(() => {}); } catch {}
});
/* Commandes de la fenêtre « application » → page */
chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (!msg) return;
  if (msg.type === 'cmd') { window.postMessage({ __il: 'cmd', cmd: msg.cmd }, '*'); reply({ ok: true }); }
  if (msg.type === 'evtRelay') { window.postMessage({ __il: 'evtIn', evt: msg.evt }, '*'); reply({ ok: true }); }
});
