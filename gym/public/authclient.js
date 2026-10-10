/* Front-end session layer.

   The server is the authority. This file does three jobs:
     1. Gets the session and the permission set from the server.
     2. Keeps the local copy of the state namespaced PER ACCOUNT, so two people
        on one phone can never see each other's cache.
     3. Enforces a bounded offline window. Offline work is allowed for a while
        on an already-authenticated device, then revalidation is required.

   What this file does NOT do is decide anything. Hiding a tab is presentation;
   the server refuses the request regardless. */

const AUTH = (function () {
  'use strict';

  const OFFLINE_GRACE_MS = 72 * 3600 * 1000;   // 3 days of offline use, then revalidate
  let session = null;                           // { user } or null
  let pendingUser = null;                       // signed in but awaiting verification or approval
  let lastVerifiedAt = 0;
  let offline = !navigator.onLine;

  async function api(path, opts) {
    opts = opts || {};
    const res = await fetch(path, {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: Object.assign(
        { 'Content-Type': 'application/json', 'X-Recomp-Request': '1' }, opts.headers || {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (e) {}
    return { status: res.status, ok: res.ok, data: data || {} };
  }

  /* ---- namespaced local storage ----------------------------------------
     Every key is scoped by account id. Logging out deletes that account's
     keys; it never leaves a document another account could read. */
  function nsKey(userId, name) { return `recomp.u.${userId}.${name}`; }

  function wipeAccount(userId) {
    const prefix = `recomp.u.${userId}.`;
    try {
      Object.keys(localStorage).filter(k => k.startsWith(prefix)).forEach(k => localStorage.removeItem(k));
    } catch (e) {}
    // The app keeps its offline copy in recompDB/kv under recomp.u.<id>.*; remove those keys.
    try {
      const rq = indexedDB.open('recompDB', 2);
      rq.onupgradeneeded = () => { try { rq.result.createObjectStore('kv'); } catch (e) {} };
      rq.onsuccess = () => {
        try {
          const db = rq.result, st = db.transaction('kv', 'readwrite').objectStore('kv');
          const kr = st.getAllKeys();
          kr.onsuccess = () => { (kr.result || []).filter(k => String(k).startsWith(prefix)).forEach(k => st.delete(k)); };
          st.transaction.oncomplete = () => db.close();
        } catch (e) {}
      };
    } catch (e) {}
  }
  function wipeAllAccounts() {
    try {
      Object.keys(localStorage).filter(k => k.startsWith('recomp.')).forEach(k => localStorage.removeItem(k));
    } catch (e) {}
  }
  async function wipeCaches() {
    try {
      if (!window.caches) return;
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k.startsWith('recomp-')).map(k => caches.delete(k)));
    } catch (e) {}
  }

  const isPendingUser = u => !!(u && u.accountState && u.accountState !== 'active');

  /* ---- session ---------------------------------------------------------- */
  async function refresh() {
    try {
      const r = await api('/api/auth/session');
      offline = false;
      /* No backend deployed at this origin. A static-only deploy must keep
         working exactly as it did before accounts existed, rather than locking
         the owner out of their own device. A 404, or anything that is not the
         expected JSON shape, means there is no server to answer to. */
      if (r.status === 404 || typeof r.data.authenticated !== 'boolean') {
        session = null;
        return { state: 'no_backend' };
      }
      if (r.status === 200 && r.data.authenticated && isPendingUser(r.data.user)) {
        /* Signed in, but not approved (or not verified) yet. This is NOT a session
           the app may use: nothing is cached for offline use and user() stays null. */
        session = null;
        pendingUser = r.data.user;
        return { state: 'pending', user: r.data.user };
      }
      if (r.status === 200 && r.data.authenticated) {
        pendingUser = null;
        session = { user: r.data.user };
        lastVerifiedAt = Date.now();
        try { localStorage.setItem('recomp.lastVerified', String(lastVerifiedAt)); } catch (e) {}
        try { localStorage.setItem('recomp.lastUser', r.data.user.id); } catch (e) {}
        return { state: 'authenticated', user: r.data.user };
      }
      session = null;
      return { state: 'anonymous', reason: r.data.reason, setupAvailable: !!r.data.setupAvailable };
    } catch (e) {
      // Network failure, not a rejection. Fall back to the bounded offline window.
      offline = true;
      const lv = parseInt(localStorage.getItem('recomp.lastVerified') || '0', 10);
      const uid = localStorage.getItem('recomp.lastUser');
      /* Never signed in on this device, and the server cannot be reached: there
         is nothing to be locked out OF. Run locally, as the app did before
         accounts existed. A gate here would strand someone on a static deploy
         or a flaky connection with no way in. */
      if (!uid || !lv) { session = null; return { state: 'no_backend' }; }
      if (uid && lv && Date.now() - lv < OFFLINE_GRACE_MS) {
        const cached = localStorage.getItem(nsKey(uid, 'user'));
        session = cached ? { user: JSON.parse(cached), offline: true } : null;
        if (session) return { state: 'offline', user: session.user,
          expiresInMs: OFFLINE_GRACE_MS - (Date.now() - lv) };
      }
      session = null;
      return { state: 'offline_expired',
        message: lv ? 'Offline for more than three days. Reconnect to keep using Recomp.'
                    : 'You need to be online to sign in the first time.' };
    }
  }

  async function setup(email, password, consent) {
    consent = consent || {};
    const r = await api('/api/auth/setup', { method: 'POST', body: { email, password,
      privacyNoticeVersion: consent.privacyNoticeVersion || undefined, healthConsent: consent.healthConsent === true ? true : undefined } });
    if (r.status !== 200) return { ok: false, error: r.data.error || 'Setup failed.' };
    session = { user: r.data.user };
    lastVerifiedAt = Date.now();
    try {
      localStorage.setItem('recomp.lastVerified', String(lastVerifiedAt));
      localStorage.setItem('recomp.lastUser', r.data.user.id);
      localStorage.setItem(nsKey(r.data.user.id, 'user'), JSON.stringify(r.data.user));
    } catch (e) {}
    return { ok: true, user: r.data.user };
  }

  async function login(email, password) {
    const r = await api('/api/auth/login', { method: 'POST', body: { email, password } });
    if (r.status !== 200) return { ok: false, error: r.data.error || 'Sign-in failed.',
                                   accountStatus: r.data.accountStatus, code: r.data.code || null };
    /* Two-step verification: no session exists yet, only a short-lived pending login. */
    if (r.data.mfaRequired) return { ok: true, mfaRequired: true, methods: r.data.methods || ['totp', 'recovery'] };
    return establish(r.data.user);
  }
  async function mfaVerify(body) {
    const r = await api('/api/auth/mfa/verify', { method: 'POST', body });
    if (r.status !== 200) return { ok: false, error: r.data.error || 'That code did not work.', code: r.data.code || null, expired: r.status === 401 };
    return establish(r.data.user);
  }
  /* Passkey sign-in (WebAuthn). Resolves like login(); a cancelled prompt resolves { ok:false, cancelled:true }. */
  async function passkeyLogin(email) {
    if (!passkeysAvailable()) return { ok: false, error: 'Passkeys are not available in this browser.' };
    const b = await api('/api/auth/passkey/login/begin', { method: 'POST', body: email ? { email } : {} });
    if (b.status !== 200) return { ok: false, error: b.data.error || 'Passkey sign-in is not available.' };
    let cred;
    try { cred = await navigator.credentials.get({ publicKey: decodeRequest(b.data.options || b.data) }); }
    catch (e) { return { ok: false, cancelled: true, error: 'The passkey prompt was closed.' }; }
    const r = await api('/api/auth/passkey/login/finish', { method: 'POST', body: { challengeId: b.data.challengeId, credential: encodeAssertion(cred) } });
    if (r.status !== 200) return { ok: false, error: r.data.error || 'That passkey was not accepted.' };
    if (r.data.mfaRequired) return { ok: true, mfaRequired: true, methods: r.data.methods };
    return establish(r.data.user);
  }
  async function passkeyRegister(label) {
    if (!passkeysAvailable()) return { ok: false, error: 'Passkeys are not available in this browser.' };
    const b = await api('/api/auth/passkey/register/begin', { method: 'POST', body: {} });
    if (b.status !== 200) return { ok: false, error: b.data.error || 'Could not start passkey set-up.', code: b.data.code || null };
    let cred;
    try { cred = await navigator.credentials.create({ publicKey: decodeCreation(b.data.options || b.data) }); }
    catch (e) { return { ok: false, cancelled: true, error: 'The passkey prompt was closed.' }; }
    const r = await api('/api/auth/passkey/register/finish', { method: 'POST', body: { challengeId: b.data.challengeId, label: label || '', credential: encodeAttestation(cred) } });
    return shape(r, 'That passkey could not be saved.');
  }
  function passkeysAvailable() { return typeof window !== 'undefined' && !!window.PublicKeyCredential && !!(navigator.credentials && navigator.credentials.create); }
  const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64u = s => { const t = String(s).replace(/-/g, '+').replace(/_/g, '/'); const bin = atob(t + '==='.slice((t.length + 3) % 4)); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out.buffer; };
  function decodeRequest(o) {
    return Object.assign({}, o, { challenge: unb64u(o.challenge), allowCredentials: (o.allowCredentials || []).map(c => Object.assign({}, c, { id: unb64u(c.id) })) });
  }
  function decodeCreation(o) {
    return Object.assign({}, o, { challenge: unb64u(o.challenge), user: Object.assign({}, o.user, { id: unb64u(o.user.id) }),
      excludeCredentials: (o.excludeCredentials || []).map(c => Object.assign({}, c, { id: unb64u(c.id) })) });
  }
  function encodeAssertion(c) {
    return { id: c.id, rawId: b64u(c.rawId), type: c.type, response: { clientDataJSON: b64u(c.response.clientDataJSON), authenticatorData: b64u(c.response.authenticatorData),
      signature: b64u(c.response.signature), userHandle: c.response.userHandle ? b64u(c.response.userHandle) : null } };
  }
  function encodeAttestation(c) {
    return { id: c.id, rawId: b64u(c.rawId), type: c.type, response: { clientDataJSON: b64u(c.response.clientDataJSON), attestationObject: b64u(c.response.attestationObject),
      transports: c.response.getTransports ? c.response.getTransports() : [] } };
  }
  async function establish(u) {
    const previous = localStorage.getItem('recomp.lastUser');
    if (previous && previous !== u.id) {
      // A different account on this device: clear the old one's cache first.
      wipeAccount(previous);
      await wipeCaches();
    }
    if (isPendingUser(u)) {
      session = null; pendingUser = u;
      return { ok: true, user: u, pending: true };
    }
    pendingUser = null;
    session = { user: u };
    lastVerifiedAt = Date.now();
    try {
      localStorage.setItem('recomp.lastVerified', String(lastVerifiedAt));
      localStorage.setItem('recomp.lastUser', u.id);
      localStorage.setItem(nsKey(u.id, 'user'), JSON.stringify(u));
    } catch (e) {}
    return { ok: true, user: u };
  }
  /* Re-read the signed-in user (after MFA, consent or settings changes). */
  async function refreshUser() {
    const r = await api('/api/auth/me');
    if (r.status !== 200 || !r.data.user) return { ok: false, status: r.status, code: r.data.code || null };
    if (session) { session.user = r.data.user; try { localStorage.setItem(nsKey(r.data.user.id, 'user'), JSON.stringify(r.data.user)); } catch (e) {} }
    return { ok: true, user: r.data.user };
  }
  /* Any other JSON call: resolves { ok, status, data, error, code }, never throws for HTTP errors. */
  async function call(method, path, body, fallback) {
    return shape(await api(path, { method, body }), fallback || 'That did not work. Try again.');
  }

  async function logout() {
    const uid = session && session.user ? session.user.id
      : pendingUser ? pendingUser.id : localStorage.getItem('recomp.lastUser');
    try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) {}
    if (uid) wipeAccount(uid);
    try {
      localStorage.removeItem('recomp.lastVerified');
      localStorage.removeItem('recomp.lastUser');
    } catch (e) {}
    await wipeCaches();
    session = null; pendingUser = null;
    return { ok: true };
  }

  async function changePassword(current, next) {
    const r = await api('/api/auth/password', { method: 'POST', body: { current, next } });
    if (r.status !== 200) return { ok: false, error: r.data.error || 'Could not change the password.' };
    if (session && session.user) {
      session.user.mustChangePassword = false;
      try { localStorage.setItem(nsKey(session.user.id, 'user'), JSON.stringify(session.user)); } catch (e) {}
    }
    return { ok: true };
  }

  /* ---- state sync -------------------------------------------------------- */
  async function pullState() {
    const r = await api('/api/state');
    if (r.status === 403 && r.data.code === 'pending') {
      return { ok: false, pending: true, accountState: r.data.accountState, error: r.data.error };
    }
    if (r.status === 403) return { ok: false, forbidden: true, error: r.data.error };
    if (r.status !== 200) return { ok: false, error: r.data.error || 'Could not load your data.' };
    return { ok: true, doc: r.data.doc, version: r.data.version };
  }
  async function pushState(doc, ifVersion) {
    const r = await api('/api/state', { method: 'PUT', body: { doc, ifVersion } });
    if (r.status === 409) return { ok: false, conflict: true, version: r.data.version };
    if (r.status !== 200) return { ok: false, error: r.data.error || 'Could not save.' };
    return { ok: true, version: r.data.version };
  }

  /* ---- sign-up, verification, reset, account status ---------------------
     Every method resolves to { ok, status, data, error, code } and never
     throws for an HTTP error. A network failure still rejects, so the caller
     can tell "the server said no" from "the server could not be reached". */
  function shape(r, fallback) {
    return { ok: r.ok, status: r.status, data: r.data,
             error: r.ok ? null : (r.data.error || fallback), code: r.data.code || null };
  }
  async function signup(f) {
    const r = await api('/api/auth/signup', { method: 'POST', body: {
      name: f.name, email: f.email, password: f.password, website: f.website || '',
      privacyNoticeVersion: f.privacyNoticeVersion || '', healthConsent: f.healthConsent === true } });
    return shape(r, 'Could not create your account.');
  }
  async function verify(token) {
    return shape(await api('/api/auth/verify', { method: 'POST', body: { token } }),
      'This confirmation link is invalid or has expired.');
  }
  async function resendVerification() {
    return shape(await api('/api/auth/resend-verification', { method: 'POST' }),
      'Could not send another email.');
  }
  async function accountStatus() {
    const r = await api('/api/auth/account-status');
    const out = shape(r, 'Could not check your account.');
    out.signedOut = r.status === 401;
    out.accountStatus = r.data.accountStatus || null;
    return out;
  }
  async function forgot(email) {
    return shape(await api('/api/auth/forgot', { method: 'POST', body: { email } }),
      'Could not send the reset email.');
  }
  async function reset(token, password) {
    return shape(await api('/api/auth/reset', { method: 'POST', body: { token, password } }),
      'Could not reset the password.');
  }

  /* ---- administrator: sign-up requests, decisions, private notes ---------- */
  async function adminRequests(status) {
    const q = status && status !== 'all' ? '?status=' + encodeURIComponent(status) : '?status=all';
    return shape(await api('/api/admin/requests' + q), 'Could not load requests.');
  }
  async function adminDecision(requestId, body) {
    return shape(await api('/api/admin/requests/' + encodeURIComponent(requestId) + '/decision',
      { method: 'POST', body }), 'Could not save the decision.');
  }
  async function adminVerifyEmail(requestId) {
    return shape(await api('/api/admin/requests/' + encodeURIComponent(requestId) + '/verify-email',
      { method: 'POST', body: {} }), 'Could not verify the email address.');
  }
  async function adminNoteGet(userId) {
    return shape(await api('/api/admin/users/' + encodeURIComponent(userId) + '/note'),
      'Could not load the note.');
  }
  async function adminNotePut(userId, note) {
    return shape(await api('/api/admin/users/' + encodeURIComponent(userId) + '/note',
      { method: 'PUT', body: { note } }), 'Could not save the note.');
  }
  async function adminUpdateUser(userId, patch) {
    return shape(await api('/api/admin/users/' + encodeURIComponent(userId),
      { method: 'PATCH', body: patch }), 'Could not update the account.');
  }

  function user() { return session ? session.user : null; }
  function pending() { return pendingUser; }
  function isOffline() { return offline; }
  function can(feature) {
    const u = user();
    return !!(u && u.permissions && u.permissions[feature]);
  }
  function localKey(name) {
    const u = user();
    return u ? nsKey(u.id, name) : `recomp.anon.${name}`;
  }

  return { api, call, refreshUser, mfaVerify, passkeyLogin, passkeyRegister, passkeysAvailable, refresh, setup, login, logout, changePassword, pullState, pushState,
           signup, verify, resendVerification, accountStatus, forgot, reset,
           adminRequests, adminDecision, adminVerifyEmail, adminNoteGet, adminNotePut, adminUpdateUser,
           user, pending, can, isOffline, localKey, wipeAccount, wipeAllAccounts, wipeCaches,
           OFFLINE_GRACE_MS };
})();

if (typeof window !== 'undefined') window.AUTH = AUTH;
if (typeof module !== 'undefined' && module.exports) module.exports = { AUTH };
