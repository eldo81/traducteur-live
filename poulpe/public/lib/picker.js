/* Poulpe — sélection pointer-cliquer dans l'aperçu (iframe). Communique avec l'éditeur par postMessage. */
(function () {
  'use strict';
  const P = window.__poulpe;
  const state = { mode: 'field', listSelector: '', fields: [], next: '' };
  let hovered = null;

  const send = (msg) => window.parent.postMessage({ __poulpe: true, ...msg }, '*');
  const clear = (cls) => document.querySelectorAll('.' + cls).forEach((e) => e.classList.remove(cls));
  const qa = (root, s) => { try { return Array.from(root.querySelectorAll(s)); } catch (e) { return []; } };
  const qs = (root, s) => { if (!s) return root; try { return root.querySelector(s); } catch (e) { return null; } };

  function paint() {
    clear('__pp-item'); clear('__pp-field'); clear('__pp-next');
    const items = state.listSelector ? qa(document, state.listSelector) : [];
    items.forEach((i) => i.classList.add('__pp-item'));
    const roots = items.length ? items : [document.body];
    for (const f of state.fields) for (const r of roots) { const el = qs(r, f.selector); if (el && el !== r) el.classList.add('__pp-field'); }
    if (state.next) qa(document, state.next).forEach((e) => e.classList.add('__pp-next'));
    return items.length;
  }

  function nextSelector(el) {
    const a = el.closest('a,button') || el;
    if (a.getAttribute('rel') === 'next') return a.tagName.toLowerCase() + '[rel="next"]';
    const al = (a.getAttribute('aria-label') || '').trim();
    if (al && al.length < 40) return a.tagName.toLowerCase() + '[aria-label="' + al.replace(/"/g, '\\"') + '"]';
    const cls = Array.from(a.classList).find((c) => /next|suiv|forward/i.test(c));
    if (cls) return a.tagName.toLowerCase() + '.' + CSS.escape(cls);
    return P.cssPath(a);
  }

  function describe(el) {
    const tag = el.tagName.toLowerCase();
    const link = el.closest('a[href]');
    return {
      tag,
      text: P.getValue(el, 'text').slice(0, 200),
      href: link ? link.href : '',
      src: tag === 'img' ? P.getValue(el, 'src') : '',
      attr: tag === 'img' ? 'src' : 'text',
    };
  }

  document.addEventListener('mouseover', (e) => {
    if (state.mode === 'off') return;
    if (hovered) hovered.classList.remove('__pp-hover');
    hovered = e.target;
    hovered.classList.add('__pp-hover');
  }, true);
  document.addEventListener('mouseout', () => { if (hovered) hovered.classList.remove('__pp-hover'); }, true);

  // Bloque toute navigation dans l'aperçu.
  ['click', 'submit', 'auxclick', 'dblclick'].forEach((ev) => document.addEventListener(ev, (e) => {
    e.preventDefault(); e.stopPropagation();
    if (ev !== 'click' || state.mode === 'off') return;
    pick(e.target);
  }, true));

  function pick(el) {
    if (el.classList) el.classList.remove('__pp-hover');
    const d = describe(el);
    if (state.mode === 'next') {
      state.next = nextSelector(el);
      paint();
      return send({ type: 'picked', kind: 'next', selector: state.next, text: d.text, href: d.href });
    }
    if (state.mode === 'list') {
      const item = P.findRepeatingAncestor(el) || el;
      state.listSelector = P.listSelectorFor(item);
      const count = paint();
      return send({ type: 'picked', kind: 'list', listSelector: state.listSelector, count });
    }
    if (state.mode === 'action') {
      return send({ type: 'picked', kind: 'action', selector: P.cssPath(el.closest('a,button,input,select,textarea,[role=button]') || el), text: d.text });
    }
    // Mode champ
    let item = null;
    if (state.listSelector) item = qa(document, state.listSelector).find((i) => i.contains(el)) || null;
    let listSelector = state.listSelector;
    if (!item && !state.singleMode) {
      const rep = P.findRepeatingAncestor(el);
      if (rep && rep !== el) {
        item = rep;
        if (!state.listSelector) { listSelector = P.listSelectorFor(rep); state.listSelector = listSelector; }
        else item = null;
      }
    }
    if (item) {
      const selector = P.relSelector(item, el);
      const count = qa(document, listSelector).length;
      const samples = qa(document, listSelector).slice(0, 5).map((i) => P.getValue(qs(i, selector), d.attr));
      const linkSel = d.href ? P.relSelector(item, el.closest('a[href]')) : '';
      send({ type: 'picked', kind: 'field', listSelector, count, selector, attr: d.attr, samples, text: d.text, href: d.href, linkSelector: linkSel, tag: d.tag });
    } else {
      const selector = P.cssPath(el);
      const a = el.closest('a[href]');
      send({ type: 'picked', kind: 'single', selector, attr: d.attr, samples: [P.getValue(el, d.attr)], text: d.text, href: d.href, linkSelector: a ? P.cssPath(a) : '', tag: d.tag });
    }
  }

  window.addEventListener('message', (e) => {
    const m = e.data || {};
    if (!m.__poulpe) return;
    if (m.type === 'state') {
      Object.assign(state, m.state);
      const count = paint();
      send({ type: 'count', count });
    }
  });

  send({ type: 'ready', title: document.title, url: document.baseURI });
})();
