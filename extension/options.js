const DEFAULTS = { model: 'gpt-realtime-2', voice: 'cedar', accent: 'senegal', hearFr: true, originalVolume: 0.2 };
const $ = (id) => document.getElementById(id);
const fields = ['apiKey', 'model', 'voice', 'accent', 'hearFr', 'originalVolume'];

chrome.storage.local.get(null, (s) => {
  const v = { ...DEFAULTS, ...s };
  fields.forEach((f) => { const el = $(f); if (el.type === 'checkbox') el.checked = !!v[f]; else el.value = v[f] ?? ''; });
  $('volv').textContent = Math.round(v.originalVolume * 100) + ' %';
});
$('originalVolume').addEventListener('input', (e) => { $('volv').textContent = Math.round(e.target.value * 100) + ' %'; });
$('show').addEventListener('click', () => { const i = $('apiKey'); i.type = i.type === 'password' ? 'text' : 'password'; });
$('save').addEventListener('click', () => {
  const out = {};
  fields.forEach((f) => { const el = $(f); out[f] = el.type === 'checkbox' ? el.checked : (f === 'originalVolume' ? Number(el.value) : el.value.trim()); });
  chrome.storage.local.set(out, () => { $('msg').textContent = '✅ Enregistré. Rechargez la page Meet si elle est ouverte.'; });
});
$('test').addEventListener('click', async () => {
  const k = $('apiKey').value.trim();
  if (!k) { $('msg').textContent = 'Clé vide.'; return; }
  $('msg').textContent = 'Test…';
  try {
    const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + k } });
    if (!r.ok) { $('msg').textContent = '❌ Clé refusée (HTTP ' + r.status + ')'; return; }
    const ids = ((await r.json()).data || []).map((m) => m.id);
    const m = $('model').value;
    $('msg').textContent = ids.includes(m) ? `✅ Clé valide, « ${m} » disponible.` : `⚠️ Clé valide, mais « ${m} » absent de votre compte.`;
  } catch (e) { $('msg').textContent = '❌ Réseau : ' + e.message; }
});
