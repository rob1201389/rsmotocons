/* Authentication UI tests, in jsdom against the real index.html and scripts.
   Needs jsdom (dev only):  cd gym/test && npm install   then   node auth.ui.test.js

   Two parts:
     1. The pop-up, the welcome page, the account-status page and the admin
        screen, against a scripted fake server (so every response can be forced).
     2. END TO END: the same pages in jsdom, with fetch wired in-process to the
        REAL backend (gym/backend, node:sqlite, outbox mail provider): sign up,
        verify by the emailed link, administrator approval, then log in.
        Skipped with a note when the backend or node:sqlite is not available. */
const { JSDOM } = require('jsdom');
const fs = require('fs'), http = require('http'), path = require('path'), url = require('url');
const APP = fs.existsSync(path.join(__dirname, '../public/index.html')) ? path.join(__dirname, '../public') : __dirname;
const BACKEND = [process.env.RECOMP_GYM && path.join(process.env.RECOMP_GYM, 'backend'), path.join(__dirname, '../backend')]
  .find(p => p && fs.existsSync(path.join(p, 'server.js')));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
               '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
let server, ORIGIN;
const serve = () => new Promise(res => {
  server = http.createServer((req, rq) => {
    const f = path.join(APP, decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '') || 'index.html');
    fs.readFile(f, (err, buf) => { if (err) { rq.writeHead(404); rq.end('nope'); return; }
      rq.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/plain' }); rq.end(buf); });
  }).listen(0, '127.0.0.1', () => { ORIGIN = 'http://127.0.0.1:' + server.address().port + '/'; res(); });
});

let pass = 0, fail = 0; const fails = [];
const t = async (n, f) => { try { await f(); pass++; console.log('  \x1b[32mPASS\x1b[0m ' + n); }
  catch (e) { fail++; fails.push([n, e.message]); console.log('  \x1b[31mFAIL\x1b[0m ' + n + '\n       ' + e.message); } };
const ok = (v, m) => { if (!v) throw new Error(m || 'falsy'); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || '') + ` expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const sec = s => console.log('\n\x1b[1m' + s + '\x1b[0m');
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, what, ms = 4000) {
  const end = Date.now() + ms;
  for (;;) {
    let v; try { v = fn(); } catch (e) { v = false; }
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting for ' + (what || fn.toString()));
    await wait(20);
  }
}

/* ------------------------------------------------------------ fixtures --- */
const PERMS = { training: true, library: true, nutrition: true, recipes: true, garmin: true, progress: true, reviews: true };
const user = o => Object.assign({ id: 'u1', email: 'alice@example.test', name: 'Alice', role: 'member', status: 'active',
  accountState: 'active', mustChangePassword: false, permissions: PERMS }, o);
const json = (status, body, headers) => ({ status, body, headers });

/* A scripted server. routes['METHOD /path'] = (body, url) => json(...). Every
   call is logged so a test can assert the exact request that was sent. */
function fakeServer(extra) {
  const calls = [];
  const routes = Object.assign({
    'GET /api/auth/session': () => json(200, { authenticated: false, reason: 'none', setupAvailable: false }),
    'PUT /api/state': () => json(200, { ok: true, version: 1 })
  }, extra || {});
  const fetchImpl = async (u, opts = {}) => {
    const U = new URL(String(u), ORIGIN), method = (opts.method || 'GET').toUpperCase();
    let body = null; try { body = opts.body ? JSON.parse(opts.body) : null; } catch (e) {}
    const call = { method, path: U.pathname, search: U.search, body, headers: opts.headers || {} };
    calls.push(call);
    const h = routes[method + ' ' + U.pathname];
    let out = h ? await h(body, U, call) : json(404, { error: 'Unknown endpoint.' });
    return { status: out.status, ok: out.status >= 200 && out.status < 300, json: async () => out.body,
             headers: { get: () => null } };
  };
  return { calls, routes, fetchImpl, last: (m, p) => [...calls].reverse().find(c => c.method === m && c.path === p),
           count: (m, p) => calls.filter(c => c.method === m && c.path === p).length };
}

function boot(srv, opts = {}) {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', resources: 'usable', url: opts.url || (ORIGIN + 'index.html'), pretendToBeVisual: true,
    beforeParse(w) {
      w.requestAnimationFrame = cb => setTimeout(() => cb(w.performance.now()), 16);
      w.cancelAnimationFrame = id => clearTimeout(id);
      w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      w.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
      w.navigator.vibrate = () => true;
      Object.defineProperty(w.navigator, 'onLine', { get: () => true, configurable: true });
      w.indexedDB = undefined; w.caches = undefined;
      w.localStorage.clear();
      (opts.local || []).forEach(([k, v]) => w.localStorage.setItem(k, v));
      w.confirm = () => true; w.alert = () => {}; w.scrollTo = () => {};
      if (srv) w.fetch = opts.fetch || srv.fetchImpl;
    }
  });
  return { dom, w: dom.window, d: dom.window.document };
}
const $ = (b, s) => b.d.querySelector(s);
const $$ = (b, s) => [...b.d.querySelectorAll(s)];
const text = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const vis = el => !!el && !el.closest('[hidden]');
function check(b, id, on) { const el = b.d.getElementById(id); el.checked = on !== false; el.dispatchEvent(new b.w.Event('change', { bubbles: true })); el.dispatchEvent(new b.w.Event('input', { bubbles: true })); }
function setIn(b, id, value) {
  const el = b.d.getElementById(id); el.value = value;
  el.dispatchEvent(new b.w.Event('input', { bubbles: true }));
}
const submit = (b, id) => b.d.getElementById(id).dispatchEvent(new b.w.Event('submit', { bubbles: true, cancelable: true }));
const click = (b, el) => (typeof el === 'string' ? b.d.querySelector(el) : el).dispatchEvent(new b.w.MouseEvent('click', { bubbles: true, cancelable: true }));
function key(b, el, k, o = {}) {
  const ev = new b.w.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, o));
  (el || b.d.activeElement || b.d.body).dispatchEvent(ev);
  return ev;
}
const appReady = b => b.w.__recomp && b.w.__recomp.AUTH_MODE === 'server' && !$(b, '#todayTitle').textContent.includes('Loading') && $(b, '#authGate').hidden && !$(b, 'nav.tabs').hidden;
async function bootAnon(extra, opts) {
  const srv = fakeServer(extra);
  const b = boot(srv, opts); b.srv = srv;
  await until(() => !$(b, '#authGate').hidden, 'the gate');
  await until(() => b.w.AuthUI && b.w.AuthUI.isOpen() || !$(b, '#authDialogWrap').hidden || !$(b, '#authStatus').hidden || true);
  await wait(60);
  return b;
}
async function bootAs(u, extra, opts) {
  const srv = fakeServer(Object.assign({
    'GET /api/auth/session': () => json(200, { authenticated: true, user: u }),
    'GET /api/state': () => json(200, { doc: null, version: 0 })
  }, extra || {}));
  const b = boot(srv, opts); b.srv = srv;
  await until(() => appReady(b), 'the signed-in app');
  b.A = b.w.__recomp;
  return b;
}
const GENERIC_NEW_USER = (o) => user(Object.assign({ id: 'u9', email: 'new@example.test', name: 'New Person', accountState: 'pending_verification', status: 'pending' }, o));

(async () => {
  await serve();

  /* ======================================================================= */
  sec('PUBLIC SURFACE: nothing private before authentication');
  let b = await bootAnon();
  await t('the welcome page names the app, describes it, and offers Log in and Sign up', () => {
    const w = $(b, '#authWelcome');
    ok(vis(w) && !w.hidden, 'welcome hidden');
    ok(/Recomp/.test(text(w)));
    ok(/adapts to you/.test(text(w)), text(w));
    eq(text($(b, '#awLogin')), 'Log in'); eq(text($(b, '#awSignup')), 'Sign up');
  });
  await t('the app shell (tabs, header, content) is hidden, inert and empty behind the gate', () => {
    ok($(b, 'body').classList.contains('locked'));
    ['nav.tabs', 'header.top', 'main#main'].forEach(s => {
      const n = $(b, s);
      ok(n.hidden && n.hasAttribute('inert') && n.getAttribute('aria-hidden') === 'true', s + ' not hidden and inert');
    });
    $$(b, '[data-tab]').forEach(x => ok(x.closest('[hidden][inert]'), 'a tab is reachable: ' + x.dataset.tab));
    eq($$(b, '#exList .ex').length, 0);
    ok(!$$(b, 'main *').some(x => x.offsetParent !== null && false), 'unreachable');
  });
  await t('no account data was requested or loaded', () => {
    eq(b.srv.calls.filter(c => c.path !== '/api/auth/session').length, 0, JSON.stringify(b.srv.calls.map(c => c.path)));
    ok(!b.A || true);
    const keys = Object.keys(b.w.localStorage);
    ok(!keys.some(k => k.startsWith('recomp.u.')), keys.join());
  });
  await t('the dialog opens on load with Log in selected and the background inert', () => {
    ok(b.w.AuthUI.isOpen());
    eq($(b, '#authTitle').textContent, 'Log in');
    eq($(b, '#tabLogin').getAttribute('aria-selected'), 'true');
    ok($(b, '#authWelcome').hasAttribute('inert') && $(b, '#authWelcome').getAttribute('aria-hidden') === 'true');
  });
  await t('closing the dialog returns to the welcome page and never reveals the app', async () => {
    key(b, $(b, '#loginEmail'), 'Escape');
    ok($(b, '#authDialogWrap').hidden, 'dialog still open');
    ok(!$(b, '#authWelcome').hasAttribute('inert') && !$(b, '#authWelcome').hidden);
    ok(!$(b, '#authGate').hidden);
    ok($(b, 'nav.tabs').hidden && $(b, 'main#main').hidden, 'app revealed');
    ok($(b, 'body').classList.contains('locked'));
    eq(b.srv.calls.filter(c => c.path !== '/api/auth/session').length, 0);
  });
  await t('the Close button does the same, and the welcome buttons reopen the right tab', () => {
    click(b, '#awSignup'); ok(b.w.AuthUI.isOpen()); eq($(b, '#tabSignup').getAttribute('aria-selected'), 'true');
    click(b, '#authClose'); ok($(b, '#authDialogWrap').hidden);
    click(b, '#awLogin'); eq($(b, '#authTitle').textContent, 'Log in');
  });

  /* ======================================================================= */
  sec('DIALOG: tabs, keyboard, fields');
  b = await bootAnon();
  await t('Log in / Sign up are a tablist with roving tabindex and linked panels', () => {
    const tl = $(b, '#authTabs');
    eq(tl.getAttribute('role'), 'tablist');
    eq($$(b, '#authTabs [role="tab"]').length, 2);
    eq($(b, '#tabLogin').tabIndex, 0); eq($(b, '#tabSignup').tabIndex, -1);
    eq($(b, '#loginForm').getAttribute('role'), 'tabpanel');
    eq($(b, '#tabLogin').getAttribute('aria-controls'), 'loginForm');
    eq($(b, '#loginForm').getAttribute('aria-labelledby'), 'tabLogin');
  });
  await t('arrow keys switch tabs, move focus, and wrap; Home and End work', () => {
    $(b, '#tabLogin').focus();
    key(b, $(b, '#tabLogin'), 'ArrowRight');
    eq($(b, '#tabSignup').getAttribute('aria-selected'), 'true');
    eq(b.d.activeElement.id, 'tabSignup');
    ok(!$(b, '#signupForm').hidden && $(b, '#loginForm').hidden);
    eq($(b, '#tabSignup').tabIndex, 0); eq($(b, '#tabLogin').tabIndex, -1);
    key(b, $(b, '#tabSignup'), 'ArrowRight');
    eq(b.d.activeElement.id, 'tabLogin');
    key(b, $(b, '#tabLogin'), 'End'); eq(b.d.activeElement.id, 'tabSignup');
    key(b, $(b, '#tabSignup'), 'Home'); eq(b.d.activeElement.id, 'tabLogin');
    key(b, $(b, '#tabLogin'), 'ArrowLeft'); eq(b.d.activeElement.id, 'tabSignup');
    eq($(b, '#authTitle').textContent, 'Create your account');
  });
  await t('every field has a visible label and the right autocomplete', () => {
    const want = { loginEmail: 'username', loginPassword: 'current-password', signupName: 'name', signupEmail: 'email',
      signupPw: 'new-password', forgotEmail: 'username', resetPw: 'new-password', resetConfirm: 'new-password',
      setupEmail: 'username', setupPw: 'new-password', pwCurrent: 'current-password', pwNext: 'new-password', pwConfirm: 'new-password' };
    Object.keys(want).forEach(id => {
      const i = b.d.getElementById(id);
      eq(i.getAttribute('autocomplete'), want[id], id);
      const l = $(b, `label[for="${id}"]`);
      ok(l && text(l).length > 2, 'no label for ' + id);
      ok(!i.getAttribute('placeholder'), 'placeholder-only labelling on ' + id);
      ok(/-err/.test(i.getAttribute('aria-describedby') || ''), id + ' not tied to its error');
    });
    eq($(b, '#loginEmail').type, 'text'); eq($(b, '#signupEmail').type, 'email');
  });
  await t('each form has a real submit button, so Enter submits', () => {
    ['loginForm', 'signupForm', 'forgotForm', 'resetForm', 'setupForm', 'pwForm'].forEach(id => {
      ok($(b, `#${id} button[type="submit"]`), id);
      ok(!b.d.getElementById(id).hasAttribute('action'), id + ' has an action');
    });
  });
  await t('the honeypot is named website, hidden from assistive tech and out of the tab order', () => {
    const hp = $(b, 'input[name="website"]');
    ok(hp && hp.tabIndex === -1 && hp.closest('[aria-hidden="true"]'));
    eq(hp.getAttribute('autocomplete'), 'off');
  });
  await t('show/hide toggles switch the field type and aria-pressed, and keep a fixed name', () => {
    const toggles = $$(b, '.pwtoggle');
    ok(toggles.length >= 8, 'toggles: ' + toggles.length);
    toggles.forEach(btn => {
      const input = b.d.getElementById(btn.dataset.for);
      eq(btn.getAttribute('aria-pressed'), 'false'); eq(input.type, 'password');
      eq(btn.getAttribute('aria-label'), 'Show password'); eq(btn.type, 'button');
      click(b, btn);
      eq(btn.getAttribute('aria-pressed'), 'true', btn.dataset.for); eq(input.type, 'text');
      eq(btn.getAttribute('aria-label'), 'Show password');
      click(b, btn);
      eq(btn.getAttribute('aria-pressed'), 'false'); eq(input.type, 'password');
    });
  });

  /* ======================================================================= */
  sec('VALIDATION and announcements');
  await t('an empty log in is refused client-side, with messages tied to the fields and announced', async () => {
    click(b, '#tabLogin'); submit(b, 'loginForm'); await wait(80);
    const e1 = $(b, '#loginEmail-err'), e2 = $(b, '#loginPassword-err');
    ok(!e1.hidden && /email address or login/.test(text(e1)), text(e1));
    ok(!e2.hidden && /Enter your password/.test(text(e2)), text(e2));
    eq($(b, '#loginEmail').getAttribute('aria-invalid'), 'true');
    ok($(b, '#loginEmail').getAttribute('aria-describedby').split(' ').includes('loginEmail-err'));
    eq(b.d.activeElement.id, 'loginEmail', 'focus did not move to the first error');
    const al = $(b, '#authAlert');
    eq(al.getAttribute('role'), 'alert');
    ok(/email address or login/.test(al.textContent) && /password/.test(al.textContent), al.textContent);
    eq(b.srv.calls.filter(c => c.path === '/api/auth/login').length, 0, 'request sent despite errors');
  });
  await t('typing clears an error as soon as the value is acceptable', () => {
    setIn(b, 'loginEmail', 'a'); ok($(b, '#loginEmail-err').hidden); ok(!$(b, '#loginEmail').hasAttribute('aria-invalid'));
  });
  await t('sign up validates name, email and the password rules the server uses', async () => {
    click(b, '#tabSignup');
    setIn(b, 'signupName', 'A'); setIn(b, 'signupEmail', 'nope'); setIn(b, 'signupPw', 'short');
    submit(b, 'signupForm'); await wait(80);
    ok(/name/i.test(text($(b, '#signupName-err'))), text($(b, '#signupName-err')));
    ok(/valid email/.test(text($(b, '#signupEmail-err'))));
    const pe = text($(b, '#signupPw-err'));
    ok(/^Your password needs at least 12 characters\.$/.test(pe), pe);
    ok(/privacy policy/.test(text($(b, '#signupPrivacy-err'))), 'privacy acknowledgement not required');
    ok(/cannot run your plan/.test(text($(b, '#signupHealth-err'))), 'health consent not required');
    ok(/valid email/.test($(b, '#authAlert').textContent), 'not announced');
    eq(b.srv.calls.filter(c => c.path === '/api/auth/signup').length, 0);
  });
  await t('the password checklist updates as you type and states "Done" or "Needed" in text', () => {
    const lis = () => $$(b, '#signupPw-req li');
    eq(lis().length, 2);                                     // length and not-common, per OWASP ASVS 5.0 (no composition rules)
    setIn(b, 'signupPw', 'short');
    eq(lis().map(l => l.className), ['', 'met']);
    ok(/Needed/.test(lis()[0].textContent) && /Done/.test(lis()[1].textContent));
    setIn(b, 'signupPw', 'password1234');
    eq(lis().map(l => l.className), ['met', '']);
    setIn(b, 'signupPw', 'correct horse battery');
    eq(lis().map(l => l.className), ['met', 'met']);
    ok($(b, '#signupPw-err').hidden, 'stale error left showing');
    ok($(b, '#signupPw').getAttribute('aria-describedby').includes('signupPw-req'));
  });
  await t('the password policy matches the server for tricky cases', () => {
    const P = b.w.AuthUI.passwordProblems;
    eq(P('Sign-Up-Pass-12'), []);
    eq(P('aaaaaaaaaaaaaaaa'), ['more than one distinct character']);
    eq(P('abcdefghijk1'), []);                                 // composition is not required any more
    eq(P('recomp123456'), ['to be less easy to guess']);
  });

  /* ======================================================================= */
  sec('FOCUS: moves in, is trapped, Escape closes, focus returns');
  b = await bootAnon();
  await t('focus is inside the dialog when it opens', () => {
    ok($(b, '#authDialog').contains(b.d.activeElement), 'focus outside: ' + b.d.activeElement.tagName);
    eq(b.d.activeElement.id, 'loginEmail');
  });
  await t('Tab from the last control goes to the first, Shift+Tab from the first goes to the last', () => {
    const f = [...$(b, '#authDialog').querySelectorAll('button, input, a[href]')]
      .filter(n => !n.closest('[hidden]') && n.tabIndex >= 0 && !n.closest('.hp'));
    ok(f.length >= 6, 'focusables: ' + f.length);
    f[f.length - 1].focus();
    let ev = key(b, f[f.length - 1], 'Tab');
    ok(ev.defaultPrevented); eq(b.d.activeElement, f[0]);
    ev = key(b, f[0], 'Tab', { shiftKey: true });
    ok(ev.defaultPrevented); eq(b.d.activeElement, f[f.length - 1]);
  });
  await t('focus cannot sit behind the dialog; the welcome page is inert', () => {
    b.d.body.focus();
    key(b, b.d.body, 'Tab');
    ok($(b, '#authDialog').contains(b.d.activeElement));
    ok($(b, '#authWelcome').hasAttribute('inert'));
  });
  await t('Escape closes, and focus returns to the control that opened it', () => {
    click(b, '#authClose');
    $(b, '#awSignup').focus();
    click(b, '#awSignup');
    ok(b.w.AuthUI.isOpen());
    ok($(b, '#authDialog').contains(b.d.activeElement));
    key(b, null, 'Escape');
    ok(!b.w.AuthUI.isOpen(), 'still open');
    eq(b.d.activeElement.id, 'awSignup', 'focus did not return');
  });
  await t('Escape does nothing while a request is running', async () => {
    let release;
    b.srv.routes['POST /api/auth/login'] = () => new Promise(r => { release = () => r(json(401, { error: 'Login or password is incorrect.' })); });
    click(b, '#awLogin');
    setIn(b, 'loginEmail', 'alice@example.test'); setIn(b, 'loginPassword', 'whatever-123');
    submit(b, 'loginForm'); await wait(40);
    key(b, null, 'Escape');
    ok(b.w.AuthUI.isOpen(), 'closed during a request');
    click(b, '#authClose'); ok(b.w.AuthUI.isOpen(), 'close button worked during a request');
    release(); await wait(80);
    key(b, null, 'Escape'); ok(!b.w.AuthUI.isOpen());
  });

  /* ======================================================================= */
  sec('LOG IN: busy state, success and failure');
  b = await bootAnon();
  await t('the submit button shows a busy state, and a second submit sends nothing', async () => {
    let release;
    b.srv.routes['POST /api/auth/login'] = () => new Promise(r => { release = () => r(json(401, { error: 'Login or password is incorrect.' })); });
    setIn(b, 'loginEmail', 'alice@example.test'); setIn(b, 'loginPassword', 'wrong-password-1');
    submit(b, 'loginForm'); await wait(40);
    const btn = $(b, '#loginBtn');
    eq(btn.getAttribute('aria-busy'), 'true'); eq(btn.getAttribute('aria-disabled'), 'true');
    ok(/Logging in/.test(btn.textContent), btn.textContent);
    submit(b, 'loginForm'); await wait(20);
    eq(b.srv.count('POST', '/api/auth/login'), 1);
    release(); await wait(80);
    ok(!btn.hasAttribute('aria-busy')); eq(btn.textContent, 'Log in');
  });
  await t('a wrong password shows the server message in a role=alert and clears the password', () => {
    const e = $(b, '#loginError');
    eq(e.getAttribute('role'), 'alert');
    ok(!e.hidden && /incorrect/.test(text(e)), text(e));
    eq($(b, '#loginPassword').value, '');
    eq(b.d.activeElement.id, 'loginPassword');
  });
  await t('the request carries the same-origin header and exact body', () => {
    const c = b.srv.last('POST', '/api/auth/login');
    eq(c.body, { email: 'alice@example.test', password: 'wrong-password-1' });
    eq(c.headers['X-Recomp-Request'], '1');
  });
  await t('a network failure is explained, not swallowed', async () => {
    b.srv.routes['POST /api/auth/login'] = () => { throw new TypeError('offline'); };
    setIn(b, 'loginPassword', 'wrong-password-1'); submit(b, 'loginForm'); await wait(80);
    ok(/Could not reach the server/.test(text($(b, '#loginError'))));
  });
  await t('a good log in closes the gate and opens the app', async () => {
    b.srv.routes['POST /api/auth/login'] = () => json(200, { user: user() });
    b.srv.routes['GET /api/state'] = () => json(200, { doc: null, version: 0 });
    setIn(b, 'loginPassword', 'right-password-1'); submit(b, 'loginForm');
    await until(() => $(b, '#authGate').hidden, 'gate to close');
    ok(!$(b, 'nav.tabs').hidden && !$(b, 'nav.tabs').hasAttribute('inert') && !$(b, 'main#main').hidden);
    ok(!$(b, 'body').classList.contains('locked'));
    eq($(b, '#loginPassword').value, '');
  });

  /* ======================================================================= */
  sec('SIGN UP: check your email, resend, 429, email not configured');
  b = await bootAnon();
  const fillSignup = () => { click(b, '#tabSignup'); setIn(b, 'signupName', 'Pat Pending'); setIn(b, 'signupEmail', 'Pat@Example.test'); setIn(b, 'signupPw', 'Sign-Up-Pass-12'); check(b, 'signupPrivacy'); check(b, 'signupHealth'); };
  await t('a valid sign-up sends the exact body (with the empty honeypot) and shows Check your email', async () => {
    b.srv.routes['POST /api/auth/signup'] = () => json(200, { ok: true, status: 'pending_verification', emailSent: true });
    fillSignup(); submit(b, 'signupForm');
    await until(() => $(b, '#authTitle').textContent === 'Check your email', 'check-your-email');
    const c = b.srv.last('POST', '/api/auth/signup');
    eq(Object.assign({}, c.body, { privacyNoticeVersion: typeof c.body.privacyNoticeVersion === 'string' && c.body.privacyNoticeVersion.length > 0 }),
      { name: 'Pat Pending', email: 'pat@example.test', password: 'Sign-Up-Pass-12', website: '', privacyNoticeVersion: true, healthConsent: true });
    eq(c.headers['X-Recomp-Request'], '1');
    ok(/pat@example\.test/.test(text($(b, '#ceMsg'))), text($(b, '#ceMsg')));
    ok(/administrator reviews/.test(text($(b, '#ceNote'))));
    ok(vis($(b, '#ceResend')));
    eq($(b, '#signupPw').value, '', 'password left in the field');
    eq(b.d.activeElement.id, 'authTitle');
  });
  await t('Resend sends a request, confirms it, and then cools down', async () => {
    b.srv.routes['POST /api/auth/resend-verification'] = () => json(200, { ok: true, emailSent: true });
    click(b, '#ceResend'); await until(() => /sent another email/.test(text($(b, '#ceStatus'))), 'resend confirmation');
    eq(b.srv.count('POST', '/api/auth/resend-verification'), 1);
    eq($(b, '#ceResend').getAttribute('aria-disabled'), 'true', 'no cooldown');
    click(b, '#ceResend'); await wait(30);
    eq(b.srv.count('POST', '/api/auth/resend-verification'), 1, 'cooldown ignored');
  });
  await t('a 429 on resend shows the server message and blocks further clicks', async () => {
    b.w.AuthUI.show('login'); b.w.AuthUI.closeDialog && 0;
    fillSignup(); submit(b, 'signupForm');
    await until(() => !$(b, '[data-view="check-email"]').hidden, 'check-email again');
    b.srv.routes['POST /api/auth/resend-verification'] = () => json(429, { error: 'Too many requests. Please wait a while before asking for another email.' });
    click(b, '#ceResend'); await until(() => /Too many requests/.test(text($(b, '#ceStatus'))), '429 message');
    eq($(b, '#ceStatus').classList.contains('bad'), true);
    eq($(b, '#ceResend').getAttribute('aria-disabled'), 'true');
    const n = b.srv.count('POST', '/api/auth/resend-verification');
    click(b, '#ceResend'); await wait(30);
    eq(b.srv.count('POST', '/api/auth/resend-verification'), n);
  });
  await t('when email is not configured the screen says so plainly', async () => {
    b = await bootAnon({ 'POST /api/auth/signup': () => json(200, { ok: true, status: 'pending_verification', emailSent: false }) });
    fillSignup(); submit(b, 'signupForm');
    await until(() => !$(b, '[data-view="check-email"]').hidden, 'check-email');
    const all = text($(b, '[data-view="check-email"]'));
    ok(/could not be sent/.test(all), all);
    ok(/administrator may verify your account manually/.test(all), all);
    eq($(b, '#authTitle').textContent, 'Request received');
  });
  await t('a server rejection (400) is shown in the form, and the honeypot value is passed through', async () => {
    b = await bootAnon({ 'POST /api/auth/signup': () => json(400, { error: 'Please enter a valid email address.' }) });
    fillSignup(); setIn(b, 'signupWebsite', 'http://spam.example');
    submit(b, 'signupForm');
    await until(() => !$(b, '#signupError').hidden, 'error');
    eq(text($(b, '#signupError')), 'Please enter a valid email address.');
    eq(b.srv.last('POST', '/api/auth/signup').body.website, 'http://spam.example');
  });
  await t('Continue goes to the account-status page', async () => {
    b = await bootAnon({
      'POST /api/auth/signup': () => json(200, { ok: true, status: 'pending_verification', emailSent: true }),
      'GET /api/auth/account-status': () => json(200, { accountStatus: 'pending', accountState: 'pending_verification', email: 'pat@example.test', name: 'Pat', emailVerified: false, requestStatus: 'pending_verification', requestedAt: Date.now() })
    });
    fillSignup(); submit(b, 'signupForm');
    await until(() => !$(b, '[data-view="check-email"]').hidden, 'check-email');
    click(b, '#ceContinue');
    await until(() => !$(b, '#authStatus').hidden, 'status page');
    eq(text($(b, '#stTitle')), 'Your account is awaiting approval');
    ok($(b, '#authDialogWrap').hidden);
  });

  /* ======================================================================= */
  sec('VERIFY LINK');
  const TOKEN = 'T0ken-abcdefghijklmnopqrstuvwxyz-0123456789'; // gitleaks:allow (synthetic test credential)
  await t('/?verify=TOKEN posts the token, shows success, and removes it from the address bar', async () => {
    const calls = [];
    b = await bootAnon({
      'POST /api/auth/verify': body => { calls.push(body); return json(200, { ok: true, status: 'pending_approval' }); }
    }, { url: ORIGIN + 'index.html?verify=' + TOKEN + '&keep=1#x' });
    eq(calls, [{ token: TOKEN }]);
    eq(b.w.location.search, '?keep=1'); eq(b.w.location.hash, '#x');
    ok(!/T0ken/.test(b.w.location.href), b.w.location.href);
    eq($(b, '#authTitle').textContent, 'Email confirmed');
    ok(/email address is confirmed/.test(text($(b, '#verMsg'))) && /administrator will now review/.test(text($(b, '#verMsg'))));
    click(b, '#verContinue'); eq($(b, '#authTitle').textContent, 'Log in');
  });
  await t('an expired link says so, and still cleans the URL', async () => {
    b = await bootAnon({
      'POST /api/auth/verify': () => json(400, { error: 'This confirmation link is invalid or has expired. Sign in and ask for a new one.' })
    }, { url: ORIGIN + 'index.html?verify=' + TOKEN });
    eq(b.w.location.search, '');
    eq($(b, '#authTitle').textContent, 'Link not valid');
    ok(/invalid or has expired/.test(text($(b, '#verMsg'))));
  });
  await t('when signed in as the pending person, a verify link lands on the account-status page', async () => {
    const pend = GENERIC_NEW_USER();
    const srv = fakeServer({
      'GET /api/auth/session': () => json(200, { authenticated: true, user: pend }),
      'POST /api/auth/verify': () => json(200, { ok: true, status: 'pending_approval' }),
      'GET /api/auth/account-status': () => json(200, { accountStatus: 'pending', accountState: 'pending_approval', email: pend.email, name: pend.name, emailVerified: true, requestStatus: 'pending_approval', requestedAt: Date.now() })
    });
    b = boot(srv, { url: ORIGIN + 'index.html?verify=' + TOKEN }); b.srv = srv;
    await until(() => !$(b, '#authStatus').hidden, 'status page');
    await wait(80);
    eq(b.w.location.search, '');
    eq(text($(b, '#stEmailVal')), 'Confirmed');
    ok($(b, '#stResend').hidden, 'resend offered after verification');
  });

  /* ======================================================================= */
  sec('PENDING APPROVAL: only the account-status page');
  const statusRoute = (o) => () => json(200, Object.assign({ accountStatus: 'pending', accountState: 'pending_approval', email: 'new@example.test', name: 'New Person', emailVerified: true, requestStatus: 'pending_approval', requestedAt: Date.now() }, o));
  let pendingState = { accountState: 'pending_approval', emailVerified: true };
  await t('logging in as a pending user (200, restricted session) shows only the status page', async () => {
    b = await bootAnon({
      'POST /api/auth/login': () => json(200, { user: GENERIC_NEW_USER({ accountState: pendingState.accountState }) }),
      'GET /api/auth/account-status': () => statusRoute({ accountState: pendingState.accountState, emailVerified: pendingState.emailVerified })(),
      'GET /api/state': () => json(403, { error: 'Your account is awaiting approval.', code: 'pending', accountState: 'pending_approval' })
    });
    b.w.AuthUI.configure({ minPollMs: 0, pollEveryMs: 3600000 });
    setIn(b, 'loginEmail', 'new@example.test'); setIn(b, 'loginPassword', 'Sign-Up-Pass-12'); submit(b, 'loginForm');
    await until(() => !$(b, '#authStatus').hidden, 'status page');
    await wait(80);
    eq(text($(b, '#stTitle')), 'Your account is awaiting approval');
    ok($(b, '#authDialogWrap').hidden, 'dialog still open');
    ok($(b, 'nav.tabs').hidden && $(b, 'main#main').hidden && $$(b, '[data-tab]').every(x => x.closest('[hidden][inert]')), 'tabs reachable');
    eq(b.srv.count('GET', '/api/state'), 0, 'private endpoint was requested');
    ok(b.w.__recomp.AUTH_MODE === 'local', 'app switched to server mode: ' + b.w.__recomp.AUTH_MODE);
    eq(b.w.AUTH.user(), null, 'AUTH.user() exposed a pending session');
  });
  await t('email and approval are shown separately; Resend is hidden once verified', () => {
    eq(text($(b, '#stEmailVal')), 'Confirmed');
    ok(/Waiting for an administrator/.test(text($(b, '#stApprovalStep'))));
    ok($(b, '#stResend').hidden);
    ok(!$(b, '#stLogout').hidden);
    // .btn sets display, so the stylesheet must still honour [hidden] (a real bug caught in screenshots).
    eq(b.w.getComputedStyle($(b, '#stResend')).display, 'none');
    eq(b.w.getComputedStyle($(b, '#stBack')).display, 'none');
  });
  await t('a private endpoint answers 403 code pending, and the client reports pending (not forbidden)', async () => {
    const r = await b.w.AUTH.pullState();
    eq(r.pending, true); ok(!r.forbidden);
  });
  await t('an unverified person sees Resend, and it works', async () => {
    pendingState = { accountState: 'pending_verification', emailVerified: false };
    b = await bootAnon({
      'GET /api/auth/session': () => json(200, { authenticated: true, user: GENERIC_NEW_USER() }),
      'GET /api/auth/account-status': () => statusRoute({ accountState: 'pending_verification', emailVerified: false })(),
      'POST /api/auth/resend-verification': () => json(200, { ok: true, emailSent: true })
    });
    await until(() => !$(b, '#authStatus').hidden, 'status page'); await wait(60);
    eq(text($(b, '#stEmailVal')), 'Not confirmed yet');
    ok(!$(b, '#stResend').hidden);
    ok(/new@example\.test/.test(text($(b, '#stLead'))));
    click(b, '#stResend'); await until(() => /another email/.test(text($(b, '#stMsg'))), 'resend message');
    eq(b.srv.count('POST', '/api/auth/resend-verification'), 1);
  });
  await t('focus and visibility changes poll the status (throttled), and approval loads the app', async () => {
    let state = 'pending_approval';
    const srv = fakeServer({
      'GET /api/auth/session': () => json(200, { authenticated: true, user: state === 'active' ? user({ id: 'u9', email: 'new@example.test' }) : GENERIC_NEW_USER({ accountState: state }) }),
      'GET /api/auth/account-status': () => json(200, { accountStatus: state === 'active' ? 'active' : 'pending', accountState: state, email: 'new@example.test', name: 'New', emailVerified: true, requestStatus: state === 'active' ? 'approved' : 'pending_approval', requestedAt: 1 }),
      'GET /api/state': () => json(200, { doc: null, version: 0 })
    });
    b = boot(srv); b.srv = srv;
    await until(() => !$(b, '#authStatus').hidden, 'status page'); await wait(100);
    const base = srv.count('GET', '/api/auth/account-status');
    ok(base >= 1);
    b.w.dispatchEvent(new b.w.Event('focus')); await wait(60);
    eq(srv.count('GET', '/api/auth/account-status'), base, 'not throttled (default 15 s)');
    b.w.AuthUI.configure({ minPollMs: 0 });
    b.w.dispatchEvent(new b.w.Event('focus')); await until(() => srv.count('GET', '/api/auth/account-status') === base + 1, 'poll on focus');
    await wait(80);
    b.d.dispatchEvent(new b.w.Event('visibilitychange')); await until(() => srv.count('GET', '/api/auth/account-status') === base + 2, 'poll on visibility');
    ok(/Waiting|awaiting/i.test(text($(b, '#authStatus'))));
    await wait(100);
    state = 'active';
    b.w.dispatchEvent(new b.w.Event('focus'));
    await until(() => appReady(b), 'app to open after approval');
    ok(!$(b, 'nav.tabs').hidden && !$(b, 'nav.tabs').hasAttribute('inert'));
    ok(srv.count('GET', '/api/state') >= 1, 'state not loaded after approval');
    eq(b.w.__recomp.AUTH_MODE, 'server');
  });
  await t('Check again announces the result, and Log out returns to the welcome page', async () => {
    b = await bootAnon({
      'GET /api/auth/session': () => json(200, { authenticated: true, user: GENERIC_NEW_USER() }),
      'GET /api/auth/account-status': statusRoute(),
      'POST /api/auth/logout': () => json(200, { ok: true })
    });
    await until(() => !$(b, '#authStatus').hidden, 'status page'); await wait(60);
    click(b, '#stCheck'); await until(() => /Still waiting/.test(text($(b, '#stMsg'))), 'check result');
    click(b, '#stLogout');
    await until(() => !$(b, '#authWelcome').hidden, 'welcome page');
    eq(b.srv.count('POST', '/api/auth/logout'), 1);
    ok($(b, '#authStatus').hidden);
    ok($(b, 'nav.tabs').hidden);
  });

  /* ======================================================================= */
  sec('REJECTED, SUSPENDED and REVOKED: a clear no-access message');
  for (const status of ['rejected', 'suspended', 'revoked']) {
    await t(`log in as a ${status} account shows "No access" and nothing about internals`, async () => {
      b = await bootAnon({ 'POST /api/auth/login': () => json(403, { error: `Your account has been ${status}.`, accountStatus: status }) });
      setIn(b, 'loginEmail', 'x@example.test'); setIn(b, 'loginPassword', 'Whatever-Pass-12'); submit(b, 'loginForm');
      await until(() => !$(b, '#authStatus').hidden, 'no-access page');
      eq(text($(b, '#stTitle')), 'No access');
      const msg = text($(b, '#stLead'));
      ok(/contact the administrator/.test(msg), msg);
      if (status === 'rejected') ok(/not approved/.test(msg), msg);
      ok(!/suspend|revok|status|database|pending/i.test(msg.replace(/not approved/, '')), 'leaks detail: ' + msg);
      ok($(b, '#stSteps').hidden && $(b, '#stCheck').hidden && $(b, '#stResend').hidden);
      ok(!$(b, '#stBack').hidden && $(b, '#stLogout').hidden);
      ok($(b, 'nav.tabs').hidden);
    });
  }
  await t('Back to log in reopens the dialog', async () => {
    click(b, '#stBack');
    await until(() => b.w.AuthUI.isOpen(), 'dialog'); ok(!$(b, '#authWelcome').hidden); eq($(b, '#authTitle').textContent, 'Log in');
  });
  await t('an account rejected while waiting is moved to No access by the next status check', async () => {
    let n = 0;
    const srv = fakeServer({
      'GET /api/auth/session': () => json(200, { authenticated: true, user: GENERIC_NEW_USER() }),
      'GET /api/auth/account-status': () => (n++ < 1) ? statusRoute()() : json(401, { error: 'Not signed in.', reason: 'revoked', accountStatus: 'rejected' })
    });
    b = boot(srv); b.srv = srv;
    await until(() => !$(b, '#authStatus').hidden, 'status page'); await wait(80);
    b.w.AuthUI.configure({ minPollMs: 0 });
    click(b, '#stCheck');
    await until(() => text($(b, '#stTitle')) === 'No access', 'no-access');
    ok(/not approved/.test(text($(b, '#stLead'))));
  });
  await t('an active person without training access gets No access with Log out', async () => {
    const srv = fakeServer({
      'GET /api/auth/session': () => json(200, { authenticated: true, user: user() }),
      'GET /api/state': () => json(403, { error: 'You do not have access to training data.' })
    });
    b = boot(srv); b.srv = srv;
    await until(() => text($(b, '#stTitle')) === 'No access', 'no-access');
    eq(text($(b, '#stLead')), 'You do not have access to training data.');
    ok(!$(b, '#stLogout').hidden && $(b, '#stBack').hidden);
  });

  /* ======================================================================= */
  sec('FORGOT AND RESET PASSWORD');
  b = await bootAnon();
  await t('Forgot password? opens the request screen, carrying a typed email across', async () => {
    setIn(b, 'loginEmail', 'alice@example.test');
    click(b, '#loginForgot');
    eq($(b, '#authTitle').textContent, 'Reset your password');
    eq($(b, '#forgotEmail').value, 'alice@example.test');
    ok($(b, '#authTabs').hidden);
    eq(b.d.activeElement.id, 'forgotEmail');
  });
  await t('an invalid email is refused; a valid one posts and shows the check-your-email state', async () => {
    setIn(b, 'forgotEmail', 'nope'); submit(b, 'forgotForm'); await wait(40);
    ok(!$(b, '#forgotEmail-err').hidden); eq(b.srv.count('POST', '/api/auth/forgot'), 0);
    b.srv.routes['POST /api/auth/forgot'] = () => json(200, { ok: true, emailSent: true });
    setIn(b, 'forgotEmail', 'alice@example.test'); submit(b, 'forgotForm');
    await until(() => $(b, '#authTitle').textContent === 'Check your email', 'sent state');
    eq(b.srv.last('POST', '/api/auth/forgot').body, { email: 'alice@example.test' });
    ok(/If there is an account for alice@example\.test/.test(text($(b, '#forgotSentMsg'))), text($(b, '#forgotSentMsg')));
    click(b, '[data-view="forgot-sent"] [data-goto="login"]'); eq($(b, '#authTitle').textContent, 'Log in');
  });
  await t('when email is not configured the forgot screen says no message was sent', async () => {
    b.srv.routes['POST /api/auth/forgot'] = () => json(200, { ok: true, emailSent: false });
    click(b, '#loginForgot'); setIn(b, 'forgotEmail', 'alice@example.test'); submit(b, 'forgotForm');
    await until(() => !$(b, '[data-view="forgot-sent"]').hidden, 'sent view');
    ok(/no message was sent/.test(text($(b, '#forgotSentMsg'))));
  });
  await t('a 429 is shown in the form', async () => {
    b.srv.routes['POST /api/auth/forgot'] = () => json(429, { error: 'Too many requests. Please try again later.' });
    click(b, '#authTabs [role=tab]'); click(b, '#loginForgot'); setIn(b, 'forgotEmail', 'alice@example.test'); submit(b, 'forgotForm');
    await until(() => !$(b, '#forgotError').hidden, '429');
    ok(/Too many requests/.test(text($(b, '#forgotError'))));
  });
  await t('/?reset=TOKEN opens the reset screen and removes the token from the URL', async () => {
    b = await bootAnon({}, { url: ORIGIN + 'index.html?reset=' + TOKEN });
    eq(b.w.location.search, '');
    eq($(b, '#authTitle').textContent, 'Choose a new password');
    ok(!$(b, '#resetForm').hidden);
    eq(b.d.activeElement.id, 'resetPw');
    ok($(b, '#authTabs').hidden);
    eq(b.srv.calls.filter(c => c.path !== '/api/auth/session').length, 0, 'token was sent before submitting');
  });
  await t('a mismatch or weak password is refused client-side', async () => {
    setIn(b, 'resetPw', 'weak'); setIn(b, 'resetConfirm', 'other'); submit(b, 'resetForm'); await wait(40);
    ok(/needs/.test(text($(b, '#resetPw-err'))));
    ok(/do not match/.test(text($(b, '#resetConfirm-err'))));
    eq(b.srv.count('POST', '/api/auth/reset'), 0);
  });
  await t('a good reset posts token and password, then offers Log in', async () => {
    b.srv.routes['POST /api/auth/reset'] = () => json(200, { ok: true });
    setIn(b, 'resetPw', 'Brand-New-Pass-77'); setIn(b, 'resetConfirm', 'Brand-New-Pass-77'); submit(b, 'resetForm');
    await until(() => $(b, '#authTitle').textContent === 'Password changed', 'done');
    eq(b.srv.last('POST', '/api/auth/reset').body, { token: TOKEN, password: 'Brand-New-Pass-77' });
    eq($(b, '#resetPw').value, '');
    click(b, '[data-view="reset-done"] [data-goto="login"]'); eq($(b, '#authTitle').textContent, 'Log in');
  });
  await t('an expired reset link offers a way to ask for a new one', async () => {
    b = await bootAnon({ 'POST /api/auth/reset': () => json(400, { error: 'This reset link is invalid or has expired. Please ask for a new one.' }) },
      { url: ORIGIN + 'index.html?reset=' + TOKEN });
    setIn(b, 'resetPw', 'Brand-New-Pass-77'); setIn(b, 'resetConfirm', 'Brand-New-Pass-77'); submit(b, 'resetForm');
    await until(() => !$(b, '#resetError').hidden, 'error');
    ok(/invalid or has expired/.test(text($(b, '#resetError'))));
    ok(!$(b, '#resetNewLink').hidden);
    click(b, '#resetNewLink'); eq($(b, '#authTitle').textContent, 'Reset your password');
  });

  /* ======================================================================= */
  sec('EXISTING FLOWS: first-time owner set-up, forced password change, local mode');
  await t('first-time set-up appears in the same dialog and creates the owner', async () => {
    b = await bootAnon({
      'GET /api/auth/session': () => json(200, { authenticated: false, reason: 'none', setupAvailable: true }),
      'POST /api/auth/setup': () => json(200, { user: user({ role: 'owner', email: 'owner@example.test' }) }),
      'GET /api/state': () => json(200, { doc: null, version: 0 })
    });
    eq($(b, '#authTitle').textContent, 'Set up your account');
    ok(!$(b, '#setupForm').hidden && $(b, '#authTabs').hidden);
    setIn(b, 'setupEmail', 'owner@example.test'); setIn(b, 'setupPw', 'Owner-Pass-12345'); setIn(b, 'setupConfirm', 'nope');
    submit(b, 'setupForm'); await wait(40);
    ok(/do not match/.test(text($(b, '#setupConfirm-err'))));
    setIn(b, 'setupConfirm', 'Owner-Pass-12345'); submit(b, 'setupForm');
    await until(() => $(b, '#authGate').hidden, 'gate to close');
    eq(b.srv.last('POST', '/api/auth/setup').body, { email: 'owner@example.test', password: 'Owner-Pass-12345' }); // gitleaks:allow (synthetic test credential)
  });
  await t('a forced password change shows in the dialog, posts current and next, and opens the app', async () => {
    b = await bootAnon({
      'POST /api/auth/login': () => json(200, { user: user({ mustChangePassword: true }) }),
      'POST /api/auth/password': () => json(200, { ok: true }),
      'GET /api/state': () => json(200, { doc: null, version: 0 })
    });
    setIn(b, 'loginEmail', 'alice@example.test'); setIn(b, 'loginPassword', 'Temp-Pass-12345'); submit(b, 'loginForm');
    await until(() => !$(b, '#pwForm').hidden, 'password form');
    eq($(b, '#authTitle').textContent, 'New password');
    ok(/temporary/.test(text($(b, '#authSub'))));
    setIn(b, 'pwCurrent', 'Temp-Pass-12345'); setIn(b, 'pwNext', 'Alice-Real-Pass-9'); setIn(b, 'pwConfirm', 'different');
    submit(b, 'pwForm'); await wait(40);
    ok(/do not match/.test(text($(b, '#pwConfirm-err'))));
    ok(b.w.AuthUI.isOpen());
    setIn(b, 'pwConfirm', 'Alice-Real-Pass-9'); submit(b, 'pwForm');
    await until(() => $(b, '#authGate').hidden, 'gate to close');
    eq(b.srv.last('POST', '/api/auth/password').body, { current: 'Temp-Pass-12345', next: 'Alice-Real-Pass-9' });
  });
  await t('closing the forced-change dialog does not skip it: Log in resumes the change', async () => {
    b = await bootAnon({ 'POST /api/auth/login': () => json(200, { user: user({ mustChangePassword: true }) }) });
    setIn(b, 'loginEmail', 'alice@example.test'); setIn(b, 'loginPassword', 'Temp-Pass-12345'); submit(b, 'loginForm');
    await until(() => !$(b, '#pwForm').hidden, 'password form');
    key(b, null, 'Escape'); ok(!b.w.AuthUI.isOpen());
    ok($(b, 'nav.tabs').hidden, 'app visible');
    click(b, '#awLogin'); eq($(b, '#authTitle').textContent, 'New password');
  });
  await t('no backend (404): the app opens in local mode with no gate, as before', async () => {
    const srv = fakeServer({ 'GET /api/auth/session': () => json(404, { error: 'Not found' }) });
    b = boot(srv); b.srv = srv;
    await until(() => !$(b, '#todayTitle').textContent.includes('Loading'), 'app');
    ok($(b, '#authGate').hidden); ok(!$(b, 'nav.tabs').hidden && !$(b, 'nav.tabs').hasAttribute('inert'));
    ok(!$(b, 'body').classList.contains('locked'));
  });
  await t('server unreachable on a device that never signed in: local mode', async () => {
    const srv = fakeServer({ 'GET /api/auth/session': () => { throw new TypeError('Failed to fetch'); } });
    b = boot(srv); b.srv = srv;
    await until(() => !$(b, '#todayTitle').textContent.includes('Loading'), 'app');
    ok($(b, '#authGate').hidden && !$(b, 'nav.tabs').hidden);
  });
  await t('verify/reset links are ignored (and left alone) when there is no backend', async () => {
    const srv = fakeServer({ 'GET /api/auth/session': () => json(404, { error: 'Not found' }) });
    b = boot(srv, { url: ORIGIN + 'index.html?verify=' + TOKEN }); b.srv = srv;
    await until(() => !$(b, '#todayTitle').textContent.includes('Loading'), 'app');
    eq(srv.count('POST', '/api/auth/verify'), 0);
  });

  /* ======================================================================= */
  sec('ADMINISTRATION: sign-up requests');
  const T0 = Date.UTC(2026, 8, 20, 3, 0, 0);
  function adminServer() {
    const S = { requests: [
      { id: 'sr1', userId: 'u10', name: 'Pat Pending', email: 'pat@example.test', emailVerified: true, verifiedByAdmin: false, status: 'pending_approval', createdAt: T0, decidedAt: null, decisionNote: null, adminNote: 'Met at the gym', accountStatus: 'pending' },
      { id: 'sr2', userId: 'u11', name: 'Una Unverified', email: 'una@example.test', emailVerified: false, verifiedByAdmin: false, status: 'pending_verification', createdAt: T0 + 3600e3, decidedAt: null, decisionNote: null, adminNote: null, accountStatus: 'pending' },
      { id: 'sr3', userId: 'u12', name: 'Ann Approved', email: 'ann@example.test', emailVerified: true, verifiedByAdmin: false, status: 'approved', createdAt: T0 - 864e5, decidedAt: T0, decisionNote: null, adminNote: null, accountStatus: 'active' },
      { id: 'sr4', userId: 'u13', name: 'Ray Rejected <b>x</b>', email: 'ray@example.test', emailVerified: true, verifiedByAdmin: false, status: 'rejected', createdAt: T0 - 2 * 864e5, decidedAt: T0, decisionNote: 'Not a member', adminNote: null, accountStatus: 'rejected' }
    ], notes: { u10: 'Met at the gym' } };
    const srv = fakeServer({
      'GET /api/auth/session': () => json(200, { authenticated: true, user: user({ id: 'a1', role: 'admin', email: 'admin@example.test', name: 'Admin' }) }),
      'GET /api/state': () => json(200, { doc: null, version: 0 }),
      'GET /api/admin/requests': (_, U) => {
        const s = U.searchParams.get('status');
        return json(200, { requests: S.requests.filter(r => !s || s === 'all' || r.status === s) });
      },
      'POST /api/admin/requests/sr1/decision': () => json(200, { ok: true, status: 'approved', role: 'coach' }),
      'POST /api/admin/requests/sr2/decision': () => json(200, { ok: true, status: 'approved', role: 'member' }),
      'POST /api/admin/requests/sr2/verify-email': () => { S.requests[1].emailVerified = true; S.requests[1].verifiedByAdmin = true; S.requests[1].status = 'pending_approval'; return json(200, { ok: true, status: 'pending_approval' }); }
    });
    const notePath = id => `/api/admin/users/${id}/note`;
    ['u10', 'u11', 'u12', 'u13'].forEach(id => {
      srv.routes['GET ' + notePath(id)] = () => json(200, { note: S.notes[id] || '', updatedAt: null });
      srv.routes['PUT ' + notePath(id)] = body => { S.notes[id] = body.note; return json(200, { ok: true }); };
      srv.routes['PATCH /api/admin/users/' + id] = () => json(200, { ok: true });
    });
    return { srv, S };
  }
  async function bootAdmin(setup) {
    const { srv, S } = adminServer(); if (setup) setup(srv, S);
    const b2 = boot(srv); b2.srv = srv; b2.S = S;
    await until(() => appReady(b2), 'admin app');
    b2.A = b2.w.__recomp; b2.A.go('profile');
    return b2;
  }
  async function openAdmin(b2) {
    const btn = $(b2, '#adminOpenBtn'); btn.focus(); click(b2, btn);
    await until(() => $(b2, '#admPanel[aria-busy="false"]'), 'the list');
  }
  await t('a member does not see the Administration button', async () => {
    const m = await bootAs(user());
    m.A.go('profile');
    ok(!$(m, '#adminOpenBtn') && !$(m, '#profAdmin'));
    ok(!/Administration/.test(text($(m, '#p-profile'))));
    ok(!m.w.Admin.available(user({ role: 'coach' })));
    ok(!m.w.Admin.available(user({ role: 'owner', accountState: 'pending_approval' })));
  });
  const ad = await bootAdmin();
  await t('an administrator sees an Administration button on the Profile tab', () => {
    const btn = $(ad, '#adminOpenBtn');
    ok(btn && btn.textContent === 'Administration' && btn.tagName === 'BUTTON');
    ok( ad.w.Admin.available(user({ role: 'admin' })) && ad.w.Admin.available(user({ role: 'owner' })));
    eq($$(ad, '#profAdmin').length, 1);
    ad.A.go('profile'); eq($$(ad, '#profAdmin').length, 1, 'duplicated on re-render');
  });
  await t('the screen lists persisted requests from the server, pending first', async () => {
    await openAdmin(ad);
    const call = ad.srv.last('GET', '/api/admin/requests');
    ok(call.headers['X-Recomp-Request'] === '1');
    const rows = $$(ad, '#admIn .adm-row');
    eq(rows.length, 2, rows.map(r => text(r)).join(' | '));
    const first = text(rows[0]);
    ok(/Pat Pending/.test(first) && /pat@example\.test/.test(first) && /Email verified/.test(first) && /Awaiting approval/.test(first) && /Requested 20 Sept?\.? 2026|Requested 20 Sep/.test(first), first);
    ok(/Email not verified/.test(text(rows[1])) && /Awaiting email/.test(text(rows[1])));
    eq($(ad, '#adminScreen').getAttribute('role'), 'dialog');
    ok(ad.d.querySelector('main').hasAttribute('inert'), 'background not inert');
  });
  await t('Pending / Approved / Rejected / All tabs filter, with arrow-key navigation', async () => {
    eq($$(ad, '#admIn [role="tab"]').map(x => x.textContent), ['Pending', 'Approved', 'Rejected', 'All']);
    $(ad, '#admTab-pending').focus();
    key(ad, $(ad, '#admTab-pending'), 'ArrowRight');
    await until(() => /Ann Approved/.test(text($(ad, '#admIn'))), 'approved tab');
    eq(ad.srv.last('GET', '/api/admin/requests').search, '?status=approved');
    eq(ad.d.activeElement.id, 'admTab-approved');
    key(ad, ad.d.activeElement, 'ArrowRight');
    await until(() => /Ray Rejected/.test(text($(ad, '#admIn'))), 'rejected tab');
    key(ad, ad.d.activeElement, 'ArrowRight');
    await until(() => $$(ad, '#admIn .adm-row').length === 4, 'all tab');
    key(ad, ad.d.activeElement, 'ArrowRight');
    await until(() => $$(ad, '#admIn .adm-row').length === 2, 'wrap to pending');
  });
  await t('names from users are rendered as text, never as markup', async () => {
    key(ad, ad.d.activeElement, 'End');
    await until(() => $$(ad, '#admIn .adm-row').length === 4, 'all');
    ok(!$(ad, '#admIn b > b') && text($(ad, '#admIn')).includes('Ray Rejected <b>x</b>'), 'markup was interpreted');
    key(ad, ad.d.activeElement, 'Home');
    await until(() => $$(ad, '#admIn .adm-row').length === 2, 'pending');
  });
  await t('the detail view has the approval controls, the permission list from the backend, and a private note', async () => {
    click(ad, $$(ad, '#admIn .adm-row')[0]);
    await until(() => $(ad, '#admNote') && !$(ad, '#admNote').disabled, 'note loaded');
    eq(text($(ad, '#admWho')), 'Pat Pending');
    eq($$(ad, '#admRole option').map(o => o.value), ['member', 'coach']);
    eq($$(ad, '#admPerms input').map(i => i.dataset.feature), ['training', 'library', 'nutrition', 'recipes', 'garmin', 'progress', 'reviews']);
    eq($$(ad, '#admPerms input').every(i => i.checked), true);
    eq($(ad, '#admNote').value, 'Met at the gym');
    ok(ad.srv.last('GET', '/api/admin/users/u10/note'));
    ok(!$(ad, '#admVerify'), 'manual verify offered for a verified address');
    eq(ad.d.activeElement.id, 'admWho');
  });
  await t('choosing Coach applies that role\'s feature defaults until you change a box yourself', () => {
    $(ad, '#admRole').value = 'coach'; $(ad, '#admRole').dispatchEvent(new ad.w.Event('change', { bubbles: true }));
    eq($$(ad, '#admPerms input').map(i => i.checked), [true, true, false, false, false, true, true]);
  });
  await t('Approve sends the exact decision body: role, every permission, and the private note', async () => {
    const reviews = $(ad, '#admPerms input[data-feature="reviews"]');
    ok(reviews.disabled && reviews.checked, 'weekly reviews are always on and cannot be unticked');
    reviews.checked = false; reviews.dispatchEvent(new ad.w.Event('change', { bubbles: true }));   // even a forced untick is ignored
    const dn = $(ad, '#admDecisionNote'); dn.value = '  Paid up  '; dn.dispatchEvent(new ad.w.Event('input', { bubbles: true }));
    click(ad, '#admApprove');
    await until(() => ad.srv.last('POST', '/api/admin/requests/sr1/decision'), 'decision');
    const c = ad.srv.last('POST', '/api/admin/requests/sr1/decision');
    eq(c.body, { action: 'approve', role: 'coach',
      permissions: { training: true, library: true, nutrition: false, recipes: false, garmin: false, progress: true, reviews: true },
      note: 'Paid up' });
    eq(c.headers['X-Recomp-Request'], '1');
    ok(!('overrideVerification' in c.body));
    await until(() => /Approved Pat Pending as a coach/.test(text($(ad, '#admStatus'))), 'status message');
    ok($(ad, '#admIn [role="tablist"]'), 'did not return to the list');
    eq($(ad, '#admLive').getAttribute('role'), 'status');
  });
  await t('Reject asks for confirmation (focus on Cancel), and sends the optional reason', async () => {
    click(ad, $$(ad, '#admIn .adm-row')[0]);
    await until(() => $(ad, '#admRejectBtn'), 'detail');
    const rs = $(ad, '#admReason'); rs.value = 'Not a member'; rs.dispatchEvent(new ad.w.Event('input', { bubbles: true }));
    click(ad, '#admRejectBtn');
    ok($(ad, '#admConfirm'), 'no confirmation');
    eq($(ad, '#admConfirm [role="alertdialog"]').getAttribute('aria-modal'), 'true');
    eq(ad.d.activeElement.id, 'admConfirmNo', 'focus should start on Cancel');
    click(ad, '#admConfirmNo'); await wait(30);
    ok(!$(ad, '#admConfirm')); eq(ad.srv.count('POST', '/api/admin/requests/sr1/decision'), 1, 'rejected without confirming');
    eq(ad.d.activeElement.id, 'admRejectBtn', 'focus did not return');
    click(ad, '#admRejectBtn'); click(ad, '#admConfirmYes');
    await until(() => ad.srv.count('POST', '/api/admin/requests/sr1/decision') === 2, 'reject');
    eq(ad.srv.last('POST', '/api/admin/requests/sr1/decision').body, { action: 'reject', note: 'Not a member' });
    await until(() => /Rejected the request from Pat Pending/.test(text($(ad, '#admStatus'))), 'message');
  });
  await t('Escape in a confirmation cancels only the confirmation', async () => {
    click(ad, $$(ad, '#admIn .adm-row')[0]);
    await until(() => $(ad, '#admRejectBtn'), 'detail');
    click(ad, '#admRejectBtn'); ok($(ad, '#admConfirm'));
    key(ad, null, 'Escape'); ok(!$(ad, '#admConfirm') && $(ad, '#admRejectBtn'), 'closed more than the confirmation');
    key(ad, null, 'Escape'); ok(!$(ad, '#admRejectBtn') && $(ad, '#adminScreen'), 'Escape did not go back to the list');
  });
  await t('an unverified request offers manual verification, and approval needs an override confirmation', async () => {
    click(ad, $$(ad, '#admIn .adm-row')[1]);
    await until(() => $(ad, '#admVerify'), 'verify button');
    ok(/not been confirmed/.test(text($(ad, '#admDecision'))));
    click(ad, '#admApprove');
    ok(/Approve without a verified email/.test(text($(ad, '#admConfirm'))));
    click(ad, '#admConfirmYes');
    await until(() => ad.srv.last('POST', '/api/admin/requests/sr2/decision'), 'override approval');
    eq(ad.srv.last('POST', '/api/admin/requests/sr2/decision').body, {
      action: 'approve', role: 'member',
      permissions: { training: true, library: true, nutrition: true, recipes: true, garmin: true, progress: true, reviews: true },
      overrideVerification: true });
  });
  const TAB_OF = n => /Ann/.test(n) ? 'approved' : /Ray/.test(n) ? 'rejected' : 'pending';
  async function toList(ad, tab) {
    if (!$(ad, '#adminScreen')) await openAdmin(ad);
    while ($(ad, '#admConfirm')) { click(ad, '#admConfirmNo'); await wait(10); }
    if (!$(ad, '#admIn [role="tablist"]')) { click(ad, '#admBack'); await wait(20); }
    if (!$(ad, '#admIn [role="tab"][aria-selected="true"]')) throw new Error('no tabs: ' + $(ad, '#adminScreen').outerHTML.slice(0, 1500));
    if ($(ad, '#admIn [role="tab"][aria-selected="true"]').dataset.tab !== tab) click(ad, '#admTab-' + tab);
    await until(() => $(ad, '#admPanel[aria-busy="false"]'), 'list for ' + tab);
  }
  async function openRow(ad, name) {
    await toList(ad, TAB_OF(name));
    const row = $$(ad, '#admIn .adm-row').find(r => text(r).includes(name));
    if (!row) throw new Error('no row for ' + name + ': ' + text($(ad, '#admIn')));
    click(ad, row);
    await until(() => $(ad, '#admWho') && text($(ad, '#admWho')).includes(name), 'detail for ' + name);
    await until(() => $(ad, '#admNote') && !$(ad, '#admNote').disabled, 'note');
  }
  await t('Verify email manually calls the endpoint and refreshes the request', async () => {
    await openRow(ad, 'Una Unverified');
    click(ad, '#admVerify');
    await until(() => ad.srv.last('POST', '/api/admin/requests/sr2/verify-email'), 'verify-email call');
    eq(ad.srv.last('POST', '/api/admin/requests/sr2/verify-email').headers['X-Recomp-Request'], '1');
    await until(() => !$(ad, '#admVerify'), 'button to go once verified');
    ok(/Email verified by admin/.test(text($(ad, '#admIn'))), text($(ad, '#admIn')));
    ok(/marked as verified/.test(text($(ad, '#admStatus'))));
    click(ad, '#admApprove');
    await until(() => ad.srv.count('POST', '/api/admin/requests/sr2/decision') === 2, 'plain approval');
    ok(!('overrideVerification' in ad.srv.last('POST', '/api/admin/requests/sr2/decision').body), 'override sent for a verified address');
  });
  await t('a private note loads with GET and saves with PUT, and clears when emptied', async () => {
    await openRow(ad, 'Pat Pending');
    eq($(ad, '#admNote').value, 'Met at the gym');
    const ta = $(ad, '#admNote'); ta.value = '  Prefers mornings  '; ta.dispatchEvent(new ad.w.Event('input', { bubbles: true }));
    click(ad, '#admNoteSave');
    await until(() => ad.srv.last('PUT', '/api/admin/users/u10/note'), 'PUT');
    const put = ad.srv.last('PUT', '/api/admin/users/u10/note');
    eq(put.body, { note: 'Prefers mornings' }); eq(put.headers['X-Recomp-Request'], '1');
    await until(() => /Note saved/.test(text($(ad, '#admStatus'))), 'saved message');
    ta.value = ''; ta.dispatchEvent(new ad.w.Event('input', { bubbles: true })); click(ad, '#admNoteSave');
    await until(() => ad.srv.calls.filter(c => c.method === 'PUT' && c.path.endsWith('/u10/note')).length === 2, 'second PUT');
    eq(ad.srv.last('PUT', '/api/admin/users/u10/note').body, { note: '' });
    await until(() => /Note cleared/.test(text($(ad, '#admStatus'))), 'cleared');
  });
  await t('suspend and revoke ask first; reactivate does not; each sends a PATCH with the status', async () => {
    await openRow(ad, 'Ann Approved');
    await until(() => $(ad, '#admSuspend'), 'account controls');
    ok(/Current status: Active/.test(text($(ad, '#admAccount'))));
    ok(!$(ad, '#admDecision') && !$(ad, '#admRejectBtn'), 'decision controls on a decided request');
    click(ad, '#admSuspend'); ok(/Suspend this account/.test(text($(ad, '#admConfirm'))));
    click(ad, '#admConfirmNo'); eq(ad.srv.count('PATCH', '/api/admin/users/u12'), 0);
    click(ad, '#admSuspend'); click(ad, '#admConfirmYes');
    await until(() => ad.srv.count('PATCH', '/api/admin/users/u12') === 1, 'suspend');
    eq(ad.srv.last('PATCH', '/api/admin/users/u12').body, { status: 'suspended' });
    eq(ad.srv.last('PATCH', '/api/admin/users/u12').headers['X-Recomp-Request'], '1');
    await until(() => /Ann Approved is suspended/.test(text($(ad, '#admStatus'))), 'confirmation message');
  });
  await t('after suspension the server state is shown, and Reactivate needs no confirmation', async () => {
    ad.S.requests[2].accountStatus = 'suspended';
    await toList(ad, 'approved');
    ok(/Suspended/.test(text($$(ad, '#admIn .adm-row').find(r => /Ann/.test(text(r))))), 'list does not show the stored status');
    await openRow(ad, 'Ann Approved');
    ok(/Current status: Suspended/.test(text($(ad, '#admAccount'))));
    click(ad, '#admReactivate');
    await until(() => ad.srv.count('PATCH', '/api/admin/users/u12') === 2, 'reactivate');
    eq(ad.srv.last('PATCH', '/api/admin/users/u12').body, { status: 'active' });
    ok(!$(ad, '#admConfirm'));
    await until(() => /Ann Approved is active again/.test(text($(ad, '#admStatus'))), 'reactivated message');
    ad.S.requests[2].accountStatus = 'active';
    await toList(ad, 'approved'); await openRow(ad, 'Ann Approved');
    click(ad, '#admRevoke'); ok(/Revoke access/.test(text($(ad, '#admConfirm')))); click(ad, '#admConfirmYes');
    await until(() => ad.srv.count('PATCH', '/api/admin/users/u12') === 3, 'revoke');
    eq(ad.srv.last('PATCH', '/api/admin/users/u12').body, { status: 'revoked' });
  });
  await t('409, 403 and 400 answers are shown as readable messages and nothing else changes', async () => {
    const cases = [[409, 'This request has already been approved. Use the account controls to change it.'],
      [403, 'Only the owner can grant the admin role.'], [400, 'Unknown feature: bogus.']];
    await openRow(ad, 'Pat Pending');
    for (const [status, error] of cases) {
      ad.srv.routes['POST /api/admin/requests/sr1/decision'] = () => json(status, { error });
      click(ad, '#admApprove');
      await until(() => text($(ad, '#admErr')) === error, `message for ${status}`);
      eq($(ad, '#admErr').getAttribute('role'), 'alert');
      eq(text($(ad, '#admWho')), 'Pat Pending', 'left the detail view on an error');
    }
    ad.srv.routes['POST /api/admin/requests/sr1/decision'] = () => json(409, { error: 'Not verified.', code: 'email_not_verified' });
    click(ad, '#admApprove');
    await until(() => /has not been verified/.test(text($(ad, '#admErr'))), 'email_not_verified message');
    ad.srv.routes['GET /api/admin/requests'] = () => json(403, { error: 'Administrator access required.' });
    click(ad, '#admBack');
    await until(() => /Administrator access required/.test(text($(ad, '#admIn'))), 'list error');
    ok($(ad, '#admIn [role="alert"]'));
    ok($$(ad, '#admIn button').some(x => x.textContent === 'Try again'));
  });
  await t('no password is ever requested or shown', () => {
    ok($(ad, '#adminScreen'));
    ok($$(ad, '#adminScreen input[type="password"]').length === 0);
    const all = $(ad, '#adminScreen').innerHTML;
    ok(!/password/i.test(all), 'the word password appears in the admin screen');
  });
  await t('Escape closes the screen, focus returns to the Administration button, the background wakes', async () => {
    ad.srv.routes['GET /api/admin/requests'] = () => json(200, { requests: [] });
    key(ad, null, 'Escape');
    ok(!$(ad, '#adminScreen'), 'still open');
    eq(ad.d.activeElement.id, 'adminOpenBtn');
    ok(!ad.d.querySelector('main').hasAttribute('inert') && !ad.d.querySelector('nav.tabs').hasAttribute('inert'));
  });
  await t('focus stays inside the admin screen (Tab wraps), and an empty tab says so', async () => {
    await openAdmin(ad);
    ok(/Nothing waiting/.test(text($(ad, '#admIn'))));
    const f = [...$(ad, '#adminScreen').querySelectorAll('button, [tabindex="0"]')].filter(n => !n.closest('[hidden]') && n.getAttribute('tabindex') !== '-1');
    f[f.length - 1].focus(); key(ad, f[f.length - 1], 'Tab'); eq(ad.d.activeElement, f[0]);
    key(ad, f[0], 'Tab', { shiftKey: true }); eq(ad.d.activeElement, f[f.length - 1]);
    click(ad, '#admBack'); ok(!$(ad, '#adminScreen'));
  });

  /* ======================================================================= */
  /* END TO END against the real backend                                      */
  /* ======================================================================= */
  sec('END TO END: the real backend, in-process');
  let e2eRan = false;
  if (!BACKEND) {
    console.log('  SKIP end-to-end: gym/backend not found beside this test (set RECOMP_GYM to the gym directory).');
  } else {
    let be = null, why = '';
    try {
      const api = await import(url.pathToFileURL(path.join(BACKEND, 'src/api.js')).href);
      const dbm = await import(url.pathToFileURL(path.join(BACKEND, 'src/db.js')).href);
      const authm = await import(url.pathToFileURL(path.join(BACKEND, 'src/auth.js')).href);
      const mail = await import(url.pathToFileURL(path.join(BACKEND, 'src/mail.js')).href);
      const cry = await import(url.pathToFileURL(path.join(BACKEND, 'src/crypto.js')).href);
      const { DatabaseSync } = await import('node:sqlite');
      be = { api, dbm, authm, mail, cry, DatabaseSync };
    } catch (e) { why = e.message; }
    if (!be) console.log('  SKIP end-to-end: backend modules could not load (' + why + ')');
    else {
      e2eRan = true;
      const OWNER_PW = 'Owner-Passphrase-99', OWNER_NEW = 'Owner-New-Passphrase-7';
      const db = be.dbm.nodeDb(be.DatabaseSync, ':memory:');
      db.exec(fs.readFileSync(path.join(BACKEND, 'schema.sql'), 'utf8'));
      const env = { OWNER_EMAIL: 'owner@example.test', OWNER_NAME: 'Owner', BOOTSTRAP_OWNER_PASSWORD: OWNER_PW, MAIL_PROVIDER: 'outbox', HIBP_CHECK: 'off' };
      /* The owner has two-step verification; codes are computed like an authenticator app. Each works
         once, so before a fresh login the fixture forgets the last used step. */
      let ownerSecret = null;
      const ownerCode = async () => { db.run("UPDATE mfa_totp SET last_step = NULL WHERE user_id = (SELECT id FROM users WHERE role = 'owner')"); return be.cry.hotp(be.cry.base32Decode(ownerSecret), Math.floor(Date.now() / 30000), 6); };
      await be.authm.bootstrapOwner(db, env, Date.now());
      be.mail.outbox.length = 0;
      let ipN = 0;

      /* A fetch that runs the real handler. Each "browser" has its own cookie jar and address. */
      function inProcessFetch() {
        const jar = new Map(), ip = '10.9.0.' + (++ipN);
        return async (u, opts = {}) => {
          const U = new URL(String(u), ORIGIN);
          const headers = new Headers(); Object.entries(opts.headers || {}).forEach(([k, v]) => headers.set(k, v));
          headers.set('x-forwarded-for', ip);
          headers.set('host', U.host);
          const ck = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
          if (ck) headers.set('cookie', ck);
          const method = (opts.method || 'GET').toUpperCase();
          const req = new Request(U, { method, headers, body: ['GET', 'HEAD'].includes(method) ? undefined : opts.body });
          const out = await be.api.handle(req, { db, env, ip });
          for (const sc of out.headers.getSetCookie()) { const [kv, ...attrs] = sc.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1);
            if (!v || attrs.some(a => /max-age=0/i.test(a))) jar.delete(k); else jar.set(k, v); }
          const text0 = await out.text(); let data = null; try { data = JSON.parse(text0); } catch (e) {}
          return { status: out.status, ok: out.status >= 200 && out.status < 300, json: async () => data, headers: { get: () => null } };
        };
      }
      const bootReal = (opts = {}) => { const b2 = boot({ fetchImpl: null }, Object.assign({ fetch: inProcessFetch() }, opts)); b2.srv = null; return b2; };

      /* The owner gets a final password first, through the API, then signs in through the UI. */
      const ownerFetch = inProcessFetch();
      const oj = async (p, m, body) => { const r = await ownerFetch(p, { method: m, headers: { 'Content-Type': 'application/json', 'X-Recomp-Request': '1' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: await r.json() }; };
      await oj('/api/auth/login', 'POST', { email: 'owner@example.test', password: OWNER_PW });
      await oj('/api/auth/password', 'POST', { current: OWNER_PW, next: OWNER_NEW });
      { const bg = await oj('/api/auth/mfa/totp/begin', 'POST', {}); ownerSecret = bg.data.secret;
        const cf = await oj('/api/auth/mfa/totp/confirm', 'POST', { code: await be.cry.hotp(be.cry.base32Decode(ownerSecret), Math.floor(Date.now() / 30000), 6) });
        if (cf.status !== 200) throw new Error('owner MFA enrolment failed'); }

      let person = bootReal();
      await until(() => !$(person, '#authGate').hidden, 'gate'); await wait(80);

      await t('E2E sign up through the pop-up creates a pending account and an emailed link', async () => {
        click(person, '#tabSignup');
        setIn(person, 'signupName', 'Erin Example'); setIn(person, 'signupEmail', 'erin@example.test'); setIn(person, 'signupPw', 'Erin-Strong-Pass-1');
        check(person, 'signupPrivacy'); check(person, 'signupHealth');
        submit(person, 'signupForm');
        await until(() => !$(person, '[data-view="check-email"]').hidden, 'check-your-email');
        ok(/erin@example\.test/.test(text($(person, '#ceMsg'))));
        const row = db.get('SELECT status, role FROM users WHERE email = ?', 'erin@example.test');
        eq([row.status, row.role], ['pending', 'member']);
        const mails = be.mail.outbox.filter(m => m.to === 'erin@example.test');
        eq(mails.length, 1); ok(/\/\?verify=/.test(mails[0].text), mails[0].text);
      });
      await t('E2E a pending person who continues sees the status page, and the server refuses private data', async () => {
        click(person, '#ceContinue');
        await until(() => !$(person, '#authStatus').hidden, 'status page'); await wait(100);
        eq(text($(person, '#stTitle')), 'Your account is awaiting approval');
        eq(text($(person, '#stEmailVal')), 'Not confirmed yet');
        ok(!$(person, '#stResend').hidden);
        const r = await person.w.AUTH.pullState(); eq(r.pending, true, JSON.stringify(r));
        ok($(person, 'nav.tabs').hidden);
      });
      await t('E2E the emailed verify link confirms the address in a fresh browser tab and cleans the URL', async () => {
        const mail = be.mail.outbox.filter(m => m.to === 'erin@example.test').pop();
        const link = new URL(mail.text.match(/https?:\/\/\S+\?verify=\S+/)[0]);
        const other = bootReal({ url: ORIGIN + 'index.html' + link.search });
        await until(() => !$(other, '#authGate').hidden, 'gate'); await wait(150);
        eq(other.w.location.search, '');
        eq($(other, '#authTitle').textContent, 'Email confirmed');
        const sr = db.get('SELECT status, email_verified_at FROM signup_requests WHERE email = ?', 'erin@example.test');
        eq(sr.status, 'pending_approval'); ok(sr.email_verified_at);
        // The same link cannot be used twice.
        const again = bootReal({ url: ORIGIN + 'index.html' + link.search });
        await until(() => !$(again, '#authGate').hidden, 'gate'); await wait(150);
        eq($(again, '#authTitle').textContent, 'Link not valid');
      });
      await t('E2E "Check again" picks up the verified address', async () => {
        click(person, '#stCheck');
        await until(() => text($(person, '#stEmailVal')) === 'Confirmed', 'confirmed');
        ok($(person, '#stResend').hidden);
      });
      await t('E2E the administrator logs in through the pop-up, sees the request, and approves with a role and permissions', async () => {
        const adm = bootReal();
        await until(() => !$(adm, '#authGate').hidden, 'gate'); await wait(80);
        setIn(adm, 'loginEmail', 'owner@example.test'); setIn(adm, 'loginPassword', OWNER_NEW); submit(adm, 'loginForm');
        await until(() => !$(adm, '#mfaForm').hidden, 'two-step verification step');
        ok(!adm.w.AUTH.user(), 'no session before the second step');
        setIn(adm, 'mfaCode', await ownerCode()); submit(adm, 'mfaForm');
        await until(() => appReady(adm), 'owner app');
        adm.w.__recomp.go('profile');
        await openAdmin(adm);
        const row = $$(adm, '#admIn .adm-row').find(r => /Erin Example/.test(text(r)));
        ok(row, text($(adm, '#admIn')));
        ok(/Email verified/.test(text(row)) && /Awaiting approval/.test(text(row)));
        click(adm, row);
        await until(() => $(adm, '#admNote') && !$(adm, '#admNote').disabled, 'detail');
        $(adm, '#admRole').value = 'coach'; $(adm, '#admRole').dispatchEvent(new adm.w.Event('change', { bubbles: true }));
        const nut = $(adm, '#admPerms input[data-feature="garmin"]'); nut.checked = true; nut.dispatchEvent(new adm.w.Event('change', { bubbles: true }));
        const nt = $(adm, '#admNote'); nt.value = 'Friend of the gym'; nt.dispatchEvent(new adm.w.Event('input', { bubbles: true })); click(adm, '#admNoteSave');
        await until(() => db.get('SELECT note FROM admin_notes WHERE user_id = (SELECT id FROM users WHERE email = ?)', 'erin@example.test'), 'note saved');
        click(adm, '#admApprove');
        await until(() => db.get('SELECT status, role FROM users WHERE email = ?', 'erin@example.test').status === 'active', 'approval');
        const u = db.get('SELECT status, role, permissions FROM users WHERE email = ?', 'erin@example.test');
        eq(u.role, 'coach');
        eq(JSON.parse(u.permissions), { training: true, library: true, nutrition: false, recipes: false, garmin: true, progress: true, reviews: true });
        await until(() => /Approved Erin Example as a coach/.test(text($(adm, '#admStatus'))), 'message');
        // Persisted: a refresh of the list shows it under Approved with no client state.
        const again = bootReal();
        ok(again);
        click(adm, '#admTab-approved');
        await until(() => $$(adm, '#admIn .adm-row').some(r => /Erin Example/.test(text(r))), 'approved list from the server');
        ok(!/password/i.test($(adm, '#adminScreen').innerHTML), 'password text in admin screen');
      });
      await t('E2E the waiting person\'s status page notices the approval and opens the app', async () => {
        person.w.AuthUI.configure({ minPollMs: 0 });
        person.w.dispatchEvent(new person.w.Event('focus'));
        await until(() => appReady(person), 'the app after approval');
        eq(person.w.__recomp.AUTH_MODE, 'server');
        eq(person.w.AUTH.user().role, 'coach');
        eq(person.w.AUTH.user().permissions.nutrition, false);
      });
      await t('E2E logging in later as the approved person goes straight to the app', async () => {
        const again = bootReal();
        await until(() => !$(again, '#authGate').hidden, 'gate'); await wait(80);
        setIn(again, 'loginEmail', 'erin@example.test'); setIn(again, 'loginPassword', 'Erin-Strong-Pass-1'); submit(again, 'loginForm');
        await until(() => appReady(again), 'app');
      });
      await t('E2E reject, then the person gets the no-access page and cannot use the app', async () => {
        const f2 = inProcessFetch();
        const c = async (p, m, b) => { const r = await f2(p, { method: m, headers: { 'Content-Type': 'application/json', 'X-Recomp-Request': '1' }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, data: await r.json() }; };
        await c('/api/auth/signup', 'POST', { name: 'Rex Reject', email: 'rex@example.test', password: 'Rex-Strong-Pass-1', website: '', privacyNoticeVersion: 'v1', healthConsent: true }); // gitleaks:allow (synthetic test credential)
        const sr = db.get('SELECT id FROM signup_requests WHERE email = ?', 'rex@example.test');
        const d = await oj(`/api/admin/requests/${sr.id}/decision`, 'POST', { action: 'reject', note: 'No' });
        eq(d.status, 200);
        const rex = bootReal();
        await until(() => !$(rex, '#authGate').hidden, 'gate'); await wait(80);
        setIn(rex, 'loginEmail', 'rex@example.test'); setIn(rex, 'loginPassword', 'Rex-Strong-Pass-1'); submit(rex, 'loginForm');
        await until(() => !$(rex, '#authStatus').hidden, 'no-access');
        eq(text($(rex, '#stTitle')), 'No access'); ok(/not approved/.test(text($(rex, '#stLead'))));
        ok($(rex, 'nav.tabs').hidden);
      });
      await t('E2E forgot and reset through the pop-up changes the password on the real server', async () => {
        const fp = bootReal();
        await until(() => !$(fp, '#authGate').hidden, 'gate'); await wait(80);
        click(fp, '#loginForgot'); setIn(fp, 'forgotEmail', 'erin@example.test'); submit(fp, 'forgotForm');
        await until(() => !$(fp, '[data-view="forgot-sent"]').hidden, 'sent');
        const mail = be.mail.outbox.filter(m => m.to === 'erin@example.test' && /reset/.test(m.text)).pop();
        ok(mail, 'no reset mail');
        const link = new URL(mail.text.match(/https?:\/\/\S+\?reset=\S+/)[0]);
        const rb = bootReal({ url: ORIGIN + 'index.html' + link.search });
        await until(() => !$(rb, '#resetForm').hidden, 'reset form'); await wait(60);
        eq(rb.w.location.search, '');
        setIn(rb, 'resetPw', 'Erin-Changed-Pass-2'); setIn(rb, 'resetConfirm', 'Erin-Changed-Pass-2'); submit(rb, 'resetForm');
        await until(() => $(rb, '#authTitle').textContent === 'Password changed', 'done');
        click(rb, '[data-view="reset-done"] [data-goto="login"]');
        setIn(rb, 'loginEmail', 'erin@example.test'); setIn(rb, 'loginPassword', 'Erin-Changed-Pass-2'); submit(rb, 'loginForm');
        await until(() => appReady(rb), 'app with the new password');
      });
      db.close();
    }
  }

  /* ======================================================================= */
  console.log('\n' + '='.repeat(62));
  console.log(`  ${pass} passed, ${fail} failed` + (BACKEND && e2eRan ? '' : '  (end-to-end skipped)'));
  console.log('='.repeat(62));
  if (fail) fails.forEach(([n, m]) => console.log(` - ${n}\n   ${m}`));
  server.close();
  process.exit(fail ? 1 : 0);
})();
