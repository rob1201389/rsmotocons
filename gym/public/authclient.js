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
    try {
      const prefix = `recomp.u.${userId}.`;
      Object.keys(localStorage).filter(k => k.startsWith(prefix)).forEach(k => localStorage.removeItem(k));
    } catch (e) {}
    try { indexedDB.deleteDatabase('recompDB.' + userId); } catch (e) {}
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
      if (r.status === 200 && r.data.authenticated) {
        session = { user: r.data.user };
        lastVerifiedAt = Date.now();
        try { localStorage.setItem('recomp.lastVerified', String(lastVerifiedAt)); } catch (e) {}
        try { localStorage.setItem('recomp.lastUser', r.data.user.id); } catch (e) {}
        return { state: 'authenticated', user: r.data.user };
      }
      session = null;
      return { state: 'anonymous', reason: r.data.reason };
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

  async function login(email, password) {
    const r = await api('/api/auth/login', { method: 'POST', body: { email, password } });
    if (r.status !== 200) return { ok: false, error: r.data.error || 'Sign-in failed.',
                                   accountStatus: r.data.accountStatus };
    const previous = localStorage.getItem('recomp.lastUser');
    if (previous && previous !== r.data.user.id) {
      // A different account on this device: clear the old one's cache first.
      wipeAccount(previous);
      await wipeCaches();
    }
    session = { user: r.data.user };
    lastVerifiedAt = Date.now();
    try {
      localStorage.setItem('recomp.lastVerified', String(lastVerifiedAt));
      localStorage.setItem('recomp.lastUser', r.data.user.id);
      localStorage.setItem(nsKey(r.data.user.id, 'user'), JSON.stringify(r.data.user));
    } catch (e) {}
    return { ok: true, user: r.data.user };
  }

  async function logout() {
    const uid = session && session.user ? session.user.id : localStorage.getItem('recomp.lastUser');
    try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) {}
    if (uid) wipeAccount(uid);
    try {
      localStorage.removeItem('recomp.lastVerified');
      localStorage.removeItem('recomp.lastUser');
    } catch (e) {}
    await wipeCaches();
    session = null;
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

  function user() { return session ? session.user : null; }
  function isOffline() { return offline; }
  function can(feature) {
    const u = user();
    return !!(u && u.permissions && u.permissions[feature]);
  }
  function localKey(name) {
    const u = user();
    return u ? nsKey(u.id, name) : `recomp.anon.${name}`;
  }

  return { api, refresh, login, logout, changePassword, pullState, pushState,
           user, can, isOffline, localKey, wipeAccount, wipeAllAccounts, wipeCaches,
           OFFLINE_GRACE_MS };
})();

if (typeof window !== 'undefined') window.AUTH = AUTH;
if (typeof module !== 'undefined' && module.exports) module.exports = { AUTH };
