/* ============================================================================
   Section views: registry, shared UI helpers, the More hub, and the one
   preview-then-apply flow used for every daily change to a session.
   Views never touch storage directly. They read RecompHost.S, call the pure
   engines (Plan, Review, Garmin), and ask the host to persist.
   ========================================================================== */
const Views = (function () {
  'use strict';
  const H = () => window.RecompHost;
  const reg = {};
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const DOW3 = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtDate = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return `${DOW3[Plan.isoDow(iso)]} ${d} ${MON3[m - 1]}`; };
  const fmtLong = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return `${Plan.DOW_NAMES[Plan.isoDow(iso)]} ${d} ${MON3[m - 1]} ${y}`; };
  const plural = (n, w, w2) => n + ' ' + (n === 1 ? w : (w2 || w + 's'));
  const todayISO = () => H().todayISO();

  function register(name, view) { reg[name] = view; }
  const has = name => !!reg[name];
  function render(name, root) { if (reg[name] && root) { try { reg[name].render(root); } catch (e) { console.error('view ' + name, e); root.innerHTML = '<div class="empty"><b>This section could not be shown</b>Your data is safe. Reload the app, and if it keeps happening export a backup from Profile.</div>'; } } }
  function afterPermissions() { if (reg.more && H().tab === 'more') render('more', document.getElementById('p-more')); }

  /* ------------------------------------------------ one generic bottom sheet */
  let sheetEl = null, sheetCloseCb = null;
  function ensureSheet() {
    if (sheetEl) return sheetEl;
    sheetEl = el('div', 'sheet'); sheetEl.id = 'vSheet'; sheetEl.setAttribute('role', 'dialog'); sheetEl.setAttribute('aria-modal', 'true'); sheetEl.setAttribute('aria-labelledby', 'vTitle');
    sheetEl.innerHTML = '<div class="scrim" data-close></div><div class="panel"><div class="grab"></div><div class="spread"><h2 id="vTitle"></h2><button class="btn sm ghost" data-close id="vClose">Close</button></div><div id="vBody"></div></div>';
    document.body.appendChild(sheetEl);
    return sheetEl;
  }
  /* build(body, close) fills the sheet. Returns the sheet body. */
  function sheet(title, build, onClose) {
    const s = ensureSheet();
    s.querySelector('#vTitle').textContent = title;
    const body = s.querySelector('#vBody'); body.innerHTML = '';
    sheetCloseCb = onClose || null;
    const close = () => { H().closeSheet('vSheet'); };
    build(body, close);
    H().openSheet('vSheet');
    return body;
  }
  document.addEventListener('click', e => { const c = e.target.closest('#vSheet [data-close]'); if (c && sheetCloseCb) { const f = sheetCloseCb; sheetCloseCb = null; try { f(); } catch (x) {} } });
  const closeSheet = () => { sheetCloseCb = null; H().closeSheet('vSheet'); };

  function confirmSheet(title, text, okLabel, danger) {
    return new Promise(res => {
      let settled = false;
      sheet(title, (b, close) => {
        b.appendChild(el('p', 'muted', esc(text)));
        const row = el('div', 'row'); row.style.marginTop = '12px';
        const ok = el('button', 'btn primary', esc(okLabel || 'Confirm')); const no = el('button', 'btn ghost', 'Cancel');
        if (danger) ok.classList.add('danger');
        ok.onclick = () => { settled = true; closeSheet(); res(true); }; no.onclick = () => { closeSheet(); if (!settled) res(false); };
        row.append(ok, no); b.appendChild(row);
      }, () => { if (!settled) res(false); });
    });
  }

  /* ---------------------------------------------------- small UI builders */
  function card(inner, cls) { return el('div', 'card' + (cls ? ' ' + cls : ''), inner); }
  function heading(text, extra) { const h = el('h2', null, esc(text)); h.style.margin = extra || '20px 0 8px'; return h; }
  function chips(options, selected, onPick, multi, label) {
    const row = el('div', 'opts'); row.setAttribute('role', 'group'); if (label) row.setAttribute('aria-label', label);
    const sel = new Set(Array.isArray(selected) ? selected : (selected == null ? [] : [selected]));
    options.forEach(o => {
      const v = typeof o === 'object' ? o.value : o, lab = typeof o === 'object' ? o.label : o;
      const b = el('button', null, esc(lab)); b.type = 'button'; b.setAttribute('aria-pressed', String(sel.has(v)));
      b.onclick = () => {
        if (multi) { if (sel.has(v)) sel.delete(v); else sel.add(v); } else { sel.clear(); sel.add(v); }
        [...row.children].forEach((c, i) => { const ov = typeof options[i] === 'object' ? options[i].value : options[i]; c.setAttribute('aria-pressed', String(sel.has(ov))); });
        onPick(multi ? [...sel] : v);
      };
      row.appendChild(b);
    });
    return row;
  }
  function scale(label, value, onPick, lo, hi) {
    const g = el('div', 'fbgroup'); g.appendChild(el('span', 'eyebrow', esc(label) + (lo ? ` · ${esc(lo)} to ${esc(hi)}` : '')));
    const row = el('div', 'scale'); row.setAttribute('role', 'group'); row.setAttribute('aria-label', label);
    for (let i = 1; i <= 5; i++) {
      const b = el('button', null, String(i)); b.type = 'button'; b.setAttribute('aria-label', `${label} ${i} of 5`); b.setAttribute('aria-pressed', String(value === i));
      b.onclick = () => { onPick(i); [...row.children].forEach(c => c.setAttribute('aria-pressed', String(c === b))); };
      row.appendChild(b);
    }
    g.appendChild(row); return g;
  }
  function labelled(label, input, hint) {
    const w = el('label', 'vfield'); w.appendChild(el('span', 'vlabel', esc(label))); w.appendChild(input);
    if (hint) w.appendChild(el('span', 'vhint dim', esc(hint))); return w;
  }
  function field(type, value, attrs) { const i = el('input'); i.type = type; if (value != null) i.value = value; Object.keys(attrs || {}).forEach(k => i.setAttribute(k, attrs[k])); return i; }
  function select(options, value, onChange) {
    const s = el('select', 'vselect'); options.forEach(o => { const v = typeof o === 'object' ? o.value : o, l = typeof o === 'object' ? o.label : o; const op = el('option', null, esc(l)); op.value = v; if (String(v) === String(value)) op.selected = true; s.appendChild(op); });
    s.onchange = () => onChange(s.value); return s;
  }
  function progressBar(pct, label) {
    const b = el('div', 'vbar'); b.setAttribute('role', 'progressbar'); b.setAttribute('aria-valuemin', '0'); b.setAttribute('aria-valuemax', '100'); b.setAttribute('aria-valuenow', String(pct == null ? 0 : pct)); if (label) b.setAttribute('aria-label', label);
    b.innerHTML = `<i style="width:${pct == null ? 0 : pct}%"></i>`; return b;
  }
  const exName = id => (H().EX_INDEX[id] || {}).short || (H().EX_INDEX[id] || {}).name || id;

  /* ============================================================================
     DAILY ADAPTATION: preview first, apply on confirmation. The same flow serves
     the Today buttons, the readiness sheet and the running workout, and it
     keeps the reason in the plan's change history for the weekly review.
     ========================================================================== */
  function openAdjust(slotId, kind, params, onApplied, onCancel) {
    const S = H().S;
    const pv = Plan.previewDayAdjust(S, slotId, kind, params);
    const title = { less_time: 'I have less time', equipment: 'Equipment unavailable', feel_different: 'I feel different today' }[kind] || 'Adjust today';
    if (!pv.ok) { H().toast(pv.problems[0], 'warn'); if (onCancel) onCancel(); return; }
    sheet(title, (b, close) => {
      b.appendChild(el('p', null, `<b>${esc(pv.reason)}</b>`));
      b.appendChild(el('p', 'muted', esc(pv.why)));
      if (!pv.changed) {
        b.appendChild(el('div', 'banner ok', '<div><b>Nothing needs to change.</b><br><span class="muted">The session already fits, so the plan is left exactly as it is.</span></div>'));
        const go = el('button', 'btn primary block', 'Continue'); go.onclick = () => { closeSheet(); if (onApplied) onApplied(false); }; b.appendChild(go); return;
      }
      const t = el('div', 'vbeforeafter');
      t.innerHTML = `<div><span class="eyebrow">Before</span><b>${Math.round(pv.before.minutes)} min</b><span class="dim">${pv.before.exercises} exercises · ${pv.before.sets} sets</span></div>
        <div class="arrow" aria-hidden="true">→</div>
        <div><span class="eyebrow">After</span><b>${Math.round(pv.after.minutes)} min</b><span class="dim">${pv.after.exercises} exercises · ${pv.after.sets} sets</span></div>`;
      b.appendChild(t);
      const ul = el('ul', 'vlist');
      pv.mods.forEach(m => {
        const txt = m.type === 'drop' ? `Remove ${esc(exName(m.exerciseId))}` : m.type === 'sets' ? `${esc(exName(m.exerciseId))}: ${m.sets} sets` : m.type === 'swap' ? `${esc(exName(m.from))} replaced by ${esc(exName(m.to))}` : esc(m.type);
        ul.appendChild(el('li', null, txt));
      });
      b.appendChild(ul);
      if (pv.holdProgression) b.appendChild(el('p', 'dim', 'No load increases in this session. Your next session returns to the normal rules.'));
      if (pv.fits === false) b.appendChild(el('div', 'banner', '<div><b>Still longer than you have.</b><br><span class="muted">The main lifts are kept so progress stays measurable. You can stop early and the session is recorded as partly done.</span></div>'));
      const live = H().currentSession();
      if (live && live.slotId === slotId) b.appendChild(el('p', 'dim', 'Anything you have already logged in this session stays exactly as logged.'));
      const row = el('div', 'row'); row.style.marginTop = '12px';
      const ok = el('button', 'btn primary', 'Apply this change'); const no = el('button', 'btn ghost', 'Not now');
      ok.onclick = () => {
        const res = Plan.applyDayAdjust(S, pv, live && live.slotId === slotId ? live : null);
        let note = '';
        if (live && live.slotId === slotId) { const r = Plan.reflowLiveSession(S, live, pv.mods, todayISO()); note = r.keptPerformed.length ? ' Exercises you had already done were kept.' : ''; }
        H().persist(); closeSheet(); H().renderAll(); H().toast('Session adjusted.' + note); H().say('Session adjusted');
        if (onApplied) onApplied(true, res);
      };
      no.onclick = () => { closeSheet(); if (onCancel) onCancel(); };
      row.append(ok, no); b.appendChild(row);
    }, () => { if (onCancel) onCancel(); });
  }

  /* ---------------------------------------------------------------- More --- */
  register('more', { render(root) {
    root.innerHTML = '';
    const items = [
      ['recovery', 'Recovery', 'Rest days, easy movement, sleep and readiness'],
      ['nutrition', 'Nutrition', 'Targets, meals and food log'],
      ['progress', 'Progress', 'Lifts, bodyweight and records'],
      ['library', 'Exercise library', 'Every exercise, with how to do it'],
      ['profile', 'Profile', 'Settings, equipment, data and account']
    ];
    const list = el('div', 'stack');
    items.forEach(([t, name, sub]) => {
      if (!H().S || (window.AUTH && AUTH.user && AUTH.user() && TAB_OK(t) === false)) return;
      const b = el('button', 'vlink'); b.type = 'button'; b.innerHTML = `<b>${esc(name)}</b><span class="muted">${esc(sub)}</span><span class="chev" aria-hidden="true">›</span>`;
      b.onclick = () => H().go(t); list.appendChild(b);
    });
    const rv = el('button', 'vlink'); rv.type = 'button'; rv.innerHTML = '<b>Weekly reviews</b><span class="muted">Past reports, changes and plan history</span><span class="chev" aria-hidden="true">›</span>';
    rv.onclick = () => { if (window.ReviewUI) ReviewUI.openHistory(); }; list.appendChild(rv);
    root.appendChild(list);
  } });
  function TAB_OK(t) { const map = { recovery: 'training', nutrition: 'nutrition', progress: 'progress', library: 'library', profile: null }; const f = map[t]; return !f || !window.AUTH || !AUTH.can || AUTH.can(f); }

  return { register, has, render, afterPermissions, sheet, closeSheet, confirmSheet, card, heading, chips, scale, labelled, field, select, progressBar,
    openAdjust, esc, el, fmtDate, fmtLong, plural, exName, todayISO, DOW3, MON3 };
})();
window.Views = Views;
