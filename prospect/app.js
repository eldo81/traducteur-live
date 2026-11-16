/* Radar B2B — prospection B2B par mots-clés (PWA, vanilla JS, aucun serveur).
 * Sources : OpenAI Responses API + outil web_search, ou OpenStreetMap Nominatim (gratuit).
 * Données stockées uniquement dans le navigateur (localStorage). */
'use strict';

const API = 'https://api.openai.com/v1';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const LS = { leads: 'rb.leads', watches: 'rb.watches', settings: 'rb.settings', key: 'rb.apiKey', sharedKey: 'tl.apiKey' };
const STATUSES = [
  ['new', 'Nouveau'], ['contacted', 'Contacté'], ['replied', 'A répondu'],
  ['meeting', 'RDV / devis'], ['won', 'Client'], ['lost', 'Perdu'],
];
const TARGETS = {
  all: 'tout type d\'entreprise pertinente (acheteurs, fournisseurs, distributeurs)',
  buyers: 'acheteurs : importateurs, centrales d\'achat, industriels utilisateurs, revendeurs qui achètent ce produit',
  suppliers: 'fournisseurs : fabricants, producteurs, exportateurs de ce produit',
  distributors: 'distributeurs, grossistes, négociants',
  partners: 'partenaires potentiels : agents commerciaux, transitaires, représentants, intégrateurs',
  public: 'donneurs d\'ordre publics, agences, ONG, bailleurs et grands projets qui achètent ce produit/service',
};
const DEFAULTS = { model: 'gpt-5-mini', customModel: '', pName: '', pCompany: 'Dioneo', pRole: '', pOffer: '', pPhone: '', pEmail: '', pLang: 'auto' };
const MODEL_FALLBACKS = ['gpt-5-mini', 'gpt-4.1-mini', 'gpt-4o-mini'];

const $ = (id) => document.getElementById(id);
const S = { leads: [], watches: [], settings: { ...DEFAULTS }, busy: false, lastRunIds: [] };

/* ---------------- stockage ---------------- */
function load(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { toast('Stockage plein : exportez puis supprimez des leads.'); } }
function persist() { save(LS.leads, S.leads); save(LS.watches, S.watches); }
function getKey() {
  try { return (localStorage.getItem(LS.key) || localStorage.getItem(LS.sharedKey) || '').trim(); } catch { return ''; }
}
function setKey(k) { try { k ? localStorage.setItem(LS.key, k.trim()) : localStorage.removeItem(LS.key); } catch {} }

/* ---------------- utilitaires ---------------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function safeUrl(u) {
  u = String(u || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u) && /^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(u)) u = 'https://' + u;
  try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; }
}
function domainOf(u) { try { return new URL(safeUrl(u)).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } }
function normName(n) {
  return String(n || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(sarl|sas|sa|suarl|sasu|ltd|llc|gmbh|bv|nv|srl|spa|inc|co|group|groupe|company|cie)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}
function leadKey(l) { return domainOf(l.site) || normName(l.entreprise) + '|' + normName(l.ville); }
function phoneDigits(p) {
  let d = String(p || '').replace(/[^\d+]/g, '');
  if (d.startsWith('00')) d = '+' + d.slice(2);
  return d;
}
function waNumber(p) {
  const d = phoneDigits(p);
  return d.startsWith('+') ? d.slice(1) : (d.length >= 11 ? d : '');
}
function cleanEmail(e) { e = String(e || '').trim().replace(/^mailto:/i, ''); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : ''; }
function fmtDate(t) { return new Date(t).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' }); }
let toastT;
function toast(m, ms = 3200) { const t = $('toast'); t.textContent = m; t.classList.remove('hidden'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), ms); }
function modelName() { return S.settings.model === 'custom' ? (S.settings.customModel.trim() || 'gpt-5-mini') : S.settings.model; }

/* ---------------- OpenAI ---------------- */
function extractText(data) {
  if (typeof data.output_text === 'string' && data.output_text) return data.output_text;
  const out = [];
  for (const item of data.output || []) {
    if (item.type === 'message') for (const c of item.content || []) if (c.type === 'output_text') out.push(c.text);
  }
  return out.join('\n');
}
function parseJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1] : text;
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('Réponse IA sans JSON exploitable.');
  return JSON.parse(raw.slice(a, b + 1));
}

let toolType = 'web_search';
let noReasoning = false;
async function openai(body, { web = false } = {}) {
  const key = getKey();
  if (!key) { showView('settings'); throw new Error('Ajoutez votre clé API OpenAI dans Réglages.'); }
  const models = [modelName(), ...MODEL_FALLBACKS.filter((m) => m !== modelName())];
  let lastErr;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const b = { model, ...body };
      if (web) b.tools = [{ type: toolType }];
      if (/^gpt-5/.test(model) && !noReasoning) b.reasoning = { effort: 'low' };
      const r = await fetch(API + '/responses', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify(b),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        if (model !== modelName()) toast(`Modèle « ${modelName()} » refusé : utilisé « ${model} ».`);
        return data;
      }
      const msg = data?.error?.message || `HTTP ${r.status}`;
      lastErr = new Error(msg);
      if (r.status === 401) throw new Error('Clé API refusée (401). Vérifiez-la dans Réglages.');
      if (r.status === 429) throw new Error(/quota|billing|credit/i.test(msg) ? 'Crédit OpenAI épuisé : rechargez le compte (Billing).' : 'Trop de requêtes : réessayez dans une minute.');
      if (web && toolType === 'web_search' && /web_search/i.test(msg) && attempt === 0) { toolType = 'web_search_preview'; continue; }
      if (/reasoning/i.test(msg) && b.reasoning && attempt === 0) { noReasoning = true; continue; }
      if ([400, 403, 404].includes(r.status) && /model/i.test(msg)) break; // modèle suivant
      throw lastErr;
    }
  }
  throw lastErr || new Error('Échec OpenAI.');
}

function searchPrompt(q, exclude) {
  return `Mission : prospection B2B. Trouve ${q.count} entreprises RÉELLES et ACTIVES correspondant à :
- Mots-clés : ${q.kw}
- Zone géographique : ${q.zone || 'international'}
- Type de cible : ${TARGETS[q.target] || TARGETS.all}
${S.settings.pOffer ? `- Contexte vendeur (pour juger la pertinence) : ${S.settings.pOffer}` : ''}

Méthode : fais plusieurs recherches web (annuaires professionnels, sites officiels, pages contact, LinkedIn entreprise, registres, salons, chambres de commerce, listes d'importateurs/exportateurs). Privilégie les entreprises avec coordonnées vérifiables.
${exclude.length ? `Exclure ces entreprises déjà connues : ${exclude.join(' ; ')}` : ''}

Règles strictes :
- N'INVENTE JAMAIS un e-mail, un téléphone, un nom de dirigeant ou une URL. Champ vide "" si non trouvé sur une source réelle.
- "source" = URL réelle de la page où l'info a été trouvée.
- "score" 0-100 = pertinence commerciale × qualité des contacts.
- "raison" = 1 phrase concrète : pourquoi c'est une cible (volumes, gamme, marchés, signal récent).
- Téléphones au format international (+221…, +32…).

Réponds UNIQUEMENT avec ce JSON, sans texte autour :
{"leads":[{"entreprise":"","activite":"","pays":"","ville":"","adresse":"","site":"","email":"","telephone":"","whatsapp":"","linkedin":"","decideur":"","poste_decideur":"","taille":"","source":"","score":0,"raison":""}]}`;
}

async function searchAI(q, exclude) {
  const data = await openai({
    input: [{ role: 'user', content: searchPrompt(q, exclude) }],
    max_output_tokens: 16000,
  }, { web: true });
  const text = extractText(data);
  const json = parseJson(text);
  return (json.leads || []).filter((l) => l && l.entreprise);
}

/* ---------------- OpenStreetMap (gratuit) ---------------- */
async function searchOSM(q) {
  const terms = q.kw.split(',').map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < terms.length; i++) {
    if (i) await sleep(1100); // politique Nominatim : 1 requête / seconde
    const p = new URLSearchParams({ q: `${terms[i]} ${q.zone || ''}`.trim(), format: 'jsonv2', limit: '40', extratags: '1', addressdetails: '1', 'accept-language': 'fr' });
    const r = await fetch(`${NOMINATIM}?${p}`, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`OpenStreetMap indisponible (HTTP ${r.status}).`);
    const arr = await r.json();
    for (const it of arr) {
      const x = it.extratags || {}, a = it.address || {};
      const name = it.name || (it.display_name || '').split(',')[0];
      if (!name) continue;
      const tel = x.phone || x['contact:phone'] || x['contact:mobile'] || '';
      const mail = x.email || x['contact:email'] || '';
      const site = x.website || x['contact:website'] || x.url || '';
      const has = [tel, mail, site].filter(Boolean).length;
      out.push({
        entreprise: name,
        activite: [it.category, it.type].filter((s) => s && s !== 'yes').join(' · ').replace(/_/g, ' '),
        pays: a.country || '', ville: a.city || a.town || a.village || a.suburb || a.state || '',
        adresse: [a.house_number, a.road, a.suburb, a.city || a.town].filter(Boolean).join(' '),
        site, email: mail, telephone: tel.split(';')[0], whatsapp: x['contact:whatsapp'] || '',
        linkedin: x['contact:linkedin'] || '', decideur: '', poste_decideur: '', taille: '',
        source: `https://www.openstreetmap.org/${it.osm_type}/${it.osm_id}`,
        score: 35 + has * 20, raison: `Établissement référencé sur OpenStreetMap pour « ${terms[i]} ».`,
      });
    }
  }
  return out.slice(0, Math.max(q.count * 2, 40));
}

/* ---------------- moteur de prospection ---------------- */
function mergeLeads(raw, q) {
  const index = new Map(S.leads.map((l) => [leadKey(l), l]));
  const added = [], updated = [];
  for (const r of raw) {
    const lead = {
      entreprise: String(r.entreprise || '').trim(), activite: r.activite || '', pays: r.pays || '', ville: r.ville || '',
      adresse: r.adresse || '', site: safeUrl(r.site), email: cleanEmail(r.email), telephone: String(r.telephone || '').trim(),
      whatsapp: String(r.whatsapp || '').trim(), linkedin: safeUrl(r.linkedin), decideur: r.decideur || '',
      poste_decideur: r.poste_decideur || '', taille: r.taille || '', source: safeUrl(r.source),
      score: Math.max(0, Math.min(100, Number(r.score) || 0)), raison: r.raison || '',
    };
    if (!lead.entreprise) continue;
    const k = leadKey(lead);
    const ex = index.get(k);
    if (ex) { // complète les champs vides
      let ch = false;
      for (const f of ['site', 'email', 'telephone', 'whatsapp', 'linkedin', 'decideur', 'poste_decideur', 'adresse', 'activite', 'source']) {
        if (!ex[f] && lead[f]) { ex[f] = lead[f]; ch = true; }
      }
      if (ch) updated.push(ex);
      continue;
    }
    Object.assign(lead, { id: uid(), status: 'new', fav: false, note: '', createdAt: Date.now(), query: `${q.kw} — ${q.zone || 'international'}`, watchId: q.watchId || '' });
    S.leads.unshift(lead); index.set(k, lead); added.push(lead);
  }
  persist();
  return { added, updated };
}

async function runSearch(q, { quiet = false } = {}) {
  if (S.busy) { toast('Une recherche est déjà en cours.'); return null; }
  S.busy = true; $('goBtn').disabled = true;
  const t0 = Date.now();
  $('progress').classList.remove('hidden');
  $('progressTitle').textContent = q.source === 'osm' ? 'Recherche OpenStreetMap…' : 'L\'IA parcourt le web…';
  const tick = setInterval(() => {
    const s = Math.round((Date.now() - t0) / 1000);
    $('progressSub').textContent = `${s} s — ${q.source === 'osm' ? 'quelques secondes' : 'compter 30 à 120 s, gardez l\'écran allumé'}`;
  }, 1000);
  try {
    const exclude = S.leads.filter((l) => !q.watchId || l.watchId === q.watchId).slice(0, 60).map((l) => l.entreprise);
    const raw = q.source === 'osm' ? await searchOSM(q) : await searchAI(q, exclude);
    const res = mergeLeads(raw, q);
    S.lastRunIds = [...res.added, ...res.updated].map((l) => l.id);
    if (q.watchId) {
      const w = S.watches.find((x) => x.id === q.watchId);
      if (w) { w.lastRun = Date.now(); w.lastNew = res.added.length; w.total = (w.total || 0) + res.added.length; persist(); }
    }
    if (!quiet) renderResults(res, q);
    toast(`${res.added.length} nouveau(x) lead(s)${res.updated.length ? `, ${res.updated.length} complété(s)` : ''}.`);
    renderAll();
    return res;
  } catch (e) {
    console.error(e);
    if (!quiet) $('results').innerHTML = `<div class="card err">${esc(e.message)}</div>`;
    toast(e.message, 5000);
    return null;
  } finally {
    clearInterval(tick); S.busy = false; $('goBtn').disabled = false; $('progress').classList.add('hidden');
  }
}

/* ---------------- rendu ---------------- */
function scoreCls(s) { return s >= 70 ? 's-hi' : s >= 45 ? 's-mid' : 's-lo'; }
function hasContact(l) { return !!(l.email || l.telephone || l.whatsapp); }

function leadCard(l, { fresh = false } = {}) {
  const tel = phoneDigits(l.telephone);
  const wa = waNumber(l.whatsapp || l.telephone);
  const loc = [l.ville, l.pays].filter(Boolean).join(', ');
  const btn = (href, label, cls = '') => href ? `<a class="btn sm ${cls}" href="${esc(href)}" target="_blank" rel="noopener">${label}</a>` : '';
  return `<article class="lead ${fresh ? 'new' : ''}" data-id="${l.id}">
    <div class="lead-h">
      <div>
        <div class="lead-name">${esc(l.entreprise)}</div>
        <div class="lead-sub">${esc([l.activite, loc, l.taille].filter(Boolean).join(' · '))}</div>
      </div>
      <div style="display:flex;align-items:center;gap:4px">
        <button class="fav ${l.fav ? 'on' : ''}" data-act="fav" type="button" aria-label="Favori">★</button>
        <span class="score ${scoreCls(l.score)}">${l.score}</span>
      </div>
    </div>
    ${l.raison ? `<div class="why">${esc(l.raison)}</div>` : ''}
    <div class="contacts">
      ${l.decideur ? `<div>Décideur : <b>${esc(l.decideur)}</b>${l.poste_decideur ? ' — ' + esc(l.poste_decideur) : ''}</div>` : ''}
      ${l.email ? `<div>E-mail : <b>${esc(l.email)}</b></div>` : ''}
      ${l.telephone ? `<div>Tél : <b>${esc(l.telephone)}</b></div>` : ''}
      ${l.adresse ? `<div>${esc(l.adresse)}</div>` : ''}
      ${l.site ? `<div>${esc(domainOf(l.site))}</div>` : ''}
    </div>
    <div class="actions">
      ${tel ? btn('tel:' + tel, '📞 Appeler') : ''}
      ${wa ? btn('https://wa.me/' + wa, '💬 WhatsApp') : ''}
      ${l.email ? `<button class="btn sm" data-act="mail" type="button">✉ E-mail</button>` : ''}
      <button class="btn sm primary" data-act="ai" type="button">✍ Message IA</button>
      ${btn(l.site, '🌐 Site')}
      ${btn(l.linkedin || 'https://www.linkedin.com/search/results/' + (l.decideur ? 'people' : 'companies') + '/?keywords=' + encodeURIComponent(l.decideur ? `${l.decideur} ${l.entreprise}` : l.entreprise), 'in LinkedIn')}
      ${l.source && l.source !== l.site ? btn(l.source, '🔗 Source') : ''}
    </div>
    <div class="lead-f">
      <select data-act="status">${STATUSES.map(([v, t]) => `<option value="${v}" ${l.status === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <button class="btn sm" data-act="note" type="button">📝</button>
      <button class="btn sm" data-act="del" type="button">🗑</button>
    </div>
    ${l.note ? `<div class="note card">${esc(l.note)}</div>` : ''}
    <div class="muted" style="margin-top:6px;font-size:11px"><span class="tag">${esc(l.query || '')}</span>${fmtDate(l.createdAt)}</div>
  </article>`;
}

function renderResults(res, q) {
  const list = [...res.added, ...res.updated].sort((a, b) => b.score - a.score);
  $('results').innerHTML = `<div class="res-h"><strong>${res.added.length} nouveaux · ${res.updated.length} complétés</strong>
    <span class="muted">${esc(q.kw)} — ${esc(q.zone || 'international')}</span></div>` +
    (list.length ? list.map((l) => leadCard(l, { fresh: res.added.includes(l) })).join('')
      : `<div class="card empty">Aucun nouveau lead. Élargissez la zone, changez la cible ou reformulez les mots-clés (produit précis + type d'acteur).</div>`);
}

function renderLeads() {
  const f = $('leadFilter').value.trim().toLowerCase();
  const st = $('statusFilter').value, sort = $('sortBy').value;
  let list = S.leads.filter((l) =>
    (st === 'all' || l.status === st) &&
    (!$('favOnly').checked || l.fav) &&
    (!$('contactOnly').checked || hasContact(l)) &&
    (!f || [l.entreprise, l.ville, l.pays, l.activite, l.decideur, l.query, l.note].join(' ').toLowerCase().includes(f)));
  if (sort === 'score') list.sort((a, b) => b.score - a.score);
  else if (sort === 'name') list.sort((a, b) => a.entreprise.localeCompare(b.entreprise, 'fr'));
  else list.sort((a, b) => b.createdAt - a.createdAt);
  $('leadList').innerHTML = list.length ? list.slice(0, 300).map((l) => leadCard(l)).join('') +
    (list.length > 300 ? `<div class="empty">${list.length - 300} de plus : affinez le filtre.</div>` : '')
    : `<div class="card empty">Aucun lead. Lancez une prospection depuis l'onglet Rechercher.</div>`;
}

function renderWatches() {
  $('watchList').innerHTML = S.watches.length ? S.watches.map((w) => `
    <div class="card watch" data-wid="${w.id}">
      <div>
        <div class="w-t">${esc(w.kw)}</div>
        <div class="muted">${esc(w.zone || 'international')} · ${esc(($('target').querySelector(`option[value="${w.target}"]`) || {}).textContent || '')} · ${w.source === 'osm' ? 'OSM' : 'IA web'} · ${w.count}</div>
        <div class="muted">${w.lastRun ? `Dernière relance ${fmtDate(w.lastRun)} : +${w.lastNew || 0}` : 'Jamais relancée'} · ${w.total || 0} leads au total</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <button class="btn sm primary" data-wact="run" type="button">Relancer</button>
        <button class="btn sm" data-wact="del" type="button">Supprimer</button>
      </div>
    </div>`).join('') : `<div class="card empty">Aucune veille. Cochez « Enregistrer comme veille » lors d'une recherche.</div>`;
}

function renderStats() {
  const n = S.leads.length, c = S.leads.filter(hasContact).length, act = S.leads.filter((l) => ['contacted', 'replied', 'meeting'].includes(l.status)).length;
  $('topStats').innerHTML = n ? `${n} leads · ${c} avec contact<br>${act} en cours · ${S.leads.filter((l) => l.status === 'won').length} clients` : '';
  $('leadCount').textContent = n ? `(${n})` : '';
}

function renderQuickLinks() {
  const kw = $('kw').value.trim() || 'importateur', z = $('zone').value.trim();
  const first = kw.split(',')[0].trim(), qz = `${first} ${z}`.trim();
  const g = (q) => 'https://www.google.com/search?q=' + encodeURIComponent(q);
  const links = [
    ['Google Maps', 'https://www.google.com/maps/search/' + encodeURIComponent(qz)],
    ['LinkedIn sociétés', 'https://www.linkedin.com/search/results/companies/?keywords=' + encodeURIComponent(qz)],
    ['LinkedIn décideurs', 'https://www.linkedin.com/search/results/people/?keywords=' + encodeURIComponent(`${first} ${z} directeur OR CEO OR achats`)],
    ['E-mails Google', g(`"${first}" ${z ? `"${z}"` : ''} (email OR "contact" OR "@")`)],
    ['Kompass', g(`site:kompass.com ${qz}`)],
    ['Europages', g(`site:europages.fr ${qz}`)],
    ['Go Africa Online', g(`site:goafricaonline.com ${qz}`)],
    ['Alibaba (fournisseurs)', 'https://www.alibaba.com/trade/search?SearchText=' + encodeURIComponent(first)],
    ['Annuaire PDF', g(`${qz} liste importateurs OR annuaire filetype:pdf`)],
  ];
  $('quickLinks').innerHTML = links.map(([t, u]) => `<a class="chip" href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>`).join('');
}

function renderAll() { renderStats(); renderLeads(); renderWatches(); }

/* ---------------- messages ---------------- */
function mailFallback(l) {
  const p = S.settings, en = p.pLang === 'en';
  const subj = en ? `Business proposal — ${p.pCompany || ''}`.trim() : `Proposition de partenariat — ${p.pCompany || ''}`.trim();
  const body = en
    ? `Dear ${l.decideur || 'Sir or Madam'},\n\n${p.pOffer || ''}\n\nGiven ${l.entreprise}'s activity in ${l.activite || 'your sector'}, I would like to discuss how we could work together. Are you available for a 15-minute call this week?\n\nBest regards,\n${[p.pName, p.pRole, p.pCompany, p.pPhone, p.pEmail].filter(Boolean).join('\n')}`
    : `Bonjour ${l.decideur || ''},\n\n${p.pOffer || ''}\n\nCompte tenu de l'activité de ${l.entreprise} (${l.activite || 'votre secteur'}), je souhaite échanger sur une collaboration. Seriez-vous disponible pour un appel de 15 minutes cette semaine ?\n\nCordialement,\n${[p.pName, p.pRole, p.pCompany, p.pPhone, p.pEmail].filter(Boolean).join('\n')}`;
  return { objet: subj, email: body.replace(/\n{3,}/g, '\n\n'), whatsapp: body.split('\n\n').slice(0, 3).join('\n\n') };
}

async function aiMessage(l) {
  const p = S.settings;
  const lang = p.pLang === 'auto' ? 'la langue d\'affaires du pays du lead (français pour l\'Afrique francophone, la France, la Belgique francophone ; anglais sinon ; néerlandais accepté seulement si clairement néerlandophone, sinon anglais)' : (p.pLang === 'en' ? 'anglais' : 'français');
  const prompt = `Rédige un premier contact B2B de prospection, en ${lang}.
Expéditeur : ${[p.pName, p.pRole, p.pCompany].filter(Boolean).join(', ') || 'non précisé'}. Coordonnées : ${[p.pPhone, p.pEmail].filter(Boolean).join(' / ') || 'aucune'}.
Offre : ${p.pOffer || 'non précisée : propose une collaboration commerciale générale liée à l\'activité du lead'}.
Destinataire : ${JSON.stringify({ entreprise: l.entreprise, activite: l.activite, pays: l.pays, ville: l.ville, decideur: l.decideur, poste: l.poste_decideur, raison: l.raison })}
Contraintes : e-mail 90-140 mots, accroche spécifique à l'entreprise, une proposition de valeur chiffrée si possible sans inventer de chiffres sur le destinataire, un seul appel à l'action (appel de 15 min). Pas de formule creuse. Signature complète avec les coordonnées fournies, aucun crochet ni champ à compléter.
WhatsApp : 40-70 mots, ton direct et poli.
Relance J+4 : 40-60 mots.
Réponds UNIQUEMENT en JSON : {"objet":"","email":"","whatsapp":"","relance":""}`;
  const data = await openai({ input: [{ role: 'user', content: prompt }], max_output_tokens: 4000 });
  return parseJson(extractText(data));
}

function openMsgDialog(l, m) {
  const wa = waNumber(l.whatsapp || l.telephone);
  $('msgTitle').textContent = 'Message pour ' + l.entreprise;
  const block = (id, label, val, extra = '') => `<div class="block"><label class="muted">${label}</label>
    <textarea id="${id}" rows="${id === 'mObj' ? 1 : 7}">${esc(val || '')}</textarea>
    <div class="row"><button class="btn sm" type="button" data-copy="${id}">Copier</button>${extra}</div></div>`;
  $('msgBody').innerHTML =
    block('mObj', 'Objet', m.objet) +
    block('mMail', 'E-mail', m.email, l.email ? `<button class="btn sm primary" type="button" id="sendMail">Ouvrir dans Gmail / Mail</button>` : '') +
    block('mWa', 'WhatsApp', m.whatsapp, wa ? `<button class="btn sm primary" type="button" id="sendWa">Envoyer sur WhatsApp</button>` : '') +
    (m.relance ? block('mRel', 'Relance J+4', m.relance) : '');
  $('msgBody').onclick = (e) => {
    const c = e.target.dataset.copy;
    if (c) { navigator.clipboard?.writeText($(c).value).then(() => toast('Copié.'), () => { $(c).select(); document.execCommand('copy'); toast('Copié.'); }); }
    if (e.target.id === 'sendMail') {
      location.href = `mailto:${encodeURIComponent(l.email)}?subject=${encodeURIComponent($('mObj').value)}&body=${encodeURIComponent($('mMail').value)}`;
      markContacted(l);
    }
    if (e.target.id === 'sendWa') {
      window.open(`https://wa.me/${wa}?text=${encodeURIComponent($('mWa').value)}`, '_blank', 'noopener');
      markContacted(l);
    }
  };
  $('msgDialog').showModal();
}
function markContacted(l) {
  if (l.status === 'new') { l.status = 'contacted'; l.note = (l.note ? l.note + '\n' : '') + `Contacté le ${fmtDate(Date.now())}`; persist(); renderAll(); }
}

/* ---------------- actions sur les cartes ---------------- */
async function onLeadClick(e) {
  const card = e.target.closest('.lead'); if (!card) return;
  const act = e.target.closest('[data-act]')?.dataset.act; if (!act || act === 'status') return;
  const l = S.leads.find((x) => x.id === card.dataset.id); if (!l) return;
  if (act === 'fav') { l.fav = !l.fav; persist(); e.target.classList.toggle('on', l.fav); renderStats(); }
  if (act === 'del') { if (!confirm(`Supprimer « ${l.entreprise} » ?`)) return; S.leads = S.leads.filter((x) => x !== l); persist(); card.remove(); renderStats(); }
  if (act === 'note') {
    const n = prompt('Note sur ce lead :', l.note || ''); if (n === null) return;
    l.note = n.trim(); persist(); card.outerHTML = leadCard(l);
  }
  if (act === 'mail') openMsgDialog(l, mailFallback(l));
  if (act === 'ai') {
    const b = e.target.closest('button'); b.disabled = true; const old = b.textContent; b.textContent = '✍ Rédaction…';
    try { openMsgDialog(l, await aiMessage(l)); }
    catch (err) { toast(err.message, 5000); openMsgDialog(l, mailFallback(l)); }
    finally { b.disabled = false; b.textContent = old; }
  }
}
function onLeadChange(e) {
  if (e.target.dataset.act !== 'status') return;
  const l = S.leads.find((x) => x.id === e.target.closest('.lead').dataset.id);
  if (l) { l.status = e.target.value; persist(); renderStats(); }
}

/* ---------------- export ---------------- */
const CSV_COLS = ['entreprise', 'activite', 'pays', 'ville', 'adresse', 'site', 'email', 'telephone', 'whatsapp', 'linkedin', 'decideur', 'poste_decideur', 'taille', 'score', 'raison', 'status', 'note', 'query', 'source', 'createdAt'];
function toCsv() {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const st = Object.fromEntries(STATUSES);
  const rows = S.leads.map((l) => CSV_COLS.map((c) => q(c === 'status' ? st[l.status] : c === 'createdAt' ? new Date(l.createdAt).toISOString().slice(0, 10) : l[c])).join(';'));
  return '﻿' + CSV_COLS.join(';') + '\n' + rows.join('\n');
}
function download(name, content, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const stamp = () => new Date().toISOString().slice(0, 10);

/* ---------------- navigation / réglages ---------------- */
function showView(v) {
  document.querySelectorAll('.view').forEach((x) => x.classList.toggle('active', x.id === 'view-' + v));
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  if (v === 'leads') renderLeads();
  if (v === 'watch') renderWatches();
  window.scrollTo(0, 0);
}
function fillSettings() {
  const s = S.settings;
  for (const k of ['model', 'customModel', 'pName', 'pCompany', 'pRole', 'pOffer', 'pPhone', 'pEmail', 'pLang']) $(k).value = s[k] ?? '';
  $('customModel').classList.toggle('hidden', s.model !== 'custom');
  let own = ''; try { own = localStorage.getItem(LS.key) || ''; } catch {}
  $('apiKey').value = own;
  $('keyHint').textContent = own ? 'Clé enregistrée sur ce téléphone.' : (getKey() ? 'Clé reprise automatiquement de Traducteur Live.' : 'Aucune clé : la source OpenStreetMap reste utilisable.');
}

function init() {
  S.leads = load(LS.leads, []); S.watches = load(LS.watches, []);
  S.settings = { ...DEFAULTS, ...load(LS.settings, {}) };
  $('statusFilter').innerHTML = `<option value="all">Tous statuts</option>` + STATUSES.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
  fillSettings(); renderQuickLinks(); renderAll();

  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
  $('kw').addEventListener('input', renderQuickLinks); $('zone').addEventListener('input', renderQuickLinks);
  if (!getKey()) $('source').value = 'osm';

  $('searchForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = { kw: $('kw').value.trim(), zone: $('zone').value.trim(), target: $('target').value, count: Number($('count').value), source: $('source').value };
    if (!q.kw) return;
    if ($('saveWatch').checked) {
      let w = S.watches.find((x) => x.kw === q.kw && x.zone === q.zone && x.target === q.target && x.source === q.source);
      if (!w) { w = { id: uid(), ...q, createdAt: Date.now(), total: 0 }; S.watches.unshift(w); persist(); }
      q.watchId = w.id;
    }
    $('results').innerHTML = '';
    await runSearch(q);
  });

  for (const id of ['results', 'leadList']) { $(id).addEventListener('click', onLeadClick); $(id).addEventListener('change', onLeadChange); }
  for (const id of ['leadFilter', 'statusFilter', 'sortBy', 'favOnly', 'contactOnly']) $(id).addEventListener('input', renderLeads);

  $('watchList').addEventListener('click', async (e) => {
    const a = e.target.dataset.wact; if (!a) return;
    const w = S.watches.find((x) => x.id === e.target.closest('[data-wid]').dataset.wid); if (!w) return;
    if (a === 'del') { if (!confirm('Supprimer cette veille ? (les leads restent)')) return; S.watches = S.watches.filter((x) => x !== w); persist(); renderWatches(); }
    if (a === 'run') {
      showView('search');
      $('kw').value = w.kw; $('zone').value = w.zone; $('target').value = w.target; $('count').value = String(w.count); $('source').value = w.source;
      renderQuickLinks(); $('results').innerHTML = '';
      await runSearch({ ...w, watchId: w.id });
    }
  });
  $('runAll').addEventListener('click', async () => {
    if (!S.watches.length) return toast('Aucune veille enregistrée.');
    let total = 0;
    for (let i = 0; i < S.watches.length; i++) {
      toast(`Veille ${i + 1}/${S.watches.length} : ${S.watches[i].kw}`, 60000);
      const r = await runSearch({ ...S.watches[i], watchId: S.watches[i].id }, { quiet: true });
      total += r ? r.added.length : 0;
      renderWatches();
    }
    toast(`Toutes les veilles relancées : ${total} nouveau(x) lead(s).`, 5000);
  });

  $('exportCsv').addEventListener('click', () => { if (!S.leads.length) return toast('Aucun lead.'); download(`leads-radar-b2b-${stamp()}.csv`, toCsv(), 'text/csv;charset=utf-8'); });
  $('shareCsv').addEventListener('click', async () => {
    if (!S.leads.length) return toast('Aucun lead.');
    const file = new File([toCsv()], `leads-radar-b2b-${stamp()}.csv`, { type: 'text/csv' });
    if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: 'Leads Radar B2B' }); } catch {} }
    else download(file.name, toCsv(), 'text/csv;charset=utf-8');
  });

  $('model').addEventListener('change', () => $('customModel').classList.toggle('hidden', $('model').value !== 'custom'));
  $('settingsForm').addEventListener('submit', (e) => {
    e.preventDefault();
    for (const k of Object.keys(DEFAULTS)) S.settings[k] = $(k).value.trim();
    save(LS.settings, S.settings);
    const k = $('apiKey').value.trim(); if (k) setKey(k); else setKey('');
    fillSettings(); toast('Réglages enregistrés.');
  });
  $('testKey').addEventListener('click', async () => {
    const k = $('apiKey').value.trim() || getKey(); if (!k) return toast('Saisissez une clé.');
    try { const r = await fetch(API + '/models', { headers: { Authorization: 'Bearer ' + k } }); toast(r.ok ? 'Clé valide ✔' : `Clé refusée (HTTP ${r.status}).`); }
    catch { toast('Réseau indisponible.'); }
  });
  $('backup').addEventListener('click', () => download(`radar-b2b-sauvegarde-${stamp()}.json`, JSON.stringify({ v: 1, leads: S.leads, watches: S.watches, settings: S.settings }, null, 1), 'application/json'));
  $('restore').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!Array.isArray(d.leads)) throw new Error();
      const known = new Set(S.leads.map(leadKey)); let n = 0;
      for (const l of d.leads) if (!known.has(leadKey(l))) { S.leads.push({ id: uid(), ...l }); n++; }
      for (const w of d.watches || []) if (!S.watches.some((x) => x.id === w.id)) S.watches.push(w);
      if (d.settings) { S.settings = { ...DEFAULTS, ...d.settings }; save(LS.settings, S.settings); fillSettings(); }
      persist(); renderAll(); toast(`${n} lead(s) restauré(s).`);
    } catch { toast('Fichier de sauvegarde invalide.'); }
    e.target.value = '';
  });
  $('wipe').addEventListener('click', () => {
    if (!confirm('Effacer TOUS les leads et veilles de ce téléphone ? Irréversible.')) return;
    S.leads = []; S.watches = []; persist(); renderAll(); toast('Données effacées.');
  });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
}

document.addEventListener('DOMContentLoaded', init);
