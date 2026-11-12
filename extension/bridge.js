/* Interprète Live — pont entre la page (script « MAIN ») et l'extension. */
window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || e.data.__il !== 'req') return;
  const { id, payload } = e.data;
  if (!payload || !['settings', 'connect', 'openOptions'].includes(payload.type)) return;
  try {
    chrome.runtime.sendMessage(payload, (res) => {
      const err = chrome.runtime.lastError;
      window.postMessage({ __il: 'res', id, res: err ? { ok: false, error: 'Extension : ' + err.message + ' — rechargez la page.' } : res }, '*');
    });
  } catch (err) {
    window.postMessage({ __il: 'res', id, res: { ok: false, error: 'Extension mise à jour : rechargez la page.' } }, '*');
  }
});
