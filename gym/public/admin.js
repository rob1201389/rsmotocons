/* Administration: sign-up requests.

   Opened from the Profile tab, for administrators only. The screen lists the
   persisted sign-up requests, and a detail view lets an administrator approve
   (with a role and feature permissions), reject, verify an email address by
   hand, keep a private note, and suspend, revoke or reactivate an account.

   Everything shown comes from the server on every visit and after every
   action, so a refresh shows the same thing. Hiding this screen from other
   people is presentation; /api/admin/* refuses anyone who is not an
   administrator. No password is ever requested or displayed here. */

const Admin = (function () {
  'use strict';

  /* Mirrors FEATURES and PRESETS in backend/src/rbac.js. The server validates
     every key, so a mismatch is refused rather than silently accepted. */
  const FEATURES = [
    ['training',  'Training', 'Plans and workout logging'],
    ['library',   'Exercise library', 'Exercises and mobility'],
    ['nutrition', 'Nutrition', 'Macros and meals'],
    ['recipes',   'Recipes', 'Recipes and meal planning'],
    ['garmin',    'Garmin import', 'Bring in Garmin data'],
    ['progress',  'Progress', 'Charts and records'],
    ['reviews',   'Weekly reviews', 'Weekly check-in, coach report and reviews']
  ];
  /* Mirrors ALWAYS_ON in rbac.js: everyone gets weekly reviews. */
  const ALWAYS_ON = ['reviews'];
  const PRESETS = {
    member: { training: true, library: true, nutrition: true, recipes: true, garmin: true, progress: true, reviews: true },
    coach:  { training: true, library: true, nutrition: false, recipes: false, garmin: false, progress: true, reviews: true }
  };
  const ROLE_LABEL = { member: 'Member', coach: 'Coach' };
  const TABS = [['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['all', 'All']];
  const PENDING = ['pending_verification', 'pending_approval'];
  const STATUS_LABEL = {
    pending_verification: 'Awaiting email', pending_approval: 'Awaiting approval',
    approved: 'Approved', rejected: 'Rejected'
  };
  const ACCOUNT_LABEL = { active: 'Active', suspended: 'Suspended', revoked: 'Revoked', rejected: 'Rejected', pending: 'Pending' };
  const OFFLINE = 'Could not reach the server. Check your connection and try again.';

  const st = {
    open: false, tab: 'pending', rows: [], loading: false, loadError: '',
    sel: null, form: null, opener: null, confirmEl: null, confirmDone: null, inerted: [], busy: false,
    status: ''
  };
  let root = null;

  /* ------------------------------------------------------------ DOM ---- */
  function h(tag, props) {
    const n = document.createElement(tag);
    if (props) Object.keys(props).forEach(k => {
      const v = props[k];
      if (v == null || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'hidden') n[k] = v;
      else n.setAttribute(k, v === true ? '' : v);
    });
    for (let i = 2; i < arguments.length; i++) {
      const c = arguments[i];
      if (c == null || c === false) continue;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return n;
  }
  const fmtDate = ms => ms ? new Date(ms).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

  const CSS = `
.adm{position:fixed;inset:0;z-index:150;display:flex;flex-direction:column;background:var(--bg);color:var(--text);
  height:100dvh;padding-top:env(safe-area-inset-top)}
.adm [hidden],.adm[hidden]{display:none!important}
.adm *{box-sizing:border-box}
.adm-hd{flex:none;display:flex;align-items:center;gap:8px;padding:8px var(--gut);border-bottom:1px solid var(--line);
  background:color-mix(in srgb,var(--bg) 92%,transparent)}
.adm-hd h2{flex:1;min-width:0;font-size:1.35rem;margin:0}
.adm-hd h2:focus{outline:none}
.adm-iconbtn{flex:none;min-width:44px;min-height:44px;display:inline-flex;align-items:center;justify-content:center;gap:6px;
  padding:0 10px;background:transparent;border:0;border-radius:var(--r-s);color:var(--text);font:inherit;font-weight:600;cursor:pointer}
.adm-iconbtn:hover{background:var(--surface-2)}
.adm-main{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
.adm-in{max-width:760px;margin:0 auto;padding:14px var(--gut) calc(28px + env(safe-area-inset-bottom))}
.adm :focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.adm-tabs{display:flex;gap:4px;padding:4px;background:var(--surface-2);border:1px solid var(--line);border-radius:12px;margin-bottom:14px}
.adm-tabs button{flex:1;min-height:44px;border:0;border-radius:9px;background:transparent;color:var(--muted);font:inherit;font-weight:600;cursor:pointer}
.adm-tabs button[aria-selected="true"]{background:var(--bg);color:var(--text);box-shadow:inset 0 -2px 0 var(--accent)}
.adm-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.adm-row{display:block;width:100%;text-align:left;padding:13px 14px;background:var(--surface);color:inherit;font:inherit;
  border:1px solid var(--line);border-radius:var(--r-m);cursor:pointer;min-height:64px}
.adm-row:hover{border-color:var(--line-strong);background:var(--surface-2)}
.adm-row .l1{display:flex;justify-content:space-between;gap:10px;align-items:baseline}
.adm-row b{font-size:1rem;overflow-wrap:anywhere}
.adm-row .em{color:var(--muted);font-size:.88rem;overflow-wrap:anywhere;margin-top:2px}
.adm-row .meta{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px;font-size:.78rem;color:var(--dim)}
.chip{display:inline-block;padding:2px 9px;border-radius:999px;font-size:.74rem;font-weight:600;border:1px solid var(--line-strong);color:var(--muted);white-space:nowrap}
.chip.ok{color:var(--accent);border-color:var(--accent);background:var(--accent-soft)}
.chip.wait{color:var(--warn);border-color:var(--warn);background:var(--warn-soft)}
.chip.bad{color:var(--alert);border-color:var(--alert);background:var(--alert-soft)}
.adm-empty{padding:28px 10px;text-align:center;color:var(--muted)}
.adm-empty b{display:block;color:var(--text);font-family:var(--display);font-size:1.15rem;margin-bottom:4px}
.adm-msg{margin:0 0 12px;padding:10px 12px;border-radius:var(--r-s);font-size:.9rem;border:1px solid var(--accent);background:var(--accent-soft)}
.adm-msg:empty{display:none}
.adm-err{margin:0 0 12px;padding:10px 12px;border-radius:var(--r-s);font-size:.9rem;border:1px solid var(--alert);background:var(--alert-soft)}
.adm-err:empty{display:none}
.adm-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-m);padding:16px;margin-bottom:12px}
.adm-card h3{font-size:1.15rem;margin:0 0 10px}
.adm-card p{margin:0 0 10px;font-size:.9rem}
.adm-who h3{font-size:1.5rem;overflow-wrap:anywhere;margin:0}
.adm-who h3:focus{outline:none}
.adm-who .em{color:var(--muted);overflow-wrap:anywhere;margin:2px 0 10px}
.adm-who .chips{display:flex;flex-wrap:wrap;gap:6px}
.adm-f{margin:0 0 14px}
.adm-f label,.adm-f legend{display:block;font-size:.88rem;font-weight:600;margin:0 0 6px;padding:0}
.adm-f select,.adm-f textarea{display:block;width:100%;font:inherit;font-size:1rem;color:var(--text);background:var(--surface-2);
  border:1px solid var(--line-strong);border-radius:var(--r-s);padding:11px 12px}
.adm-f select{min-height:48px}
.adm-f textarea{min-height:88px;resize:vertical}
.adm-f .hint{font-size:.8rem;color:var(--dim);margin:5px 0 0}
fieldset.adm-f{border:0;padding:0;margin:0 0 14px;min-width:0}
.adm-f label.adm-perm{display:flex;gap:12px;align-items:flex-start;margin:0;padding:9px 0;border-bottom:1px solid var(--line);min-height:44px;cursor:pointer;font-weight:400}
.adm-perm:last-child{border-bottom:0}
.adm-perm input{flex:none;width:22px;height:22px;margin:1px 0 0;accent-color:var(--accent)}
.adm-perm span{display:block;font-weight:600;font-size:.92rem}
.adm-perm small{display:block;color:var(--muted);font-weight:400;font-size:.8rem}
.adm-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}
.adm-acts .btn{flex:1 1 150px}
.btn.danger{background:var(--alert-soft);border-color:var(--alert);color:var(--alert)}
.btn.danger:hover{background:var(--alert);color:#fff}
.adm .btn.busy::after{content:"\\2026"}
.adm-conf{position:absolute;inset:0;z-index:5;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.6)}
.adm-conf>div{width:min(420px,100%);background:var(--surface);border:1px solid var(--line-strong);border-radius:var(--r-l);padding:20px;box-shadow:var(--shadow)}
.adm-conf h3{font-size:1.3rem;margin:0 0 8px}
.adm-conf p{color:var(--muted);margin:0 0 16px;font-size:.94rem}
.adm-conf .adm-acts .btn{flex:1 1 120px}
@media (prefers-reduced-motion:no-preference){ .adm{animation:admIn .18s var(--ease)} @keyframes admIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}} }
`;
  function ensureStyles() {
    if (document.getElementById('adminStyles')) return;
    const s = document.createElement('style'); s.id = 'adminStyles'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ------------------------------------------------------ public ------ */
  function available(user) {
    return !!(user && (user.role === 'owner' || user.role === 'admin') &&
              (!user.accountState || user.accountState === 'active'));
  }
  function profileBlock() {
    const wrap = h('div', { id: 'profAdmin' },
      h('h2', { style: 'margin:20px 0 8px', text: 'Administration' }),
      h('div', { class: 'card' },
        h('p', { class: 'muted', style: 'font-size:.86rem;margin:0 0 10px',
                 text: 'Review sign-up requests, approve or reject accounts, and manage who has access.' }),
        h('button', { class: 'btn block', type: 'button', id: 'adminOpenBtn', text: 'Administration',
                      onclick: e => open(e.currentTarget) })));
    return wrap;
  }

  function open(opener) {
    ensureStyles();
    if (st.open) return;
    st.open = true; st.opener = opener || document.activeElement;
    st.tab = 'pending'; st.sel = null; st.status = ''; st.loadError = '';
    root = h('div', { class: 'adm', id: 'adminScreen', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'admTitle' });
    document.body.appendChild(root);
    inertBackground(true);
    document.addEventListener('keydown', onKey, true);
    render();
    load();
    focusFirst();
  }
  function close() {
    if (!st.open || st.busy) return;
    if (st.confirmEl) return cancelConfirm();
    st.open = false;
    document.removeEventListener('keydown', onKey, true);
    root.remove(); root = null;
    inertBackground(false);
    const o = st.opener && st.opener.isConnected ? st.opener : document.getElementById('adminOpenBtn');
    if (o && o.focus) o.focus();
    st.opener = null;
  }
  function inertBackground(on) {
    if (on) {
      [...document.body.children].forEach(n => {
        if (n === root || n.tagName === 'SCRIPT' || n.tagName === 'STYLE' || n.hasAttribute('inert')) return;
        n.setAttribute('inert', ''); n.setAttribute('aria-hidden', 'true'); st.inerted.push(n);
      });
    } else {
      st.inerted.forEach(n => { n.removeAttribute('inert'); n.removeAttribute('aria-hidden'); });
      st.inerted = [];
    }
  }

  /* ----------------------------------------------------- keyboard ----- */
  function layer() { return st.confirmEl || root; }
  function focusables(scope) {
    return [...scope.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')].filter(n =>
      !n.disabled && n.getAttribute('tabindex') !== '-1' && !n.closest('[hidden]'));
  }
  function focusFirst() {
    const t = root.querySelector('[role="tab"][aria-selected="true"]') || root.querySelector('#admBack') || root;
    t.focus();
  }
  function onKey(e) {
    if (!st.open || st.paused) return;
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (st.busy) return;
      if (st.confirmEl) cancelConfirm();
      else if (st.sel) back();
      else close();
      return;
    }
    if (e.key !== 'Tab') return;
    const scope = layer(), f = focusables(scope), a = document.activeElement;
    if (!f.length) { e.preventDefault(); return; }
    if (!scope.contains(a)) { e.preventDefault(); (e.shiftKey ? f[f.length - 1] : f[0]).focus(); }
    else if (e.shiftKey && a === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && a === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  }

  /* -------------------------------------------------------- data ------ */
  /* Sensitive admin actions need a recent password (and code) check. The server
     says so with code 'reauth_required'; ask once above this screen and retry. */
  async function call(fn) {
    let r;
    try { r = await fn(); } catch (e) { return { ok: false, status: 0, error: OFFLINE, data: {} }; }
    if (r && r.code === 'reauth_required' && window.Settings) {
      st.paused = true; inertBackground(false); root.setAttribute('inert', ''); document.body.classList.add('adm-reauth');
      let ok = false;
      try { ok = await Settings.askReauth('Confirm it is you before changing someone\'s access.'); }
      finally { root.removeAttribute('inert'); document.body.classList.remove('adm-reauth'); inertBackground(true); st.paused = false; }
      if (!ok) return { ok: false, status: 403, error: 'Not changed: your identity was not confirmed.', data: {}, code: 'reauth_cancelled' };
      try { r = await fn(); } catch (e) { return { ok: false, status: 0, error: OFFLINE, data: {} }; }
    }
    return r;
  }
  function explain(r) {
    if (r.status === 0) return OFFLINE;
    if (r.status === 401) return 'Your session has ended. Log in again to continue.';
    if (r.status === 403) return r.error || 'You do not have permission to do that.';
    if (r.status === 404) return 'That request no longer exists. Refresh the list.';
    if (r.status === 409 || r.status === 400) return r.error || 'That could not be done.';
    if (r.status === 429) return r.error || 'Too many requests. Try again shortly.';
    return r.error || 'Something went wrong. Try again.';
  }
  async function load(keepSel) {
    st.loading = true; st.loadError = '';
    if (!st.sel) renderBody();
    const wanted = st.tab === 'pending' || st.tab === 'all' ? 'all' : st.tab;
    const r = await call(() => AUTH.adminRequests(wanted));
    st.loading = false;
    if (!st.open) return;
    if (!r.ok) { st.loadError = explain(r); st.rows = []; }
    else {
      let rows = r.data.requests || [];
      if (st.tab === 'pending') rows = rows.filter(x => PENDING.includes(x.status));
      st.rows = rows;
      if (st.sel) {
        const fresh = (r.data.requests || []).find(x => x.id === st.sel.id);
        if (fresh) st.sel = fresh;
      }
    }
    if (st.sel) { if (!keepSel) renderBody(); } else renderBody();
  }

  /* ---------------------------------------------------- rendering ----- */
  function render() {
    root.textContent = '';
    const title = h('h2', { id: 'admTitle', tabindex: '-1', text: 'User requests' });
    root.appendChild(h('div', { class: 'adm-hd' },
      h('button', { class: 'adm-iconbtn', type: 'button', id: 'admBack', 'aria-label': 'Back',
                    onclick: () => (st.sel ? back() : close()) }, '← ', h('span', { id: 'admBackLbl', text: 'Back' })),
      title,
      h('button', { class: 'adm-iconbtn', type: 'button', id: 'admRefresh', text: 'Refresh', onclick: () => { st.status = ''; load(); } })));
    root.appendChild(h('div', { class: 'adm-main', id: 'admMain' }, h('div', { class: 'adm-in', id: 'admIn' })));
    root.appendChild(h('div', { class: 'sr-only', id: 'admLive', role: 'status', 'aria-live': 'polite' }));
    renderBody();
  }
  function renderBody() {
    if (!root) return;
    const had = document.activeElement && root.contains(document.activeElement) ? document.activeElement.id : '';
    const inn = root.querySelector('#admIn'); inn.textContent = '';
    root.querySelector('#admTitle').textContent = st.sel ? 'Request' : 'User requests';
    root.querySelector('#admBack').setAttribute('aria-label', st.sel ? 'Back to requests' : 'Close');
    root.querySelector('#admBackLbl').textContent = st.sel ? 'Requests' : 'Close';
    if (st.sel) renderDetail(inn); else renderList(inn);
    /* Redrawing must not drop the keyboard: put focus back on the same control. */
    if (had && (had.indexOf('admTab-') === 0 || had === 'admRefresh')) {
      const again = root.querySelector('#' + had); if (again) again.focus();
    }
  }

  function statusChip(r) {
    if (r.status === 'approved') {
      const a = r.accountStatus;
      return h('span', { class: 'chip ' + (a === 'active' || !a ? 'ok' : 'bad'), text: a && a !== 'active' ? ACCOUNT_LABEL[a] || a : 'Approved' });
    }
    return h('span', { class: 'chip ' + (r.status === 'rejected' ? 'bad' : 'wait'), text: STATUS_LABEL[r.status] || r.status });
  }
  function verifiedChip(r) {
    return r.emailVerified
      ? h('span', { class: 'chip ok', text: r.verifiedByAdmin ? 'Email verified by admin' : 'Email verified' })
      : h('span', { class: 'chip wait', text: 'Email not verified' });
  }

  function renderList(inn) {
    const msg = h('p', { class: 'adm-msg', id: 'admStatus', role: 'status', text: st.status });
    inn.appendChild(msg);
    const tabs = h('div', { class: 'adm-tabs', role: 'tablist', 'aria-label': 'Request status' });
    TABS.forEach(([key, label]) => {
      tabs.appendChild(h('button', { type: 'button', role: 'tab', id: 'admTab-' + key, 'data-tab': key,
        'aria-selected': String(st.tab === key), 'aria-controls': 'admPanel', tabindex: st.tab === key ? '0' : '-1', text: label,
        onclick: () => switchTab(key) }));
    });
    tabs.addEventListener('keydown', e => {
      const keys = TABS.map(t => t[0]), i = keys.indexOf(st.tab);
      let n = null;
      if (e.key === 'ArrowRight') n = (i + 1) % keys.length;
      else if (e.key === 'ArrowLeft') n = (i + keys.length - 1) % keys.length;
      else if (e.key === 'Home') n = 0;
      else if (e.key === 'End') n = keys.length - 1;
      if (n == null) return;
      e.preventDefault(); switchTab(keys[n], true);
    });
    inn.appendChild(tabs);

    const panel = h('div', { id: 'admPanel', role: 'tabpanel', 'aria-labelledby': 'admTab-' + st.tab, 'aria-busy': st.loading ? 'true' : 'false' });
    inn.appendChild(panel);
    if (st.loading && !st.rows.length) {
      panel.appendChild(h('div', { class: 'adm-empty', role: 'status', text: 'Loading requests…' }));
    } else if (st.loadError) {
      panel.appendChild(h('p', { class: 'adm-err', role: 'alert', text: st.loadError }));
      panel.appendChild(h('button', { class: 'btn', type: 'button', text: 'Try again', onclick: () => load() }));
    } else if (!st.rows.length) {
      panel.appendChild(h('div', { class: 'adm-empty' },
        h('b', { text: st.tab === 'pending' ? 'Nothing waiting' : 'No requests here' }),
        st.tab === 'pending' ? 'New sign-up requests appear here.' : 'Nothing matches this tab yet.'));
    } else {
      const ul = h('ul', { class: 'adm-list', 'aria-label': 'Requests' });
      st.rows.forEach(r => {
        ul.appendChild(h('li', null, h('button', { class: 'adm-row', type: 'button', 'data-id': r.id, onclick: () => openDetail(r) },
          h('div', { class: 'l1' }, h('b', { text: r.name || '(no name)' }), statusChip(r)),
          h('div', { class: 'em', text: r.email }),
          h('div', { class: 'meta' }, verifiedChip(r), h('span', { text: 'Requested ' + fmtDate(r.createdAt) })))));
      });
      panel.appendChild(ul);
    }
  }
  function switchTab(key, focus) {
    st.tab = key; st.status = ''; st.rows = []; load();
    renderBody();
    if (focus) { const t = root.querySelector('#admTab-' + key); if (t) t.focus(); }
  }

  /* --------------------------------------------------- detail --------- */
  function openDetail(r) {
    st.sel = r; st.status = '';
    const role = 'member';
    st.form = { role, perms: Object.assign({}, PRESETS[role]), permsTouched: false, decisionNote: '', reason: '',
                note: r.adminNote || '', noteLoaded: false, noteSaved: '' , err: '' };
    renderBody();
    const t = root.querySelector('#admWho'); if (t) t.focus();
    loadNote();
  }
  function back() {
    if (st.busy) return;
    const id = st.sel && st.sel.id;
    st.sel = null; st.form = null; renderBody();
    load();
    const row = id && root.querySelector('.adm-row[data-id="' + id + '"]');
    (row || root.querySelector('[role="tab"][aria-selected="true"]') || root).focus();
  }
  async function loadNote() {
    const sel = st.sel; if (!sel) return;
    const r = await call(() => AUTH.adminNoteGet(sel.userId));
    if (!st.sel || st.sel.id !== sel.id) return;
    if (r.ok) { st.form.note = r.data.note || ''; st.form.noteSaved = st.form.note; }
    st.form.noteLoaded = true;
    const ta = root.querySelector('#admNote');
    if (ta) { ta.value = st.form.note; ta.disabled = false; }
    const sv = root.querySelector('#admNoteSave'); if (sv) sv.disabled = false;
    if (!r.ok) setErr(explain(r));
  }

  function setErr(t) {
    const e = root && root.querySelector('#admErr'); if (e) e.textContent = t || '';
  }
  function say(t) {                       // a persistent live region, so changes are announced
    const e = root && root.querySelector('#admLive');
    if (e) { e.textContent = ''; setTimeout(() => { e.textContent = t; }, 30); }
  }
  function setStatus(t) {
    st.status = t; say(t);
    const e = root && root.querySelector('#admStatus'); if (e) e.textContent = t || '';
  }

  function renderDetail(inn) {
    const r = st.sel, f = st.form;
    const pending = PENDING.includes(r.status);
    inn.appendChild(h('p', { class: 'adm-msg', id: 'admStatus', role: 'status', text: st.status }));
    inn.appendChild(h('p', { class: 'adm-err', id: 'admErr', role: 'alert' }));

    inn.appendChild(h('div', { class: 'adm-card adm-who' },
      h('h3', { id: 'admWho', tabindex: '-1', text: r.name || '(no name)' }),
      h('div', { class: 'em', text: r.email }),
      h('div', { class: 'chips' }, statusChip(r), verifiedChip(r), h('span', { class: 'chip', text: 'Requested ' + fmtDate(r.createdAt) })),
      r.decidedAt ? h('p', { class: 'hint', style: 'margin:10px 0 0;color:var(--dim);font-size:.82rem', text: 'Decided ' + fmtDate(r.decidedAt) +
        (r.decisionNote ? '. Note with the decision: ' + r.decisionNote : '') }) : null));

    if (pending) {
      /* Decision ---------------------------------------------------- */
      const card = h('div', { class: 'adm-card', id: 'admDecision' }, h('h3', { text: 'Decision' }));
      if (!r.emailVerified) {
        card.appendChild(h('p', { text: 'This email address has not been confirmed. Wait for the person to use the link, or confirm it yourself if you know it is theirs.' }));
        card.appendChild(h('div', { class: 'adm-acts', style: 'margin:0 0 14px' },
          h('button', { class: 'btn', type: 'button', id: 'admVerify', text: 'Verify email manually', onclick: ev => verifyEmail(ev.currentTarget) })));
      }
      const roleSel = h('select', { id: 'admRole', onchange: ev => {
        f.role = ev.target.value;
        if (!f.permsTouched) { f.perms = Object.assign({}, PRESETS[f.role]); syncPerms(); }
      } });
      Object.keys(ROLE_LABEL).forEach(k => roleSel.appendChild(h('option', { value: k, text: ROLE_LABEL[k] })));
      roleSel.value = f.role;
      card.appendChild(h('div', { class: 'adm-f' }, h('label', { for: 'admRole', text: 'Role' }), roleSel,
        h('p', { class: 'hint', text: 'Administrators are set up separately by the owner.' })));

      const fs = h('fieldset', { class: 'adm-f', id: 'admPerms' }, h('legend', { text: 'Features this person can use' }));
      FEATURES.forEach(([key, label, desc]) => {
        const always = ALWAYS_ON.includes(key);
        fs.appendChild(h('label', { class: 'adm-perm' },
          h('input', { type: 'checkbox', 'data-feature': key, checked: always || !!f.perms[key], disabled: always, onchange: ev => { f.perms[key] = ev.target.checked; f.permsTouched = true; } }),
          h('div', null, h('span', { text: label }), h('small', { text: always ? desc + '. Always on for everyone.' : desc }))));
      });
      card.appendChild(fs);

      card.appendChild(h('div', { class: 'adm-f' },
        h('label', { for: 'admDecisionNote', text: 'Note with this decision (optional)' }),
        h('textarea', { id: 'admDecisionNote', maxlength: '1000', value: f.decisionNote, oninput: ev => { f.decisionNote = ev.target.value; } }),
        h('p', { class: 'hint', text: 'Private. The person is not shown this.' })));
      card.appendChild(h('div', { class: 'adm-acts' },
        h('button', { class: 'btn primary', type: 'button', id: 'admApprove', text: 'Approve', onclick: ev => approve(ev.currentTarget) })));
      inn.appendChild(card);

      const rej = h('div', { class: 'adm-card', id: 'admReject' }, h('h3', { text: 'Reject' }),
        h('div', { class: 'adm-f' },
          h('label', { for: 'admReason', text: 'Reason (optional)' }),
          h('textarea', { id: 'admReason', maxlength: '1000', value: f.reason, oninput: ev => { f.reason = ev.target.value; } }),
          h('p', { class: 'hint', text: 'Private. The person is only told that the request was not approved.' })),
        h('div', { class: 'adm-acts' },
          h('button', { class: 'btn danger', type: 'button', id: 'admRejectBtn', text: 'Reject request', onclick: ev => reject(ev.currentTarget) })));
      inn.appendChild(rej);
    } else {
      /* Existing account controls ----------------------------------- */
      const a = r.accountStatus;
      const card = h('div', { class: 'adm-card', id: 'admAccount' }, h('h3', { text: 'Account' }),
        h('p', { text: 'Current status: ' + (ACCOUNT_LABEL[a] || a || 'Unknown') + '.' }));
      const acts = h('div', { class: 'adm-acts' });
      if (a === 'active') {
        acts.appendChild(h('button', { class: 'btn danger', type: 'button', id: 'admSuspend', text: 'Suspend', onclick: ev => setAccount(ev.currentTarget, 'suspended') }));
        acts.appendChild(h('button', { class: 'btn danger', type: 'button', id: 'admRevoke', text: 'Revoke access', onclick: ev => setAccount(ev.currentTarget, 'revoked') }));
        card.appendChild(h('p', { class: 'hint', style: 'color:var(--dim);font-size:.82rem', text: 'Suspending or revoking ends their sessions at once. Their data is kept.' }));
      } else if (a === 'suspended' || a === 'revoked' || a === 'rejected') {
        acts.appendChild(h('button', { class: 'btn primary', type: 'button', id: 'admReactivate', text: 'Reactivate', onclick: ev => setAccount(ev.currentTarget, 'active') }));
      }
      card.appendChild(acts);
      inn.appendChild(card);
    }

    /* Private note -------------------------------------------------- */
    const ta = h('textarea', { id: 'admNote', maxlength: '2000', value: f.note, disabled: !f.noteLoaded, oninput: ev => { f.note = ev.target.value; } });
    inn.appendChild(h('div', { class: 'adm-card', id: 'admNoteCard' }, h('h3', { text: 'Private note' }),
      h('div', { class: 'adm-f' }, h('label', { for: 'admNote', text: 'Only administrators can see this' }), ta,
        h('p', { class: 'hint', text: 'Up to 2000 characters. Not part of the person’s account.' })),
      h('div', { class: 'adm-acts' },
        h('button', { class: 'btn', type: 'button', id: 'admNoteSave', text: 'Save note', disabled: !f.noteLoaded, onclick: ev => saveNote(ev.currentTarget) }))));
  }
  function syncPerms() {
    if (!root) return;
    root.querySelectorAll('#admPerms input[data-feature]').forEach(i => { i.checked = !!st.form.perms[i.dataset.feature]; });
  }

  /* ------------------------------------------------- confirm dialog --- */
  function confirmBox(o) {
    return new Promise(resolve => {
      /* Safari does not focus a button when it is clicked, so the caller names it. */
      const prev = o.opener || document.activeElement;
      const cancel = h('button', { class: 'btn', type: 'button', id: 'admConfirmNo', text: o.cancel || 'Cancel' });
      const ok = h('button', { class: 'btn ' + (o.danger ? 'danger' : 'primary'), type: 'button', id: 'admConfirmYes', text: o.confirm });
      const box = h('div', { class: 'adm-conf', id: 'admConfirm' },
        h('div', { role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'admConfirmTitle', 'aria-describedby': 'admConfirmBody' },
          h('h3', { id: 'admConfirmTitle', text: o.title }),
          h('p', { id: 'admConfirmBody', text: o.body }),
          h('div', { class: 'adm-acts' }, cancel, ok)));
      const done = v => {
        st.confirmEl = null; st.confirmDone = null; box.remove();
        if (prev && prev.isConnected && prev.focus) prev.focus();
        resolve(v);
      };
      st.confirmEl = box; st.confirmDone = done;
      cancel.addEventListener('click', () => done(false));
      ok.addEventListener('click', () => done(true));
      box.addEventListener('click', e => { if (e.target === box) done(false); });
      root.appendChild(box);
      cancel.focus();
    });
  }
  function cancelConfirm() { if (st.confirmDone) st.confirmDone(false); }

  /* ------------------------------------------------------ actions ----- */
  async function run(btn, label, fn) {
    if (st.busy) return;
    st.busy = true; setErr('');
    const old = btn.textContent;
    btn.setAttribute('aria-busy', 'true'); btn.setAttribute('aria-disabled', 'true'); btn.textContent = label;
    try { return await fn(); }
    finally {
      st.busy = false;
      if (btn.isConnected) { btn.removeAttribute('aria-busy'); btn.removeAttribute('aria-disabled'); btn.textContent = old; }
    }
  }
  function decisionBody(action) {
    const f = st.form;
    const b = { action };
    if (action === 'approve') {
      b.role = f.role;
      b.permissions = {};
      FEATURES.forEach(([k]) => { b.permissions[k] = ALWAYS_ON.includes(k) || !!f.perms[k]; });
      const n = f.decisionNote.trim(); if (n) b.note = n;
    } else {
      const n = f.reason.trim(); if (n) b.note = n;
    }
    return b;
  }
  async function afterDecision(text) {
    st.sel = null; st.form = null; st.status = text;
    renderBody();
    await load();
    const s = root && root.querySelector('#admStatus'); if (s) s.textContent = text;
    say(text);
    const t = root && root.querySelector('[role="tab"][aria-selected="true"]'); if (t) t.focus();
  }

  async function approve(btn) {
    const r = st.sel, f = st.form;
    let override = false;
    if (!r.emailVerified) {
      const yes = await confirmBox({ title: 'Approve without a verified email?',
        body: r.email + ' has not been confirmed. If you approve now, this is recorded in the audit log.',
        confirm: 'Approve anyway', danger: true, opener: btn });
      if (!yes) return;
      override = true;
    }
    await run(btn, 'Approving…', async () => {
      const body = decisionBody('approve');
      if (override) body.overrideVerification = true;
      const res = await call(() => AUTH.adminDecision(r.id, body));
      if (!res.ok) {
        if (res.status === 409 && res.code === 'email_not_verified') setErr('This email address has not been verified. Verify it first, or approve anyway.');
        else setErr(explain(res));
        return;
      }
      await afterDecision('Approved ' + (r.name || r.email) + ' as a ' + (ROLE_LABEL[res.data.role] || res.data.role || f.role).toLowerCase() + '.');
    });
  }
  async function reject(btn) {
    const r = st.sel;
    const yes = await confirmBox({ title: 'Reject this request?',
      body: (r.name || r.email) + ' will not be able to use Recomp and their sessions end now. You can reactivate the account later.',
      confirm: 'Reject request', danger: true, opener: btn });
    if (!yes) return;
    await run(btn, 'Rejecting…', async () => {
      const res = await call(() => AUTH.adminDecision(r.id, decisionBody('reject')));
      if (!res.ok) { setErr(explain(res)); return; }
      await afterDecision('Rejected the request from ' + (r.name || r.email) + '.');
    });
  }
  async function verifyEmail(btn) {
    const r = st.sel;
    await run(btn, 'Verifying…', async () => {
      const res = await call(() => AUTH.adminVerifyEmail(r.id));
      if (!res.ok) { setErr(explain(res)); return; }
      await load(true);
      st.status = 'Email address marked as verified.'; say(st.status);
      renderBody();
      const a = root.querySelector('#admApprove'); if (a) a.focus();
    });
  }
  async function saveNote(btn) {
    const r = st.sel, f = st.form;
    await run(btn, 'Saving…', async () => {
      const res = await call(() => AUTH.adminNotePut(r.userId, f.note.trim()));
      if (!res.ok) { setErr(explain(res)); return; }
      f.noteSaved = f.note.trim();
      setStatus(f.noteSaved ? 'Note saved.' : 'Note cleared.');
    });
  }
  async function setAccount(btn, status) {
    const r = st.sel, who = r.name || r.email;
    if (status === 'suspended' || status === 'revoked') {
      const yes = await confirmBox({
        title: status === 'suspended' ? 'Suspend this account?' : 'Revoke access?',
        body: who + (status === 'suspended'
          ? ' is signed out now and cannot log in until you reactivate the account.'
          : ' loses access and is signed out now. You can reactivate the account later.'),
        confirm: status === 'suspended' ? 'Suspend account' : 'Revoke access', danger: true, opener: btn });
      if (!yes) return;
    }
    await run(btn, 'Saving…', async () => {
      const res = await call(() => AUTH.adminUpdateUser(r.userId, { status }));
      if (!res.ok) { setErr(explain(res)); return; }
      await load(true);
      st.status = status === 'active' ? who + ' is active again.' : who + (status === 'suspended' ? ' is suspended.' : ' has lost access.');
      say(st.status); renderBody();
      const t = root.querySelector('#admWho'); if (t) t.focus();
    });
  }

  return { available, profileBlock, open, close, isOpen: () => st.open, FEATURES: FEATURES.map(f => f[0]) };
})();

if (typeof window !== 'undefined') window.Admin = Admin;
if (typeof module !== 'undefined' && module.exports) module.exports = { Admin };
