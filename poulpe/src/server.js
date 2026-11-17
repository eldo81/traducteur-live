// Serveur Poulpe : interface web + API REST.
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import * as store from './store.js';
import * as runner from './runner.js';
import { launch, gotoWithRetry, runActions, extractPage, defaultsFor } from './engine.js';
import { toCSV, toXLSX, toJSON } from './export.js';
import { suggestConfig, aiAvailable, aiUsage, AI_MODEL, setApiKey, keySource, testKey } from './ai.js';
import { cleanRow, passFilters } from './transforms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const TOKEN = process.env.POULPE_TOKEN || '';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '5mb' }));

  // Jeton facultatif (obligatoire si le serveur est exposé hors de la machine).
  app.use('/api', (req, res, next) => {
    if (!TOKEN) return next();
    const got = (req.get('authorization') || '').replace(/^Bearer\s+/i, '') || req.query.token;
    if (got && crypto.timingSafeEqual(Buffer.from(String(got).padEnd(64)), Buffer.from(TOKEN.padEnd(64)))) return next();
    res.status(401).json({ error: 'Jeton manquant ou invalide (POULPE_TOKEN).' });
  });

  const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
    console.error(e);
    res.status(e.status || 500).json({ error: e.message });
  });
  const notFound = (msg) => Object.assign(new Error(msg), { status: 404 });

  // Clé API enregistrée depuis l'interface.
  const cfg = store.readConfig();
  if (cfg.anthropicApiKey) setApiKey(cfg.anthropicApiKey);

  // ---------------------------------------------------------------- réglages
  app.get('/api/settings', (req, res) => {
    const c = store.readConfig();
    res.json({ ai: aiAvailable(), source: keySource(), keyEnd: c.anthropicApiKey ? c.anthropicApiKey.slice(-4) : '', model: AI_MODEL });
  });
  app.post('/api/settings/key', wrap(async (req, res) => {
    const key = String(req.body?.apiKey || '').trim().replace(/^["']|["']$/g, '');
    if (!key.startsWith('sk-ant-')) throw Object.assign(new Error('Ce n\'est pas une clé Anthropic : elle doit commencer par sk-ant-api03-…'), { status: 400 });
    if (!key.startsWith('sk-ant-api')) throw Object.assign(new Error('Cette clé n\'est pas une clé API (elle doit commencer par sk-ant-api03-). Créez-la sur console.anthropic.com → API Keys.'), { status: 400 });
    try {
      await testKey(key);
    } catch (e) {
      const st = e.status || 0;
      if (st === 401 || st === 403) throw Object.assign(new Error('Clé refusée par Anthropic (révoquée ou mal copiée).'), { status: 400 });
      if (st !== 404) throw Object.assign(new Error('Impossible de vérifier la clé : ' + e.message + '. Vérifiez votre connexion Internet.'), { status: 502 });
    }
    store.writeConfig({ ...store.readConfig(), anthropicApiKey: key });
    setApiKey(key);
    res.json({ ok: true, ai: true, keyEnd: key.slice(-4), model: AI_MODEL });
  }));
  app.delete('/api/settings/key', wrap((req, res) => {
    const c = store.readConfig();
    delete c.anthropicApiKey;
    store.writeConfig(c);
    setApiKey('');
    res.json({ ok: true, ai: aiAvailable() });
  }));

  // ---------------------------------------------------------------- infos
  app.get('/api/status', (req, res) => res.json({
    ai: aiAvailable(), model: AI_MODEL, aiUsage: aiUsage(), active: runner.activeRuns().map(strip), version: '1.0.0', tokenRequired: !!TOKEN,
  }));

  // ---------------------------------------------------------------- tâches
  app.get('/api/tasks', wrap((req, res) => {
    res.json(store.listTasks().map((t) => {
      const runs = store.listRuns(t.id);
      return { ...t, lastRun: runs[0] ? { ...runs[0], logs: undefined } : null, nextRun: runner.nextRunOf(t.id), rows: store.readResults(t.id).length, session: store.hasSession(t.id) };
    }));
  }));
  app.get('/api/tasks/:id', wrap((req, res) => {
    const t = store.getTask(req.params.id);
    if (!t) throw notFound('Tâche introuvable');
    res.json(t);
  }));
  app.post('/api/tasks', wrap((req, res) => {
    const t = { ...req.body };
    delete t.id;
    validate(t);
    const saved = store.saveTask(t);
    runner.schedule(saved);
    res.status(201).json(saved);
  }));
  app.put('/api/tasks/:id', wrap((req, res) => {
    const prev = store.getTask(req.params.id);
    if (!prev) throw notFound('Tâche introuvable');
    const t = { ...req.body, id: prev.id, createdAt: prev.createdAt };
    validate(t);
    const saved = store.saveTask(t);
    runner.schedule(saved);
    res.json({ ...saved, nextRun: runner.nextRunOf(saved.id) });
  }));
  app.delete('/api/tasks/:id', wrap((req, res) => {
    runner.unschedule(req.params.id);
    store.deleteTask(req.params.id);
    res.json({ ok: true });
  }));
  app.post('/api/tasks/:id/duplicate', wrap((req, res) => {
    const t = store.getTask(req.params.id);
    if (!t) throw notFound('Tâche introuvable');
    const copy = { ...t, id: undefined, name: t.name + ' (copie)', schedule: { ...(t.schedule || {}), enabled: false } };
    res.status(201).json(store.saveTask(copy));
  }));

  // ---------------------------------------------------------------- exécutions
  app.post('/api/tasks/:id/run', wrap((req, res) => {
    const run = runner.startRun(req.params.id, { trigger: req.body?.trigger || 'manuel', maxPages: req.body?.maxPages, maxRows: req.body?.maxRows });
    res.status(202).json(strip(run));
  }));
  // Déclenchement externe (n8n, cron système, Zapier) : POST /api/hooks/run/<id>?token=…
  app.post('/api/hooks/run/:id', wrap(async (req, res) => {
    const run = runner.startRun(req.params.id, { trigger: 'webhook' });
    if (req.query.wait === '1') {
      await run.done;
      const rows = store.readResults(req.params.id).filter((r) => r._first_seen >= run.startedAt);
      return res.json({ ...strip(run), rows });
    }
    res.status(202).json(strip(run));
  }));
  app.get('/api/runs/:runId', wrap((req, res) => {
    const live = runner.getLiveRun(req.params.runId);
    if (live) return res.json(strip(live));
    const taskId = req.query.task;
    const r = taskId && store.listRuns(taskId).find((x) => x.runId === req.params.runId);
    if (!r) throw notFound('Exécution introuvable');
    res.json(r);
  }));
  app.post('/api/runs/:runId/stop', wrap((req, res) => res.json({ ok: runner.stopRun(req.params.runId) })));
  app.get('/api/tasks/:id/runs', wrap((req, res) => res.json(store.listRuns(req.params.id).map((r) => ({ ...r, logs: undefined })))));

  // ---------------------------------------------------------------- résultats
  app.get('/api/tasks/:id/results', wrap(async (req, res) => {
    const t = store.getTask(req.params.id);
    if (!t) throw notFound('Tâche introuvable');
    let rows = store.readResults(t.id);
    if (req.query.since) rows = rows.filter((r) => r._first_seen >= req.query.since);
    if (req.query.q) { const q = String(req.query.q).toLowerCase(); rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q)); }
    rows.sort((a, b) => String(b._first_seen).localeCompare(String(a._first_seen)));
    const name = store.slugify(t.name) + '-' + new Date().toISOString().slice(0, 10);
    const format = req.query.format || 'json';
    if (format === 'csv') {
      res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="${name}.csv"`);
      return res.send(toCSV(rows, req.query.sep === 'comma' ? ',' : ';'));
    }
    if (format === 'xlsx') {
      res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').set('Content-Disposition', `attachment; filename="${name}.xlsx"`);
      return res.send(await toXLSX(rows, t.name));
    }
    if (format === 'download') {
      res.set('Content-Type', 'application/json').set('Content-Disposition', `attachment; filename="${name}.json"`);
      return res.send(toJSON(rows));
    }
    const limit = Math.min(Number(req.query.limit || 500), 5000);
    res.json({ total: rows.length, rows: rows.slice(0, limit) });
  }));
  app.delete('/api/tasks/:id/results', wrap((req, res) => { store.clearResults(req.params.id); res.json({ ok: true }); }));
  app.delete('/api/tasks/:id/session', wrap((req, res) => { store.clearSession(req.params.id); res.json({ ok: true }); }));

  // ---------------------------------------------------------------- modèles
  app.get('/api/templates', wrap((req, res) => {
    const dir = path.join(ROOT, 'templates');
    res.json(fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) })));
  }));

  // ---------------------------------------------------------------- inspecteur (éditeur visuel)
  app.post('/api/inspect', wrap(async (req, res) => {
    const { url, task = {} } = req.body || {};
    if (!/^https?:\/\//i.test(url || '')) throw Object.assign(new Error('URL http(s) requise.'), { status: 400 });
    const s = await openInspector(url, task);
    const snap = await snapshot(s, req);
    res.json({ inspectId: s.id, snapshotId: snap, url: s.page.url(), title: await s.page.title() });
  }));
  app.post('/api/inspect/:id/refresh', wrap(async (req, res) => {
    const s = getInspector(req.params.id);
    if (req.body?.actions?.length) await runActions(s.page, req.body.actions, s.opts, () => {});
    if (req.body?.navigate) await gotoWithRetry(s.page, req.body.navigate, s.opts, () => {});
    res.json({ snapshotId: await snapshot(s, req), url: s.page.url() });
  }));
  app.post('/api/inspect/:id/detect', wrap(async (req, res) => {
    const s = getInspector(req.params.id);
    res.json(await s.page.evaluate(() => window.__poulpe.detectLists(6)));
  }));
  app.post('/api/inspect/:id/preview', wrap(async (req, res) => {
    const s = getInspector(req.params.id);
    const ex = req.body.extract || {};
    let rows = await extractPage(s.page, ex, () => {});
    const fields = ex.fields || [];
    rows = rows.map((r) => cleanRow(r, fields, s.page.url()));
    const kept = rows.filter((r) => passFilters(r, req.body.filters));
    res.json({ count: rows.length, kept: kept.length, rows: kept.slice(0, 50) });
  }));
  app.post('/api/inspect/:id/suggest', wrap(async (req, res) => {
    if (!aiAvailable()) throw Object.assign(new Error('Assistant IA indisponible : définissez ANTHROPIC_API_KEY.'), { status: 400 });
    const s = getInspector(req.params.id);
    const [outline, candidates] = await Promise.all([
      s.page.evaluate(() => window.__poulpe.outline(80000)),
      s.page.evaluate(() => window.__poulpe.detectLists(4).map((c) => ({ listSelector: c.listSelector, count: c.count, fields: c.fields, exemple: c.preview[0] }))),
    ]);
    const sug = await suggestConfig({ url: s.page.url(), goal: req.body.goal || 'Extraire la liste principale', outline, candidates });
    let preview = [];
    if (sug.mode !== 'ai') {
      preview = await extractPage(s.page, { mode: sug.mode, listSelector: sug.listSelector, fields: sug.fields }, () => {}).catch(() => []);
    }
    res.json({ ...sug, preview: preview.slice(0, 10), previewCount: preview.length });
  }));
  app.post('/api/inspect/:id/save-session', wrap(async (req, res) => {
    const s = getInspector(req.params.id);
    if (!req.body.taskId) throw Object.assign(new Error('taskId requis'), { status: 400 });
    await s.context.storageState({ path: store.sessionFile(req.body.taskId) });
    res.json({ ok: true });
  }));
  app.delete('/api/inspect/:id', wrap(async (req, res) => { await closeInspector(req.params.id); res.json({ ok: true }); }));

  // Aperçu figé de la page : scripts du site supprimés, seuls nos scripts s'exécutent (CSP).
  app.get('/snapshot/:id', (req, res) => {
    const html = store.readSnapshot(req.params.id);
    if (!html) return res.status(404).send('Aperçu expiré : rechargez la page.');
    res.set('Content-Security-Policy', "script-src 'self'; form-action 'none'; frame-ancestors 'self'; object-src 'none'");
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  });

  app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));
  return app;
}

function strip(run) {
  if (!run) return run;
  const { done, stop, ...r } = run;
  return r;
}

function validate(t) {
  if (!t.name || !String(t.name).trim()) throw Object.assign(new Error('Nom de tâche requis.'), { status: 400 });
  if (t.schedule?.enabled && !t.schedule.cron) throw Object.assign(new Error('Planification active sans expression cron.'), { status: 400 });
}

// ------------------------------------------------------------------ sessions d'inspection
const inspectors = new Map();
const INSPECT_TTL = 15 * 60 * 1000;

async function openInspector(url, task) {
  const id = crypto.randomBytes(6).toString('hex');
  const h = await launch({ ...task, browser: { ...(task.browser || {}), blockResources: false } });
  const page = await h.context.newPage();
  const s = { id, ...h, page, touched: Date.now() };
  inspectors.set(id, s);
  try {
    await gotoWithRetry(page, url, { ...defaultsFor(task), retries: 2 }, () => {});
    if (task.actions?.length) await runActions(page, task.actions, h.opts, () => {});
  } catch (e) {
    await closeInspector(id);
    throw e;
  }
  return s;
}
function getInspector(id) {
  const s = inspectors.get(id);
  if (!s) throw Object.assign(new Error('Session d\'inspection expirée : rechargez la page.'), { status: 410 });
  s.touched = Date.now();
  return s;
}
async function closeInspector(id) {
  const s = inspectors.get(id);
  inspectors.delete(id);
  if (s) await s.browser.close().catch(() => {});
}
setInterval(() => {
  for (const [id, s] of inspectors) if (Date.now() - s.touched > INSPECT_TTL) closeInspector(id);
}, 60 * 1000).unref();

async function snapshot(s, req) {
  const origin = `${req.protocol}://${req.get('host')}`;
  const html = await s.page.evaluate((origin) => {
    const doc = document.documentElement.cloneNode(true);
    doc.querySelectorAll('script, noscript, iframe, object, embed, base, meta[http-equiv], link[rel="preload"], link[rel="modulepreload"], link[rel="prefetch"]').forEach((n) => n.remove());
    for (const el of doc.querySelectorAll('*')) {
      for (const a of Array.from(el.attributes)) {
        if (/^on/i.test(a.name)) el.removeAttribute(a.name);
        else if (/^(href|src|action|formaction)$/i.test(a.name) && /^\s*javascript:/i.test(a.value)) el.setAttribute(a.name, '#');
      }
    }
    // Valeurs saisies dans les formulaires et images chargées en différé.
    doc.querySelectorAll('img[data-src]:not([src]), img[loading="lazy"][data-src]').forEach((i) => i.setAttribute('src', i.getAttribute('data-src')));
    let head = doc.querySelector('head');
    if (!head) { head = document.createElement('head'); doc.prepend(head); }
    const base = document.createElement('base');
    base.href = location.href;
    head.prepend(base);
    const meta = document.createElement('meta');
    meta.setAttribute('charset', 'utf-8');
    head.prepend(meta);
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = origin + '/lib/picker.css';
    head.append(css);
    for (const f of ['domkit.js', 'picker.js']) {
      const sc = document.createElement('script');
      sc.src = origin + '/lib/' + f;
      doc.querySelector('body')?.append(sc);
    }
    return '<!doctype html>\n' + doc.outerHTML;
  }, origin);
  return store.saveSnapshot(html);
}

// ------------------------------------------------------------------ démarrage
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp();
  const n = runner.scheduleAll();
  app.listen(PORT, HOST, () => {
    console.log(`Poulpe prêt : http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    console.log(`Données : ${store.DATA_DIR} · ${n} tâche(s) planifiée(s) · IA : ${aiAvailable() ? AI_MODEL : 'désactivée (ANTHROPIC_API_KEY absent)'}`);
    if (HOST !== '127.0.0.1' && HOST !== 'localhost' && !TOKEN) console.warn('ATTENTION : serveur exposé sans POULPE_TOKEN.');
  });
}
