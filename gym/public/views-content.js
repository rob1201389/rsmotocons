/* ============================================================================
   Public pages: About, Why Recomp, Privacy.
   Content is data (public/content/*.json, optionally overridden by an
   administrator through /api/content/:key). It is rendered with textContent
   only: the only markup is **bold** and [label](url) with https, mailto or
   #anchor links. Nothing in the content can add HTML or script.
   These pages work before sign-in, so nothing here touches account data.
   ========================================================================== */
const Content = (function () {
  'use strict';
  const KEYS = ['about', 'why', 'privacy'];
  const TITLES = { about: 'About Recomp', why: 'Why Recomp', privacy: 'Privacy policy' };
  const cache = {};
  let operator = null, operatorLoaded = false, lastFocus = null, current = null;

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const SAFE_URL = /^(https:\/\/[^\s<>"']+|mailto:[^\s<>"']+|#[A-Za-z0-9_-]+)$/;

  /* ---------------------------------------------------------- tokens */
  function tokenValue(path, tok) {
    const [ns, key] = path.split('.');
    const src = tok && tok[ns];
    const v = src ? src[key] : null;
    return v == null || String(v).trim() === '' ? null : String(v);
  }
  /* Inline text: tokens, **bold**, [label](url). Unknown or unsafe links render as plain text. */
  function inline(str, tok, ctx) {
    const frag = document.createDocumentFragment();
    const re = /\{\{\s*([a-zA-Z]+\.[a-zA-Z]+)\s*\}\}|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
    let last = 0, m; const s = String(str == null ? '' : str);
    while ((m = re.exec(s))) {
      if (m.index > last) frag.appendChild(document.createTextNode(s.slice(last, m.index)));
      if (m[1]) {
        const v = tokenValue(m[1], tok);
        if (v == null) { const miss = el('span', 'c-missing', '[not yet supplied]'); miss.title = m[1]; frag.appendChild(miss); if (ctx) ctx.missing.add(m[1]); }
        else if (/privacyEmail$/.test(m[1]) && /^[^\s@]+@[^\s@]+$/.test(v)) { const a = el('a', null, v); a.href = 'mailto:' + v; frag.appendChild(a); }
        else frag.appendChild(document.createTextNode(v));
      } else if (m[2]) frag.appendChild(el('strong', null, m[2]));
      else if (m[3]) {
        const url = m[4];
        if (SAFE_URL.test(url)) {
          const a = el('a', null, m[3]); a.href = url;
          if (url.startsWith('https://')) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
          if (url.startsWith('#')) a.onclick = e => { const t = document.getElementById('c-' + url.slice(1)); if (t) { e.preventDefault(); t.scrollIntoView({ block: 'start' }); t.focus({ preventScroll: true }); } };
          frag.appendChild(a);
        } else frag.appendChild(document.createTextNode(m[3]));
      }
      last = re.lastIndex;
    }
    if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
    return frag;
  }
  const withInline = (node, str, tok, ctx) => { node.appendChild(inline(str, tok, ctx)); return node; };
  const cleanId = id => String(id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60);

  function blocks(list, tok, ctx) {
    const frag = document.createDocumentFragment();
    (Array.isArray(list) ? list : []).forEach(b => {
      if (!b || typeof b !== 'object') return;
      const t = b.t;
      if (t === 'h2' || t === 'h3') {
        const h = withInline(el(t, 'c-' + t), b.text, tok, ctx);
        if (b.id) { h.id = 'c-' + cleanId(b.id); h.tabIndex = -1; if (ctx && t === 'h2') ctx.toc.push({ id: h.id, text: h.textContent }); }
        frag.appendChild(h);
      } else if (t === 'p') frag.appendChild(withInline(el('p', 'c-p'), b.text, tok, ctx));
      else if (t === 'note') frag.appendChild(withInline(el('p', 'c-note'), b.text, tok, ctx));
      else if (t === 'ul' || t === 'ol') {
        const l = el(t, 'c-list'); (b.items || []).forEach(i => l.appendChild(withInline(el('li'), i, tok, ctx))); frag.appendChild(l);
      } else if (t === 'table') {
        const wrap = el('div', 'c-tablewrap'); wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', b.caption || 'Table');
        const tb = el('table', 'c-table');
        if (b.caption) tb.appendChild(el('caption', null, b.caption));
        if (b.head) { const tr = el('tr'); b.head.forEach(hd => { const th = withInline(el('th'), hd, tok, ctx); th.scope = 'col'; tr.appendChild(th); }); const th = el('thead'); th.appendChild(tr); tb.appendChild(th); }
        const body = el('tbody'); (b.rows || []).forEach(r => { const tr = el('tr'); (r || []).forEach(c => tr.appendChild(withInline(el('td'), c, tok, ctx))); body.appendChild(tr); }); tb.appendChild(body);
        wrap.appendChild(tb); frag.appendChild(wrap);
      } else if (t === 'steps') {
        const ol = el('ol', 'c-steps'); (b.items || []).forEach((s, i) => { const li = el('li'); li.appendChild(el('span', 'c-stepn', String(i + 1))); const d = el('div'); d.appendChild(withInline(el('b'), s.title, tok, ctx)); if (s.text) d.appendChild(withInline(el('span', 'c-stept'), s.text, tok, ctx)); li.appendChild(d); ol.appendChild(li); });
        frag.appendChild(ol);
      } else if (t === 'cards') {
        const g = el('div', 'c-cards');
        (b.items || []).forEach(c => { const d = el('div', 'c-card'); if (c.badge) d.appendChild(el('span', 'c-badge ' + (/planned/i.test(c.badge) ? 'planned' : 'now'), c.badge)); d.appendChild(withInline(el('h3'), c.title, tok, ctx)); if (c.text) d.appendChild(withInline(el('p'), c.text, tok, ctx)); g.appendChild(d); });
        frag.appendChild(g);
      }
    });
    return frag;
  }

  /* ---------------------------------------------------------- loading */
  async function getJSON(url) {
    try { const r = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } }); if (!r.ok) return null; return await r.json(); } catch (e) { return null; }
  }
  async function loadOperator() {
    if (operatorLoaded) return operator;
    const d = await getJSON('/api/operator');
    operator = d && d.operator ? d : null; operatorLoaded = true; return operator;
  }
  async function load(key) {
    if (cache[key]) return cache[key];
    const base = await getJSON('content/' + key + '.json');
    let doc = base;
    if (key !== 'privacy') {
      const o = await getJSON('/api/content/' + key);
      if (o && o.content && Array.isArray(o.content.blocks)) doc = Object.assign({}, base || {}, o.content, { overridden: true, overrideAt: o.updatedAt });
    }
    cache[key] = doc; return doc;
  }
  function invalidate(key) { if (key) delete cache[key]; else KEYS.forEach(k => delete cache[k]); operatorLoaded = false; }

  /* ------------------------------------------------------------ page */
  function ensurePage() {
    let p = document.getElementById('docPage');
    if (p) return p;
    p = el('div', 'docpage'); p.id = 'docPage'; p.hidden = true;
    p.setAttribute('role', 'dialog'); p.setAttribute('aria-modal', 'true'); p.setAttribute('aria-labelledby', 'docTitle');
    p.innerHTML = '<div class="doc-bar"><button type="button" class="btn sm ghost" id="docBack">← Back</button><nav class="doc-tabs" aria-label="Recomp information"></nav></div><main class="doc-main" id="docMain"><h1 id="docTitle" tabindex="-1"></h1><div id="docBody"></div></main>';
    document.body.appendChild(p);
    const nav = p.querySelector('.doc-tabs');
    KEYS.forEach(k => { const b = el('button', 'doc-tab', TITLES[k].replace('Privacy policy', 'Privacy')); b.type = 'button'; b.dataset.key = k; b.onclick = () => open(k); nav.appendChild(b); });
    p.querySelector('#docBack').onclick = close;
    p.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    return p;
  }
  async function open(key, anchor) {
    if (KEYS.indexOf(key) < 0) return;
    const p = ensurePage();
    /* The sign-in dialog traps focus; close it so the page can be read and navigated. */
    if (window.AuthUI && AuthUI.isOpen && AuthUI.isOpen()) { lastFocus = document.getElementById('awLogin'); AuthUI.closeDialog({ focus: false }); }
    else if (p.hidden) lastFocus = document.activeElement;
    current = key; p.hidden = false; document.body.classList.add('doc-open');
    if (location.hash !== '#' + key && !String(location.hash).startsWith('#' + key + '/')) { try { history.pushState({ doc: key }, '', '#' + key); } catch (e) {} }
    p.querySelectorAll('.doc-tab').forEach(b => b.setAttribute('aria-current', b.dataset.key === key ? 'page' : 'false'));
    const title = p.querySelector('#docTitle'), body = p.querySelector('#docBody');
    title.textContent = TITLES[key]; body.innerHTML = ''; body.appendChild(el('p', 'muted', 'Loading…'));
    const [doc, op] = await Promise.all([load(key), loadOperator()]);
    if (current !== key) return;
    body.innerHTML = '';
    if (!doc) { body.appendChild(el('p', 'muted', 'This page could not be loaded. Check your connection and try again.')); title.focus(); return; }
    title.textContent = doc.title || TITLES[key];
    const tok = { operator: (op && op.operator) || {}, policy: Object.assign({}, (op && op.policy) || {}, { version: doc.version }) };
    if (!tok.policy.effectiveDate && doc.effectiveDate) tok.policy.effectiveDate = doc.effectiveDate;
    const ctx = { toc: [], missing: new Set() };
    const content = el('div', 'doc-content');
    if (doc.summary) content.appendChild(withInline(el('p', 'doc-lead'), doc.summary, tok, ctx));
    if (key === 'privacy' && Array.isArray(doc.overview) && doc.overview.length) {
      const ov = el('section', 'doc-overview'); ov.setAttribute('aria-labelledby', 'docOverviewH');
      const h = el('h2', null, 'Privacy at a glance'); h.id = 'docOverviewH'; ov.appendChild(h);
      ov.appendChild(blocks(doc.overview, tok, ctx)); content.appendChild(ov);
    }
    const main = blocks(doc.blocks, tok, ctx);
    if (key === 'privacy' && ctx.toc.length) {
      const nav = el('nav', 'doc-toc'); nav.setAttribute('aria-labelledby', 'docTocH');
      const h = el('h2', null, 'Contents'); h.id = 'docTocH'; nav.appendChild(h);
      const ol = el('ol'); ctx.toc.forEach(s => { const li = el('li'); const a = el('a', null, s.text); a.href = '#' + key + '/' + s.id.replace(/^c-/, ''); a.onclick = e => { e.preventDefault(); jump(s.id); }; li.appendChild(a); ol.appendChild(li); });
      nav.appendChild(ol); content.appendChild(nav);
    }
    content.appendChild(main);
    if (Array.isArray(doc.history) && doc.history.length) {
      content.appendChild(el('h2', 'c-h2', 'Version history'));
      const ul = el('ul', 'c-list'); doc.history.forEach(hh => { const li = el('li'); li.appendChild(el('b', null, `${hh.version} (${hh.date})`)); li.appendChild(document.createTextNode(' ' + (hh.summary || ''))); ul.appendChild(li); }); content.appendChild(ul);
    }
    const meta = el('p', 'doc-meta', [doc.version ? 'Version ' + doc.version : '', doc.updated ? 'updated ' + doc.updated : '', doc.overridden ? 'edited by an administrator' : ''].filter(Boolean).join(' · '));
    content.appendChild(meta);
    const draft = doc.status !== 'published' || (key === 'privacy' && (!op || !op.complete)) || ctx.missing.size > 0;
    if (draft && key === 'privacy') {
      const bn = el('div', 'doc-draft'); bn.setAttribute('role', 'note');
      bn.appendChild(el('b', null, 'Draft. '));
      bn.appendChild(document.createTextNode(ctx.missing.size ? 'Some details about who runs Recomp have not been supplied yet, so this policy is not final. ' : 'This policy is awaiting final review by the operator. '));
      bn.appendChild(document.createTextNode('It describes how the app works today.'));
      body.appendChild(bn);
    }
    body.appendChild(content);
    if (anchor) jump('c-' + cleanId(anchor)); else { p.scrollTop = 0; title.focus(); }
  }
  function jump(id) { const t = document.getElementById(id); if (!t) return; t.scrollIntoView({ block: 'start' }); t.focus({ preventScroll: true }); try { history.replaceState({ doc: current }, '', '#' + current + '/' + id.replace(/^c-/, '')); } catch (e) {} }
  function close() {
    const p = document.getElementById('docPage'); if (!p || p.hidden) return;
    p.hidden = true; current = null; document.body.classList.remove('doc-open');
    if (/^#(about|why|privacy)/.test(location.hash)) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} }
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus();
  }
  function route() {
    const m = String(location.hash).match(/^#(about|why|privacy)(?:\/([A-Za-z0-9_-]+))?$/);
    if (m) open(m[1], m[2]); else close();
  }
  window.addEventListener('hashchange', route);
  window.addEventListener('popstate', route);
  /* links anywhere in the app or the welcome page: <a data-doc="privacy"> */
  document.addEventListener('click', e => { const a = e.target.closest('[data-doc]'); if (a) { e.preventDefault(); open(a.dataset.doc, a.dataset.anchor); } });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', route, { once: true }); else route();

  return { open, close, load, invalidate, blocks, inline, KEYS, TITLES, SAFE_URL, loadOperator };
})();
window.Content = Content;
