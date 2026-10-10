/* Double progression UI tests, in jsdom against the real index.html and scripts.
   Needs jsdom (dev only):  npm install jsdom   then   node gym/test/doubleprog.ui.test.js */
const { JSDOM } = require('jsdom');
const fs = require('fs'), http = require('http'), path = require('path');
const APP = fs.existsSync(path.join(__dirname, '../public/index.html')) ? path.join(__dirname, '../public') : __dirname;
const C = require(path.join(APP, 'core.js'));
const E = require(path.join(APP, 'engine.js'));
const X = require(path.join(APP, 'exercises.js'));

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
const t = (n, f) => { try { f(); pass++; console.log('  \x1b[32mPASS\x1b[0m ' + n); }
  catch (e) { fail++; fails.push([n, e.message]); console.log('  \x1b[31mFAIL\x1b[0m ' + n + '\n       ' + e.message); } };
const ok = (v, m) => { if (!v) throw new Error(m || 'falsy'); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || '') + ` expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const sec = s => console.log('\n\x1b[1m' + s + '\x1b[0m');
const wait = ms => new Promise(r => setTimeout(r, ms));
const click = (w, e) => e.dispatchEvent(new w.Event('click', { bubbles: true }));
const GOOD = { effort: 'manageable', reserve: '3', technique: 'controlled', capacity: 'another_set', pain: null, at: Date.now() };
const PD = 'lat-pulldown';

/* A v4 state with one finished lat-pulldown session two days ago. */
function stateWith(reps, feedback) {
  const s = C.blankState(); s._exIndex = X.EX_INDEX;
  const ex = X.EX_INDEX[PD];
  const sess = C.newSession(ex.day, C.addDays(C.todayISO(), -2)), e = C.newEntry(PD, PD);
  reps.forEach(r => { const k = C.newSet({ weight: 60, reps: r }); C.editSet(k, 60, r); e.sets.push(k); });
  e.feedback = feedback === undefined ? Object.assign(E.blankFeedback(), GOOD) : feedback;
  sess.entries.push(e); sess.status = 'completed'; s.sessions.push(sess);
  delete s._exIndex;
  return s;
}
function boot(state) {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  return new JSDOM(html, {
    runScripts: 'dangerously', resources: 'usable', url: ORIGIN + 'index.html', pretendToBeVisual: true,
    beforeParse(w) {
      w.requestAnimationFrame = cb => setTimeout(() => cb(w.performance.now()), 16);
      w.cancelAnimationFrame = id => clearTimeout(id);
      w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      w.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
      w.navigator.vibrate = () => true;
      Object.defineProperty(w.navigator, 'onLine', { get: () => true, configurable: true });
      w.indexedDB = undefined;
      w.localStorage.clear(); w.localStorage.setItem('recomp.v3', JSON.stringify(state));
      w.confirm = () => true; w.alert = () => {}; w.scrollTo = () => {};
    }
  });
}
/* open a live session containing just the lat pulldown, with its card expanded */
async function openCard(state) {
  const dom = boot(state), w = dom.window, d = w.document;
  await wait(1300);
  const A = w.__recomp, ex = A.EX_INDEX[PD];
  const sess = w.newSession(ex.day, w.todayISO()), entry = w.newEntry(PD, PD);
  entry.decision = A.decideForEx(ex, null);
  A.seedSets(entry, ex, entry.decision);
  sess.entries.push(entry); A.S.sessions.push(sess); A.S._liveId = sess.id;
  A.go('train'); A.renderAll();
  click(w, d.querySelector('#exList .ex-hd')); await wait(80);
  return { dom, w, d, A, ex, sess, entry };
}
const text = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

(async () => {
  await serve();

  sec('WORKOUT PANEL — building reps');
  let c = await openCard(stateWith([12, 12, 10]));
  t('shows the load and range, last time and today\'s per-set targets', () => {
    const p = text(c.d.querySelector('#exList .prog'));
    ok(p.includes('60 kg · 3 × 8–12'), p);
    ok(p.includes('Last time: 12 / 12 / 10'), p);
    ok(p.includes('Today: 12 / 12 / 11'), p);
  });
  t('the planned reps on the set rows are the per-set targets, not 12 on every set', () => {
    const ph = [...c.d.querySelectorAll('#exList .setrow')].map(r => r.querySelectorAll('input')[1].placeholder);
    eq(ph, ['12', '12', '11']);
  });
  t('shows what is still required, with met / not yet / unknown', () => {
    const items = [...c.d.querySelectorAll('#exList .prog ul.req li')].map(li => li.className);
    ok(items.includes('met') && items.includes('unmet'), items.join(','));
    ok(text(c.d.querySelector('#exList .prog')).includes('Next weight increase: complete all 3 sets at 12 reps with controlled technique'));
  });
  t('the pill says Build, not Up or Hold, while reps are climbing at one load', () => {
    eq(text(c.d.querySelector('#exList .ex-hd .pill')), 'Build');
  });
  t('the meter shows how many sets reached the top last time', () => {
    eq(c.d.querySelectorAll('#exList .prog .meter i.on').length, 2);
    ok(text(c.d.querySelector('#exList .prog .meter-l')).includes('2 of 3 sets at 12'));
  });
  t('no accept/hold buttons while nothing is earned; Edit is still available', () => {
    const b = [...c.d.querySelectorAll('#exList .prog .mediabar button')].map(x => text(x));
    eq(b, ['Edit']);
  });

  sec('WORKOUT PANEL — missing feedback stays unknown');
  c = await openCard(stateWith([12, 12, 12], null));
  t('unknown feedback is shown as unknown, never as met', () => {
    const li = [...c.d.querySelectorAll('#exList .prog ul.req li')];
    const eff = li.find(x => /Effort no higher/.test(x.textContent));
    eq(eff.className, 'unknown');
    ok(!c.d.querySelector('#exList .prog .mediabar button.primary'), 'must not offer to accept an increase');
  });

  sec('PREVIEW — accept, hold, edit');
  c = await openCard(stateWith([12, 12, 12]));
  t('an earned increase is previewed with the new load, reset reps and three options', () => {
    const p = text(c.d.querySelector('#exList .prog'));
    ok(p.includes('62.5 kg · 3 × 8–12'), p);
    ok(p.includes('Today: 8 / 8 / 8'), p);
    ok(p.includes('Weight increase earned'), p);
    eq([...c.d.querySelectorAll('#exList .prog .mediabar button')].map(x => text(x)), ['Accept', 'Hold at 60 kg', 'Edit']);
  });
  t('Hold goes back to 60 kg and repeats last time\'s reps; the recommendation stays on record', () => {
    const hold = [...c.d.querySelectorAll('#exList .prog .mediabar button')].find(x => /^Hold/.test(text(x)));
    click(c.w, hold);
    const e = c.A.S.sessions.find(s => s.id === c.sess.id).entries[0];
    eq(e.sets.map(x => [x.plannedWeight, x.plannedReps]), [[60, 12], [60, 12], [60, 12]]);
    eq(e.decision.prescription.load, 62.5, 'automatic recommendation untouched');
    eq(e.progressionChoice.chosen, 'held');
    ok(text(c.d.querySelector('#exList .prog .choice')).includes('recorded separately'));
  });
  c = await openCard(stateWith([12, 12, 12]));
  t('Accept keeps the recommendation and says so', () => {
    click(c.w, [...c.d.querySelectorAll('#exList .prog .mediabar button')].find(x => text(x) === 'Accept'));
    const e = c.A.S.sessions.find(s => s.id === c.sess.id).entries[0];
    eq(e.progressionChoice.chosen, 'accepted'); eq(e.sets[0].plannedWeight, 62.5);
  });
  c = await openCard(stateWith([12, 12, 12]));
  t('Edit opens a sheet showing the recommendation', () => {
    click(c.w, [...c.d.querySelectorAll('#exList .prog .mediabar button')].find(x => text(x) === 'Edit'));
    ok(c.d.querySelector('#pgSheet').classList.contains('on'));
    ok(text(c.d.querySelector('#pgBody')).includes('recommended 62.5 kg'));
  });
  t('raising the load and adding a set in one edit is refused, with the reason on screen', () => {
    c.d.querySelector('#pgLoad').value = '65'; c.d.querySelector('#pgReps').value = '8, 8, 8, 8';
    click(c.w, c.d.querySelector('#pgSave'));
    ok(/load and add sets/i.test(text(c.d.querySelector('#pgErr'))), text(c.d.querySelector('#pgErr')));
    const e = c.A.S.sessions.find(s => s.id === c.sess.id).entries[0];
    eq(e.sets.length, 3); eq(e.progressionChoice, undefined);
  });
  t('a valid edit is applied and recorded as the user\'s change', () => {
    c.d.querySelector('#pgLoad').value = '61'; c.d.querySelector('#pgReps').value = '9, 9, 8';
    click(c.w, c.d.querySelector('#pgSave'));
    const e = c.A.S.sessions.find(s => s.id === c.sess.id).entries[0];
    eq(e.progressionChoice.chosen, 'edited');
    eq(e.sets.map(x => [x.plannedWeight, x.plannedReps]), [[61, 9], [61, 9], [61, 8]]);
    eq(e.decision.prescription.load, 62.5, 'recommendation preserved beside the edit');
    ok(!c.d.querySelector('#pgSheet').classList.contains('on'), 'sheet closed');
  });
  t('once a set is logged the choice buttons are gone and the logged set is untouched', () => {
    const e = c.A.S.sessions.find(s => s.id === c.sess.id).entries[0];
    c.w.editSet(e.sets[0], 61, 9); c.A.renderAll();
    click(c.w, c.d.querySelector('#exList .ex-hd')); click(c.w, c.d.querySelector('#exList .ex-hd'));
    ok(!c.d.querySelector('#exList .prog .mediabar'), 'no buttons once performance exists');
    eq([e.sets[0].actualWeight, e.sets[0].actualReps], [61, 9]);
  });

  sec('BLOCKED INCREASE');
  c = await openCard((() => { const s = stateWith([12, 12, 12]); s.sessions[0].entries[0].sets.forEach(k => { k.actualWeight = 30; k.plannedWeight = 30; }); return s; })());
  t('the interface says why the weight cannot move', () => {
    const p = text(c.d.querySelector('#exList .prog'));
    ok(/progression limit/.test(p), p);
    ok(!c.d.querySelector('#exList .prog .mediabar button.primary'));
  });

  sec('PER-EXERCISE SETTINGS');
  c = await openCard(stateWith([12, 12, 10]));
  t('the exercise sheet shows the method and offers the settings', () => {
    c.A.openDetail(c.ex);
    const body = text(c.d.querySelector('#detailBody'));
    ok(body.includes('Double progression'), body.slice(0, 200));
    ok([...c.d.querySelectorAll('#detailBody button')].some(b => /Progression settings/.test(b.textContent)));
  });
  t('the settings sheet is filled from the resolved settings', () => {
    c.A.openProgressionSettings(c.ex);
    eq(c.d.querySelector('#psMethod').value, 'double');
    eq([c.d.querySelector('#psSets').value, c.d.querySelector('#psMin').value, c.d.querySelector('#psMax').value], ['3', '8', '12']);
    eq(c.d.querySelector('#psInc').value, '2.5');
  });
  t('invalid settings are refused with reasons and nothing is stored', () => {
    c.d.querySelector('#psMin').value = '12'; c.d.querySelector('#psMax').value = '8';
    c.d.querySelector('#psInc').value = 'abc';
    click(c.w, c.d.querySelector('#psSave'));
    ok(/maximum cannot be below/i.test(text(c.d.querySelector('#psErr'))), text(c.d.querySelector('#psErr')));
    eq(c.A.S.exerciseSettings[PD], undefined);
  });
  t('valid settings are saved for this variant only', () => {
    c.d.querySelector('#psMin').value = '6'; c.d.querySelector('#psMax').value = '10';
    c.d.querySelector('#psInc').value = '1.25, 2.5'; c.d.querySelector('#psQual').value = '2';
    c.d.querySelector('#psBoSets').value = '2'; c.d.querySelector('#psBoPct').value = '85';
    click(c.w, c.d.querySelector('#psSave'));
    const st = c.A.S.exerciseSettings[PD];
    ok(st, 'not stored');
    eq([st.repMin, st.repMax, st.increments, st.qualifyingSessions, st.backoff], [6, 10, [1.25, 2.5], 2, { sets: 2, pct: 85 }]);
    eq(Object.keys(c.A.S.exerciseSettings), [PD]);
    ok(text(c.d.querySelector('#detailBody')).includes('customised'));
  });
  t('completed sessions are unchanged by the settings change', () => {
    const done = c.A.S.sessions.find(s => s.status === 'completed');
    eq(done.entries[0].sets.map(s => s.actualReps), [12, 12, 10]);
  });
  t('reset returns the exercise to defaults', () => {
    c.A.openProgressionSettings(c.ex);
    click(c.w, c.d.querySelector('#psReset'));
    eq(c.A.S.exerciseSettings[PD], undefined);
  });

  sec('MIGRATION IN THE REAL APP');
  {
    const v3 = stateWith([12, 12, 10]); v3.schemaVersion = 3; delete v3.exerciseSettings;
    const dom = boot(v3); await wait(1300);
    const A = dom.window.__recomp;
    t('schema is current and the session survived', () => { eq(A.S.schemaVersion, 5); eq(A.S.sessions.length, 1); eq(A.S.exerciseSettings, {}); });
    t('the audit entry says v3 to v4', () => { const m = A.S.migrations.find(x => x.from === 3); eq([m.from, m.to, m.sessions], [3, 4, 1]); });
  }

  console.log('\n' + '='.repeat(62));
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log('='.repeat(62));
  server.close();
  if (fail) { fails.forEach(([n, m]) => console.log(' - ' + n + ': ' + m)); process.exit(1); }
  process.exit(0);
})();
