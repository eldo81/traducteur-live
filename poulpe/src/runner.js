// Orchestration : file d'exécution, journaux en direct, sorties (fichiers, webhook), planification cron.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Cron } from 'croner';
import { execute } from './engine.js';
import * as store from './store.js';
import { toCSV, toXLSX, sendWebhook } from './export.js';

const MAX_PARALLEL = Number(process.env.POULPE_MAX_PARALLEL || 2);
const live = new Map(); // runId -> run
const queue = [];
let running = 0;

export function getLiveRun(runId) { return live.get(runId); }
export function activeRuns() { return Array.from(live.values()).filter((r) => ['queued', 'running'].includes(r.status)); }

export function startRun(taskId, opts = {}) {
  const task = store.getTask(taskId);
  if (!task) throw new Error('Tâche introuvable : ' + taskId);
  const already = activeRuns().find((r) => r.taskId === taskId);
  if (already) return already;
  const run = {
    runId: new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + crypto.randomBytes(2).toString('hex'),
    taskId, taskName: task.name, trigger: opts.trigger || 'manuel',
    status: 'queued', startedAt: null, endedAt: null, logs: [], rows: 0, newRows: 0, total: 0, errors: 0, stop: false,
  };
  live.set(run.runId, run);
  const p = new Promise((resolve) => queue.push({ run, opts, resolve }));
  run.done = p;
  pump();
  return run;
}

export function stopRun(runId) {
  const r = live.get(runId);
  if (r) r.stop = true;
  return !!r;
}

function pump() {
  while (running < MAX_PARALLEL && queue.length) {
    const job = queue.shift();
    running++;
    doRun(job.run, job.opts).finally(() => { running--; job.resolve(job.run); pump(); });
  }
}

async function doRun(run, opts) {
  const task = store.getTask(run.taskId);
  const log = (level, msg) => {
    run.logs.push({ t: new Date().toISOString(), level, msg });
    if (run.logs.length > 1000) run.logs.splice(0, run.logs.length - 1000);
    if (level === 'error') run.errors++;
    if (!opts.quiet) console.log(`[${run.taskId}] ${level.toUpperCase()} ${msg}`);
  };
  run.status = 'running';
  run.startedAt = new Date().toISOString();
  log('info', `Démarrage « ${task.name} » (${run.trigger})`);
  try {
    const { rows, stats } = await execute(task, { log, shouldStop: () => run.stop, maxPages: opts.maxPages, maxRows: opts.maxRows });
    const { added, total } = store.mergeResults(task.id, rows, task.dedupKey, { replace: task.incremental === false });
    run.rows = rows.length;
    run.newRows = added.length;
    run.total = total;
    run.stats = stats;
    log('info', `${rows.length} ligne(s) extraite(s), ${added.length} nouvelle(s), ${total} au total.`);
    await deliver(task, run, rows, added, log);
    run.status = run.stop ? 'stopped' : (stats.errors && !rows.length ? 'failed' : 'done');
  } catch (e) {
    run.status = 'failed';
    log('error', e.message);
  }
  run.endedAt = new Date().toISOString();
  const { done, ...persist } = run;
  store.saveRun(task.id, { ...persist, logs: run.logs.slice(-300) });
  setTimeout(() => live.delete(run.runId), 10 * 60 * 1000);
}

async function deliver(task, run, rows, added, log) {
  const out = task.outputs || {};
  const subset = out.onlyNew === false ? rows : added;
  if (out.webhook?.url && (subset.length || out.webhook.sendEmpty)) {
    try {
      await sendWebhook(out.webhook.url, { task: task.name, taskId: task.id, runId: run.runId, newRows: added.length, totalRows: run.total, onlyNew: out.onlyNew !== false }, subset, log);
      log('info', `Webhook : ${subset.length} ligne(s) envoyée(s).`);
    } catch (e) { log('error', 'Webhook : ' + e.message); }
  }
  if (out.folder) {
    try {
      const dir = path.resolve(out.folder);
      fs.mkdirSync(dir, { recursive: true });
      const all = store.readResults(task.id);
      const base = path.join(dir, store.slugify(task.name));
      if (out.csv !== false) fs.writeFileSync(base + '.csv', toCSV(all));
      if (out.xlsx) fs.writeFileSync(base + '.xlsx', await toXLSX(all, task.name));
      log('info', `Fichiers écrits dans ${dir}`);
    } catch (e) { log('error', 'Export fichier : ' + e.message); }
  }
}

// ------------------------------------------------------------------ planification
const jobs = new Map();

export function schedule(task) {
  unschedule(task.id);
  const s = task.schedule;
  if (!s || !s.enabled || !s.cron) return null;
  try {
    const job = new Cron(s.cron, { timezone: s.timezone || 'Africa/Dakar', protect: true }, () => {
      try { startRun(task.id, { trigger: 'planifié' }); } catch (e) { console.error(e.message); }
    });
    jobs.set(task.id, job);
    return job.nextRun();
  } catch (e) {
    throw new Error('Expression cron invalide : ' + e.message);
  }
}
export function unschedule(id) { const j = jobs.get(id); if (j) { j.stop(); jobs.delete(id); } }
export function nextRunOf(id) { const j = jobs.get(id); return j ? j.nextRun() : null; }
export function scheduleAll() {
  for (const t of store.listTasks()) { try { schedule(t); } catch (e) { console.error(`[${t.id}] ${e.message}`); } }
  return jobs.size;
}
