// Stockage local en fichiers JSON : aucune base de données à installer.
// data/tasks/<id>.json        configuration des tâches
// data/results/<id>.jsonl     toutes les lignes collectées (dédoublonnées)
// data/runs/<id>.json         historique des exécutions (50 dernières)
// data/sessions/<id>.json     cookies / session de connexion (Playwright storageState)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { rowKey } from './transforms.js';

export const DATA_DIR = path.resolve(process.env.POULPE_DATA || path.join(process.cwd(), 'data'));
const dirs = ['tasks', 'results', 'runs', 'sessions', 'snapshots', 'exports'];
for (const d of dirs) fs.mkdirSync(path.join(DATA_DIR, d), { recursive: true });

const safeId = (id) => {
  if (!/^[\w-]{1,80}$/.test(String(id))) throw new Error('Identifiant invalide : ' + id);
  return id;
};
const p = (dir, id, ext = '.json') => path.join(DATA_DIR, dir, safeId(id) + ext);

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJSON(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export function slugify(s) {
  return String(s || 'tache').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'tache';
}

export function newId(name) {
  return slugify(name) + '-' + crypto.randomBytes(3).toString('hex');
}

// ------------------------------------------------------------------ tâches
export function listTasks() {
  return fs.readdirSync(path.join(DATA_DIR, 'tasks')).filter((f) => f.endsWith('.json'))
    .map((f) => readJSON(path.join(DATA_DIR, 'tasks', f), null)).filter(Boolean)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}
export function getTask(id) { return readJSON(p('tasks', id), null); }
export function saveTask(task) {
  if (!task.id) task.id = newId(task.name);
  task.updatedAt = new Date().toISOString();
  task.createdAt = task.createdAt || task.updatedAt;
  writeJSON(p('tasks', task.id), task);
  return task;
}
export function deleteTask(id) {
  for (const [dir, ext] of [['tasks', '.json'], ['results', '.jsonl'], ['runs', '.json'], ['sessions', '.json']]) {
    try { fs.unlinkSync(p(dir, id, ext)); } catch { /* absent */ }
  }
}

// ------------------------------------------------------------------ résultats
export function readResults(id) {
  const file = p('results', id, '.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/**
 * Ajoute les lignes en dédoublonnant sur dedupKey.
 * Une ligne déjà connue est mise à jour (_last_seen) ; une ligne nouvelle reçoit _first_seen.
 * Renvoie { added: [...], total }.
 */
export function mergeResults(id, rows, dedupKey, { replace = false } = {}) {
  const now = new Date().toISOString();
  const existing = replace ? [] : readResults(id);
  const index = new Map(existing.map((r) => [r._key, r]));
  const added = [];
  for (const row of rows) {
    const key = rowKey(row, dedupKey);
    const prev = index.get(key);
    if (prev) {
      index.set(key, { ...prev, ...row, _key: key, _first_seen: prev._first_seen, _last_seen: now });
    } else {
      const r = { ...row, _key: key, _first_seen: now, _last_seen: now };
      index.set(key, r);
      added.push(r);
    }
  }
  const all = Array.from(index.values());
  fs.writeFileSync(p('results', id, '.jsonl'), all.map((r) => JSON.stringify(r)).join('\n') + (all.length ? '\n' : ''));
  return { added, total: all.length };
}
export function clearResults(id) { try { fs.unlinkSync(p('results', id, '.jsonl')); } catch { /* absent */ } }

// ------------------------------------------------------------------ exécutions
export function listRuns(id) { return readJSON(p('runs', id), []); }
export function saveRun(id, run) {
  const runs = listRuns(id).filter((r) => r.runId !== run.runId);
  runs.unshift(run);
  writeJSON(p('runs', id), runs.slice(0, 50));
}

// ------------------------------------------------------------------ sessions
export const sessionFile = (id) => p('sessions', id);
export function hasSession(id) { return fs.existsSync(sessionFile(id)); }
export function clearSession(id) { try { fs.unlinkSync(sessionFile(id)); } catch { /* absent */ } }

// ------------------------------------------------------------------ aperçus
export function saveSnapshot(html) {
  const id = crypto.randomBytes(8).toString('hex');
  fs.writeFileSync(path.join(DATA_DIR, 'snapshots', id + '.html'), html);
  // Ménage : on ne garde que les 30 derniers aperçus.
  const dir = path.join(DATA_DIR, 'snapshots');
  const files = fs.readdirSync(dir).map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
  for (const { f } of files.slice(30)) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ } }
  return id;
}
export function readSnapshot(id) {
  if (!/^[a-f0-9]{16}$/.test(id)) return null;
  try { return fs.readFileSync(path.join(DATA_DIR, 'snapshots', id + '.html'), 'utf8'); } catch { return null; }
}

// ------------------------------------------------------------------ réglages (clé API saisie dans l'interface)
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
export function readConfig() { return readJSON(CONFIG_FILE, {}); }
export function writeConfig(cfg) {
  writeJSON(CONFIG_FILE, cfg);
  try { fs.chmodSync(CONFIG_FILE, 0o600); } catch { /* Windows : sans effet */ }
}
