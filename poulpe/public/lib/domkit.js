/*
 * Poulpe — DOM kit.
 * Code exécuté dans la page cible : à la fois dans l'aperçu visuel (iframe)
 * et dans Playwright pendant l'extraction. Même logique des deux côtés,
 * donc ce que vous voyez dans l'aperçu est exactement ce que le robot extrait.
 */
(function (root) {
  'use strict';

  const NOISY_CLASS = /(^|-)(active|selected|current|hover|focus|open|odd|even|first|last|visible|hidden|show|loaded|lazy|is-|has-|js-)/i;
  const MAX_CLASSES = 3;

  function esc(s) {
    if (root.CSS && root.CSS.escape) return root.CSS.escape(s);
    return String(s).replace(/([^\w-])/g, '\\$1');
  }

  function goodClasses(el) {
    return Array.from(el.classList || [])
      .filter((c) => !c.startsWith('__pp') && c.length < 40 && !/\d{3,}/.test(c) && !NOISY_CLASS.test(c) && !/^[a-z]{1,2}\d/i.test(c) && !/[A-Za-z0-9]{6,}_[A-Za-z0-9]{4,}/.test(c))
      .slice(0, MAX_CLASSES);
  }

  /** Signature réutilisable : balise + classes stables. */
  function sig(el) {
    const tag = el.tagName.toLowerCase();
    const cls = goodClasses(el).map((c) => '.' + esc(c)).join('');
    return tag + cls;
  }

  function goodId(el) {
    const id = el.id;
    return id && id.length < 50 && !/\d{3,}|^[0-9]|:/.test(id) ? id : null;
  }

  function nthOfType(el) {
    let i = 1;
    let s = el.previousElementSibling;
    while (s) { if (s.tagName === el.tagName) i++; s = s.previousElementSibling; }
    return i;
  }

  function sameSigSiblings(el) {
    if (!el.parentElement) return 1;
    const s = sig(el);
    return Array.from(el.parentElement.children).filter((c) => sig(c) === s).length;
  }

  /** Sélecteur absolu, le plus court possible, qui désigne uniquement cet élément. */
  function cssPath(el) {
    const doc = el.ownerDocument;
    if (el === doc.body) return 'body';
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== doc.documentElement) {
      const id = goodId(cur);
      if (id) { parts.unshift('#' + esc(id)); break; }
      let part = sig(cur);
      if (sameSigSiblings(cur) > 1) part += ':nth-of-type(' + nthOfType(cur) + ')';
      parts.unshift(part);
      const candidate = parts.join(' > ');
      try { if (doc.querySelectorAll(candidate).length === 1) return candidate; } catch (e) { /* continue */ }
      if (cur === doc.body) break;
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  /** Sélecteur relatif d'un élément à l'intérieur d'un bloc répété (item). */
  function relSelector(item, el) {
    if (item === el) return '';
    const tries = [sig(el)];
    if (el.parentElement && el.parentElement !== item) tries.push(sig(el.parentElement) + ' ' + sig(el));
    for (const t of tries) {
      try { if (item.querySelector(t) === el) return t; } catch (e) { /* ignore */ }
    }
    const parts = [];
    let cur = el;
    while (cur && cur !== item) {
      let part = sig(cur);
      if (sameSigSiblings(cur) > 1) part += ':nth-of-type(' + nthOfType(cur) + ')';
      parts.unshift(part);
      cur = cur.parentElement;
    }
    return ':scope > ' + parts.join(' > ');
  }

  function ownText(el) {
    let t = '';
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue;
    return t.replace(/\s+/g, ' ').trim();
  }

  function cleanText(s) {
    return (s || '').replace(/[ \s]+/g, ' ').trim();
  }

  /** Valeur d'un élément selon l'attribut demandé. */
  function getValue(el, attr) {
    if (!el) return '';
    switch (attr || 'text') {
      case 'text': return cleanText(el.innerText != null ? el.innerText : el.textContent);
      case 'ownText': return ownText(el);
      case 'html': return el.innerHTML.trim();
      case 'outerHtml': return el.outerHTML.trim();
      case 'href': return el.href || el.getAttribute('href') || '';
      case 'src': return el.currentSrc || el.src || el.getAttribute('data-src') || el.getAttribute('src') || '';
      case 'value': return el.value != null ? String(el.value) : '';
      default: return (el.getAttribute(attr) || '').trim();
    }
  }

  function q(rootEl, selector) {
    if (!selector) return rootEl;
    try { return rootEl.querySelector(selector); } catch (e) { return null; }
  }

  function qa(rootEl, selector) {
    try { return Array.from(rootEl.querySelectorAll(selector)); } catch (e) { return []; }
  }

  /** Extrait un tableau de lignes : un bloc répété = une ligne. */
  function extractList(listSelector, fields, opts) {
    opts = opts || {};
    const doc = opts.document || root.document;
    const items = listSelector ? qa(doc, listSelector) : [doc.body];
    const rows = [];
    for (const item of items) {
      const row = {};
      let filled = 0;
      for (const f of fields || []) {
        let v;
        if (f.multiple) {
          v = qa(item, f.selector || '*').map((e) => getValue(e, f.attr)).filter(Boolean).join(f.joiner || ' | ');
        } else {
          v = getValue(q(item, f.selector), f.attr);
        }
        row[f.name] = v;
        if (v) filled++;
      }
      if (filled > 0) rows.push(row);
      if (opts.limit && rows.length >= opts.limit) break;
    }
    return rows;
  }

  function countItems(listSelector) {
    return qa(root.document, listSelector).length;
  }

  // ---------------------------------------------------------------- détection auto
  function fieldName(el, attr, used) {
    let base;
    if (attr === 'href') base = 'lien';
    else if (attr === 'src') base = 'image';
    else {
      const hint = (Array.from(el.classList || []).concat([el.getAttribute('itemprop') || '', el.tagName.toLowerCase()]))
        .join(' ').toLowerCase();
      const map = [
        [/title|titre|name|nom|heading|h[1-4]\b/, 'titre'], [/price|prix|amount|montant|cost/, 'prix'],
        [/date|time|deadline|echeance/, 'date'], [/desc|summary|resume|excerpt|snippet/, 'description'],
        [/country|pays|location|lieu|city|ville|address|adresse/, 'lieu'], [/phone|tel/, 'telephone'],
        [/mail/, 'email'], [/ref|number|numero|id\b/, 'reference'], [/company|entreprise|org|buyer|agency/, 'organisation'],
        [/categ|type|tag/, 'categorie'], [/rating|note|score|stars/, 'note'],
      ];
      base = 'champ';
      for (const [re, n] of map) if (re.test(hint)) { base = n; break; }
    }
    let n = base, i = 2;
    while (used.has(n)) n = base + '_' + i++;
    used.add(n);
    return n;
  }

  function autoFields(items) {
    const sample = items.slice(0, 12);
    const cand = new Map();
    const first = sample[0];
    const walker = (item) => {
      const all = [item].concat(Array.from(item.querySelectorAll('*')));
      for (const el of all) {
        const tag = el.tagName.toLowerCase();
        if (['script', 'style', 'svg', 'path', 'noscript', 'br', 'hr'].includes(tag)) continue;
        const specs = [];
        if (ownText(el).length >= 1 && el !== item) specs.push('text');
        if (tag === 'a' && el.getAttribute('href') && !/^(#|javascript:)/.test(el.getAttribute('href'))) specs.push('href');
        if (tag === 'img') specs.push('src');
        for (const attr of specs) {
          const sel = relSelector(item, el);
          const key = sel + '|' + attr;
          if (!cand.has(key)) cand.set(key, { selector: sel, attr, el, hits: 0 });
        }
      }
    };
    walker(first);
    for (const c of cand.values()) {
      for (const it of sample) if (getValue(q(it, c.selector), c.attr)) c.hits++;
    }
    const used = new Set();
    const out = [];
    const seenTextSel = new Set();
    for (const c of Array.from(cand.values()).filter((c) => c.hits >= Math.max(1, Math.ceil(sample.length * 0.5)))) {
      if (c.attr === 'text') {
        if (seenTextSel.has(c.selector)) continue;
        seenTextSel.add(c.selector);
      }
      out.push({ name: fieldName(c.el, c.attr, used), selector: c.selector, attr: c.attr });
      if (out.length >= 20) break;
    }
    return out;
  }

  /** Repère les listes répétées de la page (résultats, fiches, lignes de tableau). */
  function detectLists(max) {
    max = max || 5;
    const doc = root.document;
    const els = Array.from(doc.body.querySelectorAll('*')).slice(0, 8000);
    const cands = [];
    for (const parent of els) {
      if (parent.children.length < 3) continue;
      const tag = parent.tagName.toLowerCase();
      if (['select', 'script', 'head', 'svg', 'ul.nav'].includes(tag)) continue;
      const groups = new Map();
      for (const c of parent.children) {
        const s = sig(c);
        if (!groups.has(s)) groups.set(s, []);
        groups.get(s).push(c);
      }
      let best = null;
      for (const [s, arr] of groups) if (arr.length >= 3 && (!best || arr.length > best[1].length)) best = [s, arr];
      if (!best) continue;
      const items = best[1];
      const lens = items.map((i) => cleanText(i.innerText || i.textContent).length);
      const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
      if (avg < 15) continue;
      const nonEmpty = lens.filter((l) => l > 0).length / lens.length;
      const depth = items[0].querySelectorAll('*').length;
      const links = items[0].querySelectorAll('a[href]').length;
      if (depth < 1 && avg < 40) continue;
      const score = items.length * Math.min(avg, 300) * nonEmpty * (1 + Math.min(depth, 15) / 5) * (links ? 1.3 : 1);
      cands.push({ parent, items, score, sig: best[0] });
    }
    cands.sort((a, b) => b.score - a.score);
    const picked = [];
    for (const c of cands) {
      if (picked.some((p) => p.parent.contains(c.parent) || c.parent.contains(p.parent))) continue;
      picked.push(c);
      if (picked.length >= max) break;
    }
    return picked.map((c) => {
      const listSelector = cssPath(c.parent) + ' > ' + c.sig;
      const fields = autoFields(c.items);
      return {
        listSelector,
        count: qa(doc, listSelector).length,
        fields,
        preview: extractList(listSelector, fields, { limit: 5 }),
        score: Math.round(c.score),
      };
    });
  }

  /** Bloc répété le plus proche contenant l'élément cliqué. */
  function findRepeatingAncestor(el) {
    let cur = el;
    while (cur && cur.parentElement && cur !== root.document.body) {
      if (sameSigSiblings(cur) >= 2) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  function listSelectorFor(item) {
    return cssPath(item.parentElement) + ' > ' + sig(item);
  }

  /** Squelette compact du DOM pour l'assistant IA. */
  function outline(maxChars) {
    maxChars = maxChars || 60000;
    const doc = root.document;
    let out = '';
    const skip = new Set(['script', 'style', 'noscript', 'svg', 'path', 'meta', 'link', 'iframe', 'template']);
    const walk = (el, depth) => {
      if (out.length > maxChars) return;
      const tag = el.tagName.toLowerCase();
      if (skip.has(tag)) return;
      let line = '  '.repeat(Math.min(depth, 30)) + tag;
      if (goodId(el)) line += '#' + el.id;
      const cls = goodClasses(el);
      if (cls.length) line += '.' + cls.join('.');
      if (tag === 'a' && el.getAttribute('href')) line += ' [href=' + el.getAttribute('href').slice(0, 80) + ']';
      const t = ownText(el);
      if (t) line += ' "' + t.slice(0, 80) + '"';
      out += line + '\n';
      // Dans une liste longue, on ne détaille que les 3 premiers éléments répétés.
      const seen = new Map();
      for (const c of el.children) {
        const s = sig(c);
        const n = (seen.get(s) || 0) + 1;
        seen.set(s, n);
        if (n <= 3) walk(c, depth + 1);
        else if (n === 4) out += '  '.repeat(Math.min(depth + 1, 30)) + '… (' + s + ' répété)\n';
      }
    };
    walk(doc.body, 0);
    return out.slice(0, maxChars);
  }

  function pageText() {
    return cleanText(root.document.body ? root.document.body.innerText : '');
  }

  root.__poulpe = {
    sig, cssPath, relSelector, getValue, extractList, countItems, detectLists, autoFields,
    findRepeatingAncestor, listSelectorFor, outline, pageText, ownText,
  };
})(typeof window !== 'undefined' ? window : globalThis);
