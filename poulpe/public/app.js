/* Poulpe — interface. Vanilla JS, aucune dépendance. */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let TOKEN = '';
try { TOKEN = localStorage.getItem('poulpe-token') || ''; } catch { /* stockage indisponible */ }

async function api(path, opts = {}) {
  const headers = { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}) };
  const res = await fetch(path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (res.status === 401) {
    const t = prompt('Jeton d\'accès Poulpe (POULPE_TOKEN) :');
    if (t) { TOKEN = t.trim(); try { localStorage.setItem('poulpe-token', TOKEN); } catch { /* ignore */ } return api(path, opts); }
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
  return data;
}
const withToken = (url) => (TOKEN ? url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(TOKEN) : url);

function toast(msg, kind = 'info') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + kind;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, kind === 'error' ? 7000 : 3500);
}

async function busy(btn, fn) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = '…';
  try { return await fn(); } catch (e) { toast(e.message, 'error'); } finally { btn.disabled = false; btn.textContent = label; }
}

// ================================================================== onglets
function showTab(name) {
  $$('nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab').forEach((s) => s.classList.toggle('active', s.id === 'tab-' + name));
  if (name === 'tasks') loadTasks();
  if (name === 'templates') loadTemplates();
  if (name === 'data') loadDataTasks();
  if (name === 'settings') loadSettings();
}
$$('nav button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
document.addEventListener('click', (e) => { const g = e.target.closest('[data-goto]'); if (g) { e.preventDefault(); showTab(g.dataset.goto); } });

// ================================================================== statut
async function refreshStatus() {
  try {
    const s = await api('/api/status');
    $('#status').innerHTML = `<span class="dot ${s.ai ? 'ok' : ''}"></span>${s.ai ? 'IA ' + esc(s.model) : '<a href="#" data-goto="settings">IA désactivée : ajouter la clé</a>'}`
      + (s.active.length ? ` · <b>${s.active.length}</b> en cours` : '');
    window.AI_ON = s.ai;
  } catch { $('#status').textContent = 'Serveur injoignable'; }
}

// ================================================================== tâches
const fmtDate = (d) => (d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const STATUS = { done: '✅ terminé', failed: '❌ échec', running: '⏳ en cours', queued: '⏳ en file', stopped: '⏹ arrêté' };

async function loadTasks() {
  const tasks = await api('/api/tasks').catch((e) => { toast(e.message, 'error'); return []; });
  const tb = $('#tasks-table tbody');
  tb.innerHTML = '';
  $('#tasks-empty').hidden = tasks.length > 0;
  for (const t of tasks) {
    const tr = document.createElement('tr');
    const src = t.source?.type === 'api' ? 'API ' + new URL(t.source.url.replace(/\{.*?\}/g, '0')).host : (t.startUrls?.[0] ? new URL(t.startUrls[0]).host : (t.pagination?.urlTemplate ? new URL(t.pagination.urlTemplate.replace(/\{.*?\}/g, '1')).host : '—'));
    const lr = t.lastRun;
    tr.innerHTML = `<td><b>${esc(t.name)}</b><div class="muted small">${esc(t.description || '')}</div></td>
      <td>${esc(src)}<div class="muted small">${esc(t.extract?.mode === 'ai' ? 'IA' : t.source?.type === 'api' ? 'JSON' : 'sélecteurs')}${t.detail?.enabled ? ' + fiches' : ''}${t.enrich?.enabled ? ' + IA' : ''}</div></td>
      <td>${t.schedule?.enabled ? `<code>${esc(t.schedule.cron)}</code><div class="muted small">prochaine : ${fmtDate(t.nextRun)}</div>` : '<span class="muted">manuelle</span>'}</td>
      <td>${lr ? `${STATUS[lr.status] || lr.status}<div class="muted small">${fmtDate(lr.endedAt || lr.startedAt)} · +${lr.newRows ?? 0} nouvelles</div>` : '<span class="muted">jamais</span>'}</td>
      <td>${t.rows}</td>
      <td class="actions">
        <button class="small primary" data-act="run">Lancer</button>
        <button class="small" data-act="edit">Modifier</button>
        <button class="small" data-act="data">Données</button>
        <button class="small" data-act="dup">Dupliquer</button>
        <button class="small danger" data-act="del">Suppr.</button>
      </td>`;
    tr.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      ({
        run: () => runTask(t.id, t.name),
        edit: () => openEditor(t),
        data: () => { showTab('data'); setTimeout(() => { $('#data-task').value = t.id; loadData(); }, 50); },
        dup: async () => { await api(`/api/tasks/${t.id}/duplicate`, { method: 'POST' }); loadTasks(); },
        del: async () => { if (confirm(`Supprimer « ${t.name} » et ses données ?`)) { await api(`/api/tasks/${t.id}`, { method: 'DELETE' }); loadTasks(); } },
      })[b.dataset.act]?.();
    });
    tb.append(tr);
  }
}

let pollTimer = null;
async function runTask(id, name, body = {}) {
  try {
    const run = await api(`/api/tasks/${id}/run`, { method: 'POST', body });
    showTab('tasks');
    $('#run-panel').hidden = false;
    $('#run-title').textContent = `Exécution : ${name}`;
    $('#run-stop').onclick = () => api(`/api/runs/${run.runId}/stop`, { method: 'POST' });
    $('#run-close').onclick = () => { $('#run-panel').hidden = true; clearInterval(pollTimer); };
    clearInterval(pollTimer);
    const poll = async () => {
      const r = await api(`/api/runs/${run.runId}?task=${id}`).catch(() => null);
      if (!r) return;
      $('#run-log').textContent = r.logs.map((l) => `${l.t.slice(11, 19)} ${l.level === 'error' ? '✖' : l.level === 'warn' ? '!' : '·'} ${l.msg}`).join('\n');
      $('#run-log').scrollTop = 1e9;
      if (!['running', 'queued'].includes(r.status)) {
        clearInterval(pollTimer);
        toast(`${STATUS[r.status] || r.status} — ${r.rows} ligne(s), ${r.newRows} nouvelle(s)`, r.status === 'failed' ? 'error' : 'ok');
        loadTasks();
        refreshStatus();
      }
    };
    pollTimer = setInterval(poll, 1200);
    poll();
  } catch (e) { toast(e.message, 'error'); }
}

$('#btn-new').addEventListener('click', () => openEditor(blankTask()));
$('#import-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const t = JSON.parse(await f.text());
    openEditor({ ...(t.task || t), id: undefined });
    toast('Tâche importée : vérifiez puis enregistrez.');
  } catch (err) { toast('JSON invalide : ' + err.message, 'error'); }
  e.target.value = '';
});

// ================================================================== éditeur : modèle
function blankTask() {
  return {
    name: '', startUrls: [], extract: { mode: 'list', listSelector: '', fields: [], ai: { instructions: '', fields: [] } },
    pagination: { type: 'none', maxPages: 10 }, actions: [], detail: { enabled: false, mode: 'single', fields: [], concurrency: 2 },
    filters: [], dedupKey: [], incremental: true, enrich: { enabled: false, fields: [] }, postFilters: [],
    schedule: { enabled: false, cron: '', timezone: 'Africa/Dakar' }, outputs: { onlyNew: true, webhook: {} },
    browser: { respectRobots: true, blockResources: true, delayMs: [800, 2000], proxies: [] },
  };
}
let task = blankTask();
let inspectId = null;

function getPath(o, p) { return p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o); }
function setPath(o, p, v) {
  const ks = p.split('.');
  let cur = o;
  for (const k of ks.slice(0, -1)) { if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {}; cur = cur[k]; }
  cur[ks.at(-1)] = v;
}

const LINE_KINDS = {
  default: { keys: ['name', 'type', 'description'], toLine: (o) => [o.name, o.type || 'text', o.description || ''].join(' | ') },
  sel: { keys: ['name', 'selector', 'attr'], toLine: (o) => [o.name, o.selector, o.attr || 'text'].join(' | ') },
  filter: { keys: ['field', 'op', 'value'], toLine: (o) => [o.field, o.op, Array.isArray(o.value) ? o.value.join(',') : (o.value ?? '')].join(' | ') },
};
function parseLines(text, kind) {
  const k = LINE_KINDS[kind] || LINE_KINDS.default;
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const parts = l.split('|').map((s) => s.trim());
    const o = {};
    k.keys.forEach((key, i) => { if (parts[i] !== undefined && parts[i] !== '') o[key] = parts[i]; });
    if (kind === 'sel' && !o.attr) o.attr = 'text';
    return o;
  });
}

function bindForm() {
  for (const el of $$('[data-bind]')) {
    let v = getPath(task, el.dataset.bind);
    if (v === undefined && el.dataset.default !== undefined) v = el.dataset.default === 'true';
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v ?? '';
  }
  for (const el of $$('[data-bind-lines]')) {
    const arr = getPath(task, el.dataset.bindLines) || [];
    const k = LINE_KINDS[el.dataset.lineKind] || LINE_KINDS.default;
    el.value = arr.map(k.toLine).join('\n');
  }
  $('#t-name').value = task.name || '';
  $('#t-url').value = task.startUrls?.[0] || '';
  $('#extra-urls').value = (task.startUrls || []).slice(1).join('\n');
  $('#dedup').value = (task.dedupKey || []).join(', ');
  $('#delay-min').value = task.browser?.delayMs?.[0] ?? '';
  $('#delay-max').value = task.browser?.delayMs?.[1] ?? '';
  $('#proxies').value = (task.browser?.proxies || []).join('\n');
  renderFields();
  renderActions();
  applyShows();
  syncRaw();
}

function readForm() {
  task.name = $('#t-name').value.trim();
  const first = $('#t-url').value.trim();
  task.startUrls = [first, ...$('#extra-urls').value.split('\n').map((s) => s.trim())].filter(Boolean);
  task.dedupKey = $('#dedup').value.split(',').map((s) => s.trim()).filter(Boolean);
  task.browser = task.browser || {};
  const dmin = Number($('#delay-min').value || 800), dmax = Number($('#delay-max').value || 2000);
  task.browser.delayMs = [dmin, Math.max(dmin, dmax)];
  task.browser.proxies = $('#proxies').value.split('\n').map((s) => s.trim()).filter(Boolean);
  return task;
}

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.bind) {
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.num !== undefined) v = el.value === '' ? undefined : Number(el.value);
    setPath(task, el.dataset.bind, v);
    applyShows();
    if (el.dataset.bind === 'extract.listSelector') pushState();
  } else if (el.dataset.bindLines) {
    setPath(task, el.dataset.bindLines, parseLines(el.value, el.dataset.lineKind));
  } else return;
  syncRaw();
});
document.addEventListener('change', (e) => { if (e.target.dataset.bind) { applyShows(); pushState(); } });

function applyShows() {
  for (const el of $$('[data-show]')) {
    const m = el.dataset.show.match(/^([\w.]+)(!?=)(.*)$/);
    const v = String(getPath(task, m[1]) ?? (m[1].endsWith('mode') ? 'list' : ''));
    const opts = m[3].split('|');
    el.hidden = m[2] === '=' ? !opts.includes(v) : opts.includes(v);
  }
}

function syncRaw() {
  const { id, createdAt, updatedAt, ...rest } = task;
  $('#raw-json').value = JSON.stringify(rest, null, 2);
}
$('#btn-apply-json').addEventListener('click', () => {
  try { task = { ...JSON.parse($('#raw-json').value), id: task.id }; bindForm(); pushState(); toast('JSON appliqué.'); } catch (e) { toast('JSON invalide : ' + e.message, 'error'); }
});
$('#btn-export-json').addEventListener('click', () => {
  readForm();
  const { id, createdAt, updatedAt, ...rest } = task;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(rest, null, 2)], { type: 'application/json' }));
  a.download = (task.name || 'tache').replace(/[^\w-]+/g, '-') + '.json';
  a.click();
});

// ---- champs
const ATTRS = ['text', 'href', 'src', 'html', 'ownText', 'title', 'alt', 'datetime', 'content', 'value'];
const TRANSFORMS = ['', 'trim', 'number', 'date', 'absUrl', 'email', 'phone', 'lower', 'upper'];
function renderFields() {
  const box = $('#fields-list');
  const fields = task.extract.fields || (task.extract.fields = []);
  box.innerHTML = fields.length ? '' : '<p class="muted small">Aucun champ : cliquez dans la page.</p>';
  fields.forEach((f, i) => {
    const row = document.createElement('div');
    row.className = 'field-row';
    row.innerHTML = `<input class="fname" value="${esc(f.name)}" title="Nom de colonne">
      <input class="fsel mono" value="${esc(f.selector || '')}" placeholder="(le bloc lui-même)" title="Sélecteur relatif">
      <select class="fattr">${ATTRS.map((a) => `<option ${a === (f.attr || 'text') ? 'selected' : ''}>${a}</option>`).join('')}</select>
      <select class="ftr" title="Nettoyage">${TRANSFORMS.map((a) => `<option value="${a}" ${a === (f.transform || '') ? 'selected' : ''}>${a || '—'}</option>`).join('')}</select>
      <button class="small danger" title="Supprimer">✕</button>`;
    row.querySelector('.fname').oninput = (e) => { f.name = e.target.value.trim(); syncRaw(); };
    row.querySelector('.fsel').oninput = (e) => { f.selector = e.target.value; syncRaw(); pushState(); };
    row.querySelector('.fattr').onchange = (e) => { f.attr = e.target.value; syncRaw(); };
    row.querySelector('.ftr').onchange = (e) => { f.transform = e.target.value || undefined; syncRaw(); };
    row.querySelector('button').onclick = () => { fields.splice(i, 1); renderFields(); syncRaw(); pushState(); schedulePreview(); };
    box.append(row);
  });
}
$('#btn-add-field').addEventListener('click', () => { task.extract.fields.push({ name: uniqueName('champ'), selector: '', attr: 'text' }); renderFields(); syncRaw(); });

function uniqueName(base) {
  const used = new Set((task.extract.fields || []).map((f) => f.name));
  let n = base, i = 2;
  while (used.has(n)) n = `${base}_${i++}`;
  return n;
}
function guessName(text, attr) {
  if (attr === 'href') return 'lien';
  if (attr === 'src') return 'image';
  const t = (text || '').trim();
  if (/\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|\b(janv|févr|mars|avril|mai|juin|juil|août|sept|oct|nov|déc|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-zé]*\.?\s+\d/i.test(t)) return 'date';
  if (/[€$£]|\b(EUR|USD|XOF|FCFA|CFA)\b/i.test(t) && /\d/.test(t)) return 'prix';
  if (/@[\w-]+\.\w/.test(t)) return 'email';
  if (!(task.extract.fields || []).length) return 'titre';
  return 'champ';
}

// ---- actions
const ACTION_TYPES = ['click', 'clickIfExists', 'type', 'press', 'select', 'check', 'wait', 'waitFor', 'scroll', 'goto'];
function renderActions() {
  const box = $('#actions-list');
  const actions = task.actions || (task.actions = []);
  box.innerHTML = '';
  actions.forEach((a, i) => {
    const row = document.createElement('div');
    row.className = 'field-row';
    row.innerHTML = `<select class="atype">${ACTION_TYPES.map((t) => `<option ${t === a.type ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <input class="asel mono" value="${esc(a.selector || '')}" placeholder="sélecteur">
      <input class="aval" value="${esc(a.value ?? a.ms ?? '')}" placeholder="valeur / ms">
      <label class="check small" title="Ne pas échouer si absent"><input type="checkbox" class="aopt" ${a.optional ? 'checked' : ''}>opt.</label>
      <button class="small danger">✕</button>`;
    row.querySelector('.atype').onchange = (e) => { a.type = e.target.value; syncRaw(); };
    row.querySelector('.asel').oninput = (e) => { a.selector = e.target.value; syncRaw(); };
    row.querySelector('.aval').oninput = (e) => { a.value = e.target.value; syncRaw(); };
    row.querySelector('.aopt').onchange = (e) => { a.optional = e.target.checked; syncRaw(); };
    row.querySelector('button').onclick = () => { actions.splice(i, 1); renderActions(); syncRaw(); };
    box.append(row);
  });
}
$('#btn-add-action').addEventListener('click', () => { task.actions.push({ type: 'clickIfExists', selector: '', optional: true }); renderActions(); syncRaw(); });

$('#cron-presets').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cron]');
  if (!b) return;
  setPath(task, 'schedule.cron', b.dataset.cron);
  setPath(task, 'schedule.enabled', true);
  bindForm();
});

// ================================================================== éditeur : aperçu visuel
let pickMode = 'field';
$('#pick-modes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (!b) return;
  pickMode = b.dataset.mode;
  $$('#pick-modes [data-mode]').forEach((x) => x.classList.toggle('active', x === b));
  pushState();
});

function pushState() {
  const f = $('#frame').contentWindow;
  if (!f) return;
  const fields = task.extract.mode === 'ai' ? [] : (task.extract.fields || []);
  f.postMessage({ __poulpe: true, type: 'state', state: {
    mode: pickMode, listSelector: task.extract.mode === 'list' ? task.extract.listSelector || '' : '',
    fields, next: task.pagination?.selector || '', singleMode: task.extract.mode === 'single',
  } }, '*');
}

window.addEventListener('message', (e) => {
  const m = e.data || {};
  if (!m.__poulpe || e.source !== $('#frame').contentWindow) return;
  if (m.type === 'ready') { pushState(); return; }
  if (m.type === 'count') { $('#item-count').textContent = task.extract.listSelector && task.extract.mode === 'list' ? `${m.count} bloc(s)` : ''; return; }
  if (m.type !== 'picked') return;
  if (m.kind === 'list') {
    task.extract.mode = 'list';
    task.extract.listSelector = m.listSelector;
    toast(`${m.count} blocs similaires sélectionnés.`);
  } else if (m.kind === 'next') {
    task.pagination = task.pagination || {};
    if (!['next', 'loadMore'].includes(task.pagination.type)) task.pagination.type = 'next';
    task.pagination.selector = m.selector;
    toast('Bouton de pagination enregistré.');
  } else if (m.kind === 'action') {
    task.actions.push({ type: 'click', selector: m.selector, optional: true });
    renderActions();
    toast(`Action « clic » ajoutée (${m.text.slice(0, 30) || m.selector}).`);
  } else if (m.kind === 'field' || m.kind === 'single') {
    if (m.kind === 'field') {
      if (task.extract.mode !== 'list' || !task.extract.listSelector) { task.extract.mode = 'list'; task.extract.listSelector = m.listSelector; }
    } else if (task.extract.mode === 'list' && task.extract.listSelector) {
      toast('Élément en dehors des blocs répétés : changez de bloc ou passez en mode « Page unique ».', 'error');
      return;
    } else task.extract.mode = 'single';
    const fields = task.extract.fields;
    if (!fields.some((f) => f.selector === m.selector && f.attr === m.attr)) {
      const guess = guessName(m.text, m.attr);
      const transform = guess === 'prix' ? 'number' : guess === 'date' ? 'date' : undefined;
      fields.push({ name: uniqueName(guess), selector: m.selector, attr: m.attr, ...(transform ? { transform } : {}) });
    }
    if (m.href && m.linkSelector !== undefined && !fields.some((f) => f.attr === 'href' && f.selector === m.linkSelector)) {
      fields.push({ name: uniqueName('lien'), selector: m.linkSelector, attr: 'href' });
    }
    const s = (m.samples || []).filter(Boolean).slice(0, 3).map((x) => x.slice(0, 40)).join(' · ');
    toast(m.kind === 'field' ? `Champ ajouté sur ${m.count} blocs${s ? ' : ' + s : ''}` : 'Champ ajouté.');
  }
  bindForm();
  pushState();
  schedulePreview();
});

async function loadPage(url) {
  readForm();
  if (!/^https?:\/\//i.test(url)) return toast('URL http(s) requise.', 'error');
  if (inspectId) api(`/api/inspect/${inspectId}`, { method: 'DELETE' }).catch(() => {});
  $('#frame-empty').hidden = true;
  $('#frame-loading').hidden = false;
  try {
    const r = await api('/api/inspect', { method: 'POST', body: { url, task: { id: task.id, actions: task.actions, browser: task.browser } } });
    inspectId = r.inspectId;
    $('#frame').src = withToken('/snapshot/' + r.snapshotId);
    if (!task.name) { task.name = r.title.slice(0, 60); $('#t-name').value = task.name; }
    if (task.extract.listSelector || task.extract.fields.length) schedulePreview();
  } catch (e) {
    toast(e.message, 'error');
    $('#frame-empty').hidden = false;
  } finally { $('#frame-loading').hidden = true; }
}
$('#btn-load').addEventListener('click', () => loadPage($('#t-url').value.trim()));
$('#t-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadPage(e.target.value.trim()); });

async function refreshSnapshot(body) {
  if (!inspectId) return toast('Chargez d\'abord la page.', 'error');
  $('#frame-loading').hidden = false;
  try {
    const r = await api(`/api/inspect/${inspectId}/refresh`, { method: 'POST', body });
    $('#frame').src = withToken('/snapshot/' + r.snapshotId);
    schedulePreview();
  } catch (e) { toast(e.message, 'error'); } finally { $('#frame-loading').hidden = true; }
}
$('#btn-replay').addEventListener('click', () => refreshSnapshot({ actions: task.actions }));
$('#btn-open-detail').addEventListener('click', async () => {
  const rows = lastPreview || [];
  const link = rows.map((r) => r[task.detail.linkField]).find((v) => /^https?:/.test(v || ''));
  if (!link) return toast(`Aucun lien dans la colonne « ${task.detail.linkField || '?'} » de l'aperçu.`, 'error');
  toast('Fiche ouverte : en mode « Désactivé », copiez les sélecteurs depuis les outils du navigateur, ou utilisez le mode IA.');
  refreshSnapshot({ navigate: link });
});

// ---- aperçu des données
let previewTimer = null, lastPreview = [];
function schedulePreview() { clearTimeout(previewTimer); previewTimer = setTimeout(runPreview, 500); }
async function runPreview() {
  if (!inspectId) return;
  if (task.extract.mode === 'ai' && !confirm('L\'aperçu en mode IA appelle Claude (payant). Continuer ?')) return;
  $('#preview-info').textContent = 'extraction…';
  try {
    const r = await api(`/api/inspect/${inspectId}/preview`, { method: 'POST', body: { extract: task.extract, filters: task.filters } });
    lastPreview = r.rows;
    $('#preview-info').textContent = `${r.count} ligne(s) sur cette page${r.kept !== r.count ? `, ${r.kept} après filtres` : ''}`;
    renderTable($('#preview-table'), r.rows);
  } catch (e) { $('#preview-info').textContent = e.message; }
}
$('#btn-preview').addEventListener('click', runPreview);

function renderTable(tbl, rows, max = 200) {
  if (!rows.length) { tbl.innerHTML = '<tr><td class="muted">Aucune ligne.</td></tr>'; return; }
  const cols = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k) && k !== '_key' && k !== '_last_seen') cols.push(k);
  const cell = (v) => {
    const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /^https?:\/\//.test(s) ? `<a href="${esc(s)}" target="_blank" rel="noopener">${esc(s.length > 60 ? s.slice(0, 60) + '…' : s)}</a>` : esc(s.length > 160 ? s.slice(0, 160) + '…' : s);
  };
  tbl.innerHTML = `<thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.slice(0, max).map((r) => `<tr>${cols.map((c) => `<td>${cell(r[c])}</td>`).join('')}</tr>`).join('')}</tbody>`;
}

// ---- détection auto
$('#btn-detect').addEventListener('click', (e) => busy(e.target, async () => {
  if (!inspectId) throw new Error('Chargez d\'abord la page.');
  const cands = await api(`/api/inspect/${inspectId}/detect`, { method: 'POST' });
  const box = $('#detect-results');
  box.innerHTML = cands.length ? '' : '<p class="muted small">Aucune liste répétée trouvée : essayez le mode IA.</p>';
  cands.forEach((c, i) => {
    const d = document.createElement('div');
    d.className = 'cand';
    const ex = c.preview[0] || {};
    d.innerHTML = `<div><b>Liste ${i + 1}</b> · ${c.count} blocs · ${c.fields.length} colonnes</div>
      <div class="muted small">${esc(Object.values(ex).filter(Boolean).slice(0, 3).join(' · ').slice(0, 140))}</div>
      <button class="small primary">Utiliser</button>`;
    d.querySelector('button').onclick = () => {
      task.extract = { ...task.extract, mode: 'list', listSelector: c.listSelector, fields: c.fields };
      bindForm(); pushState(); schedulePreview();
      toast('Liste appliquée : renommez ou supprimez les colonnes inutiles.');
    };
    d.addEventListener('mouseenter', () => $('#frame').contentWindow?.postMessage({ __poulpe: true, type: 'state', state: { listSelector: c.listSelector, fields: c.fields } }, '*'));
    d.addEventListener('mouseleave', pushState);
    box.append(d);
  });
}));

// ---- assistant IA
$('#btn-suggest').addEventListener('click', (e) => busy(e.target, async () => {
  if (!inspectId) throw new Error('Chargez d\'abord la page.');
  if (!window.AI_ON) throw new Error('Assistant IA désactivé : lancez le serveur avec ANTHROPIC_API_KEY.');
  const goal = $('#ai-goal').value.trim();
  if (!goal) throw new Error('Décrivez ce que vous voulez extraire.');
  const s = await api(`/api/inspect/${inspectId}/suggest`, { method: 'POST', body: { goal } });
  if (s.mode === 'ai' || (s.mode === 'list' && !s.previewCount)) {
    task.extract = { ...task.extract, mode: 'ai', ai: { instructions: goal, fields: s.aiFields.length ? s.aiFields.map((f) => ({ ...f, type: 'text' })) : s.fields.map((f) => ({ name: f.name, type: 'text', description: f.name })) } };
    $('#ai-explain').textContent = (s.explication || '') + ' → Mode IA retenu (les sélecteurs ne donnaient rien).';
  } else {
    task.extract = { ...task.extract, mode: s.mode, listSelector: s.listSelector, fields: s.fields };
    $('#ai-explain').textContent = `${s.explication} (${s.previewCount} ligne(s) trouvée(s))`;
  }
  if (s.pagination?.type && s.pagination.type !== 'none') task.pagination = { ...task.pagination, type: s.pagination.type, selector: s.pagination.selector };
  bindForm(); pushState(); schedulePreview();
}));

// ---- enregistrer / tester
async function saveTask() {
  readForm();
  if (!task.name) throw new Error('Donnez un nom à la tâche.');
  const saved = task.id ? await api(`/api/tasks/${task.id}`, { method: 'PUT', body: task }) : await api('/api/tasks', { method: 'POST', body: task });
  task = { ...task, id: saved.id };
  toast('Tâche enregistrée' + (saved.nextRun ? ` · prochaine exécution ${fmtDate(saved.nextRun)}` : '') + '.', 'ok');
  return saved;
}
$('#btn-save').addEventListener('click', (e) => busy(e.target, saveTask));
$('#btn-test').addEventListener('click', (e) => busy(e.target, async () => {
  const saved = await saveTask();
  await runTask(saved.id, saved.name, { maxPages: 2, trigger: 'test' });
}));

function openEditor(t) {
  task = JSON.parse(JSON.stringify(t));
  const b = blankTask();
  for (const k of Object.keys(b)) if (task[k] === undefined) task[k] = b[k];
  task.extract = { ...b.extract, ...task.extract };
  if (!task.extract.ai) task.extract.ai = { instructions: '', fields: [] };
  showTab('editor');
  bindForm();
  $('#preview-table').innerHTML = '';
  $('#detect-results').innerHTML = '';
  if (task.source?.type === 'api') {
    $('#frame-empty').hidden = false;
    $('#frame-empty').innerHTML = '<p><b>Tâche de type API JSON</b> : pas d\'aperçu visuel. Modifiez-la dans « JSON de la tâche » puis <b>Tester</b>.</p>';
  } else if (task.startUrls?.[0] || task.pagination?.urlTemplate) {
    loadPage(task.startUrls?.[0] || task.pagination.urlTemplate.replace(/\{page\}/g, String(task.pagination.from ?? 1)));
  } else {
    $('#frame').removeAttribute('src');
    $('#frame-empty').hidden = false;
  }
}

// ================================================================== modèles
async function loadTemplates() {
  const list = await api('/api/templates').catch((e) => { toast(e.message, 'error'); return []; });
  const box = $('#templates');
  box.innerHTML = '';
  for (const t of list) {
    const c = document.createElement('div');
    c.className = 'card tpl';
    c.innerHTML = `<div class="tag">${esc(t.category || '')}</div><h3>${esc(t.title)}</h3><p>${esc(t.description)}</p>
      ${t.notes ? `<p class="muted small">${esc(t.notes)}</p>` : ''}<button class="primary small">Utiliser ce modèle</button>`;
    c.querySelector('button').onclick = () => { openEditor({ ...t.task, id: undefined }); toast('Modèle chargé : ajustez puis enregistrez.'); };
    box.append(c);
  }
}

// ================================================================== données
async function loadDataTasks() {
  const tasks = await api('/api/tasks').catch(() => []);
  const sel = $('#data-task');
  const cur = sel.value;
  sel.innerHTML = tasks.map((t) => `<option value="${esc(t.id)}">${esc(t.name)} (${t.rows})</option>`).join('');
  if (cur && tasks.some((t) => t.id === cur)) sel.value = cur;
  loadData();
}
async function loadData() {
  const id = $('#data-task').value;
  if (!id) { $('#data-info').textContent = 'Aucune tâche.'; $('#data-table').innerHTML = ''; return; }
  const q = $('#data-q').value.trim();
  const since = $('#data-new').checked ? new Date(Date.now() - 864e5).toISOString() : '';
  const qs = new URLSearchParams({ ...(q ? { q } : {}), ...(since ? { since } : {}) }).toString();
  const r = await api(`/api/tasks/${id}/results?limit=1000&${qs}`).catch((e) => { toast(e.message, 'error'); return { total: 0, rows: [] }; });
  $('#data-info').textContent = `${r.total} ligne(s)${r.total > r.rows.length ? ` — ${r.rows.length} affichées` : ''}`;
  renderTable($('#data-table'), r.rows, 1000);
  for (const [elId, fmt] of [['#dl-csv', 'csv'], ['#dl-xlsx', 'xlsx'], ['#dl-json', 'download']]) $(elId).href = withToken(`/api/tasks/${id}/results?format=${fmt}&${qs}`);
}
$('#data-task').addEventListener('change', loadData);
$('#data-new').addEventListener('change', loadData);
$('#data-q').addEventListener('input', () => { clearTimeout(loadData.t); loadData.t = setTimeout(loadData, 300); });
$('#data-clear').addEventListener('click', async () => {
  const id = $('#data-task').value;
  if (id && confirm('Effacer toutes les lignes collectées de cette tâche ?')) { await api(`/api/tasks/${id}/results`, { method: 'DELETE' }); loadDataTasks(); }
});

// ================================================================== réglages
async function loadSettings() {
  const s = await api('/api/settings').catch(() => null);
  if (!s) return;
  const src = { reglages: `enregistrée dans Poulpe (…${esc(s.keyEnd)})`, environnement: 'fournie par la variable ANTHROPIC_API_KEY', jeton: 'fournie par un jeton' }[s.source];
  $('#key-status').innerHTML = s.ai ? `✅ IA active — modèle <code>${esc(s.model)}</code>, clé ${src}.` : '❌ IA désactivée : aucune clé enregistrée.';
  $('#btn-key-del').hidden = s.source !== 'reglages';
}
$('#btn-key-save').addEventListener('click', (e) => busy(e.target, async () => {
  const key = $('#api-key').value.trim();
  if (!key) throw new Error('Collez la clé dans le champ.');
  await api('/api/settings/key', { method: 'POST', body: { apiKey: key } });
  $('#api-key').value = '';
  toast('Clé vérifiée et enregistrée : l\'IA est active.', 'ok');
  loadSettings();
  refreshStatus();
}));
$('#btn-key-del').addEventListener('click', async () => {
  if (!confirm('Supprimer la clé enregistrée ?')) return;
  await api('/api/settings/key', { method: 'DELETE' });
  loadSettings();
  refreshStatus();
});

// ================================================================== démarrage
refreshStatus();
setInterval(refreshStatus, 15000);
loadTasks();
