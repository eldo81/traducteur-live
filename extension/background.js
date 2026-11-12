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

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    try {
      if (msg.type === 'settings') {
        const all = await chrome.storage.local.get(null);
        const { apiKey, ...rest } = all;
        reply({ ok: true, hasKey: !!apiKey, settings: { ...DEFAULTS, ...rest } });
      } else if (msg.type === 'connect') {
        reply({ ok: true, sdp: await connect(msg.session, msg.sdp) });
      } else if (msg.type === 'openOptions') {
        chrome.runtime.openOptionsPage();
        reply({ ok: true });
      } else reply({ ok: false, error: 'Message inconnu' });
    } catch (e) { reply({ ok: false, error: e.message }); }
  })();
  return true; // réponse asynchrone
});

// Clic sur l'icône de l'extension → page de réglages
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
