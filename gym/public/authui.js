/* Authentication pop-up, public welcome page and account-status page.

   This file is presentation. The server decides who may do what, on every
   request; nothing here grants access. What it does:
     - shows a public welcome page while nobody is signed in, and hides and
       disables the app behind it (no tabs, no data, nothing loaded);
     - runs the dialog: log in, sign up, forgot and reset password, check your
       email, first-time owner set-up and the forced password change;
     - shows the account-status page to people who are signed up but not yet
       verified or approved, and polls gently so an approval is picked up.

   app.js supplies one hook, signedIn(user), and decides what happens next. */

const AuthUI = (function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const cfg = { minPollMs: 15000, pollEveryMs: 60000, cooldownMs: 30000, rateLimitCooldownMs: 60000 };
  let hooks = { signedIn() {} };
  const st = {
    view: null, mode: 'welcome',          // welcome | status | noaccess
    busy: false, opener: null, resume: null, resetToken: null,
    signupEmail: '', checking: false, polling: false, lastPoll: 0, pollTimer: null,
    cooldowns: new Map(), inited: false
  };

  const EYE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7c2 0 3.8.7 5.3 1.6M22 12s-3.6 7-10 7c-2 0-3.8-.7-5.3-1.6"/><path d="M3 3l18 18"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/></svg>';

  /* ---------------------------------------------------- copy ----------- */
  const NO_EMAIL = 'We could not send the email. The administrator may verify your account manually, so check back here later.';
  const OFFLINE_MSG = 'Could not reach the server. Check your connection and try again.';
  const VIEWS = {
    login:         { title: 'Log in', sub: 'Your training data is private to your account.', tabs: true, focus: 'loginEmail' },
    signup:        { title: 'Create your account', sub: 'An administrator checks every new account before it can be used.', tabs: true, focus: 'signupName' },
    forgot:        { title: 'Reset your password', sub: 'Enter your email address and we will send you a link to choose a new password.', focus: 'forgotEmail' },
    'forgot-sent': { title: 'Check your email', sub: '' },
    reset:         { title: 'Choose a new password', sub: 'This link works once and expires after an hour.', focus: 'resetPw' },
    'reset-done':  { title: 'Password changed', sub: '' },
    'check-email': { title: 'Check your email', sub: '' },
    verified:      { title: 'Email confirmed', sub: '' },
    setup:         { title: 'Set up your account', sub: 'First time only. Enter your login and choose your own password.', focus: 'setupEmail' },
    password:      { title: 'New password', sub: 'Choose a new password before you continue. The one you were given is temporary.', focus: 'pwCurrent' },
    mfa:           { title: 'Two-step verification', sub: 'Enter the code from your authenticator app to finish logging in.', focus: 'mfaCode' },
    'mfa-setup':   { title: 'Turn on two-step verification', sub: 'Accounts that can manage other people need a second step at log in.' }
  };
  const NO_ACCESS = {
    rejected: 'Your request for an account was not approved. If you think this is a mistake, contact the administrator.',
    other:    'This account does not currently have access to Recomp. If you think this is a mistake, contact the administrator.'
  };

  /* ------------------------------------------- password rules ----------
     Length, not composition (OWASP ASVS 5.0). The server (crypto.js) checks again,
     including a breached-password check this page cannot do. The server
     checks again; this only tells people what is needed before they submit. */
  const PW_RULES = [
    { text: 'At least 12 characters (a few words together works well)', need: 'at least 12 characters', ok: p => p.length >= 12 },
    { text: 'Not a common password, or the app\'s name', need: 'to be less easy to guess', ok: p => !/^(password|qwerty|recomp|rsmotocons|letmein|welcome|admin)[0-9!]*$/i.test(p.replace(/[^A-Za-z0-9!]/g, '')) }
  ];
  function passwordProblems(pw) {
    pw = pw || '';
    const out = PW_RULES.filter(r => !r.ok(pw)).map(r => r.need);
    if (pw.length && /^(.)\1+$/.test(pw)) out.push('more than one distinct character');
    return out;
  }
  function list(items) {
    return items.length < 2 ? items.join('') : items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }
  const pwMessage = pw => { const p = passwordProblems(pw); return p.length ? 'Your password needs ' + list(p) + '.' : null; };
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const emailMessage = v => EMAIL_RE.test((v || '').trim()) && v.trim().length <= 120
    ? null : 'Enter a valid email address, like name@example.com.';

  /* Rules per form: [inputId, (value, form) => message | null] */
  const RULES = {
    loginForm: [
      ['loginEmail', v => v.trim() ? null : 'Enter your email address or login.'],
      ['loginPassword', v => v ? null : 'Enter your password.']
    ],
    signupForm: [
      ['signupName', v => { const n = v.trim().replace(/\s+/g, ' '); return n.length >= 2 && n.length <= 80 ? null : 'Enter your name (2 to 80 characters).'; }],
      ['signupEmail', emailMessage],
      ['signupPw', v => v ? pwMessage(v) : 'Choose a password. ' + pwMessage('')],
      ['signupPrivacy', () => $('signupPrivacy').checked ? null : 'Tick to confirm you have read the privacy policy.'],
      ['signupHealth', () => $('signupHealth').checked ? null : 'Recomp cannot run your plan without this. Tick it to continue, or close this window if you do not agree.']
    ],
    mfaForm: [['mfaCode', v => { const c = v.replace(/[\s-]/g, ''); return st.mfaRecovery ? (c.length >= 8 ? null : 'Enter one of your recovery codes.') : (/^\d{6}$/.test(c) ? null : 'Enter the 6-digit code.'); }]],
    forgotForm: [['forgotEmail', emailMessage]],
    resetForm: [
      ['resetPw', v => v ? pwMessage(v) : 'Choose a new password. ' + pwMessage('')],
      ['resetConfirm', v => v === $('resetPw').value ? null : 'The two passwords do not match.']
    ],
    setupForm: [
      ['setupEmail', v => v.trim().length >= 3 ? null : 'Enter your login (3 characters or more).'],
      ['setupPw', v => v ? pwMessage(v) : 'Choose a password. ' + pwMessage('')],
      ['setupConfirm', v => v === $('setupPw').value ? null : 'The two passwords do not match.']
    ],
    pwForm: [
      ['pwCurrent', v => v ? null : 'Enter your current password.'],
      ['pwNext', v => v ? pwMessage(v) : 'Choose a new password. ' + pwMessage('')],
      ['pwConfirm', v => v === $('pwNext').value ? null : 'The two new passwords do not match.']
    ]
  };

  /* ----------------------------------------------------- helpers ------ */
  function announce(msg) {                       // polite status
    const n = $('authLive'); if (!n) return;
    n.textContent = '';
    setTimeout(() => { n.textContent = msg; }, 30);
  }
  function announceAlert(msg) {                  // assertive
    const n = $('authAlert'); if (!n) return;
    n.textContent = '';
    setTimeout(() => { n.textContent = msg; }, 30);
  }
  function setFieldError(input, msg) {
    const e = $(input.id + '-err');
    input.setAttribute('aria-invalid', 'true');
    if (e) { e.textContent = msg; e.hidden = false; }
  }
  function clearFieldError(input) {
    const e = $(input.id + '-err');
    input.removeAttribute('aria-invalid');
    if (e) { e.textContent = ''; e.hidden = true; }
  }
  function formError(id, msg) {
    const e = $(id); if (!e) return;
    e.textContent = msg || ''; e.hidden = !msg;
  }
  function clearForm(form) {
    form.querySelectorAll('input').forEach(i => { if (i.getAttribute('aria-invalid')) clearFieldError(i); });
    form.querySelectorAll('.autherr').forEach(e => { e.hidden = true; e.textContent = ''; });
  }
  function validate(form) {
    const rules = RULES[form.id] || [], errs = [];
    rules.forEach(([id, fn]) => {
      const i = $(id), m = fn(i.value);
      if (m) { setFieldError(i, m); errs.push({ i, m }); } else clearFieldError(i);
    });
    if (errs.length) { announceAlert(errs.map(x => x.m).join(' ')); errs[0].i.focus(); }
    return !errs.length;
  }
  async function withBusy(btn, label, fn) {
    if (st.busy) return undefined;
    st.busy = true;
    const old = btn.textContent;
    btn.setAttribute('aria-busy', 'true'); btn.setAttribute('aria-disabled', 'true');
    btn.classList.add('busy'); btn.textContent = label;
    const x = $('authClose'); if (x) x.setAttribute('aria-disabled', 'true');
    try { return await fn(); }
    finally {
      st.busy = false;
      btn.removeAttribute('aria-busy'); btn.removeAttribute('aria-disabled');
      btn.classList.remove('busy'); btn.textContent = old;
      if (x) x.removeAttribute('aria-disabled');
    }
  }
  function cooldown(btn, ms, label) {
    const prev = st.cooldowns.get(btn); if (prev) clearInterval(prev.t);
    const until = Date.now() + ms, base = label || btn.textContent.replace(/\s*\(\d+s\)$/, '');
    btn.setAttribute('aria-disabled', 'true');
    const tick = () => {
      const left = Math.ceil((until - Date.now()) / 1000);
      if (left <= 0) {
        clearInterval(rec.t); st.cooldowns.delete(btn);
        btn.removeAttribute('aria-disabled'); btn.textContent = base; return;
      }
      btn.textContent = base + ' (' + left + 's)';
    };
    const rec = { t: setInterval(tick, 1000), until };
    st.cooldowns.set(btn, rec); tick();
  }
  const cooling = btn => st.cooldowns.has(btn);
  function clearCooldowns() {
    st.cooldowns.forEach((rec, btn) => { clearInterval(rec.t); btn.removeAttribute('aria-disabled');
      btn.textContent = btn.textContent.replace(/\s*\(\d+s\)$/, ''); });
    st.cooldowns.clear();
  }

  /* ------------------------------------------------- app shell lock --- */
  function shellNodes() {
    return [...document.body.children].filter(n => n.id !== 'authGate' && n.id !== 'docPage' && n.tagName !== 'SCRIPT');
  }
  function lockShell() {
    document.body.classList.add('locked');
    shellNodes().forEach(n => {
      if (n.hasAttribute('data-auth-locked')) return;
      n.setAttribute('data-auth-locked', n.hidden ? 'h' : '');
      n.hidden = true; n.setAttribute('inert', ''); n.setAttribute('aria-hidden', 'true');
    });
  }
  function unlockShell() {
    document.querySelectorAll('[data-auth-locked]').forEach(n => {
      const was = n.getAttribute('data-auth-locked') === 'h';
      n.removeAttribute('data-auth-locked'); n.removeAttribute('inert'); n.removeAttribute('aria-hidden');
      if (!was) n.hidden = false;
    });
    document.body.classList.remove('locked');
  }

  /* ------------------------------------------------------ dialog ------ */
  const wrap = () => $('authDialogWrap');
  const dlg = () => $('authDialog');
  const isOpen = () => !!wrap() && !wrap().hidden;

  function setBackground(inert) {
    ['authWelcome', 'authStatus'].forEach(id => {
      const n = $(id); if (!n) return;
      if (inert) { n.setAttribute('inert', ''); n.setAttribute('aria-hidden', 'true'); }
      else { n.removeAttribute('inert'); n.removeAttribute('aria-hidden'); }
    });
  }
  function resetSecrets() {
    document.querySelectorAll('#authGate input[type="password"], #authGate input[type="text"][data-was-pw]').forEach(i => {
      i.value = ''; i.type = 'password';
    });
    document.querySelectorAll('.pwtoggle').forEach(b => paintToggle(b, false));
    document.querySelectorAll('.pwreq').forEach(updateReq);
  }
  function paintToggle(btn, on) {
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.innerHTML = on ? EYE_OFF : EYE;
    btn.title = on ? 'Hide password' : 'Show password';
  }
  function setView(view, o) {
    o = o || {};
    const v = VIEWS[view]; if (!v) return;
    st.view = view;
    document.querySelectorAll('#authBody [data-view]').forEach(n => { n.hidden = n.dataset.view !== view; });
    $('authTabs').hidden = !v.tabs;
    $('tabLogin').setAttribute('aria-selected', String(view === 'login'));
    $('tabSignup').setAttribute('aria-selected', String(view === 'signup'));
    $('tabLogin').tabIndex = view === 'signup' ? -1 : 0;
    $('tabSignup').tabIndex = view === 'signup' ? 0 : -1;
    $('authTitle').textContent = v.title;
    $('authSub').textContent = o.notice || v.sub || '';
    $('authSub').hidden = !$('authSub').textContent;
    $('authFoot').textContent = '';
    clearCooldowns();
    if (!o.keepErrors) document.querySelectorAll('#authBody form').forEach(clearForm);
    announce(v.title + (o.notice ? '. ' + o.notice : ''));
    if (o.focus !== false) focusInto(view);
  }
  function focusInto(view) {
    const v = VIEWS[view];
    let t = v && v.focus ? $(v.focus) : null;
    if (!t) {
      const body = $('authBody');
      t = [...body.querySelectorAll('[data-view]:not([hidden]) button.primary, [data-view]:not([hidden]) button')]
            .find(b => !b.closest('[hidden]')) || $('authTitle');
    }
    if (t && t.focus) t.focus();
  }
  function focusables() {
    const root = dlg();
    return [...root.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')].filter(n =>
      !n.disabled && n.tabIndex >= 0 && n.getAttribute('tabindex') !== '-1' &&
      !(n.closest('[hidden]') && root.contains(n.closest('[hidden]'))) && !n.closest('.hp'));
  }

  function openDialog(view, o) {
    o = o || {};
    const g = $('authGate');
    g.hidden = false; lockShell();
    showMode('welcome');
    if (!isOpen()) {
      st.opener = o.opener || (document.activeElement && document.activeElement !== document.body
        ? document.activeElement : $('awLogin'));
      wrap().hidden = false;
      setBackground(true);
      syncViewport();
    }
    setView(view, o);
  }
  function closeDialog(o) {
    o = o || {};
    if (!isOpen() || st.busy) return false;
    wrap().hidden = true;
    setBackground(false);
    resetSecrets();
    document.querySelectorAll('#authBody form').forEach(clearForm);
    clearCooldowns();
    st.resetToken = st.view === 'reset' ? null : st.resetToken;
    if (o.focus !== false) {
      const opener = st.opener && st.opener.isConnected && !st.opener.closest('[hidden]') ? st.opener : $('awLogin');
      if (opener && opener.focus) opener.focus();
    }
    st.opener = null;
    announce('Dialog closed');
    return true;
  }
  function syncViewport() {
    const vv = window.visualViewport, w = wrap(); if (!vv || !w) return;
    w.style.setProperty('--vvh', Math.round(vv.height) + 'px');
    w.style.setProperty('--vvt', Math.round(vv.offsetTop) + 'px');
  }

  /* --------------------------------------------- welcome / status ---- */
  function showMode(mode) {
    st.mode = mode;
    $('authWelcome').hidden = mode !== 'welcome';
    $('authStatus').hidden = mode === 'welcome';
    if (mode === 'welcome') stopPolling();
  }

  function showWelcome(o) {
    o = o || {};
    $('authGate').hidden = false; lockShell();
    if (isOpen()) closeDialog({ focus: false });
    showMode('welcome');
    if (o.message) announce(o.message);
  }

  function renderPending(d) {
    d = d || {};
    const verified = !!d.emailVerified;
    $('stTitle').textContent = 'Your account is awaiting approval';
    $('stLead').textContent = verified
      ? 'Your email address is confirmed. An administrator will review your request, and this page updates when they do.'
      : 'Confirm your email address using the link we sent' + (d.email ? ' to ' + d.email : '') +
        '. An administrator then reviews your request.';
    $('stSteps').hidden = false;
    $('stEmailVal').textContent = verified ? 'Confirmed' : 'Not confirmed yet';
    $('stEmailStep').className = verified ? 'done' : 'wait';
    $('stApprovalVal').textContent = 'Waiting for an administrator';
    $('stApprovalStep').className = 'wait';
    $('stResend').hidden = verified;
    $('stCheck').hidden = false; $('stLogout').hidden = false; $('stBack').hidden = true;
  }
  function renderNoAccess(status, message, loggedIn) {
    $('stTitle').textContent = 'No access';
    $('stLead').textContent = message || (status === 'rejected' ? NO_ACCESS.rejected : NO_ACCESS.other);
    $('stSteps').hidden = true;
    $('stResend').hidden = true; $('stCheck').hidden = true;
    $('stLogout').hidden = !loggedIn; $('stBack').hidden = !!loggedIn;
    $('stMsg').textContent = ''; $('stMsg').classList.remove('bad');
  }
  function showStatus(o) {
    o = o || {};
    $('authGate').hidden = false; lockShell();
    if (isOpen()) closeDialog({ focus: false });
    showMode('status');
    renderPending(Object.assign({ emailVerified: false }, o.user && {
      email: o.user.email, emailVerified: o.user.accountState === 'pending_approval' }, o.data));
    setMsg(o.notice || '');
    $('stTitle').focus();
    announce('Your account is awaiting approval');
    st.lastPoll = Date.now();
    startPolling();
    checkStatus({ force: true, quiet: true });
  }
  function showNoAccess(status, o) {
    o = o || {};
    $('authGate').hidden = false; lockShell();
    if (isOpen()) closeDialog({ focus: false });
    showMode('noaccess');
    stopPolling();
    renderNoAccess(status, o.message, !!o.loggedIn);
    $('stTitle').focus();
    announce('No access. ' + $('stLead').textContent);
  }
  function setMsg(text, bad) {
    const m = $('stMsg'); m.textContent = text || ''; m.classList.toggle('bad', !!bad);
  }

  /* ------------------------------------------------------ polling ----- */
  function startPolling() {
    if (st.polling) return;
    st.polling = true;
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    st.pollTimer = setInterval(() => { if (!document.hidden) checkStatus(); }, cfg.pollEveryMs);
  }
  function stopPolling() {
    if (!st.polling) return;
    st.polling = false;
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onFocus);
    clearInterval(st.pollTimer); st.pollTimer = null;
  }
  function onVisible() { if (!document.hidden) checkStatus(); }
  function onFocus() { checkStatus(); }

  async function checkStatus(o) {
    o = o || {};
    if (st.mode !== 'status' || st.checking) return;
    const now = Date.now();
    if (!o.force && now - st.lastPoll < cfg.minPollMs) return;
    st.lastPoll = now; st.checking = true;
    try {
      const r = await AUTH.accountStatus();
      if (st.mode !== 'status') return;
      if (r.signedOut) {
        if (r.accountStatus && r.accountStatus !== 'active' && r.accountStatus !== 'pending') {
          showNoAccess(r.accountStatus);
        } else {
          stopPolling();
          openDialog('login', { notice: 'Log in to continue.', opener: $('awLogin') });
        }
        return;
      }
      if (!r.ok) { if (!o.quiet) setMsg('Could not check just now. We will try again.', true); return; }
      const d = r.data;
      if (d.accountState === 'active') {
        stopPolling();
        const s = await AUTH.refresh();
        if (s.state === 'authenticated') { await safeSignedIn(s.user); return; }
        return;
      }
      if (d.accountStatus && d.accountStatus !== 'pending') { showNoAccess(d.accountStatus); return; }
      renderPending(d);
      if (o.announce) { setMsg('Checked just now. Still waiting for approval.'); announce('Checked. Still waiting for approval.'); }
    } catch (e) {
      if (!o.quiet) setMsg(OFFLINE_MSG, true);
    } finally { st.checking = false; }
  }

  async function safeSignedIn(user) {
    st.resume = null;
    if (user && (user.mfaSetupRequired || (user.mfa && user.mfa.required && !user.mfa.totp && !user.mfa.passkeys))) { await mfaSetupFlow(user); return; }
    try { await hooks.signedIn(user); } catch (e) { /* the app reports its own errors */ }
  }

  /* ----------------------------------------------- email sending ------ */
  async function resend(btn, statusEl) {
    if (st.busy || cooling(btn)) return;
    const say = (t, bad) => { statusEl.textContent = t; statusEl.classList.toggle('bad', !!bad); };
    let after = null;
    await withBusy(btn, 'Sending…', async () => {
      let r;
      try { r = await AUTH.resendVerification(); } catch (e) { say(OFFLINE_MSG, true); return; }
      if (r.status === 429) { say(r.error, true); after = () => cooldown(btn, cfg.rateLimitCooldownMs, 'Resend email'); return; }
      if (r.status === 401) { say('Log in to ask for another email.', true); return; }
      if (!r.ok) { say(r.error, true); return; }
      if (r.data.alreadyVerified) { say('Your email address is already confirmed.'); return; }
      if (r.data.emailSent) { say('We sent another email. It can take a minute to arrive.'); after = () => cooldown(btn, cfg.cooldownMs, 'Resend email'); return; }
      say(NO_EMAIL, true);
    });
    if (after) after();
  }

  /* ----------------------------------------------- submit handlers ---- */
  async function onLogin(e) {
    e.preventDefault();
    if (st.busy || !validate($('loginForm'))) return;
    formError('loginError', '');
    await withBusy($('loginBtn'), 'Logging in…', async () => {
      let r;
      try { r = await AUTH.login($('loginEmail').value.trim(), $('loginPassword').value); }
      catch (e2) { formError('loginError', OFFLINE_MSG); return; }
      if (!r.ok) {
        if (r.accountStatus && r.accountStatus !== 'active') {
          st.busy = false; closeDialog({ focus: false }); st.busy = true;
          showNoAccess(r.accountStatus); return;
        }
        formError('loginError', r.error);
        $('loginPassword').value = ''; $('loginPassword').focus();
        return;
      }
      $('loginPassword').value = '';
      if (r.mfaRequired) { startMfa(r.methods); return; }
      st.busy = false;
      await safeSignedIn(r.user);
      st.busy = true;
    });
  }

  /* --------------------------------------------- two-step verification -- */
  function startMfa(methods) {
    st.mfaRecovery = false; st.mfaMethods = methods || ['totp', 'recovery'];
    paintMfaMode();
    $('mfaPasskey').hidden = !(st.mfaMethods.indexOf('passkey') >= 0 && AUTH.passkeysAvailable && AUTH.passkeysAvailable());
    setView('mfa');
  }
  function paintMfaMode() {
    $('mfaCodeLabel').textContent = st.mfaRecovery ? 'One of your recovery codes' : '6-digit code from your authenticator app';
    $('mfaCode').setAttribute('inputmode', st.mfaRecovery ? 'text' : 'numeric');
    $('mfaCode').setAttribute('autocomplete', st.mfaRecovery ? 'off' : 'one-time-code');
    $('mfaUseRecovery').textContent = st.mfaRecovery ? 'Use my authenticator app instead' : 'Use a recovery code instead';
    $('mfaUseRecovery').hidden = st.mfaMethods && st.mfaMethods.indexOf('recovery') < 0;
  }
  async function onMfa(e) {
    e.preventDefault();
    if (st.busy || !validate($('mfaForm'))) return;
    formError('mfaError', '');
    await withBusy($('mfaBtn'), 'Checking…', async () => {
      const code = $('mfaCode').value.replace(/\s/g, '');
      let r;
      try { r = await AUTH.mfaVerify(st.mfaRecovery ? { recoveryCode: code } : { code }); }
      catch (e2) { formError('mfaError', OFFLINE_MSG); return; }
      $('mfaCode').value = '';
      if (!r.ok) {
        if (r.expired) { setView('login', { notice: 'That log in timed out. Enter your password again.' }); return; }
        formError('mfaError', r.error); $('mfaCode').focus(); return;
      }
      st.busy = false; await safeSignedIn(r.user); st.busy = true;
    });
  }
  async function onMfaPasskey() {
    if (st.busy) return;
    await withBusy($('mfaPasskey'), 'Waiting for your passkey…', async () => {
      let r; try { r = await AUTH.passkeyLogin(); } catch (e2) { formError('mfaError', OFFLINE_MSG); return; }
      if (!r.ok) { if (!r.cancelled) formError('mfaError', r.error); return; }
      st.busy = false; await safeSignedIn(r.user); st.busy = true;
    });
  }

  /* Owner and administrator accounts must enrol before anything else loads. */
  async function mfaSetupFlow(user) {
    openDialog('mfa-setup', { opener: $('awLogin') });
    const body = $('mfaSetupBody'); body.innerHTML = '';
    const p = (t, cls) => { const n = document.createElement('p'); if (cls) n.className = cls; n.textContent = t; return n; };
    body.appendChild(p('You will need an authenticator app such as Google Authenticator, Microsoft Authenticator, 1Password or Apple Passwords. Each time you log in you type the 6-digit code it shows.', 'adlg-note'));
    const go = document.createElement('button'); go.type = 'button'; go.className = 'btn primary block lg'; go.textContent = 'Set up my authenticator app';
    body.appendChild(go);
    const out = $('mfaSetupBtnLogout') || document.createElement('button'); out.type = 'button'; out.className = 'btn ghost block'; out.id = 'mfaSetupBtnLogout'; out.textContent = 'Log out'; out.style.marginTop = '8px';
    out.onclick = async () => { await AUTH.logout(); location.reload(); };
    body.appendChild(out);
    go.onclick = async () => {
      formError('mfaSetupError', '');
      let r; try { r = await AUTH.call('POST', '/api/auth/mfa/totp/begin', {}, 'Could not start set-up.'); } catch (e) { formError('mfaSetupError', OFFLINE_MSG); return; }
      if (!r.ok) { formError('mfaSetupError', r.code === 'reauth_required' ? 'For safety, log out and log in again, then set this up straight away.' : r.error); return; }
      body.innerHTML = '';
      body.appendChild(p('1. In your authenticator app, add an account using this key:', 'adlg-note'));
      const key = document.createElement('code'); key.className = 'mfa-key'; key.textContent = String(r.data.secret).replace(/(.{4})/g, '$1 ').trim(); body.appendChild(key);
      const row = document.createElement('p'); row.className = 'alinks';
      const open = document.createElement('a'); open.href = r.data.otpauthUri; open.textContent = 'Open in my authenticator app'; open.className = 'alink'; row.appendChild(open);
      const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'alink'; copy.textContent = 'Copy key'; copy.style.marginLeft = '14px';
      copy.onclick = () => { try { navigator.clipboard.writeText(r.data.secret); announce('Key copied'); } catch (x) {} }; row.appendChild(copy); body.appendChild(row);
      body.appendChild(p('2. Type the 6-digit code it shows:', 'adlg-note'));
      const wrapF = document.createElement('div'); wrapF.className = 'af';
      const lab = document.createElement('label'); lab.htmlFor = 'mfaSetupCode'; lab.textContent = 'Code from the app';
      const inp = document.createElement('input'); inp.id = 'mfaSetupCode'; inp.type = 'text'; inp.inputMode = 'numeric'; inp.autocomplete = 'one-time-code'; inp.maxLength = 8;
      wrapF.append(lab, inp); body.appendChild(wrapF);
      const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'btn primary block lg'; ok.textContent = 'Turn on two-step verification'; body.appendChild(ok);
      body.appendChild(out);
      inp.focus();
      ok.onclick = async () => {
        const code = inp.value.replace(/\s/g, '');
        if (!/^\d{6}$/.test(code)) { formError('mfaSetupError', 'Enter the 6-digit code from the app.'); inp.focus(); return; }
        const c = await AUTH.call('POST', '/api/auth/mfa/totp/confirm', { code }, 'That code did not match. Check the time on your phone and try again.');
        if (!c.ok) { formError('mfaSetupError', c.error); inp.select(); return; }
        formError('mfaSetupError', '');
        showRecoveryCodes(body, c.data.recoveryCodes || [], async () => {
          const me = await AUTH.refreshUser();
          closeDialog({ focus: false });
          await safeSignedIn(me.ok ? me.user : user);
        });
      };
    };
  }
  function showRecoveryCodes(body, codes, done) {
    body.innerHTML = '';
    const h = document.createElement('p'); h.className = 'adlg-note'; h.textContent = 'Two-step verification is on. Save these recovery codes somewhere safe, such as a password manager. Each works once if you lose your phone. They will not be shown again.'; body.appendChild(h);
    const ol = document.createElement('ol'); ol.className = 'mfa-codes'; codes.forEach(c => { const li = document.createElement('li'); li.textContent = c; ol.appendChild(li); }); body.appendChild(ol);
    const dl = document.createElement('button'); dl.type = 'button'; dl.className = 'btn block'; dl.textContent = 'Download as a text file';
    dl.onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['Recomp recovery codes\n\n' + codes.join('\n') + '\n'], { type: 'text/plain' })); a.download = 'recomp-recovery-codes.txt'; document.body.appendChild(a); a.click(); a.remove(); };
    body.appendChild(dl);
    const lab = document.createElement('label'); lab.className = 'acheck'; const cb = document.createElement('input'); cb.type = 'checkbox'; cb.id = 'mfaSaved';
    const sp = document.createElement('span'); sp.textContent = 'I have saved my recovery codes'; lab.append(cb, sp); body.appendChild(lab);
    const go = document.createElement('button'); go.type = 'button'; go.className = 'btn primary block lg'; go.textContent = 'Continue'; go.disabled = true; body.appendChild(go);
    cb.onchange = () => { go.disabled = !cb.checked; };
    go.onclick = done;
    go.focus && dl.focus();
  }

  async function privacyVersion() {
    try { const d = window.Content ? await Content.load('privacy') : null; return (d && d.version) || 'unversioned'; } catch (e) { return 'unversioned'; }
  }
  async function onSignup(e) {
    e.preventDefault();
    if (st.busy || !validate($('signupForm'))) return;
    formError('signupError', '');
    const f = {
      name: $('signupName').value.trim().replace(/\s+/g, ' '),
      email: $('signupEmail').value.trim().toLowerCase(),
      password: $('signupPw').value,
      website: $('signupWebsite').value,
      healthConsent: $('signupHealth').checked,
      privacyNoticeVersion: await privacyVersion()
    };
    await withBusy($('signupBtn'), 'Creating account…', async () => {
      let r;
      try { r = await AUTH.signup(f); } catch (e2) { formError('signupError', OFFLINE_MSG); return; }
      if (!r.ok) { formError('signupError', r.error); return; }
      st.signupEmail = f.email;
      $('signupPw').value = '';
      showCheckEmail(f.email, r.data.emailSent !== false);
    });
  }
  function showCheckEmail(email, sent) {
    setView('check-email', { focus: false });
    $('authTitle').textContent = sent ? 'Check your email' : 'Request received';
    $('ceMsg').textContent = sent
      ? 'We sent a confirmation link to ' + email + '. Open it to confirm your address.'
      : 'Your request is saved, but the email could not be sent.';
    $('ceNote').textContent = sent
      ? 'After that, an administrator reviews your request. The link works once and expires in 48 hours.'
      : NO_EMAIL;
    $('ceStatus').textContent = '';
    $('ceStatus').classList.remove('bad');
    $('ceResend').hidden = false;
    $('authTitle').focus();
  }

  async function onForgot(e) {
    e.preventDefault();
    if (st.busy || !validate($('forgotForm'))) return;
    formError('forgotError', '');
    const email = $('forgotEmail').value.trim();
    await withBusy($('forgotBtn'), 'Sending…', async () => {
      let r;
      try { r = await AUTH.forgot(email); } catch (e2) { formError('forgotError', OFFLINE_MSG); return; }
      if (!r.ok) { formError('forgotError', r.error); return; }
      setView('forgot-sent', { focus: false });
      $('forgotSentMsg').textContent = r.data.emailSent === false
        ? 'This server cannot send email at the moment, so no message was sent. Ask the administrator to reset your password.'
        : 'If there is an account for ' + email + ', a reset link is on its way. It works once and expires in an hour.';
      $('authTitle').focus();
    });
  }

  async function onReset(e) {
    e.preventDefault();
    if (st.busy || !validate($('resetForm'))) return;
    formError('resetError', ''); $('resetNewLink').hidden = true;
    await withBusy($('resetBtn'), 'Saving…', async () => {
      let r;
      try { r = await AUTH.reset(st.resetToken, $('resetPw').value); } catch (e2) { formError('resetError', OFFLINE_MSG); return; }
      if (!r.ok) {
        formError('resetError', r.error);
        if (/invalid|expired/i.test(r.error || '')) $('resetNewLink').hidden = false;
        return;
      }
      st.resetToken = null;
      $('resetPw').value = $('resetConfirm').value = '';
      setView('reset-done', { focus: false });
      $('authTitle').focus();
    });
  }

  async function onSetup(e) {
    e.preventDefault();
    if (st.busy || !validate($('setupForm'))) return;
    formError('setupError', '');
    await withBusy($('setupBtn'), 'Creating…', async () => {
      let r;
      try { r = await AUTH.setup($('setupEmail').value.trim(), $('setupPw').value); }
      catch (e2) { formError('setupError', OFFLINE_MSG); return; }
      if (!r.ok) { formError('setupError', r.error); return; }
      $('setupPw').value = $('setupConfirm').value = '';
      st.busy = false; await safeSignedIn(r.user); st.busy = true;
    });
  }

  async function onPassword(e) {
    e.preventDefault();
    if (st.busy || !validate($('pwForm'))) return;
    formError('pwError', '');
    await withBusy($('pwBtn'), 'Saving…', async () => {
      let r;
      try { r = await AUTH.changePassword($('pwCurrent').value, $('pwNext').value); }
      catch (e2) { formError('pwError', OFFLINE_MSG); return; }
      if (!r.ok) { formError('pwError', r.error); return; }
      $('pwCurrent').value = $('pwNext').value = $('pwConfirm').value = '';
      st.busy = false;
      const u = AUTH.user();
      if (u) await safeSignedIn(u);
      else { const s = await AUTH.refresh(); if (s.state === 'authenticated') await safeSignedIn(s.user); }
      st.busy = true;
    });
  }

  async function onLogout() {
    const btn = $('stLogout');
    await withBusy(btn, 'Logging out…', async () => {
      try { await AUTH.logout(); } catch (e) {}
    });
    st.resume = null;
    showWelcome({ message: 'You have been logged out.' });
    const b = $('awLogin'); if (b) b.focus();
  }

  /* ------------------------------------------------------ wiring ------ */
  function updateReq(ul) {
    const input = $(ul.dataset.pw); if (!input) return;
    const pw = input.value;
    if (!ul.children.length) {
      PW_RULES.forEach(r => {
        const li = document.createElement('li');
        li.innerHTML = '<span class="sr-only"></span><span class="t"></span>';
        li.querySelector('.t').textContent = r.text;
        ul.appendChild(li);
      });
    }
    [...ul.children].forEach((li, i) => {
      const met = PW_RULES[i].ok(pw);
      li.className = met ? 'met' : '';
      li.querySelector('.sr-only').textContent = met ? 'Done: ' : 'Needed: ';
    });
  }

  function bindForm(id, handler) {
    const f = $(id); if (!f) return;
    f.addEventListener('submit', handler);
    const rules = RULES[id] || [];
    f.addEventListener('input', e => {
      const i = e.target;
      if (!i || !i.id) return;
      if (i.getAttribute('aria-invalid')) {
        const rule = rules.find(r => r[0] === i.id);
        if (rule && !rule[1](i.value)) clearFieldError(i);
      }
      // A confirm field is wrong or right depending on the password above it.
      rules.forEach(([rid, fn]) => {
        const n = $(rid);
        if (n !== i && n.getAttribute('aria-invalid') && !fn(n.value)) clearFieldError(n);
      });
      if (i.matches && i.matches('input[type]') && i.id && document.querySelector('.pwreq[data-pw="' + i.id + '"]')) {
        updateReq(document.querySelector('.pwreq[data-pw="' + i.id + '"]'));
      }
    });
    f.addEventListener('focusout', e => {
      const i = e.target, rule = rules.find(r => r[0] === i.id);
      if (!rule || !i.value || i.type === 'password') return;       // never nag on first visit or half-typed passwords
      const m = rule[1](i.value);
      if (m) setFieldError(i, m); else clearFieldError(i);
    });
  }

  function init(h) {
    if (h) hooks = Object.assign(hooks, h);
    if (st.inited || !$('authGate')) return;
    st.inited = true;

    document.querySelectorAll('.pwtoggle').forEach(b => {
      paintToggle(b, false);
      b.addEventListener('click', () => {
        const input = $(b.dataset.for), show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        if (show) input.setAttribute('data-was-pw', '1'); else input.removeAttribute('data-was-pw');
        paintToggle(b, show);
      });
    });
    document.querySelectorAll('.pwreq').forEach(updateReq);

    bindForm('loginForm', onLogin); bindForm('signupForm', onSignup); bindForm('forgotForm', onForgot);
    bindForm('resetForm', onReset); bindForm('setupForm', onSetup); bindForm('pwForm', onPassword);
    bindForm('mfaForm', onMfa);
    $('mfaUseRecovery').addEventListener('click', () => { st.mfaRecovery = !st.mfaRecovery; paintMfaMode(); clearFieldError($('mfaCode')); $('mfaCode').value = ''; $('mfaCode').focus(); });
    $('mfaPasskey').addEventListener('click', onMfaPasskey);
    /* About, Why and Privacy open over the dialog; the dialog closes first so focus is not trapped behind the page. */
    document.addEventListener('click', e => { const a = e.target.closest('#authDialog [data-doc]'); if (a && isOpen()) { st.busy = false; closeDialog({ focus: false }); } }, true);

    $('awLogin').addEventListener('click', e => openDialog(st.resume || 'login', { opener: e.currentTarget }));
    $('awSignup').addEventListener('click', e => openDialog('signup', { opener: e.currentTarget }));
    $('authClose').addEventListener('click', () => closeDialog());
    $('authScrim').addEventListener('click', () => closeDialog());
    $('loginForgot').addEventListener('click', () => {
      const v = $('loginEmail').value.trim();
      setView('forgot'); if (EMAIL_RE.test(v)) $('forgotEmail').value = v;
    });
    $('authBody').addEventListener('click', e => {
      const g = e.target.closest('[data-goto]'); if (!g) return;
      setView(g.dataset.goto);
    });
    $('verContinue').addEventListener('click', async () => {
      if ($('verContinue').dataset.next === 'status') { closeDialog({ focus: false }); showStatus({}); }
      else setView('login');
    });
    $('ceResend').addEventListener('click', () => resend($('ceResend'), $('ceStatus')));
    $('ceContinue').addEventListener('click', () => { closeDialog({ focus: false }); showStatus({ user: { accountState: 'pending_verification', email: st.signupEmail } }); });

    $('stResend').addEventListener('click', () => resend($('stResend'), $('stMsg')));
    $('stCheck').addEventListener('click', () => checkStatus({ force: true, announce: true }));
    $('stLogout').addEventListener('click', onLogout);
    $('stBack').addEventListener('click', () => { showWelcome(); openDialog('login', { opener: $('awLogin') }); });

    /* Tabs: arrow keys, Home and End move and activate (automatic activation). */
    $('authTabs').addEventListener('click', e => {
      const t = e.target.closest('[role="tab"]'); if (t) setView(t.id === 'tabSignup' ? 'signup' : 'login', { focus: false });
    });
    $('authTabs').addEventListener('keydown', e => {
      const tabs = [$('tabLogin'), $('tabSignup')], i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      let n = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % tabs.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i + tabs.length - 1) % tabs.length;
      else if (e.key === 'Home') n = 0;
      else if (e.key === 'End') n = tabs.length - 1;
      if (n == null) return;
      e.preventDefault();
      setView(n === 0 ? 'login' : 'signup', { focus: false });
      tabs[n].focus();
    });

    /* Focus trap, Escape, and keeping focus inside while the dialog is open. */
    document.addEventListener('keydown', e => {
      if (!isOpen()) return;
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        if (!st.busy) closeDialog();
        return;
      }
      if (e.key !== 'Tab') return;
      const f = focusables(), a = document.activeElement, d = dlg();
      if (!f.length) { e.preventDefault(); d.focus(); return; }
      const first = f[0], last = f[f.length - 1];
      if (!d.contains(a) || a === d) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      else if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
    }, true);
    document.addEventListener('focusin', e => {
      if (isOpen() && !wrap().contains(e.target)) { const f = focusables(); if (f[0]) f[0].focus(); }
    });
    // With the on-screen keyboard up, keep the field being typed in on screen.
    dlg().addEventListener('focusin', e => {
      const t = e.target;
      if (t && t.matches && t.matches('input') && t.scrollIntoView) {
        setTimeout(() => { try { t.scrollIntoView({ block: 'center' }); } catch (x) {} }, 250);
      }
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', syncViewport);
      window.visualViewport.addEventListener('scroll', syncViewport);
    }
  }

  /* ------------------------------------------------ public surface ---- */
  function show(view, o) {
    o = o || {};
    if (!st.inited) init();
    const notice = o.notice || o.foot || '';
    switch (view) {
      case 'welcome': showWelcome(o); break;
      case 'pending': showStatus(o); break;
      case 'blocked': showNoAccess(o.status, { message: o.message, loggedIn: !!o.loggedIn }); break;
      case 'reset':
        st.resetToken = o.token || st.resetToken;
        $('resetNewLink').hidden = true;
        openDialog('reset', { opener: $('awLogin'), notice, focus: o.focus });
        break;
      case 'password': st.resume = 'password'; openDialog('password', { opener: $('awLogin'), notice, focus: o.focus }); break;
      case 'verified': {
        openDialog('verified', { opener: $('awLogin'), notice });
        $('verMsg').textContent = o.retry
          ? 'We could not confirm your email just now. Check your connection, then reload this page to try again.'
          : o.ok === false
            ? (o.error || 'This confirmation link is invalid or has expired.') + ' Log in to ask for a new one.'
            : 'Thank you. Your email address is confirmed. An administrator will now review your request.';
        $('authTitle').textContent = o.ok === false ? 'Link not valid' : 'Email confirmed';
        $('verContinue').textContent = o.ok === false ? 'Log in' : 'Log in to check your status';
        $('verContinue').dataset.next = '';
        break;
      }
      default:
        openDialog(VIEWS[view] ? view : 'login', { opener: o.opener || $('awLogin'), notice, focus: o.focus });
    }
  }
  function hide() {
    stopPolling(); clearCooldowns();
    if (isOpen()) { st.busy = false; closeDialog({ focus: false }); }
    resetSecrets();
    $('authGate').hidden = true;
    unlockShell();
  }

  /* Reads /?verify=TOKEN or /?reset=TOKEN, removes it from the address bar and
     history, and reports what it found. The token is never kept anywhere
     but in memory. */
  async function consumeUrl() {
    let p;
    try { p = new URLSearchParams(location.search); } catch (e) { return null; }
    const verify = p.get('verify'), reset = p.get('reset');
    if (!verify && !reset) return null;
    const clean = () => {
      p.delete('verify'); p.delete('reset');
      const qs = p.toString();
      try { history.replaceState(history.state, '', location.pathname + (qs ? '?' + qs : '') + location.hash); } catch (e) {}
    };
    if (reset) { clean(); return { kind: 'reset', token: reset }; }
    let r;
    try { r = await AUTH.verify(verify); }
    catch (e) { return { kind: 'verify', ok: false, error: OFFLINE_MSG, retry: true }; }   // token stays in the URL so a reload can retry
    clean();
    return { kind: 'verify', ok: r.ok, error: r.error, status: r.data && r.data.status };
  }

  function configure(o) { Object.assign(cfg, o || {}); }

  return { init, show, hide, consumeUrl, checkStatus, configure, passwordProblems,
           isOpen, view: () => st.view, mode: () => st.mode, closeDialog, showRecoveryCodes, mfaSetupFlow };
})();

if (typeof window !== 'undefined') window.AuthUI = AuthUI;
if (typeof module !== 'undefined' && module.exports) module.exports = { AuthUI };
