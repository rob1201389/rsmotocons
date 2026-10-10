/* Settings, public pages and privacy controls in jsdom, against the REAL backend
   handler in-process (node:sqlite). Run: node gym/test/settings.ui.test.js */
const K = require('./simkit.js'), U = require('./uikit.js');
const path = require('path'), fs = require('fs'), url = require('url');
const { t, eq, ok, sec, done } = K.counters();
const { wait, click, text, byText, type } = U;
const GYM = process.env.RECOMP_GYM || path.join(__dirname, '..');
const BACKEND = fs.existsSync(path.join(GYM, 'backend/src/api.js')) ? path.join(GYM, 'backend') : null;

(async () => {
  await U.serve();
  sec('PUBLIC PAGES BEFORE SIGN-IN');
  {
    // a server that knows no account: anonymous visitor on the welcome page
    const anon = async (u) => { const p = new URL(String(u), 'http://x/').pathname;
      if (p === '/api/auth/session') return { status: 200, ok: true, json: async () => ({ authenticated: false, setupAvailable: false }) };
      if (p === '/api/operator') return { status: 200, ok: true, json: async () => ({ operator: {}, policy: {}, complete: false }) };
      if (p.startsWith('/api/content/')) return { status: 200, ok: true, json: async () => ({ content: null }) };
      if (p.startsWith('/content/')) { const f = path.join(U.APP, p); return { status: 200, ok: true, json: async () => JSON.parse(fs.readFileSync(f, 'utf8')) }; }
      return { status: 404, ok: false, json: async () => ({}) }; };
    const dom = U.boot(null, { fetch: anon }); await wait(1500);
    const w = dom.window, d = w.document; w.Content = w.eval('Content');
    t('the welcome page links to About, Why and Privacy', () => { const x = text(d.querySelector('#authWelcome')); ['About Recomp', 'Why Recomp', 'Privacy policy'].forEach(s => ok(x.includes(s), s)); });
    t('no app content or tabs are visible before sign-in', () => { ok(d.querySelector('nav.tabs').hidden); ok(d.querySelector('#main').hidden || d.querySelector('#main').closest('[hidden]')); });
    click(w, d.querySelector('#authWelcome [data-doc="privacy"]')); await wait(300);
    const page = d.getElementById('docPage');
    t('the privacy policy opens over the welcome page, with a summary and contents', () => {
      ok(page && !page.hidden); const x = text(page);
      ok(x.includes('Privacy at a glance')); ok(x.includes('Contents')); ok(d.querySelectorAll('#docPage .doc-toc li').length >= 12);
    });
    t('missing operator details are shown as not supplied, and the page says it is a draft', () => { ok(text(page).includes('[not yet supplied]')); ok(text(page).includes('Draft.')); });
    t('every section in the contents exists and receives focus when chosen', () => {
      const links = [...d.querySelectorAll('#docPage .doc-toc a')]; ok(links.length > 10);
      click(w, links[5]); const id = links[5].getAttribute('href').split('/')[1]; eq(d.activeElement.id, 'c-' + id);
    });
    t('content is rendered as text: no markup from the content files reaches the page', () => {
      ok(!d.querySelector('#docPage script')); ok([...d.querySelectorAll('#docPage a')].every(a => /^(https:|mailto:|#)/.test(a.getAttribute('href'))));
    });
    t('the renderer neutralises HTML and unsafe links in content', () => {
      const frag = w.Content.blocks([{ t: 'p', text: '<img src=x onerror=alert(1)> [x](javascript:alert(1)) [ok](https://example.com)' }], { operator: {}, policy: {} }, { toc: [], missing: new Set() });
      const div = d.createElement('div'); div.appendChild(frag);
      ok(!div.querySelector('img')); eq(div.querySelectorAll('a').length, 1); eq(div.querySelector('a').getAttribute('href'), 'https://example.com');
    });
    click(w, d.querySelector('#docPage .doc-tab[data-key="about"]')); await wait(200);
    t('About and Why open from the same page', () => { ok(text(page).includes('About Recomp')); ok(text(page).includes('not affiliated')); });
    click(w, d.querySelector('#docPage .doc-tab[data-key="why"]')); await wait(200);
    t('Why marks planned features as planned', () => { ok(d.querySelectorAll('#docPage .c-badge.planned').length >= 1); ok(d.querySelectorAll('#docPage .c-steps li').length === 4); });
    d.getElementById('docPage').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(50);
    t('closing returns to the welcome page, not the app', () => { ok(page.hidden); ok(!d.querySelector('#authGate').hidden); });
    click(w, d.querySelector('#awSignup')); await wait(100);
    t('the sign-up form links to the policy and asks for privacy acknowledgement and health consent separately', () => {
      ok(d.querySelector('#signupForm a[data-doc="privacy"]')); ok(d.getElementById('signupPrivacy')); ok(d.getElementById('signupHealth'));
      ok(/AI feedback is a separate choice/.test(text(d.querySelector('#signupForm'))));
    });
    click(w, d.querySelector('#authDialog [data-doc="about"]')); await wait(200);
    t('links inside the dialog open the page and close the dialog so focus is not trapped', () => { ok(!page.hidden); ok(d.getElementById('authDialogWrap').hidden); });
  }

  if (!BACKEND) { console.log('SKIP backend tests: gym/backend not found'); U.stop(); done(); return; }
  const api = await import(url.pathToFileURL(path.join(BACKEND, 'src/api.js')).href);
  const dbm = await import(url.pathToFileURL(path.join(BACKEND, 'src/db.js')).href);
  const authm = await import(url.pathToFileURL(path.join(BACKEND, 'src/auth.js')).href);
  const cry = await import(url.pathToFileURL(path.join(BACKEND, 'src/crypto.js')).href);
  const { DatabaseSync } = await import('node:sqlite');
  const db = dbm.nodeDb(DatabaseSync, ':memory:');
  db.exec(fs.readFileSync(path.join(BACKEND, 'schema.sql'), 'utf8'));
  const aiCalls = [];
  const env = { OWNER_EMAIL: 'owner@example.test', OWNER_NAME: 'Owner', BOOTSTRAP_OWNER_PASSWORD: 'Owner-Passphrase-99', MAIL_PROVIDER: 'outbox', HIBP_CHECK: 'off', ANTHROPIC_API_KEY: 'k' };
  const aiFetch = async (u, o) => { aiCalls.push(o.body); return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '{"headline":"You did 4 of 4","wentWell":[],"needsAttention":[],"nextWeek":[],"notesConsidered":[],"caveats":[]}' }], model: 'claude-test' }) }; };
  await authm.bootstrapOwner(db, env, Date.now());
  let ipN = 0;
  function backendFetch() {
    const jar = new Map(), ip = '10.7.0.' + (++ipN);
    const f = async (u, opts = {}) => {
      const U2 = new URL(String(u), 'http://127.0.0.1/');
      if (!U2.pathname.startsWith('/api/')) {
        const fp = path.join(U.APP, U2.pathname);
        return fs.existsSync(fp) ? { status: 200, ok: true, json: async () => JSON.parse(fs.readFileSync(fp, 'utf8')) } : { status: 404, ok: false, json: async () => null };
      }
      const headers = new Headers(); Object.entries(opts.headers || {}).forEach(([k, v]) => headers.set(k, v));
      headers.set('x-forwarded-for', ip);
      const ck = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; '); if (ck) headers.set('cookie', ck);
      const method = (opts.method || 'GET').toUpperCase();
      const req = new Request(U2, { method, headers, body: ['GET', 'HEAD'].includes(method) ? undefined : opts.body });
      const out = await api.handle(req, { db, env, ip, fetch: aiFetch });
      for (const sc of out.headers.getSetCookie()) { const [kv, ...attrs] = sc.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (!v || attrs.some(a => /max-age=0/i.test(a))) jar.delete(k); else jar.set(k, v); }
      const body = await out.text(); let data = null; try { data = JSON.parse(body); } catch (e) {}
      return { status: out.status, ok: out.status < 300, json: async () => data, text: async () => body, headers: out.headers };
    };
    f.json = async (p, m, b) => { const r = await f(p, { method: m || 'GET', headers: { 'Content-Type': 'application/json', 'X-Recomp-Request': '1' }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, data: await r.json() }; };
    return f;
  }
  // the owner: final password, two-step verification, then creates two members
  const ownerF = backendFetch();
  await ownerF.json('/api/auth/login', 'POST', { email: 'owner@example.test', password: 'Owner-Passphrase-99' });
  await ownerF.json('/api/auth/password', 'POST', { current: 'Owner-Passphrase-99', next: 'Owner-New-Passphrase-7' });
  const bg = await ownerF.json('/api/auth/mfa/totp/begin', 'POST', {});
  await ownerF.json('/api/auth/mfa/totp/confirm', 'POST', { code: await cry.hotp(cry.base32Decode(bg.data.secret), Math.floor(Date.now() / 30000), 6) });
  const mk = async (email, name) => { const r = await ownerF.json('/api/admin/users', 'POST', { email, name, password: 'Member-Pass-4567-x', role: 'member' }); db.run('UPDATE users SET must_change_pw = 0 WHERE id = ?', r.data.id); return r.data.id; };
  const ALICE = await mk('alice@example.test', 'Alice'), BOB = await mk('bob@example.test', 'Bob');
  const signIn = async (email) => { const f = backendFetch(); await f.json('/api/auth/login', 'POST', { email, password: 'Member-Pass-4567-x' }); return f; };
  const bobF = await signIn('bob@example.test');
  await bobF.json('/api/state', 'PUT', { doc: Object.assign(K.C.blankState(), { notes: [{ id: 'n1', text: 'bob private note', date: '2026-09-10', createdAt: 1 }] }) });

  async function openAs(f, state) {
    if (state) await f.json('/api/state', 'PUT', { doc: state });
    const dom = U.boot(null, { fetch: f }); await wait(1800);
    const w = dom.window; ['Plan', 'Review', 'Settings', 'Views', 'Garmin', 'Content'].forEach(n => { try { w[n] = w.eval(n); } catch (e) {} });
    return { dom, w, d: w.document, A: w.__recomp };
  }
  const aliceF = await signIn('alice@example.test');
  const st = K.newUser({}, '2026-09-07'); K.runWeek(st, '2026-09-07', () => ({ feedback: K.GOOD })); delete st._exIndex;
  st.wellness = { sleep: [{ date: '2026-09-08', hours: 7.2, importId: 'im_1' }, { date: '2026-09-09', hours: 6, importId: 'im_2' }], activities: [], imports: [{ id: 'im_1', kind: 'sleep', filename: 'a.csv', added: 1, coverage: { from: '2026-09-08', to: '2026-09-08' }, importedAt: 1 }, { id: 'im_2', kind: 'sleep', filename: 'b.csv', added: 1, coverage: { from: '2026-09-09', to: '2026-09-09' }, importedAt: 2 }] };
  let c = await openAs(aliceF, st);
  const sheet = () => text(c.d.querySelector('#vSheet.on'));

  sec('SETTINGS');
  t('the app opens signed in as Alice, with her own data only', () => { eq(c.A.AUTH_MODE, 'server'); eq(c.w.AUTH.user().email, 'alice@example.test'); ok(!JSON.stringify(c.A.S).includes('bob private note')); });
  c.A.go('profile'); await wait(400);
  t('Settings has every section', () => {
    const x = text(c.d.querySelector('#p-profile'));
    ['Account and security', 'Goals, equipment and availability', 'Time zone, week and review day', 'Nutrition preferences', 'Theme, accessibility and motion', 'Reminders and notifications', 'Imported Garmin data', 'AI-assisted weekly reviews', 'Reviewer access and sharing', 'Your consent', 'Your data', 'About, why Recomp and privacy'].forEach(s => ok(x.includes(s), s));
  });
  t('goals are set in the plan setup, not in a prominent card at the top of Settings', () => {
    const pg = c.d.getElementById('profGoals'), planned = c.w.Plan.hasPlan(c.A.S);
    if (planned) {
      const det = pg.closest('details'); ok(det && det.id === 'setTrainingMore', 'inside the collapsed section'); ok(!det.open, 'collapsed by default');
      ok(/Bodyweight \(kg\)/.test(text(pg)) && /Max load jump/.test(text(pg)), 'bodyweight and limits still reachable');
      ok(!/Training days per week|Session length/.test(text(pg)), 'no duplicate goal fields');
      ok(/Change goals, equipment and availability/.test(text(c.d.querySelector('#p-profile'))));
    } else {
      ok(pg.closest('details') && !pg.closest('details').open, 'old goals card collapsed before the plan exists');
      ok(/Set up my plan/.test(text(c.d.querySelector('#p-profile'))));
    }
    const first = c.d.querySelector('#p-profile h2:not([hidden])'); ok(!first || !/Goals and training/.test(first.textContent), 'no Goals and training heading');
  });
  t('sessions are listed with this device marked', () => ok(/this device/.test(text(c.d.querySelector('#setSessions')))));
  t('AI reviews are off by default, with what happens to past reports explained', () => {
    eq(c.d.getElementById('setAiToggle').checked, false); ok(/Feedback already written stays in your past reports/.test(text(c.d.querySelector('#set-ai'))));
  });
  {
    const cb = c.d.getElementById('setAiToggle'); cb.checked = true; cb.dispatchEvent(new c.w.Event('change', { bubbles: true })); await wait(200);
    t('turning AI on is saved on the server for this account only', () => { eq(db.get('SELECT ai_reviews FROM user_settings WHERE user_id = ?', ALICE).ai_reviews, 1); eq(db.get('SELECT ai_reviews FROM user_settings WHERE user_id = ?', BOB), null); });
    t('and recorded as a consent change', () => ok(db.get("SELECT COUNT(*) AS n FROM consents WHERE user_id = ? AND kind = 'ai_review' AND granted = 1", ALICE).n === 1));
  }
  sec('AI SETTING HAS A REAL EFFECT');
  {
    aiCalls.length = 0;
    c.w.ReviewUI = c.w.eval('ReviewUI');
    c.w.ReviewUI.open(); await wait(100);
    click(c.w, byText(c.d.querySelector('#vSheet'), 'button', 'Continue')); await wait(80);
    click(c.w, byText(c.d.querySelector('#vSheet'), 'button', 'Build my report')); await wait(600);
    t('with AI on, the review is worded by the AI service and labelled as AI-assisted', () => { eq(aiCalls.length, 1); ok(/AI-assisted/.test(sheet()), sheet().slice(0, 300)); });
    t('the request carries no name, email or account id', () => { ok(!aiCalls[0].includes('alice@example.test') && !aiCalls[0].includes(ALICE) && !aiCalls[0].includes('Alice')); });
    c.w.RecompHost.closeSheet('vSheet');
    c.A.go('profile'); await wait(300);
    const cb = c.d.getElementById('setAiToggle'); cb.checked = false; cb.dispatchEvent(new c.w.Event('change', { bubbles: true })); await wait(200);
    aiCalls.length = 0;
    const rep = c.A.S.reviews.find(r => r.status === 'draft');
    c.w.ReviewUI._s.report = rep; await c.w.eval('ReviewUI').open(); await wait(80);
    click(c.w, byText(c.d.querySelector('#vSheet'), 'button', 'Continue')); await wait(80);
    click(c.w, byText(c.d.querySelector('#vSheet'), 'button', 'Build my report')); await wait(500);
    t('with AI off, nothing is sent and the summary says it was written by the app', () => { eq(aiCalls.length, 0); ok(/not written by AI/i.test(sheet())); ok(/AI feedback is off/.test(sheet())); });
    t('a direct request with AI off is refused by the server', async () => {});
    const direct = await aliceF.json('/api/ai/weekly-review', 'POST', { payload: { period: { start: '2026-09-07', end: '2026-09-13', timezone: 'Australia/Sydney' }, goal: { primary: 'recomp', secondary: [] }, stats: {}, facts: [], attention: [], notes: [], feedback: [], proposals: [], dataGaps: [] } });
    t('a direct request with AI off is refused by the server, and nothing is sent', () => { eq(direct.data.code, 'ai_disabled'); eq(aiCalls.length, 0); });
    t('AI wording already written can be removed from past reports', () => {
      c.w.RecompHost.closeSheet('vSheet'); c.A.go('profile');
    });
    await wait(300);
    const rm = byText(c.d.querySelector('#set-ai'), 'button', 'Remove AI wording');
    t('the remove option appears for the report that has AI wording', () => ok(rm));
    if (rm) { click(c.w, rm); await wait(80); click(c.w, byText(c.d.querySelector('#vSheet'), 'button', 'Remove')); await wait(150); }
    t('after removal no stored report holds AI text', () => ok(!c.A.S.reviews.some(r => r.ai && r.ai.report)));
  }
  sec('OTHER PREFERENCES PERSIST AND TAKE EFFECT');
  {
    c.A.go('profile'); await wait(300);
    click(c.w, byText(c.d.querySelector('#set-appearance'), 'button', 'Larger')); await wait(400);
    t('text size applies immediately and is saved to the account', async () => {});
    t('text size applies immediately', () => eq(c.d.documentElement.getAttribute('data-text'), 'larger'));
    click(c.w, byText(c.d.querySelector('#set-nutrition'), 'button', 'Eggs')); await wait(300);
    c.A.go('nutrition'); await wait(200);
    t('excluded foods leave the suggested meal plan, with the shortfall shown', () => { const x = text(c.d.querySelector('#fuelCard')); ok(!/whole eggs/.test(x.split('Plan totals')[0])); ok(/Left out because you excluded them: whole eggs/.test(x)); });
    c.A.go('profile'); await wait(300);
    const rr = c.d.getElementById('setReviewReminder'); rr.checked = false; rr.dispatchEvent(new c.w.Event('change', { bubbles: true })); await wait(100);
    c.A.go('today'); await wait(200);
    t('turning off the review reminder removes the Today card', () => ok(!/Your weekly review is ready/.test(text(c.d.querySelector('#todayExtra')))));
    c.A.go('profile'); await wait(300);
    click(c.w, byText(c.d.querySelector('#set-garmin'), 'button', 'Delete')); await wait(80);
    click(c.w, byText(c.d.querySelector('#vSheet'), 'button', 'Delete')); await wait(200);
    t('deleting one Garmin import removes only its rows', () => { eq(c.A.S.wellness.imports.length, 1); eq(c.A.S.wellness.sleep.length, 1); eq(c.A.S.wellness.sleep[0].importId, 'im_1'); });
    await wait(1500);
    const saved = await aliceF.json('/api/state');
    t('preferences are stored in the account on the server, not just this device', () => { eq(saved.data.doc.prefs.textSize, 'larger'); eq(saved.data.doc.prefs.foodExclusions, ['egg']); eq(saved.data.doc.prefs.reviewReminder, false); eq(saved.data.doc.wellness.imports.length, 1); });
  }
  sec('SHARING, EXPORT AND DELETION');
  {
    c.A.go('profile'); await wait(300);
    const sh = c.d.getElementById('setShareToggle'); sh.checked = false; sh.dispatchEvent(new c.w.Event('change', { bubbles: true })); await wait(200);
    t('turning off reviewer sharing is enforced by the server', () => eq(db.get('SELECT share_with_reviewer FROM user_settings WHERE user_id = ?', ALICE).share_with_reviewer, 0));
    db.run('DELETE FROM session_reauth');
    let downloaded = null;
    c.w.URL.createObjectURL = blob => { downloaded = blob; return 'blob:x'; }; c.w.URL.revokeObjectURL = () => {};
    click(c.w, c.d.getElementById('setExport')); await wait(200);
    t('download asks for the password again first', () => ok(/Confirm it is you/.test(sheet())));
    c.d.getElementById('reauthPw').value = 'Member-Pass-4567-x'; click(c.w, c.d.getElementById('reauthOk')); await wait(400);
    const exp = downloaded ? JSON.parse(await downloaded.text()) : null;
    t('the download holds Alice\'s data and nothing of Bob\'s', () => { ok(exp); eq(exp.account.email, 'alice@example.test'); ok(!JSON.stringify(exp).includes('bob private note')); ok(!JSON.stringify(exp).includes('pbkdf2$')); });
    click(c.w, c.d.getElementById('setDelete')); await wait(80);
    t('deletion explains what is deleted, what is kept and how backups work, before anything happens', () => { const x = sheet(); ok(/Deleted straight away/.test(x)); ok(/Kept, and why/.test(x)); ok(/backups/.test(x)); ok(db.get('SELECT id FROM users WHERE id = ?', ALICE)); });
    type(c.w, c.d.querySelector('#vSheet input'), 'DELETE MY ACCOUNT');
    click(c.w, c.d.getElementById('setDeleteConfirm')); await wait(500);
    t('after confirming, the server has really deleted the account and says what was kept', () => { eq(db.get('SELECT id FROM users WHERE id = ?', ALICE), null); eq(db.get('SELECT COUNT(*) AS n FROM user_state WHERE user_id = ?', ALICE).n, 0); ok(/has been deleted/.test(sheet())); ok(/database host keeps/.test(sheet())); });
    t('Bob\'s account is untouched', () => ok(db.get('SELECT id FROM users WHERE id = ?', BOB)));
    const again = await aliceF.json('/api/auth/me');
    t('the deleted account\'s session no longer works', () => eq(again.status, 401));
  }
  sec('MOBILE LAYOUT');
  t('settings sections have a jump list and no fixed widths wider than a phone', () => {
    ok(c.d.querySelector('#p-profile .set-nav'));
    const css = fs.readFileSync(path.join(U.APP, 'content.css'), 'utf8'); ok(!/(^|[^-])width:\s*(4[0-9]{2}|[5-9][0-9]{2})px/m.test(css));
  });
  sec('LINKS AND SIGN-OUT');
  t('a shared link to a public page is not hidden behind the locked sign-in screen', () => {
    const html = fs.readFileSync(path.join(U.APP, 'index.html'), 'utf8');
    ok(/body\.locked>\*:not\(#authGate\):not\(#docPage\)/.test(html));
    const app = fs.readFileSync(path.join(U.APP, 'app.js'), 'utf8');
    ok(/view === 'login'[^\n]*#\(about\|why\|privacy\)[^\n]*view = 'welcome'/.test(app));
  });
  t('sign-out removes this account\'s offline copy from IndexedDB, not only localStorage', () => {
    const ac = fs.readFileSync(path.join(U.APP, 'authclient.js'), 'utf8');
    ok(/indexedDB\.open\('recompDB'/.test(ac) && /startsWith\(prefix\)\)\.forEach\(k => st\.delete\(k\)\)/.test(ac));
  });
  U.stop(); done();
})();
