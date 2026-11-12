/* Interprète Live — fenêtre « application » : pilote l'onglet de réunion
 * (Meet / Teams / Zoom) où l'extension fait la traduction. */
const MEETING_URLS = ['https://meet.google.com/*', 'https://web.whatsapp.com/*', 'https://teams.microsoft.com/*', 'https://teams.live.com/*', 'https://teams.cloud.microsoft/*', 'https://app.zoom.us/*', 'https://*.zoom.us/*'];
const $ = (id) => document.getElementById(id);
let tabId = null;
let log = [];
let mode = 'off';

/** Trouve l'onglet de réunion (le plus récemment utilisé). */
async function findMeeting() {
  const tabs = await chrome.tabs.query({ url: MEETING_URLS });
  tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  const t = tabs.find((x) => x.active) || tabs.find((x) => /meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/.test(x.url)) || tabs[0];
  if (!t) { tabId = null; $('noMeet').hidden = false; setStatus('', 'Aucune réunion ouverte'); return; }
  tabId = t.id;
  $('noMeet').hidden = true;
  $('target').textContent = '🎥 ' + (t.title || t.url);
  cmd({ type: 'state' });
}

async function cmd(c) {
  if (tabId === null) { await findMeeting(); if (tabId === null) return; }
  try { await chrome.runtime.sendMessage({ type: 'cmdTab', tabId, cmd: c }); }
  catch { setStatus('err', 'Réunion injoignable : rechargez la page de l’appel (F5).'); }
}

function setStatus(state, text) {
  $('dot').className = 'dot' + (state ? ' ' + state : '');
  $('status').textContent = text;
}
function setMode(m) {
  mode = m;
  document.querySelectorAll('[data-m]').forEach((b) => b.classList.toggle('active', b.dataset.m === m));
}
function addLine(l) {
  log.push(l);
  const li = document.createElement('li');
  li.className = l.dir;
  li.innerHTML = '<div class="meta"></div><div class="txt"></div>';
  li.querySelector('.meta').textContent = l.t + '  ·  ' + (l.dir === 'listen' ? 'Il dit (EN→FR)' : 'Vous (FR→EN)');
  li.querySelector('.txt').textContent = l.text;
  $('history').appendChild(li);
  $('history').scrollTop = $('history').scrollHeight;
  $('count').textContent = '(' + log.length + ')';
}
function renderLog(lines) {
  log = []; $('history').innerHTML = '';
  (lines || []).forEach(addLine);
  $('count').textContent = '(' + log.length + ')';
}
const transcript = () => 'Transcription Interprète Live — ' + new Date().toLocaleString('fr-FR') + '\n' + '='.repeat(50) + '\n\n' +
  log.map((l) => `[${l.t}] ${l.dir === 'listen' ? 'Interlocuteur (traduit en français)' : 'Moi (traduit en anglais)'} :\n${l.text}`).join('\n\n') + '\n';

/* Événements venant de l'onglet de réunion */
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== 'evt' || !sender.tab) return;
  if (tabId === null) tabId = sender.tab.id;
  if (sender.tab.id !== tabId) return;
  const e = msg.evt;
  if (e.type === 'status') setStatus(e.status.state, e.status.text);
  if (e.type === 'mode') setMode(e.mode);
  if (e.type === 'subtitle') {
    (e.dir === 'listen' ? $('liveFr') : $('liveEn')).textContent = e.text;
    if (e.done && e.line) addLine(e.line);
  }
  if (e.type === 'state') {
    const s = e.state;
    setMode(s.mode); setStatus(s.status.state, s.status.text);
    $('liveFr').textContent = s.live.listen || '—';
    $('liveEn').textContent = s.live.speak || '—';
    renderLog(s.log);
  }
});

document.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => cmd({ type: 'setMode', mode: b.dataset.m })));
$('btnSettings').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('btnNewMeet').addEventListener('click', () => chrome.tabs.create({ url: 'https://meet.google.com/' }));
$('btnRetry').addEventListener('click', findMeeting);
$('btnCopy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(transcript()); setStatus(mode === 'off' ? '' : 'on', 'Transcription copiée'); } catch { setStatus('err', 'Copie refusée'); }
});
$('btnExport').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([transcript()], { type: 'text/plain;charset=utf-8' }));
  a.download = 'interprete-' + new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-') + '.txt';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$('btnClear').addEventListener('click', () => { renderLog([]); cmd({ type: 'clearLog' }); });

// Suit l'onglet de réunion s'il est ouvert, rechargé ou fermé
chrome.tabs.onUpdated.addListener((id, info) => { if (info.status === 'complete') setTimeout(findMeeting, 800); });
chrome.tabs.onRemoved.addListener((id) => { if (id === tabId) { tabId = null; findMeeting(); } });
findMeeting();
