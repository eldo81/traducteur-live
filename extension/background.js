/* Interprète Live — arrière-plan : seul endroit où la clé API est utilisée.
 * La page ne reçoit jamais la clé : seulement la réponse SDP d'OpenAI. */
const API = 'https://api.openai.com/v1';
const DEFAULTS = {
  model: 'gpt-realtime-2', voice: 'cedar', accent: 'senegal',
  hearFr: true, originalVolume: 0.2, transcribe: 'gpt-live-transcribe',
};

async function httpError(r) {
  let msg = 'HTTP ' + r.status;
  try { const j = await r.json(); if (j.error && j.error.message) msg += ' — ' + j.error.message; } catch {}
  const e = new Error(msg); e.status = r.status; return e;
}

async function clientSecret(apiKey, session) {
  const r = await fetch(API + '/realtime/client_secrets', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ session }),
  });
  if (!r.ok) throw await httpError(r);
  return (await r.json()).value;
}

async function connect(session, sdp) {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  if (!apiKey) throw new Error('Clé API manquante : cliquez sur l’icône de l’extension.');
  let ek;
  try { ek = await clientSecret(apiKey, session); }
  catch (e) {
    // Modèle qui refuse le réglage de raisonnement : on réessaie sans
    if (e.status === 400 && /reasoning/i.test(e.message) && session.reasoning) {
      delete session.reasoning;
      ek = await clientSecret(apiKey, session);
    } else if (e.status === 401) throw new Error('Clé API refusée (401) : vérifiez-la dans les réglages.');
    else throw e;
  }
  const r = await fetch(API + '/realtime/calls', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + ek, 'Content-Type': 'application/sdp' },
    body: sdp,
  });
  if (!r.ok) throw await httpError(r);
  return r.text();
}

/* Cadre (frame) qui porte l'appel, par onglet — conservé si le service worker redémarre */
async function mediaFrame(tabId) {
  const k = 'mf_' + tabId;
  const o = await chrome.storage.session.get(k);
  return o[k] ?? 0;
}
async function sendCmd(tabId, cmd) {
  const frameId = await mediaFrame(tabId);
  try { await chrome.tabs.sendMessage(tabId, { type: 'cmd', cmd }, { frameId }); }
  catch { await chrome.tabs.sendMessage(tabId, { type: 'cmd', cmd }, { frameId: 0 }).catch(() => {}); }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg && msg.type === 'evt' && sender.tab) {
    if (msg.evt && msg.evt.type === 'media') chrome.storage.session.set({ ['mf_' + sender.tab.id]: sender.frameId || 0 });
    // Événement venu d'un sous-cadre : on le relaie au panneau de la page principale
    else if (sender.frameId) chrome.tabs.sendMessage(sender.tab.id, { type: 'evtRelay', evt: msg.evt }, { frameId: 0 }).catch(() => {});
    return false;
  }
  if (msg && msg.type === 'cmdTab') {
    const tabId = msg.tabId || (sender.tab && sender.tab.id);
    if (tabId) sendCmd(tabId, msg.cmd);
    reply({ ok: true });
    return false;
  }
  if (!msg || msg.type === 'cmd') return false;
  (async () => {
    try {
      if (msg.type === 'settings') {
        const all = await chrome.storage.local.get(null);
        const { apiKey, ...rest } = all;
        reply({ ok: true, hasKey: !!apiKey, settings: { ...DEFAULTS, ...rest } });
      } else if (msg.type === 'connect') {
        reply({ ok: true, sdp: await connect(msg.session, msg.sdp) });
      } else if (msg.type === 'openApp') {
        await openApp();
        reply({ ok: true });
      } else if (msg.type === 'openOptions') {
        chrome.runtime.openOptionsPage();
        reply({ ok: true });
      } else reply({ ok: false, error: 'Message inconnu' });
    } catch (e) { reply({ ok: false, error: e.message }); }
  })();
  return true; // réponse asynchrone
});

// Clic sur l'icône de l'extension → fenêtre « application » (une seule à la fois)
let appWindowId = null;
async function openApp() {
  if (appWindowId !== null) {
    try { await chrome.windows.update(appWindowId, { focused: true }); return; } catch { appWindowId = null; }
  }
  const w = await chrome.windows.create({ url: 'app.html', type: 'popup', width: 460, height: 860 });
  appWindowId = w.id;
}
chrome.action.onClicked.addListener(openApp);
chrome.windows.onRemoved.addListener((id) => { if (id === appWindowId) appWindowId = null; });
