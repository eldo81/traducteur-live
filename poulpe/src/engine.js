// Moteur d'extraction : navigateur Playwright (pages web) ou appels HTTP JSON (API publiques).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { cleanRow, passFilters } from './transforms.js';
import { extractWithAI, enrichRows, aiAvailable } from './ai.js';
import { robotsCheck } from './robots.js';
import { sessionFile, hasSession } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DOMKIT = fs.readFileSync(path.join(__dirname, '..', 'public', 'lib', 'domkit.js'), 'utf8');
export const UA_DEFAULT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => Math.round(a + Math.random() * Math.max(0, b - a));

let proxyCursor = 0;

export function defaultsFor(task) {
  return {
    headless: true,
    timeoutMs: 45000,
    delayMs: [800, 2000],
    blockResources: true,
    respectRobots: true,
    locale: 'fr-FR',
    userAgent: UA_DEFAULT,
    proxies: [],
    retries: 3,
    ...(task.browser || {}),
  };
}

/** Liste des URL de départ : startUrls, gabarit {page}, ou liste collée. */
export function expandStartUrls(task) {
  const urls = [];
  for (const u of task.startUrls || []) if (u && u.trim()) urls.push(u.trim());
  const pg = task.pagination || {};
  if (pg.type === 'url' && pg.urlTemplate) {
    const from = Number(pg.from ?? 1), to = Number(pg.to ?? from + (pg.maxPages || 5) - 1), step = Number(pg.step || 1);
    for (let i = from; i <= to; i += step) urls.push(pg.urlTemplate.replace(/\{page\}/g, String(i)).replace(/\{offset\}/g, String((i - from) * (pg.pageSize || 10))));
  }
  return Array.from(new Set(urls));
}

export async function launch(task, { headless } = {}) {
  const b = defaultsFor(task);
  const launchOpts = { headless: headless ?? b.headless };
  if (process.env.POULPE_CHROMIUM) launchOpts.executablePath = process.env.POULPE_CHROMIUM;
  if (b.proxies && b.proxies.length) {
    const raw = b.proxies[proxyCursor++ % b.proxies.length];
    const u = new URL(raw.includes('://') ? raw : 'http://' + raw);
    launchOpts.proxy = { server: `${u.protocol}//${u.host}`, username: decodeURIComponent(u.username) || undefined, password: decodeURIComponent(u.password) || undefined };
  }
  const browser = await chromium.launch(launchOpts);
  const ctxOpts = {
    userAgent: b.userAgent,
    locale: b.locale,
    viewport: { width: 1366, height: 900 },
    ignoreHTTPSErrors: !!b.ignoreHTTPSErrors,
  };
  if (task.id && hasSession(task.id)) ctxOpts.storageState = sessionFile(task.id);
  if (b.extraHeaders) ctxOpts.extraHTTPHeaders = b.extraHeaders;
  const context = await browser.newContext(ctxOpts);
  context.setDefaultTimeout(b.timeoutMs);
  if (b.blockResources) {
    await context.route('**/*', (route) => {
      const t = route.request().resourceType();
      return ['image', 'media', 'font'].includes(t) ? route.abort() : route.continue();
    });
  }
  await context.addInitScript({ content: DOMKIT });
  return { browser, context, opts: b };
}

export async function gotoWithRetry(page, url, b, log) {
  let lastErr;
  for (let attempt = 1; attempt <= (b.retries || 3); attempt++) {
    try {
      const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: b.timeoutMs });
      const status = res ? res.status() : 0;
      if (status === 429 || status >= 500) throw new Error('HTTP ' + status);
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      if (b.waitForSelector) await page.waitForSelector(b.waitForSelector, { timeout: b.timeoutMs }).catch(() => log?.('warn', `Sélecteur d'attente introuvable : ${b.waitForSelector}`));
      if (b.waitMs) await sleep(b.waitMs);
      return res;
    } catch (e) {
      lastErr = e;
      log?.('warn', `Échec ${attempt}/${b.retries || 3} sur ${url} : ${e.message}`);
      await sleep(2000 * attempt * attempt);
    }
  }
  throw lastErr;
}

async function ensureKit(page) {
  const ok = await page.evaluate(() => typeof window.__poulpe === 'object').catch(() => false);
  if (!ok) await page.addScriptTag({ content: DOMKIT });
}

/** Actions préalables : connexion, fermeture de bannière cookies, recherche, filtres… */
export async function runActions(page, actions, b, log) {
  for (const a of actions || []) {
    try {
      switch (a.type) {
        case 'goto': await gotoWithRetry(page, a.value, b, log); break;
        case 'click': await page.click(a.selector, { timeout: a.timeoutMs || 10000 }); break;
        case 'clickIfExists': {
          const el = await page.$(a.selector);
          if (el && await el.isVisible()) await el.click();
          break;
        }
        case 'type': await page.fill(a.selector, resolveSecret(a.value)); break;
        case 'press': await page.press(a.selector || 'body', a.value || 'Enter'); break;
        case 'select': await page.selectOption(a.selector, a.value); break;
        case 'check': await page.check(a.selector); break;
        case 'hover': await page.hover(a.selector); break;
        case 'wait': await sleep(Number(a.ms || a.value || 1000)); break;
        case 'waitFor': await page.waitForSelector(a.selector, { timeout: a.timeoutMs || b.timeoutMs }); break;
        case 'scroll': await page.evaluate((n) => window.scrollBy(0, n || window.innerHeight), Number(a.value || 0)); break;
        case 'eval': await page.evaluate(a.value); break;
        default: log?.('warn', `Action inconnue : ${a.type}`);
      }
      if (a.type !== 'wait') await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    } catch (e) {
      if (a.optional) log?.('info', `Action facultative ignorée (${a.type} ${a.selector || ''}) : ${e.message}`);
      else throw new Error(`Action ${a.type} ${a.selector || ''} : ${e.message}`);
    }
  }
}

/** "${ENV:UNGM_PASSWORD}" → valeur de la variable d'environnement (aucun mot de passe en clair dans les tâches). */
export function resolveSecret(v) {
  return String(v ?? '').replace(/\$\{ENV:([A-Z0-9_]+)\}/g, (_, k) => process.env[k] ?? '');
}

/** Extrait les lignes de la page courante selon le mode de la tâche. */
export async function extractPage(page, ex, log) {
  await ensureKit(page);
  if (ex.mode === 'ai') {
    if (!aiAvailable()) throw new Error('Mode IA : ANTHROPIC_API_KEY absent.');
    const text = await page.evaluate(() => window.__poulpe.pageText());
    return extractWithAI(text, ex.ai || {}, page.url());
  }
  const listSelector = ex.mode === 'single' ? null : ex.listSelector;
  if (ex.mode !== 'single' && !listSelector) throw new Error('Sélecteur de liste manquant.');
  const rows = await page.evaluate(([ls, fields]) => window.__poulpe.extractList(ls, fields), [listSelector, ex.fields || []]);
  if (!rows.length) log?.('warn', `0 ligne sur ${page.url()} (sélecteur : ${listSelector || 'page'})`);
  return rows;
}

async function firstItemFingerprint(page, ex) {
  return page.evaluate((ls) => {
    const el = ls ? document.querySelector(ls) : document.body;
    return (el ? el.textContent : '').slice(0, 300) + '|' + location.href;
  }, ex.mode === 'single' ? null : ex.listSelector).catch(() => '');
}

async function nextAvailable(page, sel) {
  const el = await page.$(sel);
  if (!el) return null;
  const state = await el.evaluate((n) => ({
    visible: !!(n.offsetWidth || n.offsetHeight || n.getClientRects().length),
    disabled: n.disabled || n.getAttribute('aria-disabled') === 'true' || /\bdisabled\b/.test(n.className || '') || /\bdisabled\b/.test((n.parentElement && n.parentElement.className) || ''),
    href: n.tagName === 'A' && n.getAttribute('href') && !/^(#|javascript:)/i.test(n.getAttribute('href')) ? n.href : null,
  }));
  if (!state.visible || state.disabled) return null;
  return { el, href: state.href };
}

async function waitForChange(page, ex, before, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    await sleep(400);
    const now = await firstItemFingerprint(page, ex);
    if (now && now !== before) return true;
  }
  return false;
}

/** Parcourt une URL de départ avec sa pagination et renvoie les lignes brutes. */
export async function crawlStart(page, url, task, b, ctx) {
  const { log, maxPages: maxPagesOverride, shouldStop } = ctx;
  const ex = task.extract || {};
  const pg = task.pagination || { type: 'none' };
  const maxPages = maxPagesOverride || pg.maxPages || 10;
  const rows = [];
  await gotoWithRetry(page, url, b, log);
  await runActions(page, task.actions, b, log);

  if (pg.type === 'scroll' || pg.type === 'loadMore') {
    let stale = 0, last = -1;
    const limit = pg.type === 'scroll' ? (pg.maxScrolls || maxPages * 3) : maxPages;
    for (let i = 0; i < limit && !shouldStop(); i++) {
      const count = await page.evaluate((ls) => (ls ? document.querySelectorAll(ls).length : 0), ex.listSelector || null).catch(() => 0);
      if (count === last) { if (++stale >= 2) break; } else stale = 0;
      last = count;
      if (pg.type === 'scroll') {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      } else {
        const nx = await nextAvailable(page, pg.selector);
        if (!nx) break;
        await nx.el.click().catch(() => {});
      }
      await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
      await sleep(pg.waitMs || 1200);
      if (ctx.maxRows && count >= ctx.maxRows) break;
    }
    rows.push(...(await extractPage(page, ex, log)).map((r) => ({ ...r, _source_url: page.url() })));
    log?.('info', `${rows.length} ligne(s) après défilement : ${url}`);
    return rows;
  }

  for (let p = 1; p <= maxPages && !shouldStop(); p++) {
    const got = await extractPage(page, ex, log);
    rows.push(...got.map((r) => ({ ...r, _source_url: page.url() })));
    log?.('info', `Page ${p} : ${got.length} ligne(s) — ${page.url()}`);
    if (ctx.maxRows && rows.length >= ctx.maxRows) break;
    if (pg.type !== 'next' || !pg.selector) break;
    const nx = await nextAvailable(page, pg.selector);
    if (!nx) { log?.('info', 'Fin de pagination (bouton suivant absent ou désactivé).'); break; }
    await sleep(rand(...b.delayMs));
    const before = await firstItemFingerprint(page, ex);
    if (nx.href && nx.href !== page.url()) {
      await gotoWithRetry(page, nx.href, b, log);
    } else {
      await nx.el.click();
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      if (!(await waitForChange(page, ex, before))) { log?.('warn', 'La page n\'a pas changé après « suivant » : arrêt.'); break; }
    }
  }
  return rows;
}

/** Visite les pages de détail (fiche produit, avis d'appel d'offres…) et fusionne les champs. */
export async function crawlDetails(context, rows, task, b, ctx) {
  const d = task.detail;
  if (!d || !d.enabled || !d.linkField) return rows;
  const conc = Math.max(1, Math.min(Number(d.concurrency || 2), 6));
  const out = rows.map((r) => ({ ...r }));
  let idx = 0, done = 0;
  const worker = async () => {
    const page = await context.newPage();
    try {
      while (idx < out.length && !ctx.shouldStop()) {
        const i = idx++;
        const link = out[i][d.linkField];
        if (!link || !/^https?:/i.test(link)) continue;
        try {
          if (b.respectRobots && !(await robotsCheck(link)).allowed) { ctx.log('warn', `robots.txt interdit ${link}`); continue; }
          await sleep(rand(...b.delayMs));
          await gotoWithRetry(page, link, b, ctx.log);
          await runActions(page, d.actions, b, ctx.log);
          const ex = d.mode === 'ai' ? { mode: 'ai', ai: { ...(d.ai || {}), single: true } } : { mode: 'single', fields: d.fields || [] };
          const got = await extractPage(page, ex, ctx.log);
          if (got[0]) for (const [k, v] of Object.entries(got[0])) if (v !== '' && v != null) out[i][k] = v;
        } catch (e) {
          out[i]._detail_error = e.message.slice(0, 200);
          ctx.log('warn', `Détail ${link} : ${e.message}`);
        }
        if (++done % 10 === 0) ctx.log('info', `Pages de détail : ${done}/${out.length}`);
      }
    } finally { await page.close().catch(() => {}); }
  };
  await Promise.all(Array.from({ length: conc }, worker));
  return out;
}

// ------------------------------------------------------------------ source API JSON
const getPath = (obj, p) => (p ? String(p).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj) : obj);

/** Variables : {page} {offset} {limit} {today} {today-7} ; suffixe :compact → AAAAMMJJ. */
export function fill(str, vars) {
  return String(str).replace(/\{(page|offset|limit|today(?:-(\d+))?)(:compact)?\}/g, (m, k, n, compact) => {
    if (k.startsWith('today')) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - Number(n || 0));
      const iso = d.toISOString().slice(0, 10);
      return compact ? iso.replace(/-/g, '') : iso;
    }
    return String(vars[k]);
  });
}

/** Valeur multilingue {fra: "...", eng: "..."} → texte dans la langue préférée. */
function pickValue(v, langs) {
  if (v == null) return v;
  if (Array.isArray(v)) return v.map((x) => pickValue(x, langs)).filter((x) => x != null && x !== '').join(' | ');
  if (typeof v === 'object') {
    for (const l of langs || ['fra', 'eng']) if (v[l] != null) return pickValue(v[l], langs);
    if (v.value != null) return pickValue(v.value, langs);
    const keys = Object.keys(v);
    if (keys.length && keys.every((k) => /^[a-z]{3}$/.test(k))) return pickValue(v[keys[0]], langs);
    return JSON.stringify(v);
  }
  return v;
}

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = Array.isArray(v) ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : x)).join(' | ') : v;
  }
  return out;
}

export async function crawlApi(task, ctx) {
  const s = task.source;
  const limit = Number(s.pageSize || 50);
  const maxPages = ctx.maxPages || s.maxPages || 10;
  const rows = [];
  for (let p = 0; p < maxPages && !ctx.shouldStop(); p++) {
    const vars = { page: (s.firstPage ?? 1) + p, offset: p * limit, limit };
    const url = fill(s.url, vars);
    const init = { method: s.method || 'GET', headers: { Accept: 'application/json', 'User-Agent': UA_DEFAULT, ...(s.headers || {}) } };
    for (const [k, v] of Object.entries(init.headers)) init.headers[k] = resolveSecret(v);
    if (s.body) {
      const raw = typeof s.body === 'string' ? s.body : JSON.stringify(s.body);
      // "{page}" entre guillemets devient un nombre JSON.
      init.body = fill(raw.replace(/"\{(page|offset|limit)\}"/g, (m, k) => String(vars[k])), vars);
      init.headers['Content-Type'] = init.headers['Content-Type'] || 'application/json';
    }
    let data, lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url, init);
        if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
        data = await res.json();
        break;
      } catch (e) { lastErr = e; ctx.log('warn', `API ${url} (essai ${attempt}) : ${e.message}`); await sleep(2000 * attempt); }
    }
    if (!data) throw lastErr;
    let items = getPath(data, s.itemsPath);
    if (items && !Array.isArray(items) && typeof items === 'object') items = Object.values(items);
    items = items || [];
    for (const it of items) {
      const row = s.fields && s.fields.length
        ? Object.fromEntries(s.fields.map((f) => [f.name, pickValue(getPath(it, f.path || f.name), f.lang || s.lang)]))
        : flatten(it);
      if (s.linkTemplate) row.lien = fill(s.linkTemplate.replace(/\{item\.([\w.-]+)\}/g, (_, k) => getPath(it, k) ?? ''), vars);
      rows.push({ ...row, _source_url: url.split('?')[0] });
    }
    ctx.log('info', `API page ${p + 1} : ${items.length} élément(s)`);
    if (items.length < limit && s.stopWhenShort !== false) break;
    if (ctx.maxRows && rows.length >= ctx.maxRows) break;
    await sleep(rand(300, 900));
  }
  return rows;
}

// ------------------------------------------------------------------ exécution complète
/**
 * Exécute une tâche et renvoie { rows, stats }.
 * ctx = { log(level, msg), shouldStop(), maxPages?, maxRows?, skipDetails?, skipEnrich? }
 */
export async function execute(task, ctx) {
  const log = ctx.log || (() => {});
  ctx = { shouldStop: () => false, ...ctx, log };
  const t0 = Date.now();
  let rows = [];
  let browserHandle = null;
  const stats = { pages: 0, errors: 0 };
  try {
    if (task.source && task.source.type === 'api') {
      rows = await crawlApi(task, ctx);
    } else {
      const urls = expandStartUrls(task);
      if (!urls.length) throw new Error('Aucune URL de départ.');
      browserHandle = await launch(task);
      const { context, opts: b } = browserHandle;
      const page = await context.newPage();
      for (const url of urls) {
        if (ctx.shouldStop()) break;
        if (b.respectRobots) {
          const rb = await robotsCheck(url);
          if (!rb.allowed) { log('error', `robots.txt interdit l'accès à ${url} (désactivable dans Navigateur → robots.txt).`); stats.errors++; continue; }
          if (rb.delay) b.delayMs = [Math.max(b.delayMs[0], rb.delay), Math.max(b.delayMs[1], rb.delay)];
        }
        try {
          const got = await crawlStart(page, url, task, b, ctx);
          rows.push(...got);
          stats.pages++;
        } catch (e) {
          stats.errors++;
          log('error', `${url} : ${e.message}`);
        }
        if (ctx.maxRows && rows.length >= ctx.maxRows) break;
        await sleep(rand(...b.delayMs));
      }
      if (ctx.maxRows) rows = rows.slice(0, ctx.maxRows);
      if (!ctx.skipDetails && task.detail?.enabled) {
        log('info', `Visite de ${rows.length} page(s) de détail…`);
        rows = await crawlDetails(context, rows, task, b, ctx);
      }
      if (task.saveSession) await context.storageState({ path: sessionFile(task.id) }).catch(() => {});
    }

    // Nettoyage, filtres, enrichissement
    const allFields = [...(task.extract?.fields || []), ...(task.detail?.fields || []), ...(task.source?.fields || []), ...(task.cleaning || [])];
    rows = rows.map((r) => cleanRow(r, allFields, r._source_url));
    const before = rows.length;
    rows = rows.filter((r) => passFilters(r, task.filters));
    if (before !== rows.length) log('info', `Filtres : ${before - rows.length} ligne(s) écartée(s), ${rows.length} gardée(s).`);
    if (!ctx.skipEnrich && task.enrich?.enabled && task.enrich.prompt && rows.length) {
      if (!aiAvailable()) log('warn', 'Enrichissement IA ignoré : ANTHROPIC_API_KEY absent.');
      else { log('info', `Enrichissement IA de ${rows.length} ligne(s)…`); rows = await enrichRows(rows, task.enrich); }
    }
    if (task.postFilters?.length) {
      const n = rows.length;
      rows = rows.filter((r) => passFilters(r, task.postFilters));
      log('info', `Filtres après IA : ${n - rows.length} ligne(s) écartée(s), ${rows.length} gardée(s).`);
    }
  } finally {
    if (browserHandle) await browserHandle.browser.close().catch(() => {});
  }
  stats.durationMs = Date.now() - t0;
  stats.rows = rows.length;
  return { rows, stats };
}
