/* ============================================================================
   SETTINGS. One place for account and security, training, time, nutrition,
   appearance, reminders, imported data, AI, reviewer sharing, your data and
   consent. Preferences that only change what this app shows live in the
   synced state document (per user). Choices the server must enforce (AI
   reviews, reviewer sharing, consent) are stored and checked on the server.
   ========================================================================== */
const Settings = (function () {
  'use strict';
  const H = () => window.RecompHost;
  const { el, esc, fmtDate, plural } = Views;
  const server = () => H().AUTH_MODE === 'server' && window.AUTH && AUTH.user && AUTH.user();
  let serverSettings = null, loading = null;
  const FOOD_GROUPS = [
    ['Eggs', ['egg']], ['Dairy (milk, yoghurt)', ['milk', 'yoghurt']], ['Red meat (beef)', ['beef']], ['Poultry (chicken)', ['chicken']],
    ['Nuts (almonds)', ['almonds']], ['Oats', ['oats']], ['Rice', ['rice']], ['Potato', ['potato']], ['Banana', ['banana']]
  ];

  /* ------------------------------------------------- server helpers */
  async function loadServerSettings(force) {
    if (!server()) return null;
    if (serverSettings && !force) return serverSettings;
    if (!loading) loading = AUTH.call('GET', '/api/settings').then(r => { loading = null; if (r.ok) serverSettings = r.data.settings; return serverSettings; }).catch(() => { loading = null; return null; });
    return loading;
  }
  const cached = () => serverSettings;
  /* Runs a request; if the server wants a fresh password (and code), asks once and retries. */
  async function withReauth(run, why) {
    let r = await run();
    if (r && r.code === 'reauth_required') {
      const ok = await askReauth(why);
      if (!ok) return { ok: false, cancelled: true };
      r = await run();
    }
    return r;
  }
  function askReauth(why) {
    const u = AUTH.user() || {}; const needCode = !!(u.mfa && u.mfa.totp);
    return new Promise(res => {
      let done = false;
      Views.sheet('Confirm it is you', (b) => {
        b.appendChild(el('p', 'muted', esc(why || 'For your security, enter your password again before this change.')));
        const pw = Views.field('password', '', { autocomplete: 'current-password', id: 'reauthPw' });
        b.appendChild(Views.labelled('Password', pw));
        let code = null;
        if (needCode) { code = Views.field('text', '', { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 12, id: 'reauthCode' }); b.appendChild(Views.labelled('Code from your authenticator app (or a recovery code)', code)); }
        const err = el('p', 'autherr'); err.setAttribute('role', 'alert'); err.hidden = true; b.appendChild(err);
        const ok = el('button', 'btn primary block', 'Confirm'); ok.id = 'reauthOk';
        ok.onclick = async () => {
          ok.disabled = true;
          const body = { password: pw.value }; if (code) { const c = code.value.replace(/\s/g, ''); if (/^\d{6}$/.test(c)) body.code = c; else if (c) body.recoveryCode = c; }
          const r = await AUTH.call('POST', '/api/auth/reauth', body, 'That did not match. Try again.');
          ok.disabled = false; pw.value = '';
          if (!r.ok) { err.textContent = r.error; err.hidden = false; return; }
          done = true; Views.closeSheet(); res(true);
        };
        b.appendChild(ok);
        setTimeout(() => pw.focus(), 80);
      }, () => { if (!done) res(false); });
    });
  }
  function toggleRow(title, sub, checked, onChange, opts) {
    opts = opts || {};
    const r = el('div', 'set-row'); const t = el('div', 'set-t', `<b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}`);
    const sw = el('label', 'switch'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!checked; cb.disabled = !!opts.disabled; cb.setAttribute('role', 'switch'); cb.setAttribute('aria-label', title); if (opts.id) cb.id = opts.id;
    cb.onchange = async () => { cb.disabled = true; const ok = await onChange(cb.checked); cb.disabled = !!opts.disabled; if (ok === false) cb.checked = !cb.checked; };
    sw.append(cb, el('i')); r.append(t, sw); return r;
  }
  function section(root, id, title, intro) {
    const s = el('section', 'set-sec'); s.id = 'set-' + id; s.setAttribute('aria-labelledby', 'seth-' + id);
    const h = Views.heading(title); h.id = 'seth-' + id; s.appendChild(h);
    const c = el('div', 'card'); if (intro) c.appendChild(el('p', 'muted', esc(intro))); s.appendChild(c); root.appendChild(s); return c;
  }
  const note = (c, t) => { const p = el('p', 'dim veffect', esc(t)); c.appendChild(p); return p; };

  /* ======================================================== sections */
  function accountSection(root) {
    const c = section(root, 'account', 'Account and security');
    if (!server()) { c.appendChild(el('p', 'muted', 'This copy of Recomp is not connected to an account server, so your data is kept on this device only. Account and security settings appear when you sign in to an account.')); return; }
    const u = AUTH.user();
    c.appendChild(el('dl', 'kv', `<dt>Name</dt><dd>${esc(u.name || '–')}</dd><dt>Login</dt><dd>${esc(u.email)}</dd><dt>Role</dt><dd>${esc(u.role)}</dd>`));
    const row = el('div', 'row'); row.style.cssText = 'flex-wrap:wrap;margin:8px 0';
    const nm = el('button', 'btn sm', 'Change name'); nm.onclick = () => changeName(u);
    const pw = el('button', 'btn sm', 'Change password'); pw.id = 'setPwBtn'; pw.onclick = changePassword;
    const em = el('button', 'btn sm', 'Change email'); em.onclick = changeEmail;
    row.append(nm, pw, em); c.appendChild(row);
    // two-step verification
    const m = u.mfa || {};
    c.appendChild(el('span', 'eyebrow', 'Two-step verification'));
    c.appendChild(el('p', null, m.totp ? `<b>On</b> with an authenticator app. ${m.recoveryCodesLeft != null ? plural(m.recoveryCodesLeft, 'recovery code') + ' left.' : ''}` : '<b>Off.</b> Add a second step at log in so a stolen password is not enough.'));
    if (m.required) note(c, 'Your account can manage other people, so two-step verification must stay on.');
    const mrow = el('div', 'row'); mrow.style.flexWrap = 'wrap';
    if (!m.totp) { const on = el('button', 'btn sm primary', 'Turn on'); on.id = 'setMfaOn'; on.onclick = enrolTotp; mrow.appendChild(on); }
    else {
      const rg = el('button', 'btn sm', 'New recovery codes'); rg.onclick = regenerateCodes; mrow.appendChild(rg);
      if (!m.required) { const off = el('button', 'btn sm ghost', 'Turn off'); off.onclick = disableTotp; mrow.appendChild(off); }
    }
    c.appendChild(mrow);
    // passkeys
    const pk = el('div'); c.appendChild(pk); paintPasskeys(pk);
    // sessions
    c.appendChild(el('span', 'eyebrow', 'Where you are signed in'));
    const sl = el('div'); sl.id = 'setSessions'; sl.appendChild(el('p', 'dim', 'Loading…')); c.appendChild(sl); paintSessions(sl);
  }
  async function paintPasskeys(box) {
    const r = await AUTH.call('GET', '/api/auth/passkeys');
    box.innerHTML = '';
    if (!r.ok || r.data.supported === false) return;
    box.appendChild(el('span', 'eyebrow', 'Passkeys'));
    const list = r.data.passkeys || [];
    if (!list.length) box.appendChild(el('p', 'muted', 'No passkeys yet. A passkey lets you confirm it is you with your device\'s fingerprint, face or PIN.'));
    list.forEach(p => {
      const row = el('div', 'set-row'); row.appendChild(el('div', 'set-t', `<b>${esc(p.label || 'Passkey')}</b><span>Added ${esc(new Date(p.createdAt).toLocaleDateString('en-AU'))}${p.lastUsedAt ? ', last used ' + esc(new Date(p.lastUsedAt).toLocaleDateString('en-AU')) : ''}</span>`));
      const rm = el('button', 'btn sm ghost', 'Remove'); rm.onclick = async () => {
        if (!(await Views.confirmSheet('Remove this passkey?', 'You will not be able to use it to sign in any more.', 'Remove', true))) return;
        const x = await withReauth(() => AUTH.call('DELETE', '/api/auth/passkeys/' + encodeURIComponent(p.id)), 'Confirm it is you before removing a passkey.');
        if (x.ok) { H().toast('Passkey removed'); paintPasskeys(box); } else if (!x.cancelled) H().toast(x.error, 'warn');
      };
      row.appendChild(rm); box.appendChild(row);
    });
    if (AUTH.passkeysAvailable()) {
      const add = el('button', 'btn sm', 'Add a passkey'); add.onclick = async () => {
        const x = await withReauth(() => AUTH.passkeyRegister(navigator.platform || ''), 'Confirm it is you before adding a passkey.');
        if (x.ok) { H().toast('Passkey added'); await AUTH.refreshUser(); paintPasskeys(box); } else if (!x.cancelled) H().toast(x.error, 'warn');
      };
      box.appendChild(add);
    } else box.appendChild(el('p', 'dim', 'This browser does not support passkeys.'));
  }
  async function paintSessions(box) {
    const r = await AUTH.call('GET', '/api/auth/sessions');
    box.innerHTML = '';
    if (!r.ok) { box.appendChild(el('p', 'dim', 'Could not load your sessions.')); return; }
    (r.data.sessions || []).forEach(s => {
      const row = el('div', 'set-row');
      row.appendChild(el('div', 'set-t', `<b>${esc(s.device || 'Unknown device')}${s.current ? ' · this device' : ''}</b><span>Signed in ${esc(new Date(s.createdAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }))}, last active ${esc(new Date(s.lastSeenAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }))}</span>`));
      if (!s.current) { const b = el('button', 'btn sm ghost', 'Sign out'); b.onclick = async () => { const x = await AUTH.call('POST', '/api/auth/sessions/' + encodeURIComponent(s.id) + '/revoke', {}); if (x.ok) { H().toast('Signed out of that device'); paintSessions(box); } else H().toast(x.error, 'warn'); }; row.appendChild(b); }
      box.appendChild(row);
    });
    const all = el('button', 'btn sm', 'Log out all other devices'); all.id = 'setLogoutAll';
    all.onclick = async () => { const x = await AUTH.call('POST', '/api/auth/logout-all', { keepCurrent: true }); if (x.ok) { H().toast(`Signed out of ${plural(x.data.revoked || 0, 'other device')}`); paintSessions(box); } else H().toast(x.error, 'warn'); };
    const every = el('button', 'btn sm ghost', 'Log out everywhere, including here');
    every.onclick = async () => { if (!(await Views.confirmSheet('Log out everywhere?', 'Every device, including this one, is signed out. Data on this device for your account is cleared.', 'Log out everywhere'))) return; await AUTH.call('POST', '/api/auth/logout-all', { keepCurrent: false }); await AUTH.logout(); location.reload(); };
    const row = el('div', 'row'); row.style.cssText = 'flex-wrap:wrap;margin-top:8px'; row.append(all, every); box.appendChild(row);
    note(box, 'A device that is offline cannot be told it was signed out until it reconnects. Recomp stops working offline after three days without reaching the server.');
  }
  function changeName(u) {
    Views.sheet('Change name', (b) => {
      const f = Views.field('text', u.name || '', { maxlength: 80, autocomplete: 'name' }); b.appendChild(Views.labelled('Name', f));
      const ok = el('button', 'btn primary block', 'Save'); b.appendChild(ok);
      ok.onclick = async () => { const n = f.value.trim(); if (n.length < 2) { H().toast('Enter at least 2 characters', 'warn'); return; } const r = await AUTH.call('PUT', '/api/account/profile', { name: n }); if (r.ok) { await AUTH.refreshUser(); Views.closeSheet(); H().renderAll(); H().toast('Name saved'); } else H().toast(r.error, 'warn'); };
    });
  }
  function changePassword() {
    Views.sheet('Change password', (b) => {
      const cur = Views.field('password', '', { autocomplete: 'current-password' }), nx = Views.field('password', '', { autocomplete: 'new-password' }), cf = Views.field('password', '', { autocomplete: 'new-password' });
      b.append(Views.labelled('Current password', cur), Views.labelled('New password', nx, 'At least 12 characters, with a lowercase letter, a digit, and an uppercase letter or a symbol. Passwords found in known data breaches are refused.'), Views.labelled('New password again', cf));
      const err = el('p', 'autherr'); err.setAttribute('role', 'alert'); err.hidden = true; b.appendChild(err);
      const ok = el('button', 'btn primary block', 'Change password'); b.appendChild(ok);
      ok.onclick = async () => {
        if (nx.value !== cf.value) { err.textContent = 'The two new passwords do not match.'; err.hidden = false; return; }
        const probs = window.AuthUI && AuthUI.passwordProblems ? AuthUI.passwordProblems(nx.value) : [];
        if (probs && probs.length) { err.textContent = 'The new password needs ' + probs.join(', ') + '.'; err.hidden = false; return; }
        const r = await withReauth(() => AUTH.changePassword(cur.value, nx.value).then(x => x.ok ? { ok: true } : { ok: false, error: x.error, code: x.code }), 'Confirm it is you before changing your password.');
        cur.value = nx.value = cf.value = '';
        if (!r.ok) { if (!r.cancelled) { err.textContent = r.error; err.hidden = false; } return; }
        Views.closeSheet(); H().toast('Password changed. Other devices were signed out.');
      };
    });
  }
  function changeEmail() {
    Views.sheet('Change email', (b) => {
      b.appendChild(el('p', 'muted', 'We send a link to the new address. Your login only changes when you open it. Your current address is told about the change.'));
      const f = Views.field('email', '', { autocomplete: 'email', inputmode: 'email' }); b.appendChild(Views.labelled('New email address', f));
      const err = el('p', 'autherr'); err.setAttribute('role', 'alert'); err.hidden = true; b.appendChild(err);
      const ok = el('button', 'btn primary block', 'Send confirmation link'); b.appendChild(ok);
      ok.onclick = async () => {
        const v = f.value.trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { err.textContent = 'Enter a valid email address.'; err.hidden = false; return; }
        const r = await withReauth(() => AUTH.call('POST', '/api/auth/email', { newEmail: v }), 'Confirm it is you before changing your email.');
        if (!r.ok) { if (!r.cancelled) { err.textContent = r.code === 'mail_not_configured' ? 'Email is not set up on this server yet, so the address cannot be changed safely. Ask the administrator.' : r.error; err.hidden = false; } return; }
        Views.closeSheet(); H().toast('Check the new address for a confirmation link.');
      };
    });
  }
  async function enrolTotp() {
    const r = await withReauth(() => AUTH.call('POST', '/api/auth/mfa/totp/begin', {}), 'Confirm it is you before turning on two-step verification.');
    if (!r.ok) { if (!r.cancelled) H().toast(r.error, 'warn'); return; }
    Views.sheet('Turn on two-step verification', (b) => {
      b.appendChild(el('p', 'muted', 'Add this key to an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Apple Passwords and others), then type the 6-digit code it shows.'));
      b.appendChild(el('code', 'mfa-key', esc(String(r.data.secret).replace(/(.{4})/g, '$1 ').trim())));
      const lk = el('a', 'btn sm', 'Open in my authenticator app'); lk.href = r.data.otpauthUri; b.appendChild(lk);
      const code = Views.field('text', '', { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 8, id: 'setTotpCode' }); b.appendChild(Views.labelled('Code from the app', code));
      const err = el('p', 'autherr'); err.setAttribute('role', 'alert'); err.hidden = true; b.appendChild(err);
      const ok = el('button', 'btn primary block', 'Turn on'); b.appendChild(ok);
      ok.onclick = async () => {
        const c = code.value.replace(/\s/g, ''); if (!/^\d{6}$/.test(c)) { err.textContent = 'Enter the 6-digit code.'; err.hidden = false; return; }
        const x = await AUTH.call('POST', '/api/auth/mfa/totp/confirm', { code: c }, 'That code did not match.');
        if (!x.ok) { err.textContent = x.error; err.hidden = false; return; }
        AuthUI.showRecoveryCodes(b, x.data.recoveryCodes || [], async () => { await AUTH.refreshUser(); Views.closeSheet(); H().renderAll(); H().toast('Two-step verification is on'); });
      };
    });
  }
  async function regenerateCodes() {
    if (!(await Views.confirmSheet('Make new recovery codes?', 'Your old recovery codes stop working straight away.', 'Make new codes'))) return;
    const r = await withReauth(() => AUTH.call('POST', '/api/auth/mfa/recovery/regenerate', {}), 'Confirm it is you before making new recovery codes.');
    if (!r.ok) { if (!r.cancelled) H().toast(r.error, 'warn'); return; }
    Views.sheet('New recovery codes', (b) => AuthUI.showRecoveryCodes(b, r.data.recoveryCodes || [], async () => { await AUTH.refreshUser(); Views.closeSheet(); H().renderAll(); }));
  }
  async function disableTotp() {
    if (!(await Views.confirmSheet('Turn off two-step verification?', 'Anyone with your password could then sign in. Your recovery codes stop working.', 'Turn off', true))) return;
    const r = await withReauth(() => AUTH.call('POST', '/api/auth/mfa/disable', {}), 'Confirm it is you before turning off two-step verification.');
    if (!r.ok) { if (!r.cancelled) H().toast(r.error, 'warn'); return; }
    await AUTH.refreshUser(); H().renderAll(); H().toast('Two-step verification is off');
  }

  function trainingSection(root, S) {
    const c = section(root, 'training', 'Goals, equipment and availability');
    if (Plan.hasPlan(S)) {
      const g = S.goals;
      c.appendChild(el('dl', 'kv', `<dt>Goal</dt><dd>${esc(Plan.GOALS[g.primary].label)}</dd><dt>Days</dt><dd>${g.daysPerWeek} a week${g.preferredDays && g.preferredDays.length ? ' (' + g.preferredDays.map(d => Plan.DOW_NAMES[d].slice(0, 3)).join(', ') + ')' : ''}</dd><dt>Session length</dt><dd>${g.sessionMinutes} minutes</dd><dt>Equipment</dt><dd>${esc(Object.keys(g.equipment).filter(k => g.equipment[k]).join(', '))}</dd>`));
      const b = el('button', 'btn', 'Change goals, equipment and availability'); b.onclick = () => PlanUI.openGoals(false); c.appendChild(b);
      note(c, 'Changes create a new plan version from next week. Your history stays exactly as it is.');
      ['#profGoals'].forEach(sel => { const n = document.querySelector('#p-profile ' + sel); if (n) { n.hidden = true; if (n.previousElementSibling && n.previousElementSibling.tagName === 'H2') n.previousElementSibling.hidden = true; } });
    } else {
      const b = el('button', 'btn primary', 'Set up my plan'); b.onclick = () => PlanUI.openGoals(true); c.appendChild(b);
    }
    c.appendChild(el('span', 'eyebrow', 'Units'));
    c.appendChild(el('p', 'muted', 'Recomp uses metric units: kilograms and centimetres, with food energy in kilocalories (kcal). Other units are not available yet.'));
    moveInto(c, '#profEquip', 'Equipment for exercise choice'); moveInto(c, '#profInc', 'Smallest weight steps');
  }
  /* existing cards from app.js are moved into the matching section, not duplicated */
  function moveInto(card, sel, title) {
    const n = document.querySelector('#p-profile ' + sel); if (!n) return;
    const outer = n.hasAttribute('data-set-moved') ? n : n.classList.contains('card') ? n : (n.parentElement && n.parentElement.classList.contains('card') && n.parentElement.children.length <= 2 ? n.parentElement : n);
    outer.setAttribute('data-set-moved', '');
    const h = outer.previousElementSibling && outer.previousElementSibling.tagName === 'H2' ? outer.previousElementSibling : null;
    if (h) h.hidden = true;
    const wrap = el('div', 'set-moved'); if (title) wrap.appendChild(el('span', 'eyebrow', esc(title)));
    wrap.appendChild(outer); outer.classList.remove('card'); card.appendChild(wrap);
  }
  function timeSection(root, S) {
    const c = section(root, 'time', 'Time zone, week and review day');
    if (!Plan.hasPlan(S)) { c.appendChild(el('p', 'muted', 'These come with your plan. Set up your plan first.')); return; }
    const g = S.goals, start = ((g.reviewDay % 7) + 1);
    c.appendChild(el('dl', 'kv', `<dt>Time zone</dt><dd>${esc(g.timezone)}</dd><dt>Review</dt><dd>${esc(Plan.DOW_NAMES[g.reviewDay])} at ${esc(g.reviewTime)}</dd><dt>Week starts</dt><dd>${esc(Plan.DOW_NAMES[start])}</dd>`));
    note(c, 'Your training week starts the day after your review day, so each review covers exactly one week.');
    const b = el('button', 'btn sm', 'Change'); b.onclick = () => PlanUI.openGoals(false); c.appendChild(b);
  }
  function nutritionSection(root, S) {
    const c = section(root, 'nutrition', 'Nutrition preferences');
    moveInto(c, '#profNutrition', 'Targets');
    c.appendChild(el('span', 'eyebrow', 'Foods to leave out of the suggested meal plan'));
    S.prefs.foodExclusions = S.prefs.foodExclusions || [];
    const cur = new Set(S.prefs.foodExclusions);
    c.appendChild(Views.chips(FOOD_GROUPS.map(([l]) => ({ value: l, label: l })), FOOD_GROUPS.filter(([, ks]) => ks.every(k => cur.has(k))).map(([l]) => l), v => {
      const keys = []; FOOD_GROUPS.forEach(([l, ks]) => { if (v.indexOf(l) >= 0) keys.push(...ks); });
      S.prefs.foodExclusions = Array.from(new Set(keys)); H().persist();
    }, true, 'Excluded foods'));
    note(c, 'Excluded foods are removed from the suggestion and nothing is swapped in, so you see how far short of your targets the rest is. The meal plan is a suggestion; only food you log counts as eaten.');
  }
  function appearanceSection(root, S) {
    const c = section(root, 'appearance', 'Theme, accessibility and motion');
    moveInto(c, '#profPrefs', null);
    c.appendChild(el('span', 'eyebrow', 'Text size'));
    c.appendChild(Views.chips([{ value: 'normal', label: 'Standard' }, { value: 'large', label: 'Large' }, { value: 'larger', label: 'Larger' }], S.prefs.textSize || 'normal', v => { S.prefs.textSize = v; H().applyTheme(); H().persist(); }, false, 'Text size'));
    note(c, 'Reduce motion also stops the exercise animations. Your device\'s own accessibility settings are respected when these are set to match the device.');
  }
  function remindersSection(root, S) {
    const c = section(root, 'reminders', 'Reminders and notifications');
    const on = S.prefs.reviewReminder !== false;
    c.appendChild(toggleRow('Weekly review reminder in the app', 'A card on Today when your review is due or overdue. You can still start a review from More, Weekly reviews.', on, v => { S.prefs.reviewReminder = v; H().persist(); return true; }, { id: 'setReviewReminder' }));
    note(c, 'Recomp does not send push notifications or reminder emails. Security emails (for example when your email or password changes) are sent when the server has email set up, and you cannot turn those off.');
  }
  function garminSection(root, S) {
    const c = section(root, 'garmin', 'Imported Garmin data');
    const w = Garmin.ensure(S);
    if (!w.imports.length) c.appendChild(el('p', 'muted', 'Nothing imported. You can import Garmin export files from Recovery. Files are read on this device; only the rows you import are kept, in your account data.'));
    w.imports.slice().reverse().forEach(im => {
      const row = el('div', 'set-row');
      row.appendChild(el('div', 'set-t', `<b>${esc(im.filename || 'Imported file')}</b><span>${esc(im.kind)} · ${im.added} added${im.coverage ? ' · covers ' + esc(fmtDate(im.coverage.from)) + ' to ' + esc(fmtDate(im.coverage.to)) : ''} · imported ${esc(new Date(im.importedAt).toLocaleDateString('en-AU'))}</span>`));
      const del = el('button', 'btn sm ghost', 'Delete'); del.onclick = async () => {
        if (!(await Views.confirmSheet('Delete this import?', 'The rows it added are removed from your account data now. Earlier server backups keep them until those backups expire.', 'Delete', true))) return;
        const r = Garmin.removeImport(S, im.id); H().persist(); H().renderAll(); H().toast(`Removed ${plural(r ? r.removed : 0, 'row')}`);
      };
      row.appendChild(del); c.appendChild(row);
    });
    const untagged = w.sleep.concat(w.activities).filter(r => !r.importId).length;
    if (untagged) note(c, `${plural(untagged, 'row')} came from imports made before imports could be deleted one by one. Use Delete all to remove them.`);
    if (w.sleep.length + w.activities.length) {
      const all = el('button', 'btn sm ghost', 'Delete all imported data'); all.onclick = async () => {
        if (!(await Views.confirmSheet('Delete all imported data?', 'All imported sleep and activity rows are removed. Your logged workouts are not touched.', 'Delete all', true))) return;
        Garmin.clearAll(S); H().persist(); H().renderAll(); H().toast('Imported data deleted');
      };
      c.appendChild(all);
    }
  }
  async function aiSection(root) {
    const c = section(root, 'ai', 'AI-assisted weekly reviews');
    c.appendChild(el('p', 'muted', 'Every number in your weekly review is calculated by the app. If you turn this on, the week\'s statistics, the app\'s sentences about them, your written updates for that week, effort counts and the proposed changes are sent to the AI service the operator has set up, to word your feedback. Your name and email are not sent.'));
    if (!server()) { note(c, 'Not available: this copy of Recomp is not connected to an account server. Your reviews use the statistics summary.'); return; }
    const st = await loadServerSettings();
    if (!st) { note(c, 'Could not load this setting. Try again later.'); return; }
    c.appendChild(toggleRow('Use AI to word my weekly review', st.aiReviews ? 'On. The statistics summary is still shown if the service is unavailable.' : 'Off. Reviews use the statistics summary, written by the app without AI.', st.aiReviews, async v => {
      const r = await AUTH.call('PUT', '/api/settings', { aiReviews: v });
      if (!r.ok) { H().toast(r.error, 'warn'); return false; }
      serverSettings = r.data.settings; H().toast(v ? 'AI reviews on' : 'AI reviews off. Nothing more will be sent.'); H().renderAll(); return true;
    }, { id: 'setAiToggle' }));
    note(c, 'Turning this off stops all future AI requests. Feedback already written stays in your past reports, which are part of your own data. You can remove it below.');
    const S = H().S; const withAi = (S.reviews || []).filter(r => r.ai && r.ai.report).length;
    if (withAi) {
      const del = el('button', 'btn sm ghost', `Remove AI wording from ${plural(withAi, 'past report')}`);
      del.onclick = async () => { if (!(await Views.confirmSheet('Remove AI wording?', 'The AI-written feedback is removed from your past reports. Their statistics and decisions stay.', 'Remove', true))) return;
        (S.reviews || []).forEach(r => { if (r.ai && r.ai.report) r.ai = { status: 'removed', reason: 'AI wording removed by you.' }; }); H().persist(); H().renderAll(); H().toast('AI wording removed'); };
      c.appendChild(del);
    }
  }
  async function sharingSection(root) {
    const c = section(root, 'sharing', 'Reviewer access and sharing');
    if (!server()) { c.appendChild(el('p', 'muted', 'Nothing is shared. This copy of Recomp keeps your data on this device.')); return; }
    const st = await loadServerSettings(); if (!st) return;
    c.appendChild(el('p', 'muted', 'An administrator can assign a coach to review your training. Nobody else can read your training records, and an administrator cannot read them without being assigned. Every read by a reviewer is logged.'));
    c.appendChild(toggleRow('Let my assigned reviewer see my training and weekly reports', st.shareWithReviewer ? 'On. Your assigned reviewer can read what you send them and your training records.' : 'Off. No reviewer can read your records, and you cannot send reports to a coach.', st.shareWithReviewer, async v => {
      const r = await AUTH.call('PUT', '/api/settings', { shareWithReviewer: v });
      if (!r.ok) { H().toast(r.error, 'warn'); return false; } serverSettings = r.data.settings; H().renderAll(); return true;
    }, { id: 'setShareToggle' }));
  }
  function consentSection(root) {
    if (!server()) return;
    const u = AUTH.user(); const cs = u.consents || {};
    const c = section(root, 'consent', 'Your consent');
    const pn = cs.privacyNotice, hd = cs.healthData;
    c.appendChild(el('dl', 'kv', `<dt>Privacy policy</dt><dd>${pn ? 'Read version ' + esc(pn.version) + ' on ' + esc(new Date(pn.at).toLocaleDateString('en-AU')) : 'Not yet acknowledged'}</dd><dt>Health information</dt><dd>${hd ? (hd.granted ? 'Agreed on ' : 'Withdrawn on ') + esc(new Date(hd.at).toLocaleDateString('en-AU')) : 'Not yet recorded'}</dd>`));
    const row = el('div', 'row'); row.style.flexWrap = 'wrap';
    const read = el('a', 'btn sm', 'Read the privacy policy'); read.href = '#privacy'; read.dataset.doc = 'privacy'; row.appendChild(read);
    if (!hd || !hd.granted) { const g = el('button', 'btn sm primary', 'Agree to health information use'); g.onclick = () => askConsent(true); row.appendChild(g); }
    else { const w = el('button', 'btn sm ghost', 'Withdraw consent'); w.onclick = withdrawConsent; row.appendChild(w); }
    c.appendChild(row);
    note(c, 'Acknowledging the privacy policy is not consent. Consent to use your health information is a separate choice, and AI reviews are a separate choice again.');
  }
  async function askConsent(grant) {
    const d = await Content.load('privacy'); const version = (d && d.version) || 'unversioned';
    const r = await AUTH.call('POST', '/api/account/consents', { kind: 'health_data', granted: !!grant });
    if (grant) await AUTH.call('POST', '/api/account/consents', { kind: 'privacy_notice', version });
    if (!r.ok) { H().toast(r.error, 'warn'); return; }
    await AUTH.refreshUser(); H().renderAll(); H().toast(grant ? 'Thank you. Recorded.' : 'Consent withdrawn');
  }
  async function withdrawConsent() {
    if (!(await Views.confirmSheet('Withdraw consent?', 'Recomp needs your health and fitness information to run your plan. If you withdraw, the server stops saving new training data, AI reviews and coach reports. You can still read, export and delete what is there, and you can agree again later. To remove the data itself, delete your account.', 'Withdraw', true))) return;
    askConsent(false);
  }
  function dataSection(root, S) {
    const c = section(root, 'data', 'Your data');
    if (server()) {
      c.appendChild(el('span', 'eyebrow', 'Download everything'));
      c.appendChild(el('p', 'muted', 'A file with everything your account holds: account details, training, plan, reviews, notes, imported data, settings, consents and your sign-in history.'));
      const ex = el('button', 'btn primary', 'Download my data'); ex.id = 'setExport'; ex.onclick = exportAccount; c.appendChild(ex);
      c.appendChild(el('span', 'eyebrow', 'Correct something or ask a question'));
      c.appendChild(el('p', 'muted', 'You can change most things yourself. For anything you cannot, such as an administrator\'s note or a record you think is wrong, send a request to the administrator.'));
      const rq = el('button', 'btn', 'Send a request'); rq.onclick = sendRequest; c.appendChild(rq);
    }
    moveInto(c, '#profData', server() ? 'Backup file on this device' : 'Backup file');
    if (server()) {
      c.appendChild(el('span', 'eyebrow', 'Delete my account'));
      const del = el('button', 'btn danger', 'Delete my account'); del.id = 'setDelete'; del.onclick = deleteAccount; c.appendChild(del);
    }
  }
  async function exportAccount() {
    const r = await withReauth(() => AUTH.call('GET', '/api/account/export'), 'Confirm it is you before downloading your data.');
    if (!r.ok) { if (!r.cancelled) H().toast(r.error, 'warn'); return; }
    const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'recomp-account-export-' + H().todayISO() + '.json';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    H().toast('Your data was downloaded. Keep the file somewhere private.');
  }
  function sendRequest() {
    Views.sheet('Send a request to the administrator', (b) => {
      let type = 'correction';
      b.appendChild(Views.chips([{ value: 'correction', label: 'Correct my information' }, { value: 'privacy', label: 'Privacy question' }, { value: 'other', label: 'Something else' }], type, v => { type = v; }, false, 'Request type'));
      const t = el('textarea', 'vtext'); t.maxLength = 2000; t.setAttribute('aria-label', 'Your request'); b.appendChild(t);
      note(b, 'Administrators see your request and your login. Do not include passwords or codes.');
      const ok = el('button', 'btn primary block', 'Send'); b.appendChild(ok);
      ok.onclick = async () => { const m = t.value.trim(); if (m.length < 5) { H().toast('Write a little more', 'warn'); return; } const r = await AUTH.call('POST', '/api/account/requests', { type, message: m }); if (r.ok) { Views.closeSheet(); H().toast('Sent. The administrator will reply by email or in the app.'); } else H().toast(r.error, 'warn'); };
    });
  }
  function deleteAccount() {
    Views.sheet('Delete my account', (b) => {
      b.appendChild(el('p', null, '<b>This happens immediately and cannot be undone.</b>'));
      b.appendChild(el('span', 'eyebrow', 'Deleted straight away'));
      b.appendChild(el('ul', 'vlist', ['Your account and login', 'Your training, plan, reviews, notes, imported data and settings', 'Weekly reports you sent to a coach, and their replies', 'Your sign-in sessions, two-step verification and passkeys', 'Your consent records, requests and any administrator notes about you'].map(x => '<li>' + esc(x) + '</li>').join('')));
      b.appendChild(el('span', 'eyebrow', 'Kept, and why'));
      b.appendChild(el('ul', 'vlist', ['A security log entry that an account was deleted, with no name, email or training content, so misuse can be investigated', 'Server backups: the database host keeps point-in-time backups for a limited period. Your data stays in those until they expire and is not restored from them except to recover from a fault', 'Anything on your own devices or files you downloaded. Signing out here clears this device'].map(x => '<li>' + esc(x) + '</li>').join('')));
      const f = Views.field('text', '', { autocomplete: 'off', 'aria-label': 'Type DELETE MY ACCOUNT' }); b.appendChild(Views.labelled('Type DELETE MY ACCOUNT to confirm', f));
      const err = el('p', 'autherr'); err.setAttribute('role', 'alert'); err.hidden = true; b.appendChild(err);
      const ok = el('button', 'btn danger block', 'Delete my account now'); ok.id = 'setDeleteConfirm'; b.appendChild(ok);
      ok.onclick = async () => {
        if (f.value.trim() !== 'DELETE MY ACCOUNT') { err.textContent = 'Type the words exactly to confirm.'; err.hidden = false; return; }
        const r = await withReauth(() => AUTH.call('POST', '/api/account/delete', { confirm: 'DELETE MY ACCOUNT' }), 'Confirm it is you before deleting your account.');
        if (!r.ok) { if (!r.cancelled) { err.textContent = r.error; err.hidden = false; } return; }
        b.innerHTML = '';
        b.appendChild(el('p', null, '<b>Your account has been deleted.</b>'));
        b.appendChild(el('span', 'eyebrow', 'Deleted')); b.appendChild(el('ul', 'vlist', (r.data.deleted || []).map(x => '<li>' + esc(x) + '</li>').join('')));
        if ((r.data.retained || []).length) { b.appendChild(el('span', 'eyebrow', 'Kept')); b.appendChild(el('ul', 'vlist', r.data.retained.map(x => '<li>' + esc(x) + '</li>').join(''))); }
        if (r.data.backups) b.appendChild(el('p', 'muted', esc(r.data.backups)));
        const fin = el('button', 'btn primary block', 'Finish'); b.appendChild(fin);
        fin.onclick = async () => { await AUTH.logout(); location.reload(); };
      };
    });
  }
  function aboutSection(root) {
    const c = section(root, 'about', 'About, why Recomp and privacy');
    const row = el('div', 'row'); row.style.flexWrap = 'wrap';
    [['about', 'About Recomp'], ['why', 'Why Recomp'], ['privacy', 'Privacy policy']].forEach(([k, l]) => { const a = el('a', 'btn sm', l); a.href = '#' + k; a.dataset.doc = k; row.appendChild(a); });
    c.appendChild(row);
    moveInto(c, '#profAssume', 'Coaching assumptions');
  }

  Views.register('profile', { render(root) {
    const S = H().S;
    /* app.js has just refilled its cards wherever they sit (inside the previous layout);
       the new layout moves them in, then the old layout is dropped. */
    const old = root.querySelector('#setMain');
    let host = el('div'); host.id = 'setMain';
    const nav = el('nav', 'set-nav'); nav.setAttribute('aria-label', 'Settings sections');
    [['account', 'Account'], ['training', 'Training'], ['time', 'Time'], ['nutrition', 'Nutrition'], ['appearance', 'Appearance'], ['reminders', 'Reminders'], ['garmin', 'Garmin'], ['ai', 'AI'], ['sharing', 'Sharing'], ['consent', 'Consent'], ['data', 'Your data'], ['about', 'About']].forEach(([id, l]) => {
      if (id === 'consent' && !server()) return;
      const a = el('a', null, l); a.href = '#'; a.onclick = e => { e.preventDefault(); const t = document.getElementById('set-' + id); if (t) { t.scrollIntoView({ block: 'start' }); const h = t.querySelector('h2'); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } } }; nav.appendChild(a);
    });
    host.appendChild(nav);
    root.prepend(host);
    accountSection(host); trainingSection(host, S); timeSection(host, S); nutritionSection(host, S); appearanceSection(host, S);
    remindersSection(host, S); garminSection(host, S);
    const aiHost = el('div'); host.appendChild(aiHost); aiSection(aiHost);
    const shHost = el('div'); host.appendChild(shHost); sharingSection(shHost);
    consentSection(host); dataSection(host, S); aboutSection(host);
    const adm = document.getElementById('profAdmin');
    if (adm) { const acct = host.querySelector('#set-account'); if (acct) acct.after(adm); else host.prepend(adm); }
    if (old) old.remove();
  } });

  /* Existing accounts that have not recorded consent are asked once, after sign-in. */
  async function checkConsentOnce() {
    if (!server()) return;
    const u = AUTH.user(); const cs = u.consents;
    if (!cs || (cs.healthData && cs.healthData.granted) || sessionStorage.getItem('recomp.consentAsked')) return;
    try { sessionStorage.setItem('recomp.consentAsked', '1'); } catch (e) {}
    Views.sheet('Your health information', (b) => {
      b.appendChild(el('p', null, 'Recomp keeps health and fitness information: your training, body measurements, food, and any sleep and heart rate data you import. It needs your agreement to keep using it to run your plan.'));
      const read = el('a', null, 'Read the privacy policy'); read.href = '#privacy'; read.dataset.doc = 'privacy'; b.appendChild(read);
      const ok = el('button', 'btn primary block', 'I agree'); ok.style.marginTop = '12px'; ok.onclick = async () => { Views.closeSheet(); await askConsent(true); };
      const later = el('button', 'btn ghost block', 'Not now'); later.style.marginTop = '8px'; later.onclick = () => Views.closeSheet();
      b.append(ok, later);
      note(b, 'If you do not agree, you can still read, download or delete your data in Settings.');
    });
  }

  return { loadServerSettings, cached, withReauth, askReauth, checkConsentOnce, deleteAccount, exportAccount };
})();
window.Settings = Settings;
