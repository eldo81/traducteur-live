import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startSite } from './site.js';

process.env.POULPE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'poulpe-test-'));
const { toNumber, toISODate, applyField, passFilters } = await import('../src/transforms.js');
const engine = await import('../src/engine.js');
const store = await import('../src/store.js');
const runner = await import('../src/runner.js');
const ai = await import('../src/ai.js');
const { createApp } = await import('../src/server.js');
const { toCSV, toXLSX } = await import('../src/export.js');

let site, app, appUrl;
const log = () => {};
const fast = { respectRobots: true, blockResources: true, delayMs: [0, 10], retries: 1, timeoutMs: 15000 };

before(async () => {
  site = await startSite();
  await new Promise((r) => { app = createApp().listen(0, '127.0.0.1', r); });
  appUrl = `http://127.0.0.1:${app.address().port}`;
});
after(() => { site.server.closeAllConnections?.(); site.server.close(); app.closeAllConnections?.(); app.close(); });

test('nettoyage : nombres, dates, filtres', () => {
  assert.equal(toNumber('1 234,56 €'), 1234.56);
  assert.equal(toNumber('$2,500.00'), 2500);
  assert.equal(toNumber('7.40-8.20 USD/kg'), 7.4);
  assert.equal(toNumber('12,5'), 12.5);
  assert.equal(toISODate('17/11/2026'), '2026-11-17');
  assert.equal(toISODate('5 décembre 2026'), '2026-12-05');
  assert.equal(toISODate('Nov 3, 2026'), '2026-11-03');
  assert.equal(applyField('Réf : AO-2026-114 (lot 2)', { regex: 'AO-[\\d-]+' }), 'AO-2026-114');
  assert.equal(applyField('/a/b', { transform: 'absUrl' }, 'https://x.org/c/'), 'https://x.org/a/b');
  assert.equal(applyField('Tel +221 77 123 45 67', { transform: 'phone' }), '+221771234567');
  assert.ok(passFilters({ pays: 'Senegal' }, [{ field: 'pays', op: 'containsAny', value: 'Mali,Senegal' }]));
  assert.ok(!passFilters({ d: '2000-01-01' }, [{ field: 'd', op: 'after', value: 'today' }]));
});

test('liste + pagination par lien + pages de détail + nettoyage', async () => {
  const task = {
    id: 'liste', name: 'Liste', startUrls: [site.url + '/list'],
    extract: { mode: 'list', listSelector: '.results > .card', fields: [
      { name: 'titre', selector: 'h2 a', attr: 'text' },
      { name: 'prix', selector: '.price', attr: 'text', transform: 'number' },
      { name: 'date', selector: '.date', attr: 'text', transform: 'date' },
      { name: 'lien', selector: 'h2 a', attr: 'href' },
    ] },
    pagination: { type: 'next', selector: 'a.next', maxPages: 10 },
    detail: { enabled: true, linkField: 'lien', mode: 'single', concurrency: 3, fields: [
      { name: 'description', selector: '.long', attr: 'text' }, { name: 'pdf', selector: 'a.pdf', attr: 'href' },
    ] },
    filters: [{ field: 'prix', op: 'gt', value: 1001 }],
    browser: fast,
  };
  const { rows, stats } = await engine.execute(task, { log });
  assert.equal(stats.errors, 0);
  assert.equal(rows.length, 13, 'filtre prix > 1001 : 15 - 2');
  const r = rows.find((x) => x.titre === 'Article 5');
  assert.equal(r.prix, 1002.5);
  assert.equal(r.date, '2026-11-06');
  assert.equal(r.description, "Description complète de l'article 5.");
  assert.equal(r.pdf, site.url + '/doc/5.pdf');
});

test('pagination JavaScript (bouton sans lien)', async () => {
  const task = { name: 'js', startUrls: [site.url + '/js-list'],
    extract: { mode: 'list', listSelector: '#res > .row', fields: [{ name: 'nom', selector: '.name', attr: 'text' }, { name: 'val', selector: '.val', attr: 'text', transform: 'number' }] },
    pagination: { type: 'next', selector: '#nx', maxPages: 10 }, browser: fast };
  const { rows } = await engine.execute(task, { log });
  assert.deepEqual(rows.map((r) => r.val), [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
});

test('défilement infini', async () => {
  const task = { name: 'scroll', startUrls: [site.url + '/scroll'],
    extract: { mode: 'list', listSelector: '#feed > article.post', fields: [{ name: 't', selector: '.t', attr: 'text' }] },
    pagination: { type: 'scroll', maxScrolls: 10, waitMs: 400 }, browser: fast };
  const { rows } = await engine.execute(task, { log });
  assert.equal(rows.length, 15);
});

test('robots.txt est respecté', async () => {
  const task = { name: 'priv', startUrls: [site.url + '/private'], extract: { mode: 'single', fields: [{ name: 'p', selector: 'p' }] }, browser: fast };
  const { rows, stats } = await engine.execute(task, { log });
  assert.equal(rows.length, 0);
  assert.equal(stats.errors, 1);
});

test('source API JSON (GET et POST) avec valeurs multilingues', async () => {
  const task = { name: 'api', source: { type: 'api', url: site.url + '/api?page={page}', itemsPath: 'data.items', pageSize: 3, maxPages: 5,
    fields: [{ name: 'id', path: 'id' }, { name: 'titre', path: 'title' }, { name: 'acheteur', path: 'buyer.name' }, { name: 'tags', path: 'tags' }],
    linkTemplate: 'https://exemple.org/avis/{item.id}' } };
  const { rows } = await engine.execute(task, { log });
  assert.equal(rows.length, 6);
  assert.equal(rows[0].titre, 'Avis 1');
  assert.equal(rows[0].tags, 'a | b');
  assert.equal(rows[5].lien, 'https://exemple.org/avis/6');
  const post = { name: 'post', source: { type: 'api', method: 'POST', url: site.url + '/api-post', body: { page: '{page}', q: 'd>={today-7:compact}' }, itemsPath: 'notices', pageSize: 1, maxPages: 3 } };
  const r2 = await engine.execute(post, { log });
  assert.equal(r2.rows[0].typeOfPage, 'number');
});

test('détection automatique des listes', async () => {
  const h = await engine.launch({ browser: fast });
  try {
    const page = await h.context.newPage();
    await page.goto(site.url + '/list');
    const c = await page.evaluate(() => window.__poulpe.detectLists(3));
    assert.ok(c.length >= 1);
    assert.equal(c[0].count, 5);
    assert.match(c[0].listSelector, /card/);
    const names = c[0].fields.map((f) => f.name);
    assert.ok(names.includes('lien'));
    assert.ok(names.includes('prix'));
    assert.equal(c[0].preview[0].lien, site.url + '/item/1');
  } finally { await h.browser.close(); }
});

test('exécution complète : dédoublonnage incrémental, exports', async () => {
  const task = store.saveTask({ name: 'Incrémental', startUrls: [site.url + '/list'],
    extract: { mode: 'list', listSelector: '.results > .card', fields: [{ name: 'titre', selector: 'h2 a' }, { name: 'lien', selector: 'h2 a', attr: 'href' }] },
    pagination: { type: 'next', selector: 'a.next', maxPages: 2 }, dedupKey: ['lien'], browser: fast });
  const r1 = runner.startRun(task.id, { quiet: true });
  await r1.done;
  assert.equal(r1.status, 'done');
  assert.equal(r1.newRows, 10);
  task.pagination.maxPages = 3;
  store.saveTask(task);
  const r2 = runner.startRun(task.id, { quiet: true });
  await r2.done;
  assert.equal(r2.newRows, 5);
  assert.equal(r2.total, 15);
  const rows = store.readResults(task.id);
  const csv = toCSV(rows);
  assert.ok(csv.startsWith('﻿titre;lien;'));
  assert.equal(csv.trim().split('\r\n').length, 16);
  const x = await toXLSX(rows, 'Test');
  assert.equal(x.subarray(0, 2).toString(), 'PK');
});

test('API HTTP : tâche, exécution, résultats, inspecteur visuel', async () => {
  const j = async (p, opts = {}) => {
    const res = await fetch(appUrl + p, { ...opts, headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    return { status: res.status, data: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text(), headers: res.headers };
  };
  const created = await j('/api/tasks', { method: 'POST', body: { name: 'Via API', startUrls: [site.url + '/list'],
    extract: { mode: 'list', listSelector: '.results > .card', fields: [{ name: 'titre', selector: 'h2 a' }] }, browser: fast } });
  assert.equal(created.status, 201);
  const id = created.data.id;
  const run = await j(`/api/hooks/run/${id}?wait=1`, { method: 'POST' });
  assert.equal(run.data.status, 'done');
  assert.equal(run.data.rows.length, 5);
  const csv = await j(`/api/tasks/${id}/results?format=csv`);
  assert.match(csv.headers.get('content-disposition'), /\.csv/);
  const tpl = await j('/api/templates');
  assert.ok(tpl.data.length >= 5);

  const ins = await j('/api/inspect', { method: 'POST', body: { url: site.url + '/list' } });
  assert.equal(ins.status, 200);
  const snap = await j('/snapshot/' + ins.data.snapshotId);
  assert.ok(!/<script>/.test(snap.data), 'scripts du site retirés');
  assert.match(snap.data, /lib\/picker\.js/);
  assert.match(snap.headers.get('content-security-policy'), /script-src 'self'/);
  const det = await j(`/api/inspect/${ins.data.inspectId}/detect`, { method: 'POST' });
  assert.equal(det.data[0].count, 5);
  const prev = await j(`/api/inspect/${ins.data.inspectId}/preview`, { method: 'POST', body: { extract: { mode: 'list', listSelector: det.data[0].listSelector, fields: det.data[0].fields } } });
  assert.equal(prev.data.count, 5);
  await j(`/api/inspect/${ins.data.inspectId}`, { method: 'DELETE' });
});

test('IA : extraction et enrichissement (client simulé)', async () => {
  const calls = [];
  ai.setClient({ beta: { messages: { stream: (params) => { calls.push(params); return { finalMessage: async () => {
    const schemaKeys = Object.keys(params.output_config.format.schema.properties);
    const payload = schemaKeys.includes('items') ? { items: [{ titre: 'Avis A', date_limite: '2026-12-01' }] } : { results: [{ _i: 0, pertinent: true }] };
    return { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'text', text: JSON.stringify(payload) }] };
  } }; } } } });
  const task = { name: 'ia', startUrls: [site.url + '/list'],
    extract: { mode: 'ai', ai: { instructions: 'avis', fields: [{ name: 'titre' }, { name: 'date_limite', type: 'date' }] } },
    enrich: { enabled: true, prompt: 'pertinent ?', fields: [{ name: 'pertinent', type: 'boolean' }] },
    postFilters: [{ field: 'pertinent', op: 'equals', value: 'true' }], browser: fast };
  const { rows } = await engine.execute(task, { log });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pertinent, true);
  assert.equal(calls[0].model, 'claude-opus-5-5');
  assert.equal(calls[0].fallbacks, 'default');
  assert.match(calls[0].messages[0].content, /Article 1/);
});
