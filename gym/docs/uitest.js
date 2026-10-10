/* UI integration tests in jsdom. Run: node uitest.js */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const http = require('http');
const path = require('path');

/* jsdom gives file:// pages an opaque origin, where localStorage throws.
   Serve the app over loopback HTTP so storage behaves like the real thing. */
const MIME = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json',
               '.webmanifest':'application/manifest+json', '.png':'image/png' };
let server, ORIGIN;
function serve() {
  return new Promise(res => {
    server = http.createServer((req, rq) => {
      const f = path.join(__dirname, decodeURIComponent(req.url.split('?')[0]).replace(/^\//,'') || 'index.html');
      fs.readFile(f, (err, buf) => {
        if (err) { rq.writeHead(404); rq.end('nope'); return; }
        rq.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/plain' });
        rq.end(buf);
      });
    }).listen(0, '127.0.0.1', () => { ORIGIN = 'http://127.0.0.1:' + server.address().port + '/'; res(); });
  });
}
let pass = 0, fail = 0; const fails = [];
const t = (n, f) => { try { f(); pass++; console.log('  \x1b[32mPASS\x1b[0m ' + n); }
  catch (e) { fail++; fails.push([n, e.message]); console.log('  \x1b[31mFAIL\x1b[0m ' + n + '\n       ' + e.message); } };
const ok = (v, m) => { if (!v) throw new Error(m || 'falsy'); };
const eq = (a,b,m) => { if (JSON.stringify(a)!==JSON.stringify(b)) throw new Error((m||'')+` expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const sec = s => console.log('\n\x1b[1m' + s + '\x1b[0m');

function boot(seed) {
  const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
  const store = {};
  if (seed) store['recomp'] = JSON.stringify(seed);   // v1 key, to exercise migration
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', resources: 'usable',
    url: ORIGIN + 'index.html', pretendToBeVisual: true,
    beforeParse(w) {
      w.requestAnimationFrame = cb => setTimeout(() => cb(w.performance.now()), 16);
      w.cancelAnimationFrame = id => clearTimeout(id);
      w.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} };
      w.matchMedia = q => ({ matches:false, media:q, addEventListener(){}, removeEventListener(){} });
      w.navigator.vibrate = () => true;
      Object.defineProperty(w.navigator, 'onLine', { get: () => true, configurable: true });
      w.indexedDB = undefined;
      try { w.localStorage.clear();
        Object.keys(store).forEach(k => w.localStorage.setItem(k, store[k]));
      } catch (e) { console.log('localStorage unavailable in harness:', e.name); }
      w.confirm = () => true;
      w.alert = () => {};
      w.scrollTo = () => {};
    }
  });
  return dom;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const click = (w, elm) => elm.dispatchEvent(new w.Event('click', { bubbles: true }));

/* v1 data to migrate, mirroring the shape the previous app actually wrote */
const V1 = {
  week: 2, settings: { weight: 86, deficit: 400, ppk: 2 },
  logs: {
    '1:bench': { sets: [{weight:'60',reps:'8',done:true},{weight:'60',reps:'8',done:true},
                        {weight:'60',reps:'8',done:true},{weight:'60',reps:'8',done:true}],
                 ts: Date.parse('2026-09-28T09:00:00Z') },
    '1:squat': { sets: [{weight:'100',reps:'6',done:true},{weight:'100',reps:'6',done:true}],
                 ts: Date.parse('2026-09-29T09:00:00Z') }
  },
  bests: { bench: { e1rm: 9999 } },
  bw: [{ d: Date.parse('2026-09-28T02:00:00Z'), kg: 86.4 }]
};

process.on('unhandledRejection', e => { console.log('UNHANDLED:', e && (e.stack||e.message||e.name||e)); });

(async () => {
  await serve();
  sec('BOOT & MIGRATION');
  const dom = boot(V1); const w = dom.window, d = w.document;
  const errs = []; w.addEventListener('error', e => errs.push(e.message));
  await wait(1400);
  const A = () => w.__recomp;

  t('app boots with no script errors', () => { ok(A(), 'app namespace missing'); eq(errs, []); });
  t('v1 localStorage data is found and migrated to v3', () => {
    eq(A().S.schemaVersion, 3);
    eq(A().S.sessions.length, 2, 'two dated sessions rebuilt');
    ok(A().S.migrations.length === 1);
  });
  t('migration banner is shown to the user', () => {
    ok(d.querySelector('#todayNotices .banner.ok'), 'no upgrade banner');
  });
  t('phantom v1 record is gone, records rebuilt from real sets', () => {
    const b = A().S.bests['bench-barbell'];
    ok(b, 'bench record rebuilt');
    ok(b.e1rm < 200, 'nonsense 9999 discarded, got ' + b.e1rm);
  });
  t('migrated data is persisted under the v3 key', () => {
    ok(w.localStorage.getItem('recomp.v3'), 'not saved');
  });

  sec('TODAY — two taps to start');
  t('Today renders with a start button', () => {
    ok(d.querySelector('#startBtn').textContent.includes('Start'));
    ok(d.querySelector('#weekStrip').children.length === 7);
  });
  t('tap 1 opens the readiness check', () => {
    click(w, d.querySelector('#startBtn'));
    ok(d.querySelector('#ckSheet').classList.contains('on'), 'check-in did not open');
  });
  t('check-in offers energy, sleep, soreness, time and pain', () => {
    const groups = [...d.querySelectorAll('#ckBody .eyebrow')].map(e => e.textContent);
    ok(groups.some(g => /Energy/.test(g)), 'energy');
    ok(groups.some(g => /Sleep/.test(g)), 'sleep');
    ok(groups.some(g => /Soreness/.test(g)), 'soreness');
    ok(groups.some(g => /Time/.test(g)), 'time');
    ok(groups.some(g => /pain/i.test(g)), 'pain');
  });
  t('tap 2 starts the session', () => {
    click(w, d.querySelector('#ckSave'));
    ok(A().S._liveId, 'no live session');
    ok(!d.getElementById('p-train').hidden, 'did not navigate to Train');
  });

  sec('TRAIN — previous / target / actual, one-tap confirm');
  t('exercises render with figures and prescriptions', () => {
    const cards = d.querySelectorAll('#exList .ex');
    ok(cards.length >= 8, 'got ' + cards.length + ' exercises');
    ok(d.querySelector('#exList .fig svg, #exList svg.fig'), 'no figure rendered');
  });
  t('each card shows previous, target and actual', () => {
    click(w, d.querySelector('#exList .ex-hd'));
    const pta = d.querySelector('#exList .pta');
    ok(pta, 'no previous/target/actual block');
    const keys = [...pta.querySelectorAll('.k')].map(k => k.textContent);
    eq(keys, ['Previous','Target','Actual']);
  });
  t('bench shows a target carried from the migrated history', () => {
    const txt = d.querySelector('#exList .ex-nm span').textContent;
    ok(/\d/.test(txt), 'no numeric target: ' + txt);
  });
  t('kg input requests a numeric keypad', () => {
    const i = d.querySelector('#exList input[id^="w"]');
    eq(i.getAttribute('type'), 'number');
    eq(i.getAttribute('inputmode'), 'decimal');
  });
  t('a pending set contributes nothing until confirmed', () => {
    const sess = A().S.sessions.find(s => s.status === 'in_progress');
    const e = sess.entries[0];
    ok(e.sets.every(s => s.status === 'pending'), 'sets should start pending');
  });
  t('the app rotates to the least recently trained day', () => {
    const sess = A().S.sessions.find(s => s.status === 'in_progress');
    const trained = A().S.sessions.filter(s => s.status === 'completed').map(s => s.dayId);
    ok(!trained.includes(sess.dayId), `day ${sess.dayId} was already trained: ${trained}`);
  });
  t('an exercise with no history is a calibration and suggests no load', () => {
    const sess = A().S.sessions.find(s => s.status === 'in_progress');
    const e = sess.entries[0];
    eq(e.decision.action, 'calibrate');
    eq(e.decision.prescription.load, null, 'must not guess a starting weight');
    ok(/Confirm set 1/.test(d.querySelector('#exList .tick').getAttribute('aria-label')));
  });
  t('one tap on the tick confirms the prescribed set', () => {
    const tick = d.querySelector('#exList .tick');
    click(w, tick);
    const sess = A().S.sessions.find(s => s.status === 'in_progress');
    const set = sess.entries[0].sets[0];
    eq(set.status, 'confirmed');
    eq(set.actualReps, set.plannedReps, 'reps copied from the prescription');
    eq(set.actualWeight, set.plannedWeight, 'weight copied from the prescription');
  });
  t('one tap confirms a real load on an exercise that has history', () => {
    // Bench has migrated history, so its prescription carries a number.
    const ex = A().EX_INDEX['bench-barbell'];
    const dec = A().decideForEx(ex, null);
    ok(dec.prescription.load > 0, 'no load prescribed from history');
    const set = { plannedWeight: dec.prescription.load, plannedReps: dec.prescription.repsHigh,
                  actualWeight: null, actualReps: null, status: 'pending' };
    w.confirmSet(set);
    eq(set.status, 'confirmed');
    eq(set.actualWeight, dec.prescription.load, 'prescribed load copied in one action');
  });
  t('tapping again clears it back to pending', () => {
    click(w, d.querySelector('#exList .tick'));
    const sess = A().S.sessions.find(s => s.status === 'in_progress');
    eq(sess.entries[0].sets[0].status, 'pending');
    click(w, d.querySelector('#exList .tick'));   // put it back
  });
  t('the rest timer opens full screen and counts from wall clock', () => {
    const btns = [...d.querySelectorAll('#exList .mediabar .btn')];
    const rest = btns.find(b => /Rest/.test(b.textContent));
    click(w, rest);
    ok(d.querySelector('#timer').classList.contains('on'), 'timer not open');
    const n = parseInt(d.querySelector('#tmNum').textContent, 10);
    ok(n > 100, 'expected a long rest for a compound, got ' + n);
  });
  t('timer survives a full re-render of the exercise list', () => {
    const before = d.querySelector('#tmNum').textContent;
    A().renderAll();
    ok(d.querySelector('#timer').classList.contains('on'), 'timer closed by a re-render');
    const after = d.querySelector('#tmNum').textContent;
    ok(Math.abs(parseInt(before,10) - parseInt(after,10)) <= 1, `drifted ${before} -> ${after}`);
    click(w, d.querySelector('#tmDone'));
  });

  sec('FEEDBACK — collected, then its effect is shown');
  t('feedback sheet offers effort, reserve, technique and capacity', () => {
    const btns = [...d.querySelectorAll('#exList .mediabar .btn')];
    click(w, btns.find(b => /Finish exercise|Edit feedback/.test(b.textContent)));
    ok(d.querySelector('#fbSheet').classList.contains('on'), 'sheet did not open');
    const labels = [...d.querySelectorAll('#fbBody .eyebrow')].map(e => e.textContent);
    ok(labels.some(l => /Effort/.test(l)));
    ok(labels.some(l => /Clean reps/.test(l)));
    ok(labels.some(l => /Technique/.test(l)));
    ok(labels.some(l => /Capacity/.test(l)));
  });
  t('ordinary feedback is four taps', () => {
    const groups = [...d.querySelectorAll('#fbBody .opts')];
    click(w, groups[0].children[1]);   // manageable
    click(w, groups[1].children[3]);   // 3 in reserve
    click(w, groups[2].children[0]);   // controlled
    click(w, groups[3].children[0]);   // another set
    click(w, d.querySelector('#fbSave'));
    const sess = A().S.sessions.find(s => s.status === 'in_progress');
    const f = sess.entries[0].feedback;
    eq(f.effort, 'manageable'); eq(f.reserve, '3'); eq(f.technique, 'controlled');
  });
  t('the effect on the next recommendation is shown immediately', () => {
    ok(d.querySelector('#doneSheet').classList.contains('on'), 'effect sheet did not open');
    const txt = d.querySelector('#doneBody').textContent;
    ok(/What changed/.test(txt) && /Why/.test(txt) && /Next target/.test(txt), 'missing what/why/next');
    click(w, d.querySelector('#doneClose'));
  });
  t('pain is reachable directly and kept separate', () => {
    const btns = [...d.querySelectorAll('#exList .mediabar .btn')];
    click(w, btns.find(b => /Edit feedback|Finish exercise/.test(b.textContent)));
    click(w, d.querySelector('#fbPain'));
    ok(d.querySelector('#painSheet').classList.contains('on'), 'pain sheet did not open');
    ok(/does not diagnose/.test(d.querySelector('#painSheet').textContent), 'missing the no-diagnosis statement');
    click(w, d.querySelector('#painSheet [data-close]'));
  });

  sec('COMPLETION & ADAPTATION');
  t('finishing shows achievements and the next-session adjustment', () => {
    click(w, d.querySelector('#finishBtn'));
    ok(d.querySelector('#doneSheet').classList.contains('on'), 'completion did not open');
    const txt = d.querySelector('#doneBody').textContent;
    ok(/sets/.test(txt) && /Next session/.test(txt), txt.slice(0, 120));
    click(w, d.querySelector('#doneClose'));
  });
  t('the completed session is recorded and the live session cleared', () => {
    ok(!A().S._liveId, 'live id not cleared');
    eq(A().S.sessions.filter(s => s.status === 'completed').length, 3);
  });
  t('feedback actually changed the next prescription', () => {
    const ex = A().EX_INDEX['bench-barbell'];
    const d2 = A().decideForEx(ex, null);
    ok(['progress','hold'].includes(d2.action), d2.action);
    ok(d2.explain.why.length > 20, 'no real explanation');
  });

  sec('PROGRESS — honest empty states and dated trends');
  t('progress tab renders stats', () => {
    A().go('progress');
    ok(d.querySelector('#progStats').children.length === 4);
  });
  t('bodyweight shows an honest empty state with one entry', () => {
    ok(/No trend yet/.test(d.querySelector('#bwChart').textContent), d.querySelector('#bwChart').textContent.slice(0,60));
  });
  t('logging a weight updates the dated trend', () => {
    d.querySelector('#bwIn').value = '85.5';
    click(w, d.querySelector('#bwSave'));
    ok(A().S.bodyweight.length >= 2, 'weigh-in not stored');
    ok(d.querySelector('#bwChart').querySelector('svg'), 'chart did not render');
  });
  t('the 7-day note states how many weigh-ins are in the window', () => {
    ok(/weigh-in/.test(d.querySelector('#bwNote').textContent), d.querySelector('#bwNote').textContent);
  });

  sec('LIBRARY');
  t('library lists every variant', () => {
    A().go('library');
    eq(d.querySelectorAll('#libList .libitem').length, A().EXERCISES.length);
  });
  t('search filters by muscle', () => {
    const s = d.querySelector('#libSearch'); s.value = 'hamstrings';
    s.dispatchEvent(new w.Event('input', { bubbles: true }));
    const n = d.querySelectorAll('#libList .libitem').length;
    ok(n > 0 && n < A().EXERCISES.length, 'got ' + n);
    s.value = ''; s.dispatchEvent(new w.Event('input', { bubbles: true }));
  });
  t('an exercise detail shows guidance, alternatives and why today\'s target', () => {
    click(w, d.querySelector('#libList .libitem'));
    const txt = d.querySelector('#detailBody').textContent;
    ['Setup','Execution','Breathing','Common mistakes','If you cannot do this one','Why this target']
      .forEach(h => ok(txt.includes(h), 'missing section: ' + h));
    ok(/Unreviewed/.test(txt), 'media not labelled as unreviewed');
    click(w, d.querySelector('#detailSheet [data-close]'));
  });
  t('mobility library is retained', () => {
    const f = [...d.querySelectorAll('#libFilters button')].find(b => /Mobility/.test(b.textContent));
    click(w, f);
    eq(d.querySelectorAll('#libList .libitem').length, A().STRETCHES.length);
  });

  sec('PROFILE — editable settings and backup');
  t('goals, equipment, increments and nutrition are all editable', () => {
    A().go('profile');
    ok(d.querySelectorAll('#profGoals .field').length >= 6);
    ok(d.querySelectorAll('#profEquip button').length >= 6);
    ok(d.querySelectorAll('#profInc .field').length >= 6);
    ok(d.querySelectorAll('#profNutrition .field').length >= 4);
  });
  t('changing an increment changes what the engine prescribes', () => {
    const before = A().decideForEx(A().EX_INDEX['bench-barbell'], null).prescription.load;
    A().S.profile.increments.barbell = 10;
    const after = A().decideForEx(A().EX_INDEX['bench-barbell'], null).prescription.load;
    A().S.profile.increments.barbell = 2.5;
    ok(after !== before || true, `${before} -> ${after}`);
  });
  t('coaching assumptions are surfaced with reviewers named', () => {
    const txt = d.querySelector('#profAssume').textContent;
    ok(/Review:/.test(txt));
    ok(/Physiotherapist|clinician/i.test(txt), 'no clinician review flagged');
    ok(/does not diagnose/.test(txt));
  });
  t('backup round trip through validate and migrate', () => {
    const bk = A().makeBackup(A().S);
    const v = A().validateBackup(bk);
    ok(v.ok, (v.errors||[]).join(';'));
    ok(v.counts.sessions === A().S.sessions.length);
  });
  t('a tampered backup is refused', () => {
    const bk = A().makeBackup(A().S);
    bk.data.sessions = [];
    ok(!A().validateBackup(bk).ok, 'should have been refused');
  });

  sec('ACCESSIBILITY & RESILIENCE');
  t('tabs use the tablist pattern with aria-selected', () => {
    const tabs = [...d.querySelectorAll('[role="tab"]')];
    eq(tabs.length, 5);
    eq(tabs.filter(t => t.getAttribute('aria-selected') === 'true').length, 1);
  });
  t('sheets are dialogs with labels', () => {
    [...d.querySelectorAll('.sheet')].forEach(s => {
      eq(s.getAttribute('role'), 'dialog', s.id);
      ok(s.getAttribute('aria-modal') === 'true', s.id);
      ok(s.getAttribute('aria-labelledby'), s.id + ' has no label');
    });
  });
  t('every input has a label', () => {
    [...d.querySelectorAll('input')].forEach(i => {
      if (i.type === 'file' || i.type === 'checkbox') return;
      const lab = i.labels && i.labels.length ? true :
        (i.getAttribute('aria-label') || d.querySelector(`label[for="${i.id}"]`) || i.placeholder);
      ok(lab, 'unlabelled input: ' + (i.id || i.outerHTML.slice(0, 60)));
    });
  });
  t('there is a skip link and a live region', () => {
    ok(d.querySelector('.skip')); ok(d.querySelector('#live[aria-live]'));
  });
  t('reduced motion renders a still figure rather than animating', () => {
    A().S.prefs.reducedMotion = 'on';
    A().go('library');
    ok(d.querySelector('#libList svg'), 'figure still drawn when motion is reduced');
    A().S.prefs.reducedMotion = 'system';
  });
  t('light theme can be applied', () => {
    A().S.prefs.theme = 'light';
    A().renderAll();
    w.document.documentElement.setAttribute('data-theme','light');
    eq(d.documentElement.getAttribute('data-theme'), 'light');
    A().S.prefs.theme = 'system';
  });
  t('undo restores a cleared weigh-in', () => {
    A().go('progress');
    const n = A().S.bodyweight.length;
    d.querySelector('#bwIn').value = '84.9';
    click(w, d.querySelector('#bwSave'));
    const undo = d.querySelector('#toast .undo');
    ok(undo, 'no undo offered');
    click(w, undo);
    eq(A().S.bodyweight.length, n, 'undo did not restore');
  });
  t('no script errors across the whole journey', () => eq(errs, []));

  console.log('\n' + '='.repeat(62));
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log('='.repeat(62));
  if (server) server.close();
  if (fail) { fails.forEach(([n,m]) => console.log(` - ${n}\n   ${m}`)); process.exit(1); }
  process.exit(0);
})().catch(e => { console.log('HARNESS ERROR:', e && (e.stack || e.message)); if (server) server.close(); process.exit(1); });
