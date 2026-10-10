/* ============================================================================
   Recomp UI. Depends on core.js, engine.js, exercises.js, figure.js, lifts.js.
   ========================================================================== */
(function () {
'use strict';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const el = (tag, cls, html) => { const n = document.createElement(tag);
  if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

/* ------------------------------------------------------------- storage --- */
/* The storage key is namespaced per account. Two people on one phone get two
   separate documents, and logging out deletes the one that belongs to the
   account signing out. */
let KEY = 'recomp.v3';
function setStorageScope(userId) {
  KEY = userId ? `recomp.u.${userId}.state` : 'recomp.v3';
}
let hasLS = false, idb = null, memOnly = {};
function openIDB() {
  return new Promise(res => {
    try {
      if (!window.indexedDB) return res(null);
      const rq = indexedDB.open('recompDB', 2);
      rq.onupgradeneeded = () => { try { rq.result.createObjectStore('kv'); } catch (e) {} };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => res(null);
      setTimeout(() => res(rq.readyState === 'done' ? rq.result : null), 2500);
    } catch (e) { res(null); }
  });
}
const idbGet = k => new Promise(res => { if (!idb) return res(null);
  try { const r = idb.transaction('kv','readonly').objectStore('kv').get(k);
    r.onsuccess = () => res(r.result ?? null); r.onerror = () => res(null);
  } catch (e) { res(null); } });
const idbSet = (k, v) => new Promise(res => { if (!idb) return res(false);
  try { const t = idb.transaction('kv','readwrite'); t.objectStore('kv').put(v, k);
    t.oncomplete = () => res(true); t.onerror = () => res(false);
  } catch (e) { res(false); } });

async function initStorage() {
  try { localStorage.setItem('__p','1'); localStorage.removeItem('__p'); hasLS = true; } catch (e) {}
  idb = await openIDB();
}
async function loadRaw() {
  let a = null, b = null;
  if (hasLS) { try { const v = localStorage.getItem(KEY); a = v ? JSON.parse(v) : null; } catch (e) {} }
  if (idb)   { try { b = await idbGet(KEY); } catch (e) {} }
  if (!a && !b) {   // look for the v1 store from the previous app
    if (hasLS) { try { const v = localStorage.getItem('recomp'); a = v ? JSON.parse(v) : null; } catch (e) {} }
    if (!a && idb) { try { b = await idbGet('recomp'); } catch (e) {} }
  }
  if (a && b) return ((b._savedAt||0) > (a._savedAt||0)) ? b : a;
  return a || b || null;
}
/* Server sync. Local is the working copy so the app stays usable offline;
   the server is the record. A push failure never loses the local write. */
let serverVersion = 0, syncing = false, pendingPush = false, lastSyncAt = 0;
async function pushToServer() {
  if (!window.AUTH || !AUTH.user() || AUTH.isOffline()) { pendingPush = true; return false; }
  if (syncing) { pendingPush = true; return false; }
  syncing = true;
  try {
    const r = await AUTH.pushState(S, serverVersion || undefined);
    if (r.ok) { serverVersion = r.version; lastSyncAt = Date.now(); pendingPush = false; return true; }
    if (r.conflict) {
      // Another device saved first. Pull, merge sessions by id, push again.
      const pull = await AUTH.pullState();
      if (pull.ok && pull.doc) {
        const seen = new Set((S.sessions || []).map(x => x.id));
        (pull.doc.sessions || []).forEach(x => { if (!seen.has(x.id)) S.sessions.push(x); });
        const bw = new Set((S.bodyweight || []).map(x => x.date));
        (pull.doc.bodyweight || []).forEach(x => { if (!bw.has(x.date)) S.bodyweight.push(x); });
        serverVersion = pull.version;
        const again = await AUTH.pushState(S, serverVersion);
        if (again.ok) { serverVersion = again.version; pendingPush = false; return true; }
      }
    }
    if (r.forbidden) { toast('Your access to training data was removed', 'bad'); }
    pendingPush = true; return false;
  } catch (e) { pendingPush = true; return false; }
  finally { syncing = false; updateSyncBadge(); }
}
function updateSyncBadge() {
  const b = $('#storeBadge'); if (!b) return;
  if (!window.AUTH || !AUTH.user()) { b.textContent = storageLabel(); return; }
  if (AUTH.isOffline()) { b.textContent = 'Offline'; return; }
  b.textContent = pendingPush ? 'Syncing…' : 'Synced';
}
let pushTimer = null;
function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => pushToServer(), 1200);
}

let saveFailed = false;
async function persist() {
  S._savedAt = Date.now();
  let ok = false;
  const body = JSON.stringify(S);
  if (hasLS) { try { localStorage.setItem(KEY, body); ok = true; } catch (e) {} }
  if (idb)   { if (await idbSet(KEY, S)) ok = true; }
  if (!ok) memOnly[KEY] = S;
  if (!ok && !saveFailed) { saveFailed = true; banner('bad', 'Not saving to this device', 'Private browsing or full storage. Your session is held in memory only — back up before you close the app.'); }
  if (ok && saveFailed) { saveFailed = false; renderAll(); }
  schedulePush();
  return ok;
}
function storageLabel() {
  if (idb && hasLS) return 'Saved ×2';
  if (idb || hasLS) return 'Saved';
  return 'NOT SAVING';
}

/* --------------------------------------------------------------- state --- */
let S = null;
let live = { session: null };       // in-progress session
let openEx = null;
let undoStack = [];

function pushUndo(label, fn) {
  undoStack.push({ label, fn, at: Date.now() });
  if (undoStack.length > 30) undoStack.shift();
}
function doUndo() {
  const u = undoStack.pop();
  if (!u) { toast('Nothing to undo', 'warn'); return; }
  u.fn(); persist(); renderAll(); toast('Undone: ' + u.label);
}

/* ----------------------------------------------------------------- ui ----- */
let toastTimer = null;
function toast(msg, kind, undo) {
  const t = $('#toast');
  t.innerHTML = esc(msg) + (undo ? ' <span class="undo" role="button" tabindex="0">Undo</span>' : '');
  t.className = 'toast show' + (kind ? ' ' + kind : '');
  if (undo) {
    const u = t.querySelector('.undo');
    const go = () => { doUndo(); t.className = 'toast'; };
    u.onclick = go; u.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') go(); };
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, undo ? 6000 : 2400);
}
function say(msg) { $('#live').textContent = msg; }
function banner(kind, title, body) {
  const b = el('div', 'banner ' + (kind || ''), `<div><b>${esc(title)}</b><br><span class="muted">${esc(body)}</span></div>`);
  $('#todayNotices').prepend(b);
}

/* sheets ------------------------------------------------------------------ */
let lastFocus = null;
function openSheet(id) {
  lastFocus = document.activeElement;
  const s = document.getElementById(id);
  s.classList.add('on');
  const f = s.querySelector('button, input, [tabindex]');
  if (f) setTimeout(() => f.focus(), 60);
  document.body.style.overflow = 'hidden';
}
function closeSheet(id) {
  const s = document.getElementById(id);
  s.classList.remove('on');
  document.body.style.overflow = '';
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}
document.addEventListener('click', e => {
  const c = e.target.closest('[data-close]');
  if (c) { const sh = c.closest('.sheet'); if (sh) closeSheet(sh.id); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const open = $$('.sheet.on'); if (open.length) closeSheet(open[open.length - 1].id);
    else if ($('#timer').classList.contains('on')) endTimer(false);
  }
});

/* =========================================================== rest timer ===
   Wall-clock based. Survives re-renders, tab switches and backgrounding,
   because remaining time is always (end - now), never a tick count.        */
let tmInt = null, tmEnd = 0, tmTotal = 0, tmWake = null;
const ARC = 282.74;
async function wake(on) {
  try {
    if (on && 'wakeLock' in navigator && !tmWake) tmWake = await navigator.wakeLock.request('screen');
    else if (!on && tmWake) { tmWake.release(); tmWake = null; }
  } catch (e) { tmWake = null; }
}
function paintTimer() {
  const left = Math.max(0, Math.ceil((tmEnd - Date.now()) / 1000));
  const n = $('#tmNum'); n.textContent = left; n.classList.toggle('low', left <= 5);
  $('#tmArc').setAttribute('stroke-dashoffset', (ARC * (1 - (tmTotal ? left / tmTotal : 0))).toFixed(1));
  if (left <= 0) endTimer(true);
}
function startTimer(secs, label, sub) {
  if (!secs) return;
  if (tmInt) clearInterval(tmInt);
  tmTotal = secs; tmEnd = Date.now() + secs * 1000;
  $('#tmLabel').textContent = label || 'Rest';
  $('#tmSub').textContent = sub || '';
  $('#timer').classList.add('on');
  paintTimer(); tmInt = setInterval(paintTimer, 250); wake(true);
  // persist so an app restart can restore the countdown
  S._timer = { end: tmEnd, total: tmTotal, label, sub }; persist();
}
function endTimer(rang) {
  if (tmInt) { clearInterval(tmInt); tmInt = null; }
  $('#timer').classList.remove('on'); wake(false);
  delete S._timer; persist();
  if (rang) { say('Rest finished'); toast('Time'); try { navigator.vibrate && navigator.vibrate([250,110,250]); } catch (e) {} }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && tmInt) paintTimer(); });
$('#tmDone').onclick = () => endTimer(false);
$('#tmAdd').onclick = () => { if (!tmInt) return; tmEnd += 30000; tmTotal += 30; paintTimer(); };

/* ======================================================== figure helper === */
const figStops = [];
function stopFigs() { while (figStops.length) { try { figStops.pop()(); } catch (e) {} } }
function reducedMotion() {
  const p = S && S.prefs ? S.prefs.reducedMotion : 'system';
  if (p === 'on') return true; if (p === 'off') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
function mkFig(cls, animKey, big) {
  const anim = (typeof LIFTS !== 'undefined' && LIFTS[animKey]) ||
               (typeof STRETCHES !== 'undefined' && STRETCHES.find(s => s.id === animKey));
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','30 12 150 106'); svg.setAttribute('class', cls);
  svg.setAttribute('role','img');
  if (!anim) { svg.setAttribute('aria-label','No demonstration available'); return svg; }
  svg.setAttribute('aria-hidden','true');
  const opts = { near:'var(--accent)', far:'var(--dim)', body:'var(--text)', kit:'var(--muted)',
    lw: big ? 8 : 6, still: reducedMotion(),
    view: big ? {w:150,h:104,cx:105,floor:112,maxScale:1.2} : {w:150,h:96,cx:105,floor:110,maxScale:1.0} };
  try { figStops.push(animate(svg, anim, opts)); } catch (e) {}
  return svg;
}

/* ======================================================== program/days === */
function dayName(d) { const pd = programDay(d); return pd ? pd.name : 'Day ' + d; }
function dayFocus(d) {
  const pd = programDay(d); if (!pd) return '';
  return pd.exercises.slice(0, 3).map(e => (EX_INDEX[e.id] || {}).short).filter(Boolean).join(' · ');
}

/* Which day comes next: the one least recently trained. */
function nextDay() {
  const last = {};
  C_completed().forEach(s => { last[s.dayId] = s.date; });
  const n = currentProgram().days.length;
  let best = 1, bestDate = '9999';
  for (let d = 1; d <= n; d++) {
    const dt = last[d] || '0000';
    if (dt < bestDate) { bestDate = dt; best = d; }
  }
  return best;
}
function C_completed() { return completedSessions(S); }

/* The roster comes from the generated programme, so goal, experience, days per
   week, session length and equipment all actually decide what you train. */
function currentProgram() {
  const sig = [S.profile.trainingDaysPerWeek, S.profile.goal, S.profile.experience,
               S.profile.sessionMinutes,
               JSON.stringify(S.profile.equipment)].join('|');
  if (!S.program || S.program.signature !== sig) {
    const p = buildProgram(S.profile, EXERCISES);
    S.program = Object.assign({}, S.program, p, { signature: sig });
    persist();
  }
  return S.program;
}
function programDay(day) {
  const p = currentProgram();
  return p.days[(day - 1) % p.days.length] || p.days[0];
}
function rosterFor(day) {
  const pd = programDay(day);
  let list = pd.exercises.map(e => EX_INDEX[e.id]).filter(Boolean);
  // anything deferred from a shortened session of this day comes first next time
  const def = (S.deferred && S.deferred[day]) || [];
  if (def.length) {
    const back = def.map(id => EX_INDEX[id]).filter(Boolean).filter(e => !list.some(x => x.id === e.id));
    list = back.concat(list);
  }
  return list;
}
function prescriptionForProgram(ex, day) {
  const pd = programDay(day);
  return pd.exercises.find(e => e.id === ex.id) || null;
}
function hasEquipment(ex) {
  const eq = S.profile.equipment || {};
  const map = { barbell:'barbell', dumbbell:'dumbbell', machine:'machine', cable:'cable',
                bodyweight:null, assisted:'machine' };
  const need = map[ex.equipment];
  if (!need) return true;
  return eq[need] !== false;
}

/* ================================================== session lifecycle ==== */
function startSession(day, checkin) {
  const sess = newSession(day, todayISO());
  sess.checkin = checkin || null;
  const full = rosterFor(day);
  const plan = applySessionPlan(full, checkin, S.profile);
  sess.plan = { shortened: plan.shortened, kept: plan.kept.map(e => e.id),
                dropped: plan.dropped.map(e => e.id), explain: plan.explain };
  if (plan.shortened) {
    S.deferred = S.deferred || {};
    S.deferred[day] = plan.dropped.map(e => e.id);   // roll into the next session of this day
  }
  plan.kept.forEach(ex => {
    const entry = newEntry(ex.id, ex.id);
    const d = decideForEx(ex, checkin);
    entry.decision = d;
    const p = d.prescription;
    const n = p ? p.sets : ex.sets;
    for (let i = 0; i < n; i++) {
      entry.sets.push(newSet(p ? { weight: p.load, reps: p.repsHigh } : { weight: null, reps: ex.hi }));
    }
    sess.entries.push(entry);
  });
  if (S.deferred && S.deferred[day] && !plan.shortened) delete S.deferred[day];
  closeDeloadIfDue(S, todayISO());
  S.sessions.push(sess);
  live.session = sess;
  S._liveId = sess.id;
  persist();
  go('train');
  say(`${dayName(day)} started with ${sess.entries.length} exercises`);
}
function decideForEx(ex, checkin) {
  S._exIndex = EX_INDEX;
  return decide({ state: S, ex, variantId: ex.id, checkin: checkin || null,
                  todayISO: todayISO(), last: lastPerformance(S, ex.id, ex) });
}
function currentSession() {
  if (live.session) return live.session;
  if (S._liveId) {
    const s = S.sessions.find(x => x.id === S._liveId && x.status === 'in_progress');
    if (s) { live.session = s; return s; }
  }
  return null;
}
function finishSession() {
  const sess = currentSession(); if (!sess) return;
  const performed = sess.entries.reduce((a, e) => a + workingSets(e).length, 0);
  if (!performed) { toast('Nothing logged — session discarded', 'warn'); abandonSession(true); return; }
  sess.status = 'completed'; sess.endedAt = Date.now();
  recomputeBests(S, EX_INDEX);
  live.session = null; delete S._liveId;
  closeDeloadIfDue(S, todayISO());
  persist();
  if (S._updateWaiting && navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
    navigator.serviceWorker.getRegistration().then(r => {
      if (r && r.waiting && confirm('Workout saved. Apply the pending app update now?')) {
        r.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    }).catch(() => {});
  }
  showCompletion(sess);
  renderAll();
}
function abandonSession(quiet) {
  const sess = currentSession(); if (!sess) return;
  const snapshot = JSON.parse(JSON.stringify(sess));
  S.sessions = S.sessions.filter(x => x.id !== sess.id);
  live.session = null; delete S._liveId;
  pushUndo('discarded session', () => { S.sessions.push(snapshot); S._liveId = snapshot.id; live.session = snapshot; });
  persist(); go('today'); renderAll();
  if (!quiet) toast('Session discarded', 'warn', true);
}

/* ============================================================== render === */
const TITLES = { today:'Today', train:'Train', progress:'Progress', library:'Library', profile:'Profile' };
let tab = 'today';
const TAB_FEATURE = { today:'training', train:'training', progress:'progress',
                      library:'library', profile:null };
function tabAllowed(t) {
  const f = TAB_FEATURE[t];
  if (!f) return true;
  if (!window.AUTH || !AUTH.user()) return true;      // no backend: local-only mode
  return AUTH.can(f);
}
function applyPermissions() {
  if (!window.AUTH || !AUTH.user()) return;
  ['today','train','progress','library','profile'].forEach(t => {
    const b = document.querySelector(`[data-tab="${t}"]`);
    if (b) b.hidden = !tabAllowed(t);
  });
  const fuel = $('#fuelCard');
  if (fuel) {
    const ok = AUTH.can('nutrition');
    const section = fuel.previousElementSibling;
    fuel.hidden = !ok; if (section && section.tagName === 'H2') section.hidden = !ok;
  }
  if (!tabAllowed(tab)) {
    const first = ['today','train','progress','library','profile'].find(tabAllowed);
    if (first) go(first);
  }
}

function go(t) {
  if (!tabAllowed(t)) { toast('That section is not enabled for your account', 'warn'); return; }
  tab = t;
  ['today','train','progress','library','profile'].forEach(x => {
    document.getElementById('p-' + x).hidden = x !== t;
    const b = document.querySelector(`[data-tab="${x}"]`);
    b.setAttribute('aria-selected', String(x === t));
  });
  $('#screenTitle').textContent = TITLES[t];
  window.scrollTo(0, 0);
  renderAll();
  applyPermissions();
}
$$('[data-tab]').forEach(b => b.onclick = () => go(b.dataset.tab));

function renderAll() {
  stopFigs();
  $('#storeBadge').textContent = storageLabel();
  $('#storeBadge').className = 'badge' + (storageLabel() === 'NOT SAVING' ? ' live' : '');
  if (tab === 'today') renderToday();
  if (tab === 'train') renderTrain();
  if (tab === 'progress') renderProgress();
  if (tab === 'library') renderLibrary();
  if (tab === 'profile') renderProfile();
}

/* ------------------------------------------------------------- TODAY ---- */
function renderToday() {
  const notices = $('#todayNotices'); notices.innerHTML = '';
  const sess = currentSession();
  const day = sess ? sess.dayId : nextDay();
  const d = new Date();
  $('#todayDate').textContent = d.toLocaleDateString('en-AU', { weekday:'long', day:'numeric', month:'long' });
  $('#todayTitle').textContent = sess ? `${dayName(day)} in progress` : dayName(day);
  $('#todaySub').textContent = sess
    ? `${sess.entries.filter(e => workingSets(e).length).length} of ${sess.entries.length} exercises logged`
    : dayFocus(day);
  const btn = $('#startBtn');
  btn.textContent = sess ? 'Resume workout' : 'Start workout';
  btn.onclick = () => {
    if (sess) { go('train'); return; }
    openCheckin(day);            // tap 1 = Start, tap 2 = Start in the sheet
  };
  $('#readinessBtn').onclick = () => openCheckin(day, true);

  const dl = proposeDeload(S, todayISO());
  if (dl && !S._deloadDismissed) {
    const b = el('div','banner');
    b.innerHTML = `<div><b>Deload suggested</b><br><span class="muted">${esc(dl.reason)} ${esc(dl.plan)}</span></div>`;
    const acc = el('button','btn sm','Accept'); acc.onclick = () => {
      const d = acceptDeload(S, todayISO());
      persist(); toast(`Deload week: ${d.startDate} to ${d.endDate}`); renderAll(); };
    const no = el('button','btn sm ghost','Not now'); no.onclick = () => {
      dismissDeload(S, todayISO()); persist(); renderAll(); };
    const row = el('div','row'); row.style.marginTop='8px'; row.append(acc, no);
    b.querySelector('div').appendChild(row);
    notices.appendChild(b);
  }
  if (!S.lastBackupVerified || (S.lastBackup && Date.now() - S.lastBackup > 14*864e5)) {
    const b = el('div','banner');
    b.innerHTML = `<div><b>${S.lastBackup ? 'Backup is due' : 'No backup yet'}</b><br><span class="muted">Everything is stored on this device only. A backup is the only copy that survives a lost phone.</span></div>`;
    const go2 = el('button','btn sm','Back up now'); go2.style.marginTop='8px';
    go2.onclick = () => { go('profile'); setTimeout(() => $('#exportBtn') && $('#exportBtn').focus(), 200); };
    b.querySelector('div').appendChild(go2);
    notices.appendChild(b);
  }

  // week strip
  const strip = $('#weekStrip'); strip.innerHTML = '';
  const today = todayISO();
  const monday = addDays(today, -((new Date().getDay() + 6) % 7));
  let doneCount = 0;
  for (let i = 0; i < 7; i++) {
    const iso = addDays(monday, i);
    const ses = S.sessions.filter(s => s.date === iso && s.status === 'completed');
    if (ses.length) doneCount++;
    const cell = el('div', (ses.length ? 'done ' : '') + (iso === today ? 'today' : ''));
    cell.innerHTML = `<span>${['M','T','W','T','F','S','S'][i]}</span><span>${ses.length ? ses.length : '·'}</span>`;
    cell.setAttribute('aria-label', `${iso}: ${ses.length ? ses.length + ' session(s)' : 'no session'}`);
    strip.appendChild(cell);
  }
  $('#weekSummary').textContent = `${doneCount} of ${S.profile.trainingDaysPerWeek} planned days done this week.`;

  $('#insight').innerHTML = buildInsight();
  renderFuel();
}

function buildInsight() {
  const done = C_completed();
  if (!done.length) return `<b>Nothing logged yet.</b><p class="muted" style="margin:4px 0 0">
    Your first session of each exercise is a calibration — the app suggests no load until it has seen you lift.</p>`;
  // most recent decisions that changed something
  const recent = done.slice(-1)[0];
  const changed = recent.entries.filter(e => e.decision && e.decision.action === 'progress');
  const bw = trailingAverage(S, 7);
  const prior = trailingAverage(S, 7, addDays(todayISO(), -7));
  if (changed.length) {
    const names = changed.slice(0,3).map(e => (EX_INDEX[e.variantId]||{}).short || e.variantId);
    return `<b>${changed.length} lift${changed.length>1?'s':''} moved up last session.</b>
      <p class="muted" style="margin:4px 0 0">${esc(names.join(', '))}. Each increase was earned by effort and technique feedback, not by rep completion alone.</p>`;
  }
  if (bw.avg != null && prior.avg != null) {
    const delta = bw.avg - prior.avg;
    const dir = delta < 0 ? 'down' : 'up';
    return `<b>Bodyweight ${dir} ${Math.abs(delta).toFixed(1)} kg on the 7-day average.</b>
      <p class="muted" style="margin:4px 0 0">${bw.n} weigh-in${bw.n===1?'':'s'} in the window. Single days bounce around; the calendar average is what to act on.</p>`;
  }
  const holds = done.slice(-1)[0].entries.filter(e => e.decision && e.decision.action === 'hold').length;
  if (holds) return `<b>${holds} lift${holds>1?'s are':' is'} holding.</b>
    <p class="muted" style="margin:4px 0 0">A hold is the engine waiting for a clean, controlled session with reps to spare before it adds load.</p>`;
  return `<b>${done.length} session${done.length>1?'s':''} logged.</b>
    <p class="muted" style="margin:4px 0 0">Log bodyweight a few times a week and the trend becomes useful within a fortnight.</p>`;
}

function renderFuel() {
  const t = macroTargets(S);
  const plan = buildMealPlan(t);
  const c = $('#fuelCard');
  c.innerHTML = `
    <div class="grid4">
      <div class="stat"><div class="n">${t.kcal}</div><div class="l">kcal</div></div>
      <div class="stat"><div class="n" style="color:var(--accent)">${t.protein}</div><div class="l">protein g</div></div>
      <div class="stat"><div class="n">${t.carbs}</div><div class="l">carbs g</div></div>
      <div class="stat"><div class="n">${t.fat}</div><div class="l">fat g</div></div>
    </div>
    <p class="dim" style="margin:10px 0 0;font-size:.8rem">
      From ${t.bodyweightKg} kg × ${S.nutrition.maintenanceFactor} = ${t.maintenance} kcal maintenance, less a ${S.nutrition.deficitKcal} kcal deficit.
      ${t.floored ? ' Floored at 1,200 kcal.' : ''} Maintenance is a population formula, not a measurement.</p>`;
  const det = el('details'); det.style.marginTop = '10px';
  det.innerHTML = `<summary style="cursor:pointer;font-family:var(--display);font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:.72rem;color:var(--muted);min-height:44px;display:flex;align-items:center">A day that hits these numbers</summary>`;
  plan.plan.forEach(m => {
    const items = m.items.map(i => `${i.qty}${FOOD[i.food].per === 'ea' ? '' : FOOD[i.food].per} ${esc(FOOD[i.food].label)}`).join(' · ');
    det.appendChild(el('div', null, `<div style="margin-top:8px"><b style="font-size:.86rem">${esc(m.slot)}</b><br>
      <span class="muted" style="font-size:.84rem">${items}</span></div>`));
  });
  det.appendChild(el('p','dim',`Plan totals ${plan.totals.kcal} kcal · ${plan.totals.p}P ${plan.totals.c}C ${plan.totals.f}F. Regenerated whenever your targets change.`));
  det.lastChild.style.cssText = 'font-size:.78rem;margin-top:10px';
  c.appendChild(det);
}

/* ------------------------------------------------------------- TRAIN ---- */
function renderTrain() {
  const sess = currentSession();
  const notices = $('#trainNotices'); notices.innerHTML = '';
  const list = $('#exList'); list.innerHTML = '';
  if (!sess) {
    $('#trainDay').textContent = 'No session running';
    $('#trainMeta').textContent = '';
    $('#finishBtn').hidden = true; $('#abandonBtn').hidden = true;
    list.appendChild(el('div','empty','<b>Nothing in progress</b>Start a workout from Today and it appears here.'));
    return;
  }
  $('#finishBtn').hidden = false; $('#abandonBtn').hidden = false;
  $('#trainDay').textContent = dayName(sess.dayId);
  const logged = sess.entries.filter(e => workingSets(e).length).length;
  $('#trainMeta').textContent = `${logged}/${sess.entries.length} exercises · started ${new Date(sess.startedAt).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'})}`;
  $('#finishBtn').onclick = finishSession;
  $('#abandonBtn').onclick = () => { if (confirm('Discard this session and everything logged in it?')) abandonSession(); };

  if (sess.plan && sess.plan.shortened) {
    const b = el('div','banner');
    b.innerHTML = `<div><b>${esc(sess.plan.explain.what)}</b><br>
      <span class="muted">${esc(sess.plan.explain.why)}</span><br>
      <span class="dim" style="font-size:.8rem">${esc(sess.plan.explain.next)}</span></div>`;
    notices.appendChild(b);
  }
  const advice = sessionPlanAdvice(sess.checkin, S.profile.sessionMinutes, sess.entries.length);
  (advice || []).filter(a => a.action !== 'shorten').forEach(a => {
    const b = el('div','banner' + (a.action === 'pain_review' ? ' bad' : ''));
    b.innerHTML = `<div><b>${esc(a.explain.what)}</b><br><span class="muted">${esc(a.explain.why)}</span></div>`;
    notices.appendChild(b);
  });

  sess.entries.forEach((entry, idx) => list.appendChild(exCard(sess, entry, idx)));
}

function exCard(sess, entry, idx) {
  const ex = EX_INDEX[entry.variantId];
  const d = entry.decision;
  const done = workingSets(entry).length > 0;
  const card = el('div','ex' + (done ? ' done' : '') + (openEx === entry.variantId ? ' open' : ''));

  const hd = el('button','ex-hd');
  hd.setAttribute('aria-expanded', String(openEx === entry.variantId));
  hd.appendChild(mkFig('fig', ex.anim, false));
  const nm = el('div','ex-nm');
  const p = d && d.prescription;
  const tgt = p ? prescriptionText(p, ex) : 'Choose your load';
  nm.innerHTML = `<b>${esc(ex.name)}</b><span>${esc(tgt)}</span>`;
  hd.appendChild(nm);
  if (d) hd.appendChild(el('span','pill ' + pillKind(d.action), actionLabel(d.action)));
  hd.appendChild(el('span','chev','▶'));
  hd.onclick = () => { openEx = (openEx === entry.variantId) ? null : entry.variantId; renderTrain(); };
  card.appendChild(hd);

  const body = el('div','ex-body');

  // A paused exercise shows no sets at all: there is nothing to log.
  if (d && d.paused) {
    card.classList.add('paused');
    const warn = el('div','banner bad');
    warn.innerHTML = `<div><b>${esc(d.explain.what)}</b><br><span class="muted">${esc(d.explain.why)}</span>
      <br><span class="dim" style="font-size:.8rem">${esc(d.explain.next)}</span></div>`;
    body.appendChild(warn);
    const opts = el('div','mediabar');
    (d.resumeOptions || []).forEach(o => {
      const b = el('button','btn sm' + (o.id === 'clear' ? '' : ' ghost'), esc(o.label));
      b.title = o.detail;
      b.onclick = () => {
        if (o.id === 'substitute') { swapExercise(sess, entry, ex); }
        else if (o.id === 'skip') {
          entry.skipped = true; persist(); renderTrain(); toast('Skipped — nothing logged');
        } else if (o.id === 'clear') {
          const c = openConcernFor(S, entry.variantId);
          if (!c) { toast('No open concern to clear', 'warn'); return; }
          if (!confirm('Only clear this if the movement is genuinely pain-free, or a clinician has cleared you. Clear it?')) return;
          resolvePainConcern(S, c.id, todayISO(), 'cleared by user in app');
          entry.decision = decideForEx(ex, sess.checkin);
          entry.sets = [];
          const p2 = entry.decision.prescription;
          for (let k = 0; k < (p2 ? p2.sets : ex.sets); k++) {
            entry.sets.push(newSet(p2 ? { weight: p2.load, reps: p2.repsHigh } : { weight: null, reps: ex.hi }));
          }
          persist(); renderTrain(); toast('Concern cleared');
        }
      };
      opts.appendChild(b);
    });
    body.appendChild(opts);
    card.appendChild(body);
    return card;   // no sets, no tick, no timer — paused means paused
  }

  // previous / target / actual
  const last = lastPerformance(S, entry.variantId, ex);
  const perf = workingSets(entry);
  const pta = el('div','pta');
  pta.innerHTML = `
    <div><span class="k">Previous</span><span class="v">${last ? esc(shortSummary(last.summary, ex)) : '—'}</span></div>
    <div class="target"><span class="k">Target</span><span class="v">${p && p.load != null ? p.load + (ex.modality==='assisted'?' asst':'') : '—'}</span></div>
    <div><span class="k">Actual</span><span class="v">${perf.length ? esc(actualSummary(perf, ex)) : '—'}</span></div>`;
  body.appendChild(pta);

  // explanation
  if (d && d.explain) {
    const why = el('dl','why');
    why.innerHTML = `<dt>What changed</dt><dd>${esc(d.explain.what)}</dd>
      <dt>Why</dt><dd>${esc(d.explain.why)}</dd>
      <dt>Next target</dt><dd>${esc(d.explain.next)}</dd>`;
    body.appendChild(why);
  }

  // sets
  entry.sets.forEach((set, i) => body.appendChild(setRow(sess, entry, ex, set, i)));

  // actions
  const bar = el('div','mediabar');
  const restBtn = el('button','btn sm', `Rest ${ex.restSec}s`);
  restBtn.onclick = () => startTimer(ex.restSec, 'Rest', ex.name);
  const fbBtn = el('button','btn sm' + (entry.feedback ? '' : ' primary'),
    entry.feedback ? 'Edit feedback' : 'Finish exercise');
  fbBtn.onclick = () => openFeedback(sess, entry, ex);
  const guideBtn = el('button','btn sm ghost','Guidance');
  guideBtn.onclick = () => openDetail(ex);
  const subBtn = el('button','btn sm ghost','Swap');
  subBtn.onclick = () => swapExercise(sess, entry, ex);
  bar.append(restBtn, fbBtn, guideBtn, subBtn);
  body.appendChild(bar);

  card.appendChild(body);
  if (openEx === entry.variantId) {
    // big figure only while open, so only one animation runs at a time
    const big = mkFig('figbig', ex.anim, true);
    body.insertBefore(big, body.firstChild);
  }
  return card;
}

function setRow(sess, entry, ex, set, i) {
  const row = el('div','setrow' + (set.status === 'pending' ? ' suggested' : ''));
  const unit = ex.unit || (MODALITY[ex.modality] || {}).unit || 'reps';
  row.appendChild(el('div','sn', String(i + 1)));

  const wf = el('div','fld');
  wf.innerHTML = `<label for="w${entry.variantId}${i}">${ex.modality === 'assisted' ? 'asst' : 'kg'}</label>`;
  const w = el('input'); w.id = `w${entry.variantId}${i}`; w.type = 'number'; w.step = '0.5';
  w.inputMode = 'decimal'; w.enterKeyHint = 'next';
  w.value = set.actualWeight != null ? set.actualWeight : '';
  w.placeholder = set.plannedWeight != null ? set.plannedWeight : '—';
  wf.appendChild(w);

  const rf = el('div','fld');
  rf.innerHTML = `<label for="r${entry.variantId}${i}">${unit}</label>`;
  const r = el('input'); r.id = `r${entry.variantId}${i}`; r.type = 'number'; r.step = '1';
  r.inputMode = 'numeric'; r.enterKeyHint = 'done';
  r.value = set.actualReps != null ? set.actualReps : '';
  r.placeholder = set.plannedReps != null ? set.plannedReps : '—';
  rf.appendChild(r);

  [w, r].forEach(inp => {
    inp.addEventListener('focus', () => { setTimeout(() => { try { inp.select(); } catch (e) {} }, 0); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
    inp.addEventListener('change', () => {
      const before = JSON.parse(JSON.stringify(set));
      editSet(set, w.value, r.value);
      pushUndo('set edit', () => Object.assign(set, before));
      persist(); renderTrain();
    });
  });
  row.append(wf, rf);

  const tick = el('button','tick' + (isPerformed(set) ? ' on' : ''), isPerformed(set) ? '✓' : '○');
  tick.setAttribute('aria-label', isPerformed(set)
    ? `Set ${i+1} logged. Tap to clear.`
    : `Confirm set ${i+1} as prescribed: ${set.plannedWeight ?? '—'} for ${set.plannedReps ?? '—'} ${unit}`);
  tick.onclick = () => {
    const before = JSON.parse(JSON.stringify(set));
    if (isPerformed(set)) { unlogSet(set); }
    else if (w.value !== '' || r.value !== '') { editSet(set, w.value, r.value); }
    else { confirmSet(set); }            // one tap confirms the prescribed set
    pushUndo('set', () => Object.assign(set, before));
    persist();
    if (isPerformed(set) && S.prefs.restTimerAutoStart && i < entry.sets.length - 1) {
      startTimer(ex.restSec, 'Rest', ex.name);
    }
    renderTrain();
    say(isPerformed(set) ? `Set ${i+1} logged` : `Set ${i+1} cleared`);
  };
  row.appendChild(tick);
  return row;
}

function prescriptionText(p, ex) {
  if (p.load == null) return `Calibrate · ${p.sets} × ${p.repsLow}–${p.repsHigh} ${p.unit}`;
  const l = ex.modality === 'assisted' ? `${p.load} kg assist`
          : ex.modality === 'bodyweight_reps' ? (p.load ? `BW +${p.load} kg` : 'bodyweight')
          : `${p.load} kg`;
  const reps = p.repsLow === p.repsHigh ? p.repsLow : `${p.repsLow}–${p.repsHigh}`;
  return `${p.sets} × ${reps} ${p.unit} · ${l}`;
}
function shortSummary(sum, ex) {
  if (sum.workingWeight == null) return '—';
  return `${sum.workingWeight}×${sum.repsAtWorkingWeight[0] ?? sum.maxReps ?? '?'}`;
}
function actualSummary(sets, ex) {
  const w = modeWeight(sets);
  const reps = sets.filter(s => s.actualWeight === w).map(s => s.actualReps).join(',');
  return `${w ?? 0}×${reps || '—'}`;
}
function pillKind(a) {
  if (a === 'progress') return 'go';
  if (a === 'reduce' || a === 'review') return 'down';
  return 'hold';
}
function actionLabel(a) {
  return ({ progress:'Up', hold:'Hold', reduce:'Down', substitute:'Swap',
            review:'Review', calibrate:'Calibrate' })[a] || a;
}

function swapExercise(sess, entry, ex) {
  const alts = (ex.alternatives || []).map(id => EX_INDEX[id]).filter(Boolean);
  if (!alts.length) { toast('No alternative on file for this one', 'warn'); return; }
  const names = alts.map((a, i) => `${i + 1}. ${a.name}`).join('\n');
  const pick = prompt(`Swap ${ex.name} for:\n${names}\n\nEnter a number, or Cancel.`);
  const i = parseInt(pick, 10) - 1;
  if (!(i >= 0 && i < alts.length)) return;
  const before = JSON.parse(JSON.stringify(entry));
  const nx = alts[i];
  entry.substitutedFrom = entry.variantId;
  entry.variantId = nx.id; entry.exerciseId = nx.id;
  entry.decision = decideForEx(nx, sess.checkin);
  entry.sets = [];
  const p = entry.decision.prescription;
  for (let k = 0; k < (p ? p.sets : nx.sets); k++) {
    entry.sets.push(newSet(p ? { weight: p.load, reps: p.repsHigh } : { weight: null, reps: nx.hi }));
  }
  pushUndo('swap', () => Object.assign(entry, before));
  persist(); renderTrain();
  toast(`Swapped to ${nx.short}`, null, true);
}

/* --------------------------------------------------------- FEEDBACK ----- */
let fbCtx = null;
function openFeedback(sess, entry, ex) {
  fbCtx = { sess, entry, ex, draft: Object.assign(blankFeedback(), entry.feedback || {}) };
  $('#fbTitle').textContent = ex.short;
  const b = $('#fbBody'); b.innerHTML = '';
  b.appendChild(optGroup('Effort', 'effort', [
    ['very_easy','Very easy'],['manageable','Manageable'],['challenging','Challenging'],
    ['near_limit','Near limit'],['maximum','Maximum']]));
  b.appendChild(optGroup('Clean reps still possible', 'reserve', [
    ['0','0'],['1','1'],['2','2'],['3','3'],['4+','4+'],['unsure','Unsure']]));
  b.appendChild(optGroup('Technique', 'technique', [
    ['controlled','Controlled'],['deteriorating','Deteriorating'],['unsure','Unsure']]));
  b.appendChild(optGroup('Capacity', 'capacity', [
    ['another_set','Could do another set'],['enough','Enough today'],['needed_less','Needed less']]));
  openSheet('fbSheet');
}
function optGroup(label, key, opts) {
  const g = el('div','fbgroup');
  g.appendChild(el('span','eyebrow', esc(label)));
  const row = el('div','opts');
  row.setAttribute('role','group'); row.setAttribute('aria-label', label);
  opts.forEach(([v, lab]) => {
    const btn = el('button', null, esc(lab));
    btn.type = 'button';
    btn.setAttribute('aria-pressed', String(fbCtx.draft[key] === v));
    btn.onclick = () => {
      fbCtx.draft[key] = (fbCtx.draft[key] === v) ? null : v;
      [...row.children].forEach(c => c.setAttribute('aria-pressed', String(c === btn && fbCtx.draft[key] === v)));
    };
    row.appendChild(btn);
  });
  g.appendChild(row);
  return g;
}
$('#fbSave').onclick = () => {
  if (!fbCtx) return;
  const before = fbCtx.entry.feedback ? JSON.parse(JSON.stringify(fbCtx.entry.feedback)) : null;
  fbCtx.draft.at = Date.now();
  fbCtx.entry.feedback = fbCtx.draft;
  pushUndo('feedback', () => { fbCtx.entry.feedback = before; });
  persist();
  closeSheet('fbSheet');
  showEffect(fbCtx.entry, fbCtx.ex);
};
$('#fbPain').onclick = () => { closeSheet('fbSheet'); openPain(fbCtx.entry, fbCtx.ex); };

/* After feedback, show what it actually did to the next recommendation. */
function showEffect(entry, ex) {
  // Simulate the next decision as if this session were already completed.
  const snapshot = JSON.parse(JSON.stringify(S));
  const sess = currentSession();
  const wasStatus = sess.status; sess.status = 'completed';
  let next;
  try { next = decideForEx(ex, sess.checkin); } finally { sess.status = wasStatus; }
  S.sessions = snapshot.sessions ? S.sessions : S.sessions;   // no mutation beyond status
  const d = $('#doneBody');
  $('#doneTitle').textContent = ex.short + ' — effect on next session';
  d.innerHTML = `<div class="why" style="margin-top:10px">
      <dt>What changed</dt><dd>${esc(next.explain.what)}</dd>
      <dt>Why</dt><dd>${esc(next.explain.why)}</dd>
      <dt>Next target</dt><dd>${esc(next.explain.next)}</dd></div>
    <p class="dim" style="font-size:.8rem;margin-top:10px">This is a preview from the feedback you just gave. Change the feedback and this changes with it.</p>`;
  openSheet('doneSheet');
  renderTrain();
}
$('#doneClose').onclick = () => closeSheet('doneSheet');

/* ------------------------------------------------------------- PAIN ----- */
let painCtx = null;
function openPain(entry, ex) {
  painCtx = { entry, ex, draft: blankPain() };
  const b = $('#painBody'); b.innerHTML = '';
  const g1 = el('div','fbgroup');
  g1.appendChild(el('span','eyebrow','Where'));
  const row = el('div','opts danger');
  ['Shoulder','Elbow','Wrist','Lower back','Hip','Knee','Ankle','Other'].forEach(loc => {
    const btn = el('button', null, loc); btn.type = 'button';
    btn.onclick = () => { painCtx.draft.location = loc; painCtx.draft.present = true;
      [...row.children].forEach(c => c.setAttribute('aria-pressed', String(c === btn))); };
    row.appendChild(btn);
  });
  g1.appendChild(row); b.appendChild(g1);

  const g2 = el('div','fbgroup');
  g2.appendChild(el('span','eyebrow','Severity (optional, 1–10)'));
  const sc = el('div','scale');
  for (let i = 1; i <= 10; i++) {
    const btn = el('button', null, String(i)); btn.type = 'button';
    btn.onclick = () => { painCtx.draft.severity = i;
      [...sc.children].forEach(c => c.setAttribute('aria-pressed', String(c === btn))); };
    sc.appendChild(btn);
  }
  g2.appendChild(sc); b.appendChild(g2);

  const g3 = el('div','fbgroup');
  g3.appendChild(el('span','eyebrow','Describe it (optional)'));
  const ta = el('input','search'); ta.placeholder = 'e.g. sharp at the bottom of the rep';
  ta.oninput = () => painCtx.draft.note = ta.value;
  g3.appendChild(ta); b.appendChild(g3);
  openSheet('painSheet');
}
$('#painSave').onclick = () => {
  if (!painCtx) return;
  painCtx.draft.present = true;
  const fb = painCtx.entry.feedback || blankFeedback();
  fb.pain = painCtx.draft; fb.at = Date.now();
  painCtx.entry.feedback = fb;
  persist(); closeSheet('painSheet');
  showEffect(painCtx.entry, painCtx.ex);
  say('Pain recorded. This exercise is flagged for review.');
};

/* --------------------------------------------------------- CHECK-IN ----- */
let ckCtx = null;
function openCheckin(day, previewOnly) {
  ckCtx = { day, previewOnly, draft: blankCheckin() };
  const b = $('#ckBody'); b.innerHTML = '';
  b.appendChild(scaleGroup('Energy', 'energy', 'Flat', 'Fresh'));
  b.appendChild(scaleGroup('Sleep', 'sleep', 'Poor', 'Great'));
  b.appendChild(scaleGroup('Soreness', 'soreness', 'None', 'Very sore'));
  const g = el('div','fbgroup');
  g.appendChild(el('span','eyebrow','Time available'));
  const row = el('div','opts');
  [20,30,45,60,90].forEach(m => {
    const btn = el('button', null, m + ' min'); btn.type = 'button';
    btn.onclick = () => { ckCtx.draft.timeAvailableMin = m;
      [...row.children].forEach(c => c.setAttribute('aria-pressed', String(c === btn))); };
    row.appendChild(btn);
  });
  g.appendChild(row); b.appendChild(g);

  const pg = el('div','fbgroup');
  pg.appendChild(el('span','eyebrow','Any pain today?'));
  const prow = el('div','opts danger');
  const no = el('button', null, 'No pain'); no.type = 'button'; no.setAttribute('aria-pressed','true');
  no.onclick = () => { ckCtx.draft.pain = null; no.setAttribute('aria-pressed','true');
    [...prow.children].forEach(c => { if (c !== no) c.setAttribute('aria-pressed','false'); }); };
  prow.appendChild(no);
  ['Shoulder','Elbow','Lower back','Hip','Knee','Other'].forEach(loc => {
    const btn = el('button', null, loc); btn.type = 'button';
    btn.onclick = () => { ckCtx.draft.pain = { present: true, location: loc, severity: null, note: null };
      [...prow.children].forEach(c => c.setAttribute('aria-pressed', String(c === btn))); };
    prow.appendChild(btn);
  });
  pg.appendChild(prow);
  pg.appendChild(el('p','dim','Pain is recorded separately. It never changes your readiness score and is never treated as effort.'));
  pg.lastChild.style.cssText = 'font-size:.78rem;margin:8px 0 0';
  b.appendChild(pg);

  $('#ckSave').textContent = previewOnly ? 'Save check-in' : 'Start workout';
  openSheet('ckSheet');
}
function scaleGroup(label, key, lo, hi) {
  const g = el('div','fbgroup');
  g.appendChild(el('span','eyebrow', `${label} — ${lo} to ${hi}`));
  const row = el('div','scale');
  row.setAttribute('role','group'); row.setAttribute('aria-label', label);
  for (let i = 1; i <= 5; i++) {
    const btn = el('button', null, String(i)); btn.type = 'button';
    btn.setAttribute('aria-label', `${label} ${i} of 5`);
    btn.onclick = () => { ckCtx.draft[key] = i;
      [...row.children].forEach(c => c.setAttribute('aria-pressed', String(c === btn))); };
    row.appendChild(btn);
  }
  g.appendChild(row);
  return g;
}
$('#ckSave').onclick = () => {
  const ck = ckCtx.draft; ck.at = Date.now();
  closeSheet('ckSheet');
  if (ckCtx.previewOnly) { S.lastCheckin = ck; persist(); toast('Check-in saved'); renderAll(); return; }
  startSession(ckCtx.day, ck);
};
$('#ckSkip').onclick = () => { closeSheet('ckSheet'); if (!ckCtx.previewOnly) startSession(ckCtx.day, null); };

/* ------------------------------------------------------- COMPLETION ----- */
function showCompletion(sess) {
  const d = $('#doneBody');
  $('#doneTitle').textContent = `${dayName(sess.dayId)} complete`;
  const rows = [];
  let vol = 0, sets = 0;
  sess.entries.forEach(e => {
    const ex = EX_INDEX[e.variantId]; if (!ex) return;
    const ws = workingSets(e); if (!ws.length) return;
    sets += ws.length;
    const sum = summariseEntry(e, ex);
    vol += sum.volume;
    const next = decideForEx(ex, null);
    rows.push(`<div style="padding:10px 0;border-bottom:1px solid var(--line)">
      <div class="spread"><b>${esc(ex.short)}</b>
        <span class="pill ${pillKind(next.action)}">${actionLabel(next.action)}</span></div>
      <div class="muted" style="font-size:.84rem">${esc(actualSummary(ws, ex))} · ${ws.length} sets</div>
      <div class="dim" style="font-size:.82rem;margin-top:4px">${esc(next.explain.what)}</div></div>`);
  });
  const newBests = Object.keys(S.bests).filter(k => S.bests[k] && S.bests[k].e1rm_on === sess.date);
  d.innerHTML = `
    <div class="grid4" style="margin:12px 0">
      <div class="stat"><div class="n">${sets}</div><div class="l">sets</div></div>
      <div class="stat"><div class="n">${Math.round(vol)}</div><div class="l">kg volume</div></div>
      <div class="stat"><div class="n">${rows.length}</div><div class="l">exercises</div></div>
      <div class="stat"><div class="n" style="color:var(--accent)">${newBests.length}</div><div class="l">records</div></div>
    </div>
    <span class="eyebrow">Next session</span>
    ${rows.join('') || '<p class="muted">Nothing was logged.</p>'}
    <p class="dim" style="font-size:.8rem;margin-top:10px">Every line above comes from what you actually logged plus the feedback you gave. Change a set or the feedback and these change too.</p>`;
  openSheet('doneSheet');
}

/* --------------------------------------------------------- PROGRESS ----- */
function renderProgress() {
  const done = C_completed();
  const sets = done.reduce((a,s) => a + s.entries.reduce((b,e) => b + workingSets(e).length, 0), 0);
  const vol = done.reduce((a,s) => a + s.entries.reduce((b,e) =>
    b + summariseEntry(e, EX_INDEX[e.variantId]).volume, 0), 0);
  const weeks = new Set(done.map(s => s.date.slice(0,4) + '-' + weekNum(s.date))).size;
  $('#progStats').innerHTML = `
    <div class="stat"><div class="n">${done.length}</div><div class="l">sessions</div></div>
    <div class="stat"><div class="n">${sets}</div><div class="l">working sets</div></div>
    <div class="stat"><div class="n">${(vol/1000).toFixed(1)}t</div><div class="l">volume</div></div>
    <div class="stat"><div class="n">${weeks}</div><div class="l">weeks trained</div></div>`;

  // bodyweight
  const bw = bwSortedLocal();
  const bwc = $('#bwChart');
  if (bw.length < 2) {
    bwc.innerHTML = '<div class="empty"><b>No trend yet</b>Log your weight on two separate days and a dated trend appears here.</div>';
    $('#bwNote').textContent = bw.length ? '1 entry so far.' : '';
  } else {
    bwc.innerHTML = lineChart(bw.map(e => ({ x: e.date, y: e.kg })), 'kg');
    const t7 = trailingAverage(S, 7), p7 = trailingAverage(S, 7, addDays(todayISO(), -7));
    const rate = weeklyRate(S, 20);
    $('#bwNote').textContent =
      `7-day average ${t7.avg != null ? t7.avg.toFixed(1) + ' kg from ' + t7.n + ' weigh-in' + (t7.n===1?'':'s') : 'unavailable — no weigh-ins in the last 7 days'}`
      + (p7.avg != null && t7.avg != null ? ` · ${(t7.avg - p7.avg >= 0 ? '+' : '')}${(t7.avg - p7.avg).toFixed(1)} kg vs the week before` : '')
      + (rate != null ? ` · trend ${rate >= 0 ? '+' : ''}${rate.toFixed(2)} kg/week` : '');
  }

  // strength
  const sc = $('#strengthChart');
  const mains = ['squat-barbell','bench-barbell','deadlift-conventional','row-barbell'];
  const series = mains.map(id => ({ id, name: (EX_INDEX[id]||{}).short || id,
    pts: historyFor(S, id).map(h => ({ x: h.session.date,
      y: Math.max(...workingSets(h.entry).map(s => e1rm(s.actualWeight||0, s.actualReps||0))) })) }))
    .filter(s => s.pts.length);
  sc.innerHTML = series.length
    ? multiLine(series) + '<p class="dim" style="font-size:.78rem;margin:8px 0 0">Estimated 1RM (Epley). Accuracy degrades above about 10 reps.</p>'
    : '<div class="empty"><b>No strength trend yet</b>Log a main lift and its estimated 1RM appears here, dated.</div>';

  // consistency
  const cc = $('#consistChart');
  const last8 = [];
  for (let w = 7; w >= 0; w--) {
    const end = addDays(todayISO(), -w * 7);
    const start = addDays(end, -6);
    last8.push({ label: start.slice(5), n: done.filter(s => s.date >= start && s.date <= end).length });
  }
  cc.innerHTML = done.length
    ? barChart(last8, S.profile.trainingDaysPerWeek)
    : '<div class="empty"><b>Nothing to show</b>Sessions per week appears once you have logged one.</div>';

  // workload per muscle, last 7 days
  const wl = {};
  done.filter(s => s.date >= addDays(todayISO(), -6)).forEach(s => s.entries.forEach(e => {
    const ex = EX_INDEX[e.variantId]; if (!ex) return;
    wl[ex.primary] = (wl[ex.primary] || 0) + workingSets(e).length;
  }));
  const keys = Object.keys(wl).sort((a,b) => wl[b] - wl[a]);
  $('#workloadChart').innerHTML = keys.length
    ? `<h3 class="eyebrow">Working sets per muscle, last 7 days</h3>` +
      keys.map(k => `<div class="spread" style="padding:6px 0"><span>${esc(k)}</span>
        <span class="num" style="color:${wl[k] > 22 ? 'var(--warn)' : 'var(--text)'}">${wl[k]}</span></div>`).join('') +
      `<p class="dim" style="font-size:.78rem;margin-top:6px">Above 22 sets in a week the engine stops adding load for that muscle.</p>`
    : '<div class="empty"><b>No workload this week</b>Sets per muscle group appears after your next session.</div>';

  // records
  const rl = $('#recordList');
  const ids = Object.keys(S.bests || {});
  rl.innerHTML = ids.length ? '' : '<div class="empty"><b>No records yet</b>Records are recalculated from your logs every time, so correcting a typo corrects the record.</div>';
  ids.forEach(id => {
    const ex = EX_INDEX[id]; const b = S.bests[id]; if (!ex) return;
    const bits = [];
    if (b.heaviest != null) bits.push(`${b.heaviest} kg`);
    if (b.e1rm != null) bits.push(`${b.e1rm} kg e1RM`);
    if (b.leastAssist != null) bits.push(`${b.leastAssist} kg assist`);
    if (b.mostReps != null) bits.push(`${b.mostReps} reps`);
    if (b.longestHold != null) bits.push(`${b.longestHold}s`);
    rl.appendChild(el('div', null,
      `<div class="spread" style="padding:9px 0;border-bottom:1px solid var(--line)">
        <span>${esc(ex.short)}</span><span class="num">${esc(bits.join(' · ') || '—')}</span></div>`));
  });
}
function bwSortedLocal() { return [...(S.bodyweight||[])].sort((a,b) => a.date < b.date ? -1 : 1); }
function weekNum(iso) {
  const [y,m,d] = iso.split('-').map(Number); const dt = new Date(y, m-1, d);
  const jan = new Date(y,0,1);
  return String(Math.ceil(((dt - jan)/864e5 + jan.getDay() + 1)/7)).padStart(2,'0');
}
function lineChart(pts, unit) {
  const W = 520, H = 160, pad = 30;
  const ys = pts.map(p => p.y), mn = Math.min(...ys), mx = Math.max(...ys), sp = (mx-mn)||1;
  const X = i => pad + (pts.length < 2 ? .5*(W-2*pad) : (i/(pts.length-1))*(W-2*pad));
  const Y = v => H - pad - ((v-mn)/sp)*(H-2*pad);
  const path = pts.map((p,i) => (i?'L':'M') + X(i).toFixed(1) + ' ' + Y(p.y).toFixed(1)).join(' ');
  const last = pts[pts.length-1];
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Trend from ${pts[0].x} to ${last.x}, latest ${last.y} ${unit}">
    <line x1="${pad}" y1="${H-pad}" x2="${W-pad}" y2="${H-pad}" stroke="var(--line)"/>
    <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>
    ${pts.map((p,i)=>`<circle cx="${X(i).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="2.6" fill="var(--accent)"/>`).join('')}
    <text x="${W-pad}" y="${(Y(last.y)-9).toFixed(1)}" fill="var(--accent)" font-family="monospace" font-size="13" font-weight="700" text-anchor="end">${last.y}</text>
    <text x="${pad}" y="${H-8}" fill="var(--dim)" font-family="monospace" font-size="10">${pts[0].x}</text>
    <text x="${W-pad}" y="${H-8}" fill="var(--dim)" font-family="monospace" font-size="10" text-anchor="end">${last.x}</text>
  </svg>`;
}
function multiLine(series) {
  const W = 520, H = 170, pad = 30;
  const all = series.flatMap(s => s.pts.map(p => p.y));
  const mn = Math.min(...all), mx = Math.max(...all), sp = (mx-mn)||1;
  const N = Math.max(...series.map(s => s.pts.length));
  const cols = ['var(--accent)','var(--text)','var(--muted)','var(--dim)'];
  const X = i => pad + (N<2 ? .5*(W-2*pad) : (i/(N-1))*(W-2*pad));
  const Y = v => H - pad - ((v-mn)/sp)*(H-2*pad);
  const paths = series.map((s,k) => {
    const d = s.pts.map((p,i) => (i?'L':'M') + X(i).toFixed(1) + ' ' + Y(p.y).toFixed(1)).join(' ');
    return `<path d="${d}" fill="none" stroke="${cols[k%4]}" stroke-width="2.4"/>`;
  }).join('');
  const legend = series.map((s,k) =>
    `<span style="color:${cols[k%4]};font-family:var(--mono);font-size:.7rem;margin-right:12px">■ ${esc(s.name)} ${s.pts[s.pts.length-1].y}</span>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Estimated one rep max over time for ${series.map(s=>s.name).join(', ')}">
    <line x1="${pad}" y1="${H-pad}" x2="${W-pad}" y2="${H-pad}" stroke="var(--line)"/>${paths}</svg>
    <div style="margin-top:6px">${legend}</div>`;
}
function barChart(rows, target) {
  const mx = Math.max(target || 1, ...rows.map(r => r.n), 1);
  return `<h3 class="eyebrow">Sessions per week</h3>
  <div style="display:flex;gap:6px;align-items:flex-end;height:110px;margin-top:8px">
  ${rows.map(r => `<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%">
    <div style="width:100%;height:${Math.max(3,(r.n/mx)*86)}px;background:${r.n >= (target||0) ? 'var(--accent)' : 'var(--surface-3)'};border-radius:5px 5px 0 0" title="${r.n} sessions"></div>
    <span class="dim" style="font-family:var(--mono);font-size:.6rem;margin-top:4px">${r.label}</span></div>`).join('')}
  </div><p class="dim" style="font-size:.78rem;margin-top:6px">Target ${target} per week.</p>`;
}

/* ---------------------------------------------------------- LIBRARY ----- */
let libFilter = 'all', libQuery = '';
function renderLibrary() {
  const f = $('#libFilters'); f.innerHTML = '';
  [['all','All'],['1','Upper A'],['2','Lower A'],['3','Upper B'],['4','Lower B'],['mob','Mobility']]
    .forEach(([v,lab]) => {
      const b = el('button', null, lab); b.type = 'button';
      b.setAttribute('aria-pressed', String(libFilter === v));
      b.onclick = () => { libFilter = v; renderLibrary(); };
      f.appendChild(b);
    });
  const list = $('#libList'); list.innerHTML = '';
  const q = libQuery.toLowerCase();
  if (libFilter === 'mob') {
    (typeof STRETCHES !== 'undefined' ? STRETCHES : []).forEach(s => {
      if (q && !(s.name + s.why).toLowerCase().includes(q)) return;
      const b = el('button','libitem');
      b.appendChild(mkFig('fig', s.id, false));
      b.appendChild(el('div','ex-nm', `<b>${esc(s.name)}</b><span>${esc(s.time)} · ${esc(s.block === 'warm' ? 'Before lifting' : 'After / rest day')}</span>`));
      b.onclick = () => openStretch(s);
      list.appendChild(b);
    });
    return;
  }
  EXERCISES.filter(e => libFilter === 'all' || String(e.day) === libFilter)
    .filter(e => !q || (e.name + ' ' + e.primary + ' ' + e.equipment + ' ' + (e.secondary||[]).join(' ')).toLowerCase().includes(q))
    .forEach(e => {
      const b = el('button','libitem');
      b.appendChild(mkFig('fig', e.anim, false));
      b.appendChild(el('div','ex-nm', `<b>${esc(e.name)}</b><span>${esc(e.primary)} · ${esc(e.equipment)}</span>`));
      b.onclick = () => openDetail(e);
      list.appendChild(b);
    });
  if (!list.children.length) list.appendChild(el('div','empty','<b>Nothing matches</b>Try a muscle, a piece of equipment, or part of the name.'));
}
$('#libSearch').addEventListener('input', e => { libQuery = e.target.value; renderLibrary(); });

function openDetail(ex) {
  $('#detailTitle').textContent = ex.name;
  const b = $('#detailBody'); b.innerHTML = '';
  const fig = mkFig('figbig', ex.anim, true);
  b.appendChild(fig);
  const bar = el('div','mediabar');
  const pause = el('button','btn sm', reducedMotion() ? 'Play' : 'Pause');
  let stopped = reducedMotion();
  pause.onclick = () => {
    stopped = !stopped;
    pause.textContent = stopped ? 'Play' : 'Pause';
    const it = fig.__fig; if (it) it.paused = stopped;
  };
  bar.appendChild(pause);
  bar.appendChild(el('span','dim','Diagram, not a technique reference. Unreviewed.'));
  bar.lastChild.style.fontSize = '.74rem';
  b.appendChild(bar);

  const g = el('div','guide');
  const last = lastPerformance(S, ex.id, ex);
  const d = decideForEx(ex, null);
  g.innerHTML = `
    <div class="pta" style="margin-top:12px">
      <div><span class="k">Previous</span><span class="v">${last ? esc(shortSummary(last.summary, ex)) : '—'}</span></div>
      <div class="target"><span class="k">Today</span><span class="v">${d.prescription && d.prescription.load != null ? d.prescription.load : '—'}</span></div>
      <div><span class="k">Modality</span><span class="v" style="font-size:.7rem">${esc(ex.modality.replace(/_/g,' '))}</span></div>
    </div>
    <dl class="why"><dt>Why this target</dt><dd>${esc(d.explain.why)}</dd>
      <dt>Next</dt><dd>${esc(d.explain.next)}</dd></dl>
    <h4>Movement</h4><ul><li>${esc(ex.direction)}</li>
      <li>Primary: ${esc(ex.primary)}${ex.secondary && ex.secondary.length ? '. Also: ' + esc(ex.secondary.join(', ')) : ''}</li></ul>
    <h4>Setup</h4><ul>${ex.setup.map(c => `<li>${esc(c)}</li>`).join('')}</ul>
    <h4>Execution</h4><ul>${ex.execution.map(c => `<li>${esc(c)}</li>`).join('')}</ul>
    <h4>Breathing</h4><ul><li>${esc(ex.breathing)}</li></ul>
    <h4>Common mistakes</h4><ul>${ex.mistakes.map(c => `<li>${esc(c)}</li>`).join('')}</ul>
    <h4>If you cannot do this one</h4><ul>${ex.alternatives.map(a =>
      `<li>${esc((EX_INDEX[a]||{}).name || a)}</li>`).join('')}</ul>
    ${ex.progressionNote ? `<h4>How it progresses</h4><ul><li>${esc(ex.progressionNote)}</li></ul>` : ''}
    ${ex.prerequisite ? `<h4>Before this</h4><ul><li>${esc((EX_INDEX[ex.prerequisite]||{}).name)}</li></ul>` : ''}`;
  b.appendChild(g);
  openSheet('detailSheet');
}
function openStretch(s) {
  $('#detailTitle').textContent = s.name;
  const b = $('#detailBody'); b.innerHTML = '';
  b.appendChild(mkFig('figbig', s.id, true));
  b.appendChild(el('div','guide', `<h4>Why</h4><ul><li>${esc(s.why)}</li></ul>
    <h4>How</h4><ul><li>${esc(s.how)}</li></ul><h4>Dose</h4><ul><li>${esc(s.time)}</li></ul>`));
  const secs = parseInt((s.time.match(/(\d+)\s*s/)||[])[1]||0, 10);
  if (secs) { const btn = el('button','btn block', `Hold ${secs}s`);
    btn.style.marginTop='10px'; btn.onclick = () => startTimer(secs, 'Hold', s.name); b.appendChild(btn); }
  openSheet('detailSheet');
}

/* ---------------------------------------------------------- PROFILE ----- */
function renderProfile() {
  const P = S.profile;
  const g = $('#profGoals'); g.innerHTML = '';
  g.appendChild(selectField('Goal','goal',P.goal,[['recomp','Recomposition'],['strength','Strength'],['hypertrophy','Hypertrophy'],['fatloss','Fat loss']],v=>{P.goal=v;}));
  g.appendChild(selectField('Experience','experience',P.experience,[['novice','Novice'],['intermediate','Intermediate'],['advanced','Advanced']],v=>{P.experience=v;}));
  g.appendChild(numField('Training days per week', P.trainingDaysPerWeek, 1, v => P.trainingDaysPerWeek = v));
  g.appendChild(numField('Session length (min)', P.sessionMinutes, 5, v => P.sessionMinutes = v));
  g.appendChild(numField('Bodyweight (kg)', P.bodyweightKg, 0.5, v => P.bodyweightKg = v));
  g.appendChild(numField('Max load jump (%)', P.maxLoadJumpPct, 1, v => P.maxLoadJumpPct = v));
  g.appendChild(numField('Treat as a break after (days)', P.returnBreakDays, 1, v => P.returnBreakDays = v));

  const prog = currentProgram();
  g.appendChild(el('p','dim',
    `<b style="color:var(--text)">Your programme:</b> ${esc(prog.explain)}` +
    (prog.notes && prog.notes.length ? '<br>' + prog.notes.map(esc).join('<br>') : '')));
  g.lastChild.style.cssText = 'font-size:.82rem;margin:12px 0 0;line-height:1.5';

  const eq = $('#profEquip'); eq.innerHTML = '';
  Object.keys(P.equipment).forEach(k => {
    const b = el('button', null, k.replace(/([A-Z])/g,' $1')); b.type = 'button';
    b.setAttribute('aria-pressed', String(!!P.equipment[k]));
    b.onclick = () => { P.equipment[k] = !P.equipment[k]; persist(); renderProfile(); };
    eq.appendChild(b);
  });

  const inc = $('#profInc'); inc.innerHTML = '';
  Object.keys(P.increments).forEach(k => inc.appendChild(
    numField(k.charAt(0).toUpperCase()+k.slice(1)+' (kg)', P.increments[k], 0.25, v => P.increments[k] = v)));
  inc.appendChild(el('p','dim','The smallest jump you can actually make in your gym. The engine never prescribes a load you cannot load.'));
  inc.lastChild.style.cssText='font-size:.8rem;margin:10px 0 0';

  const nu = $('#profNutrition'); nu.innerHTML = '';
  nu.appendChild(numField('Daily deficit (kcal)', S.nutrition.deficitKcal, 50, v => S.nutrition.deficitKcal = v));
  nu.appendChild(numField('Protein (g/kg)', S.nutrition.proteinPerKg, 0.1, v => S.nutrition.proteinPerKg = v));
  nu.appendChild(numField('Fat (g/kg)', S.nutrition.fatPerKg, 0.1, v => S.nutrition.fatPerKg = v));
  nu.appendChild(numField('Maintenance (kcal/kg)', S.nutrition.maintenanceFactor, 1, v => S.nutrition.maintenanceFactor = v));

  const pr = $('#profPrefs'); pr.innerHTML = '';
  pr.appendChild(selectField('Theme','theme',S.prefs.theme,[['system','Match device'],['dark','Dark'],['light','Light']],v=>{S.prefs.theme=v;applyTheme();}));
  pr.appendChild(selectField('Motion','reducedMotion',S.prefs.reducedMotion,[['system','Match device'],['on','Reduce motion'],['off','Full motion']],v=>{S.prefs.reducedMotion=v;applyTheme();}));
  pr.appendChild(toggleField('Start the rest timer automatically', S.prefs.restTimerAutoStart, v => S.prefs.restTimerAutoStart = v));

  const dt = $('#profData'); dt.innerHTML = '';
  const line = el('p','muted');
  line.style.cssText='font-size:.86rem;margin:0 0 10px';
  line.innerHTML = `Stored on this device${idb && hasLS ? ' in two places' : ''}. ${
    S.lastBackup ? 'Last verified backup ' + new Date(S.lastBackup).toLocaleDateString('en-AU') + '.'
                 : '<b>Never backed up.</b>'} Schema v${S.schemaVersion}, ${S.sessions.length} sessions.`;
  dt.appendChild(line);
  const exp = el('button','btn primary block','Back up my data'); exp.id = 'exportBtn';
  exp.onclick = doExport; dt.appendChild(exp);
  const lab = el('label','btn ghost block'); lab.textContent = 'Restore from a backup';
  lab.setAttribute('for','importFile'); lab.style.marginTop='8px'; dt.appendChild(lab);
  const fi = el('input'); fi.type='file'; fi.id='importFile'; fi.accept='application/json,.json';
  fi.className='sr-only'; fi.onchange = doImport; dt.appendChild(fi);
  if (S.migrations && S.migrations.length) {
    const m = S.migrations[S.migrations.length-1];
    dt.appendChild(el('p','dim',`Migrated from schema v${m.from} on ${new Date(m.at).toLocaleDateString('en-AU')}: ${esc(m.note||'')}`));
    dt.lastChild.style.cssText='font-size:.78rem;margin-top:10px';
  }
  const reset = el('button','btn ghost block','Erase everything'); reset.style.marginTop='8px';
  reset.onclick = () => { if (confirm('Erase all sessions, records and settings? This cannot be undone.')) {
    S = blankState(); persist(); renderAll(); toast('Everything erased','warn'); } };
  dt.appendChild(reset);

  const as = $('#profAssume');
  as.innerHTML = `<p class="muted" style="font-size:.86rem;margin:0 0 10px">
    The engine encodes judgement calls. These are the ones a qualified coach or clinician should review.
    This app does not diagnose injuries or prescribe rehabilitation.</p>` +
    COACHING_ASSUMPTIONS.map(a => `<div style="padding:9px 0;border-bottom:1px solid var(--line)">
      <b style="font-size:.9rem">${esc(a.claim)}</b>
      <div class="muted" style="font-size:.82rem;margin-top:2px">${esc(a.basis)}</div>
      <div class="dim" style="font-size:.78rem;margin-top:2px">Review: ${esc(a.review)}</div></div>`).join('');
}
function numField(label, value, step, set) {
  const f = el('div','field');
  const id = 'f' + Math.random().toString(36).slice(2,7);
  f.innerHTML = `<label for="${id}">${esc(label)}</label>`;
  const i = el('input'); i.id = id; i.type='number'; i.step=String(step); i.inputMode='decimal'; i.value = value;
  i.onchange = () => { const v = parseFloat(i.value); if (!isNaN(v)) { set(v); persist(); renderAll(); } };
  f.appendChild(i); return f;
}
function selectField(label, key, value, opts, set) {
  const f = el('div','field');
  const id = 'f' + Math.random().toString(36).slice(2,7);
  f.innerHTML = `<label for="${id}">${esc(label)}</label>`;
  const s = el('select'); s.id = id;
  opts.forEach(([v,l]) => { const o = el('option', null, esc(l)); o.value = v; if (v === value) o.selected = true; s.appendChild(o); });
  s.onchange = () => { set(s.value); persist(); renderAll(); };
  f.appendChild(s); return f;
}
function toggleField(label, value, set) {
  const f = el('div','field');
  const id = 'f' + Math.random().toString(36).slice(2,7);
  f.innerHTML = `<label for="${id}">${esc(label)}</label>`;
  const w = el('label','switch');
  const i = el('input'); i.type='checkbox'; i.id=id; i.checked = !!value;
  i.onchange = () => { set(i.checked); persist(); };
  w.append(i, el('span')); f.appendChild(w); return f;
}

/* ----------------------------------------------------------- backup ----- */
async function doExport() {
  const bk = makeBackup(S);
  const check = validateBackup(bk);
  if (!check.ok) { toast('Backup failed its own check — nothing saved', 'bad'); return; }
  const body = JSON.stringify(bk, null, 2);
  const name = `recomp-backup-${todayISO()}.json`;
  let delivered = false;
  if (navigator.share && navigator.canShare) {
    try {
      const file = new File([body], name, { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Recomp backup' });
        delivered = true;
      }
    } catch (e) { if (e && e.name === 'AbortError') { toast('Backup cancelled — not saved', 'warn'); return; } }
  }
  if (!delivered) {
    try {
      const blob = new Blob([body], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = el('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 600);
      delivered = true;
    } catch (e) { delivered = false; }
  }
  if (!delivered) { toast('Could not write the backup file', 'bad'); return; }
  S.lastBackup = Date.now(); S.lastBackupVerified = true;
  await persist(); renderAll();
  toast(`Backed up ${check.counts.sessions} sessions`);
}
function doImport(e) {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = async () => {
    let obj;
    try { obj = JSON.parse(r.result); }
    catch (err) { toast('That file is not valid JSON', 'bad'); return; }
    const v = validateBackup(obj);
    if (!v.ok) { alert('This backup cannot be restored:\n\n' + v.errors.join('\n')); return; }
    const mig = migrate(obj.data, { dayOfExercise: dayOfExerciseMap(), exIndex: EX_INDEX, variantMap: LEGACY_ID_MAP });
    if (!mig.state) { alert(mig.error || 'Could not read that backup.'); return; }
    const msg = `Restore ${v.counts.sessions} sessions and ${v.counts.bodyweight} weigh-ins from ${
      v.exportedAt ? new Date(v.exportedAt).toLocaleString('en-AU') : 'an unknown date'}?
${v.warnings && v.warnings.length ? '\nWarnings:\n' + v.warnings.join('\n') + '\n' : ''}
This replaces everything currently on this device.`;
    if (!confirm(msg)) return;
    S = mig.state; S._exIndex = EX_INDEX;
    recomputeBests(S, EX_INDEX);
    live.session = null;
    await persist(); applyTheme(); renderAll();
    toast(`Restored ${v.counts.sessions} sessions`);
  };
  r.readAsText(f); e.target.value = '';
}

/* ------------------------------------------------------------ theme ----- */
function applyTheme() {
  const t = S && S.prefs ? S.prefs.theme : 'system';
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  const m = S && S.prefs ? S.prefs.reducedMotion : 'system';
  if (m === 'on') document.documentElement.setAttribute('data-motion','off');
  else document.documentElement.removeAttribute('data-motion');
}

/* ------------------------------------------------------- bodyweight ----- */
$('#bwSave').onclick = () => {
  const v = parseFloat($('#bwIn').value);
  if (!v || v < 30 || v > 250) { toast('Enter a weight between 30 and 250 kg', 'warn'); return; }
  const before = JSON.parse(JSON.stringify(S.bodyweight));
  logBodyweight(S, v, todayISO());
  pushUndo('weigh-in', () => { S.bodyweight = before; });
  $('#bwIn').value = '';
  persist(); renderProgress(); toast('Logged', null, true);
};


/* ============================================================================
   AUTH GATE
   The app does not render until the server says who you are. When there is no
   backend (a static deployment, or the API unreachable on first run) the app
   falls back to local-only mode rather than locking you out of your own data.
   ========================================================================== */
let AUTH_MODE = 'local';     // local | server | offline

function showGate(view, opts) {
  opts = opts || {};
  const gate = $('#authGate');
  gate.hidden = false;
  document.body.classList.add('locked');
  $('#loginForm').hidden = view !== 'login';
  $('#pwForm').hidden = view !== 'password';
  $('#setupForm').hidden = view !== 'setup';
  $('#authBlocked').hidden = view !== 'blocked';
  $('#authHeading').textContent =
    view === 'password' ? 'New password' : view === 'blocked' ? 'No access'
    : view === 'setup' ? 'Set up your account' : 'Sign in';
  $('#authSub').textContent =
    view === 'password' ? 'This replaces the temporary password you were given.'
    : view === 'setup' ? 'First time only. Enter your login and choose your own password.'
    : view === 'blocked' ? ''
    : 'Your training data is private to your account.';
  if (view === 'blocked') $('#authBlockedMsg').textContent = opts.message || '';
  $('#authFoot').textContent = opts.foot || '';
  const focus = gate.querySelector('form:not([hidden]) input, #authBackBtn');
  if (focus) setTimeout(() => focus.focus(), 80);
}
function hideGate() {
  $('#authGate').hidden = true;
  document.body.classList.remove('locked');
}

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#loginBtn'), errEl = $('#loginError');
  errEl.hidden = true; btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const r = await AUTH.login($('#loginEmail').value.trim(), $('#loginPassword').value);
    if (!r.ok) {
      errEl.textContent = r.error; errEl.hidden = false;
      if (r.accountStatus && r.accountStatus !== 'active') {
        showGate('blocked', { message: r.error });
      }
      return;
    }
    $('#loginPassword').value = '';
    await afterSignIn(r.user);
  } catch (e2) {
    errEl.textContent = 'Could not reach the server. Check your connection.';
    errEl.hidden = false;
  } finally { btn.disabled = false; btn.textContent = 'Sign in'; }
});

$('#setupForm').addEventListener('submit', async e => {
  e.preventDefault();
  const errEl = $('#setupError'); errEl.hidden = true;
  const pw = $('#setupPw').value;
  if (pw !== $('#setupConfirm').value) { errEl.textContent = 'The two passwords do not match.'; errEl.hidden = false; return; }
  const btn = $('#setupBtn'); btn.disabled = true; btn.textContent = 'Creating…';
  try {
    const r = await AUTH.setup($('#setupEmail').value.trim(), pw);
    if (!r.ok) { errEl.textContent = r.error; errEl.hidden = false; return; }
    $('#setupPw').value = $('#setupConfirm').value = '';
    await afterSignIn(r.user);
  } catch (e2) {
    errEl.textContent = 'Could not reach the server. Check your connection.'; errEl.hidden = false;
  } finally { btn.disabled = false; btn.textContent = 'Create my account'; }
});

$('#pwForm').addEventListener('submit', async e => {
  e.preventDefault();
  const errEl = $('#pwError'); errEl.hidden = true;
  const next = $('#pwNext').value, confirm2 = $('#pwConfirm').value;
  if (next !== confirm2) { errEl.textContent = 'The two new passwords do not match.'; errEl.hidden = false; return; }
  const btn = $('#pwBtn'); btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const r = await AUTH.changePassword($('#pwCurrent').value, next);
    if (!r.ok) { errEl.textContent = r.error; errEl.hidden = false; return; }
    $('#pwCurrent').value = $('#pwNext').value = $('#pwConfirm').value = '';
    await afterSignIn(AUTH.user());
  } finally { btn.disabled = false; btn.textContent = 'Set password and continue'; }
});

$('#authBackBtn').addEventListener('click', () => showGate('login'));

/* One initialisation path, shared by first boot and by signing in. Takes the
   server document when there is one, otherwise whatever is on this device. */
async function initialiseState(serverDoc) {
  let source = serverDoc;
  if (!source) source = await loadRaw();
  const res = migrate(source, { dayOfExercise: dayOfExerciseMap(), exIndex: EX_INDEX, variantMap: LEGACY_ID_MAP });
  if (!res.state) {
    document.body.innerHTML = `<div class="wrap" style="padding:40px 16px">
      <h1>Can't open your data</h1><p class="muted">${esc(res.error || '')}</p></div>`;
    return false;
  }
  S = res.state; S._exIndex = EX_INDEX;
  if (res.migrated) recomputeBests(S, EX_INDEX);
  if (S._timer && S._timer.end > Date.now()) {
    tmTotal = S._timer.total; tmEnd = S._timer.end;
    $('#tmLabel').textContent = S._timer.label || 'Rest';
    $('#tmSub').textContent = S._timer.sub || '';
    $('#timer').classList.add('on'); paintTimer(); tmInt = setInterval(paintTimer, 250);
  } else if (S._timer) { delete S._timer; }
  applyTheme();
  return res;
}

/* Signed in: scope local storage to this account, load from the server, and
   offer to bring across anything that was stored locally before accounts. */
async function afterSignIn(user) {
  if (user.mustChangePassword) { showGate('password'); return; }
  AUTH_MODE = 'server';
  setStorageScope(user.id);

  const legacy = await readLegacyLocal();
  const pulled = await AUTH.pullState();
  if (pulled.forbidden) {
    showGate('blocked', { message: pulled.error || 'Training data is not enabled for your account.' });
    return;
  }
  if (pulled.ok) serverVersion = pulled.version || 0;

  const res = await initialiseState(pulled.ok ? pulled.doc : null);
  if (!res) return;

  hideGate();
  recomputeBests(S, EX_INDEX);
  await persist();
  currentSession();
  go('today');
  applyPermissions();
  updateAccountButton();

  if (legacy && (legacy.sessions || []).length) offerLegacyImport(legacy);
}

/* Data written before accounts existed, under the old unscoped key. */
async function readLegacyLocal() {
  try {
    const raw = localStorage.getItem('recomp.v3') || localStorage.getItem('recomp');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return (parsed && (parsed.sessions || parsed.logs)) ? parsed : null;
  } catch (e) { return null; }
}
async function offerLegacyImport(legacy) {
  const res = migrate(legacy, { dayOfExercise: dayOfExerciseMap(), exIndex: EX_INDEX, variantMap: LEGACY_ID_MAP });
  if (!res.state) return;
  const doc = res.state;
  const r = await AUTH.api('/api/import/preview', { method: 'POST', body: { doc } });
  if (r.status !== 200) return;
  const p = r.data.preview;
  if (!p.newSessions && !p.newWeighIns) return;
  const msg = `This device has ${p.incomingSessions} session${p.incomingSessions === 1 ? '' : 's'} saved ` +
    `from before you had an account.\n\n` +
    `New to your account: ${p.newSessions} session${p.newSessions === 1 ? '' : 's'}, ` +
    `${p.newWeighIns} weigh-in${p.newWeighIns === 1 ? '' : 's'}.\n` +
    `Already there: ${p.duplicateSessions}.\n\n` +
    `Import them? Nothing is deleted and duplicates are skipped.`;
  if (!confirm(msg)) return;
  const c = await AUTH.api('/api/import/commit', { method: 'POST', body: { doc } });
  if (c.status === 200) {
    const pulled = await AUTH.pullState();
    if (pulled.ok && pulled.doc) {
      const m2 = migrate(pulled.doc, { dayOfExercise: dayOfExerciseMap(), exIndex: EX_INDEX, variantMap: LEGACY_ID_MAP });
      if (m2.state) { S = m2.state; S._exIndex = EX_INDEX; serverVersion = pulled.version; }
    }
    try { localStorage.removeItem('recomp.v3'); localStorage.removeItem('recomp'); } catch (e) {}
    recomputeBests(S, EX_INDEX); await persist(); renderAll();
    toast(`Imported ${c.data.sessions} sessions into your account`);
  }
}

function updateAccountButton() {
  const b = $('#acctBtn');
  if (AUTH_MODE === 'local') { b.hidden = true; return; }
  if (!window.AUTH || !AUTH.user()) { b.hidden = true; return; }
  const u = AUTH.user();
  b.hidden = false;
  b.textContent = (u.name || u.email).split('@')[0];
  b.title = `${u.email} · ${u.role}`;
  b.onclick = async () => {
    if (!confirm(`Signed in as ${u.email}.\n\nSign out? Anything not yet synced stays on this device until you sign back in.`)) return;
    await AUTH.logout();
    S = blankState(); S._exIndex = EX_INDEX;
    setStorageScope(null);
    AUTH_MODE = 'local';
    location.reload();
  };
}

/* Decide how the app starts. */
async function resolveSession() {
  if (!window.AUTH) return { mode: 'local' };
  let r;
  try { r = await AUTH.refresh(); } catch (e) { return { mode: 'local' }; }
  if (r.state === 'authenticated') {
    if (r.user.mustChangePassword) { showGate('password'); return { mode: 'gate' }; }
    setStorageScope(r.user.id);
    return { mode: 'server', user: r.user };
  }
  if (r.state === 'offline') {
    setStorageScope(r.user.id);
    const hours = Math.round(r.expiresInMs / 3600000);
    return { mode: 'offline', user: r.user, note:
      `Working offline. Your account is re-checked when you reconnect; offline access lasts about ${hours} more hours.` };
  }
  if (r.state === 'offline_expired') {
    showGate('login', { foot: r.message });
    return { mode: 'gate' };
  }
  if (r.state === 'anonymous') { showGate(r.setupAvailable ? 'setup' : 'login'); return { mode: 'gate' }; }
  if (r.state === 'no_backend') return { mode: 'local' };   // static deploy, no accounts
  return { mode: 'local' };
}

/* --------------------------------------------------------- lifecycle ---- */
window.addEventListener('online',  () => {
  $('#offlineBadge').hidden = true;
  if (AUTH_MODE !== 'local' && window.AUTH) {
    AUTH.refresh().then(r => {
      if (r.state === 'authenticated') { pushToServer(); updateSyncBadge(); }
      else if (r.state === 'anonymous') { showGate('login', { foot: 'Your session ended. Sign in to keep syncing.' }); }
    });
  }
});
window.addEventListener('offline', () => { $('#offlineBadge').hidden = false; });

(async function boot() {
  await initStorage();

  /* Who is this? The answer decides which storage namespace to open. */
  const sess = await resolveSession();
  if (sess.mode === 'gate') return;                   // the gate owns the screen
  AUTH_MODE = sess.mode;

  let serverDoc = null;
  if (AUTH_MODE === 'server') {
    const pulled = await AUTH.pullState();
    if (pulled.forbidden) { showGate('blocked', { message: pulled.error }); return; }
    if (pulled.ok) { serverDoc = pulled.doc; serverVersion = pulled.version || 0; }
  }
  const res = await initialiseState(serverDoc);
  if (!res) return;
  if (res.migrated) await persist();
  if (!navigator.onLine) $('#offlineBadge').hidden = false;
  if (AUTH_MODE === 'server' || AUTH_MODE === 'offline') { hideGate(); updateAccountButton(); }

  currentSession();
  go('today');
  applyPermissions();
  if (sess.note) banner('ok', 'Offline', sess.note);
  if (res.migrated) {
    banner('ok','Your data was upgraded',
      `${S.sessions.length} sessions were rebuilt from week-numbered logs into dated sessions. Records were recalculated from the actual sets. Dates for migrated sessions are estimated where the old data had no timestamp.`);
  }
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register('sw.js');
        const offer = worker => {
          if (!worker) return;
          // Never swap code out from under a running workout.
          if (currentSession()) {
            S._updateWaiting = true;
            toast('Update ready — it will apply after this workout', 'warn');
            return;
          }
          if (confirm('A new version of Recomp is ready. Reload to apply it?')) {
            worker.postMessage({ type: 'SKIP_WAITING' });
          } else { S._updateWaiting = true; }
        };
        if (reg.waiting) offer(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => { if (nw.state === 'installed' && reg.waiting) offer(reg.waiting); });
        });
        let reloading = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (reloading) return; reloading = true; location.reload();
        });
      } catch (e) {}
    });
  }
})();

window.__recomp = {
  get S() { return S; }, set S(v) { S = v; },
  go, renderAll, startTimer, decideForEx, persist,
  EXERCISES, EX_INDEX, STRETCHES: (typeof STRETCHES !== 'undefined' ? STRETCHES : []),
  makeBackup, validateBackup, migrate, LEGACY_ID_MAP,
  currentProgram, rosterFor, startSession, finishSession, nextDay,
  resolveSession, afterSignIn, showGate, hideGate, applyPermissions, tabAllowed,
  pushToServer, get AUTH_MODE() { return AUTH_MODE; }, setStorageScope,
  acceptDeload, dismissDeload, inDeload, applySessionPlan, buildProgram,
  openConcernFor, resolvePainConcern, syncPainConcerns,
  paused_variant: null
};
})();
