/* WORKOUTS, STRETCH and RECOVERY.
   Workouts: this week's assigned sessions and a searchable library, with a
   preview of what an extra session does to the week before it is added.
   Stretch: routines with timers and side changes, recommended from the plan.
   Recovery: rest, easy movement, readiness data with its coverage dates. */
(function () {
  'use strict';
  const H = () => window.RecompHost;
  const { el, esc, fmtDate, plural } = Views;
  const AREA_OF = { chest: 'chest', 'upper chest': 'chest', back: 'back', 'rear delt': 'back', 'posterior chain': 'back', shoulders: 'shoulders', 'side delt': 'shoulders',
    triceps: 'arms', biceps: 'arms', abs: 'core', obliques: 'core', trunk: 'core', quads: 'legs', hamstrings: 'legs', calves: 'legs', glutes: 'glutes', 'full body': 'full_body' };
  const KIND_LABEL = { strength: 'Strength', hypertrophy: 'Hypertrophy', conditioning: 'Conditioning', cardio: 'Cardio', bodyweight: 'Bodyweight', home: 'Home', hotel: 'Hotel', express: 'Express' };
  const lab = s => String(s).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
  const todayISO = () => H().todayISO();

  /* ============================================================ WORKOUTS */
  const WF = { q: '', goal: '', kind: '', maxMin: '', difficulty: '', bodyArea: '', onlyMine: true };

  function myEquipment(S) {
    const e = (S.goals && S.goals.equipment) || { barbell: true, dumbbell: true, machine: true, cable: true, bands: true, kettlebell: false, bodyweight: true };
    const have = ['none', 'cardio_machine', 'bench', 'pullup_bar'];
    ['barbell', 'dumbbell', 'machine', 'cable', 'bands', 'kettlebell'].forEach(k => { if (e[k] !== false) have.push(k); });
    return have;
  }
  function blockLine(b) {
    if (b.type === 'resistance') return `<b>${esc(b.label || 'Resistance')}</b>: ` + b.exercises.map(e => `${esc(Views.exName(e.id))} ${e.sets}×${e.repMin}–${e.repMax}`).join(', ');
    if (b.type === 'intervals') return `<b>${esc(b.label || 'Intervals')}</b>: ${b.rounds} rounds of ` + b.work.map(w => `${esc(w.name)} ${w.workSec}s on ${w.restSec}s off`).join(', ');
    if (b.type === 'steady') return `<b>${esc(b.name)}</b>: ${b.minutes} min, ${esc(b.intensity)}`;
    if (b.type === 'circuit') return `<b>${esc(b.label || 'Circuit')}</b>: ${b.rounds} rounds of ` + b.moves.map(m => esc(m.name)).join(', ');
    return esc(b.type);
  }
  /* A session for a library workout. Loads come from double progression like any other session. */
  function buildLibrarySession(w, replacesSlotId) {
    const S = H().S, today = todayISO();
    S._exIndex = H().EX_INDEX;
    const sess = newSession(1, today);
    sess.extra = true; sess.workoutId = w.id; sess.dayName = w.name; sess.replacesSlotId = replacesSlotId || null; sess.blocks = [];
    w.blocks.forEach(b => {
      if (b.type === 'resistance') b.exercises.forEach(e => {
        const ex = H().EX_INDEX[e.id]; if (!ex) return;
        const entry = newEntry(ex.id, ex.id);
        const d = decide({ state: S, ex, variantId: ex.id, checkin: null, todayISO: today, last: lastPerformance(S, ex.id, ex), settingsOverride: { sets: e.sets } });
        entry.decision = d; H().seedSets(entry, ex, d); sess.entries.push(entry);
      });
      else sess.blocks.push(JSON.parse(JSON.stringify(Object.assign({ done: false }, b))));
    });
    return sess;
  }
  /* Conditioning blocks the user ticked off become load, using the same points as the plan. */
  function finaliseBlocks(sess) {
    let pts = 0, mins = 0;
    (sess.blocks || []).filter(b => b.done).forEach(b => { const l = Plan.workoutLoad({ blocks: [b] }); pts += l.condPts; mins += l.conditioningMinutes; });
    sess.condPts = pts; sess.condMinutes = mins;
  }
  function trainExtras(sess, list) {
    (sess.blocks || []).forEach((b, i) => {
      const c = el('div', 'card'); c.innerHTML = `<span class="eyebrow">${esc(lab(b.type))}</span><p style="margin:6px 0">${blockLine(b)}</p>`;
      const lb = el('label', 'vcheck'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!b.done;
      cb.onchange = () => { b.done = cb.checked; finaliseBlocks(sess); H().persist(); };
      lb.append(cb, document.createTextNode(' Done')); c.appendChild(lb); list.appendChild(c);
    });
  }

  function previewWorkout(w) {
    const S = H().S, today = todayISO();
    Views.sheet(w.name, (b) => {
      b.appendChild(el('p', 'muted', esc(w.summary)));
      b.appendChild(el('div', 'tags', [`${w.durationMin} min`, lab(w.difficulty), KIND_LABEL[w.kind], ...w.equipment.map(lab)].map(t => `<span class="vtag">${esc(t)}</span>`).join(' ')));
      b.appendChild(el('span', 'eyebrow', 'Intended effect')); b.appendChild(el('p', null, esc(w.effect)));
      b.appendChild(el('span', 'eyebrow', 'What is in it'));
      const ul = el('ul', 'vlist'); w.blocks.forEach(bl => ul.appendChild(el('li', null, blockLine(bl)))); b.appendChild(ul);
      b.appendChild(el('p', 'dim veffect', `Duration is a modelled estimate without warm-up. Hard sets: ${hardSets(w)}. Relative recovery cost: ${w.demand} of 5.`));
      if (!Plan.hasPlan(S)) { b.appendChild(el('p', 'muted', 'Set up your plan to add this to your week.')); return; }
      const wk = Plan.ensureWeek(S, today);
      const row = el('div', 'row'); row.style.cssText = 'flex-wrap:wrap;margin-top:10px';
      const add = el('button', 'btn primary', 'Add as an extra session'); add.onclick = () => { Views.closeSheet(); extraImpact(w); };
      row.appendChild(add);
      const open = wk.slots.filter(s => (s.kind === 'training' || s.kind === 'conditioning') && s.status === 'planned' && s.date >= today);
      if (open.length) { const rp = el('button', 'btn', 'Replace a planned session'); rp.onclick = () => { Views.closeSheet(); replaceChoice(w, open); }; row.appendChild(rp); }
      b.appendChild(row);
    });
  }
  const hardSets = w => window.hardSets ? window.hardSets(w) : 0;

  function replaceChoice(w, slots) {
    const S = H().S;
    Views.sheet('Replace which session?', (b) => {
      b.appendChild(el('p', 'muted', 'The replaced session is kept in your history as replaced, not deleted. Your plan\'s progress is tied to exercises, so nothing is lost.'));
      slots.forEach(s => {
        const mine = Plan.workoutLoad(w).hardSets, theirs = s.kind === 'training' ? Plan.sessionRoster(S, s).items.reduce((a, i) => a + i.sets, 0) : 0;
        const bt = el('button', 'vlink'); bt.type = 'button';
        bt.innerHTML = `<b>${esc(s.label)} · ${esc(fmtDate(s.date))}</b><span class="muted">${s.kind === 'training' ? `About ${theirs} hard sets planned. This workout has ${mine}.` : 'Conditioning slot'}</span><span class="chev">›</span>`;
        bt.onclick = () => { Views.closeSheet(); const sess = buildLibrarySession(w, s.id); sess.extraImpact = `Replaced ${s.label} with ${w.name}.`; H().startAdHoc(sess); H().toast(`Started in place of ${s.label}.`); };
        b.appendChild(bt);
      });
    });
  }
  /* the week is previewed, and any adjustments are proposed rather than imposed */
  function extraImpact(w) {
    const S = H().S, today = todayISO();
    const ck = S.lastCheckin; const ready = ck && ck.energy ? ((ck.energy + (ck.sleep || ck.energy) + (6 - (ck.soreness || 3))) / 3) * 20 : null;
    const pv = Plan.previewExtra(S, w, today, today, ready);
    const picked = new Set(pv.changes.map(c => c.id));
    Views.sheet('Add ' + w.name, (b) => {
      b.appendChild(el('p', null, `<b>${esc(pv.advice)}</b>`));
      b.appendChild(el('div', 'vbeforeafter', `<div><span class="eyebrow">Week without it</span><b>${esc(pv.before.level)}</b><span class="dim">${pv.done.hardSets + pv.remaining.hardSets} hard sets</span></div><div class="arrow" aria-hidden="true">→</div><div><span class="eyebrow">With it</span><b>${esc(pv.after.level)}</b><span class="dim">${pv.projected.hardSets} hard sets</span></div>`));
      b.appendChild(el('p', 'dim veffect', `So far ${pv.done.sessions} sessions this week. It counts in your history and weekly load as an additional workout, and it never raises planned-session completion above 100 per cent.`));
      if (pv.conflict) b.appendChild(el('p', 'banner', `<div><b>${esc(pv.conflict.label)} is planned today.</b><br><span class="muted">Consider replacing it instead.</span></div>`));
      if (pv.changes.length) {
        b.appendChild(el('span', 'eyebrow', 'Suggested adjustments to the rest of the week'));
        pv.changes.forEach(c => { const lb = el('label', 'vcheck'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = true; cb.onchange = () => { if (cb.checked) picked.add(c.id); else picked.delete(c.id); }; lb.append(cb, document.createTextNode(' ' + c.text)); b.appendChild(lb); });
      }
      const row = el('div', 'row'); row.style.cssText = 'flex-wrap:wrap;margin-top:12px';
      const go = el('button', 'btn primary', pv.changes.length ? 'Add it and apply the ticked changes' : 'Add it'); 
      go.onclick = () => {
        const chosen = pv.changes.filter(c => picked.has(c.id));
        const applied = chosen.length ? Plan.applyChanges(S, chosen, { source: 'extra', reason: 'Extra session: ' + w.name, todayISO: today }) : [];
        const sess = buildLibrarySession(w, null); sess.extraImpact = pv.advice; sess.extraAdjustments = applied;
        Views.closeSheet(); H().startAdHoc(sess); H().toast(applied.length ? `Started. ${plural(applied.length, 'change')} applied to your week.` : 'Started.');
      };
      const cancel = el('button', 'btn ghost', 'Cancel'); cancel.onclick = Views.closeSheet;
      row.append(go, cancel); b.appendChild(row);
    });
  }

  function workoutCard(w) {
    const c = el('button', 'vwo'); c.type = 'button';
    c.innerHTML = `<b>${esc(w.name)}</b><span class="muted">${esc(w.summary)}</span><span class="tags"><span class="vtag">${w.durationMin} min</span><span class="vtag">${esc(lab(w.difficulty))}</span><span class="vtag">${esc(KIND_LABEL[w.kind])}</span>${w.equipment.slice(0, 3).map(e => `<span class="vtag">${esc(lab(e))}</span>`).join('')}</span>`;
    c.onclick = () => previewWorkout(w); return c;
  }

  Views.register('workouts', { render(root) {
    root.innerHTML = '';
    const S = H().S, today = todayISO();
    if (Plan.hasPlan(S)) {
      Plan.reconcile(S, today);
      const wk = Plan.ensureWeek(S, today);
      root.appendChild(Views.heading('Assigned this week', '0 0 8px'));
      const slots = wk.slots.filter(s => s.kind === 'training' || s.kind === 'conditioning');
      const box = el('div', 'vcards');
      slots.forEach(s => {
        const c = el('button', 'vwo'); c.type = 'button';
        const r = s.kind === 'training' ? Plan.sessionRoster(S, s) : null;
        const stat = { planned: s.date === today ? 'Today' : fmtDate(s.date), completed: 'Done', partial: 'Partly done', missed: 'Not done', skipped: 'Skipped' }[s.status] || s.status;
        c.innerHTML = `<b>${esc(s.label)}</b><span class="muted">${r ? esc(r.items.slice(0, 4).map(i => Views.exName(i.id)).join(', ')) : 'Pick a conditioning session below'}</span><span class="tags"><span class="vtag">${esc(stat)}</span><span class="vtag">${r ? Math.round(r.minutes) : s.minutes} min</span></span>`;
        c.onclick = () => PlanUI.openSlot(s.id); box.appendChild(c);
      });
      root.appendChild(box);
      const live = H().currentSession();
      if (live) { const b = el('button', 'btn primary block', 'Resume ' + (live.dayName || 'your workout')); b.style.marginTop = '10px'; b.onclick = () => H().go('train'); root.appendChild(b); }
    }
    root.appendChild(Views.heading('Library'));
    const fl = el('div', 'vfilter');
    const q = Views.field('search', WF.q, { placeholder: 'Search workouts', 'aria-label': 'Search workouts' });
    const sel = (key, opts, label) => { const s = Views.select([{ value: '', label }].concat(opts.map(o => typeof o === 'object' ? o : { value: o, label: lab(o) })), WF[key], v => { WF[key] = v; paint(); }); s.setAttribute('aria-label', label); return s; };
    fl.append(sel('goal', VOCAB.GOALS, 'Any goal'), sel('kind', VOCAB.KINDS.map(k => ({ value: k, label: KIND_LABEL[k] })), 'Any type'),
      sel('maxMin', [10, 15, 20, 30, 45, 60].map(m => ({ value: m, label: 'Up to ' + m + ' min' })), 'Any length'), sel('difficulty', VOCAB.DIFFICULTIES, 'Any level'),
      sel('bodyArea', VOCAB.BODY_AREAS, 'Any body area'));
    root.append(q, fl);
    const mine = el('label', 'vcheck'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = WF.onlyMine; cb.onchange = () => { WF.onlyMine = cb.checked; paint(); };
    mine.append(cb, document.createTextNode(' Only workouts I have the equipment for')); root.appendChild(mine);
    const out = el('div', 'vcards'); out.style.marginTop = '8px'; const count = el('p', 'dim'); root.append(count, out);
    function paint() {
      const f = { q: WF.q, goal: WF.goal || undefined, kind: WF.kind || undefined, maxMin: WF.maxMin ? Number(WF.maxMin) : undefined, difficulty: WF.difficulty || undefined, bodyArea: WF.bodyArea || undefined };
      if (WF.onlyMine) f.equipment = myEquipment(S);
      const res = searchWorkouts(f);
      count.textContent = `${plural(res.length, 'workout')} match${res.length === 1 ? 'es' : ''}.`;
      out.innerHTML = ''; res.slice(0, 40).forEach(w => out.appendChild(workoutCard(w)));
      if (res.length > 40) out.appendChild(el('p', 'dim', 'Showing the first 40. Narrow the filters to see more.'));
    }
    q.oninput = () => { WF.q = q.value; paint(); };
    paint();
  } });

  /* ============================================================= STRETCH */
  function stepInfo(step) { const st = (H().STRETCHES || []).find(s => s.id === step.stretchId) || {}; return { name: st.name || step.label || 'Step', how: st.how || step.cue || '', st }; }
  /* The runner: each step has a countdown, a side change, and pause/skip. */
  function runRoutine(routine, kind) {
    const S = H().S;
    const steps = routine.steps; let i = 0, side = 1, left = 0, endAt = 0, timer = null, paused = false, started = Date.now();
    const total = steps.length;
    const sidesOf = s => s.sides || 1;
    Views.sheet(routine.name, (b, close) => {
      const figBox = el('div'); const title = el('h3'); const how = el('p', 'muted'); const clock = el('div', 'vtimer'); clock.setAttribute('role', 'timer'); clock.setAttribute('aria-live', 'off');
      const prog = el('p', 'dim'); const sideMsg = el('p', 'banner ok'); sideMsg.hidden = true;
      const row = el('div', 'row'); row.style.cssText = 'flex-wrap:wrap;margin-top:8px';
      const prev = el('button', 'btn ghost', 'Back'), pause = el('button', 'btn', 'Pause'), next = el('button', 'btn primary', 'Skip');
      row.append(prev, pause, next); b.append(prog, figBox, title, how, sideMsg, clock, row);
      b.appendChild(el('p', 'dim veffect', routine.note || (kind === 'recovery' ? 'General relaxation and easy movement. Not rehabilitation. Stop if anything is sharp or worsening.' : 'General mobility, not treatment. Ease off or stop if anything is sharp, and see a professional if it persists.')));
      const stop = () => { clearInterval(timer); timer = null; };
      const load = () => {
        stop(); const s = steps[i]; const inf = stepInfo(s);
        figBox.innerHTML = ''; if (s.stretchId && H().mkFig) { try { figBox.appendChild(H().mkFig('figbig', s.stretchId, true)); } catch (e) {} }
        title.textContent = inf.name + (sidesOf(s) === 2 ? ` · side ${side} of 2` : ''); how.textContent = s.cue || inf.how;
        prog.textContent = `Step ${i + 1} of ${total}`;
        left = s.seconds; endAt = Date.now() + left * 1000; paused = false; pause.textContent = 'Pause'; tick(); timer = setInterval(tick, 250);
        prev.disabled = i === 0 && side === 1;
      };
      const fmt = n => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
      const tick = () => {
        if (paused) return;
        left = Math.max(0, Math.ceil((endAt - Date.now()) / 1000)); clock.textContent = fmt(left);
        if (left <= 0) advance(true);
      };
      const advance = (auto) => {
        const s = steps[i];
        if (sidesOf(s) === 2 && side === 1) { side = 2; sideMsg.textContent = 'Switch sides.'; sideMsg.hidden = false; if (navigator.vibrate) try { navigator.vibrate(120); } catch (e) {} H().say('Switch sides'); setTimeout(() => { sideMsg.hidden = true; }, 3000); load(); return; }
        side = 1; i++;
        if (i >= total) { stop(); finish(); return; }
        load();
      };
      next.onclick = () => advance(false);
      prev.onclick = () => { if (side === 2) { side = 1; load(); } else if (i > 0) { i--; side = 1; load(); } };
      pause.onclick = () => { if (paused) { paused = false; endAt = Date.now() + left * 1000; pause.textContent = 'Pause'; } else { paused = true; pause.textContent = 'Resume'; } };
      const finish = () => {
        b.innerHTML = '';
        const secs = Math.round((Date.now() - started) / 1000);
        b.appendChild(el('h3', null, 'Done'));
        b.appendChild(el('p', 'muted', `${esc(routine.name)} took about ${Math.max(1, Math.round(secs / 60))} minutes. How do you feel?`));
        const row2 = el('div', 'opts');
        [['better', 'Better'], ['same', 'About the same'], ['worse', 'Worse or sore']].forEach(([v, l]) => { const bt = el('button', null, l); bt.type = 'button'; bt.onclick = () => save(v); row2.appendChild(bt); });
        b.appendChild(row2);
        const sk = el('button', 'btn ghost', 'Save without feedback'); sk.style.marginTop = '10px'; sk.onclick = () => save(null); b.appendChild(sk);
      };
      const save = (feedback) => {
        const today = todayISO();
        S.stretchLog = S.stretchLog || [];
        S.stretchLog.push({ id: 'sl_' + Date.now().toString(36), routineId: routine.id, name: routine.name, type: kind === 'recovery' ? 'recovery' : routine.type, date: today, seconds: Math.round((Date.now() - started) / 1000), feedback, at: Date.now() });
        const slot = Plan.hasPlan(S) ? Plan.slotsOn(S, today).find(x => x.status === 'planned' && (kind === 'recovery' ? x.kind === 'recovery' : x.kind === 'stretch')) : null;
        if (slot) Plan.completeSlot(S, slot.id, { id: 'sl_' + Date.now().toString(36), date: today }, 1);
        H().persist(); close(); H().renderAll(); H().toast(slot ? `${slot.label} done.` : 'Logged.');
      };
      load();
    }, () => { clearInterval(0); });
    // the sheet's own close stops the timer via the interval check below
    const sheetEl = document.getElementById('vSheet');
    const obs = new MutationObserver(() => { if (!sheetEl.classList.contains('on')) { try { clearInterval(timer); } catch (e) {} obs.disconnect(); } });
    obs.observe(sheetEl, { attributes: true, attributeFilter: ['class'] });
  }

  function routinePreview(r, kind) {
    Views.sheet(r.name, (b) => {
      b.appendChild(el('p', 'muted', esc(r.purpose)));
      b.appendChild(el('div', 'tags', `<span class="vtag">${r.durationMin} min</span>` + (r.level ? `<span class="vtag">${esc(lab(r.level))}</span>` : '') + (r.bodyAreas || []).slice(0, 4).map(a => `<span class="vtag">${esc(a)}</span>`).join('')));
      const ul = el('ul', 'vlist'); r.steps.forEach(s => { const inf = stepInfo(s); ul.appendChild(el('li', null, `<b>${esc(inf.name)}</b> · ${s.seconds}s${(s.sides || 1) === 2 ? ' each side' : ''}`)); }); b.appendChild(ul);
      const go = el('button', 'btn primary block', 'Start'); go.onclick = () => { Views.closeSheet(); runRoutine(r, kind); }; b.appendChild(go);
    });
  }
  const SF = { type: '', bodyArea: '', activity: '', maxMin: '', stiffness: [] };

  function plannedWorkoutHint(S) {
    if (!Plan.hasPlan(S)) return null;
    const slot = Plan.slotsOn(S, todayISO()).find(x => x.kind === 'training' && x.status === 'planned') || null;
    if (!slot) return null;
    const r = Plan.sessionRoster(S, slot);
    const areas = Array.from(new Set(r.items.map(i => AREA_OF[(H().EX_INDEX[i.id] || {}).primary]).filter(Boolean)));
    return { slot, workout: { kind: 'strength', bodyAreas: areas.length >= 4 ? areas.concat(['full_body']) : areas } };
  }
  Views.register('stretch', { render(root) {
    root.innerHTML = '';
    const S = H().S;
    const hint = plannedWorkoutHint(S);
    const lastStiff = (function () { const r = (S.reviews || []).filter(x => x.checkin && x.checkin.stiffness).slice(-1)[0]; return r ? r.checkin.stiffness.map(s => s.toLowerCase()) : []; })();
    const stiff = SF.stiffness.length ? SF.stiffness : lastStiff;
    root.appendChild(Views.heading('Recommended for you', '0 0 8px'));
    const rec = el('div', 'stack'); root.appendChild(rec);
    const addRec = (phase, title) => {
      const rr = recommendRoutines({ plannedWorkout: hint ? hint.workout : undefined, stiffness: stiff, minutesAvailable: SF.maxMin ? Number(SF.maxMin) : 20, phase });
      if (!rr.length) return;
      rec.appendChild(el('span', 'eyebrow', title));
      rr.slice(0, 2).forEach(x => { const c = el('button', 'vlink'); c.type = 'button'; c.innerHTML = `<b>${esc(x.routine.name)} · ${x.routine.durationMin} min</b><span class="muted">${esc(x.why)}</span><span class="chev">›</span>`; c.onclick = () => routinePreview(x.routine); rec.appendChild(c); });
    };
    if (hint) { addRec('before', `Warm-up before ${hint.slot.label}`); addRec('after', `After ${hint.slot.label}`); } else addRec('standalone', 'Standalone');
    rec.appendChild(el('p', 'dim veffect', hint ? 'Chosen from today\'s planned session' + (stiff.length ? ' and the stiff areas you reported' : '') + '.' : (stiff.length ? 'Chosen from the stiff areas you reported.' : 'No session is planned today, so these are general. Tell Recomp where you are stiff and they will follow.')));
    root.appendChild(Views.heading('Find a routine'));
    const fl = el('div', 'vfilter');
    const sel = (key, opts, label) => { const s = Views.select([{ value: '', label }].concat(opts.map(o => typeof o === 'object' ? o : { value: o, label: lab(o) })), SF[key], v => { SF[key] = v; paint(); }); s.setAttribute('aria-label', label); return s; };
    fl.append(sel('type', [{ value: 'dynamic_warmup', label: 'Warm-ups' }, { value: 'post_workout', label: 'After training' }, { value: 'standalone', label: 'Standalone' }], 'Any type'),
      sel('bodyArea', ['neck', 'shoulders', 'chest', 'upper back', 'lower back', 'hips', 'legs', 'hamstrings', 'quads', 'calves', 'ankles', 'wrists'], 'Any body area'),
      sel('activity', VOCAB.ACTIVITIES, 'Any activity'), sel('maxMin', [5, 10, 15, 20].map(m => ({ value: m, label: 'Up to ' + m + ' min' })), 'Any length'));
    root.appendChild(fl);
    root.appendChild(el('span', 'eyebrow', 'Where are you stiff?'));
    root.appendChild(Views.chips(VOCAB.STIFFNESS, SF.stiffness, v => { SF.stiffness = v; Views.render('stretch', root); }, true, 'Stiff areas'));
    const out = el('div', 'vcards'); out.style.marginTop = '8px'; root.appendChild(out);
    function paint() {
      const res = searchRoutines({ type: SF.type || undefined, bodyArea: SF.bodyArea || undefined, activity: SF.activity || undefined, maxMin: SF.maxMin ? Number(SF.maxMin) : undefined, stiffness: SF.stiffness.length ? SF.stiffness : undefined });
      out.innerHTML = '';
      res.slice(0, 30).forEach(r => { const c = el('button', 'vwo'); c.type = 'button'; c.innerHTML = `<b>${esc(r.name)}</b><span class="muted">${esc(r.purpose)}</span><span class="tags"><span class="vtag">${r.durationMin} min</span><span class="vtag">${esc(lab(r.type))}</span></span>`; c.onclick = () => routinePreview(r); out.appendChild(c); });
      if (!res.length) out.appendChild(el('div', 'empty', '<b>Nothing matches</b>Try a wider length or fewer filters.'));
    }
    paint();
    root.appendChild(Views.heading('Single stretches'));
    const sg = el('div', 'vcards');
    (H().STRETCHES || []).forEach(s => { const c = el('button', 'vwo'); c.type = 'button'; c.appendChild(H().mkFig('fig', s.id, false)); c.appendChild(el('b', null, esc(s.name))); c.appendChild(el('span', 'muted', esc(s.why))); c.onclick = () => runRoutine({ id: 'single-' + s.id, name: s.name, type: 'standalone', steps: [{ stretchId: s.id, seconds: s.seconds || 30, sides: s.sides || 1 }] }); sg.appendChild(c); });
    root.appendChild(sg);
    const log = (S.stretchLog || []).slice(-5).reverse();
    if (log.length) { root.appendChild(Views.heading('Recent')); const ul = el('ul', 'vlist'); log.forEach(l => ul.appendChild(el('li', null, `${esc(fmtDate(l.date))} ${esc(l.name)} ${l.feedback ? '<span class="pill">' + esc(l.feedback) + '</span>' : ''}`))); root.appendChild(ul); }
  } });

  /* ============================================================ RECOVERY */
  function whyLighter(S, today) {
    const out = [];
    const h = Plan.planHistory(S).filter(x => Plan.diffDays(new Date(x.at).toISOString().slice(0, 10), today) <= 10);
    h.forEach(x => {
      if (x.type === 'daily' && /worse|less time/i.test(x.reason + x.kind)) out.push(`Daily change: ${x.reason}`);
      if (x.type === 'version' && /Reduce|deload/i.test(x.reason + (x.changes || []).join(' '))) out.push(`Plan change: ${x.reason}`);
    });
    const slot = Plan.hasPlan(S) ? Plan.slotsOn(S, today).find(x => x.kind === 'training') : null;
    if (slot && slot.holdProgression) out.push('No load increases in today\'s session while recovery catches up.');
    return out.slice(0, 3);
  }
  Views.register('recovery', { render(root) {
    root.innerHTML = '';
    const S = H().S, today = todayISO();
    const slot = Plan.hasPlan(S) ? Plan.slotsOn(S, today)[0] : null;
    const top = el('div', 'hero stack');
    const rest = slot && (slot.kind === 'rest' || slot.kind === 'recovery');
    top.innerHTML = `<span class="eyebrow">Today</span><h2 style="margin:0">${rest ? (slot.kind === 'rest' ? 'Rest day' : 'Recovery day') : 'Recovery'}</h2>
      <p class="muted" style="margin:0">${rest ? 'This is planned, so keeping it is the plan working. A rest day is not a missed session and does not break anything.' : 'Recovery is when training turns into progress. Use easy movement and check-ins to keep it on track.'}</p>`;
    const why = whyLighter(S, today);
    if (why.length) { const ul = el('ul', 'vlist'); why.forEach(w => ul.appendChild(el('li', null, esc(w)))); top.appendChild(el('span', 'eyebrow', 'Why today is lighter')); top.appendChild(ul); }
    const ck = el('button', 'btn', 'Readiness check-in'); ck.onclick = () => H().openCheckin(1, true); top.appendChild(ck);
    root.appendChild(top);

    // this week
    if (Plan.hasPlan(S)) {
      const wk = Plan.ensureWeek(S, today), load = Plan.weekLoad(S, wk), cap = Plan.capacity(S, null), lvl = Plan.strainLevel(load, cap, load.sessions);
      const restKept = wk.slots.filter(s => (s.kind === 'rest' || s.kind === 'recovery') && s.date <= today).length;
      const c = el('div', 'card');
      c.innerHTML = `<span class="eyebrow">Workload this week</span><div class="grid4" style="margin-top:8px">
        <div class="stat"><div class="n">${load.hardSets}</div><div class="l">hard sets</div></div><div class="stat"><div class="n">${load.conditioningMinutes}</div><div class="l">cardio min</div></div>
        <div class="stat"><div class="n">${load.days.size}</div><div class="l">training days</div></div><div class="stat"><div class="n">${restKept}</div><div class="l">rest days kept</div></div></div>
        <p class="muted" style="margin:8px 0 0">Load is <b>${esc({ ok: 'comfortable', high: 'high', excessive: 'above what you can usually recover from' }[lvl.level])}</b> against a ceiling for your experience and goal. Extra workouts and imported activities are included.</p>`;
      root.appendChild(c);
    }
    // ratings
    const cks = (S.sessions || []).filter(s => s.checkin && s.status === 'completed').slice(-6);
    const c2 = el('div', 'card'); c2.innerHTML = '<span class="eyebrow">Your own ratings (last sessions)</span>';
    if (!cks.length) c2.appendChild(el('p', 'muted', 'No readiness check-ins yet. They take ten seconds before a workout and improve how the plan responds.'));
    else { const ul = el('ul', 'vlist'); cks.reverse().forEach(s => ul.appendChild(el('li', null, `${esc(fmtDate(s.date))}: energy ${s.checkin.energy || '–'}, sleep ${s.checkin.sleep || '–'}, soreness ${s.checkin.soreness || '–'}${s.checkin.pain && s.checkin.pain.present ? ', pain flagged' : ''}`))); c2.appendChild(ul); }
    root.appendChild(c2);

    // garmin
    const cur = Garmin.current(S, today), w = Garmin.ensure(S);
    const c3 = el('div', 'card'); c3.innerHTML = `<span class="eyebrow">Wearable data (Garmin files)</span><p style="margin:6px 0">${esc(cur.message)}</p>`;
    if (cur.hasData) c3.appendChild(el('p', 'dim', `Imported data covers ${esc(w.imports.map(i => i.coverage ? fmtDate(i.coverage.from) + ' to ' + fmtDate(i.coverage.to) : '').filter(Boolean).join('; '))}.`));
    const file = el('input'); file.type = 'file'; file.accept = '.csv,.tcx,.json,.fit'; file.setAttribute('aria-label', 'Import a Garmin file'); file.style.display = 'block'; file.style.margin = '8px 0';
    file.onchange = async () => {
      const f = file.files[0]; if (!f) return;
      const buf = await f.arrayBuffer(); const p = Garmin.parse(new Uint8Array(buf), f.name);
      if (!p.rows.length) { H().toast(p.problems[0] || 'Nothing could be read from that file.', 'warn'); return; }
      Views.sheet('Import ' + f.name, (b) => {
        b.appendChild(el('p', null, `<b>${plural(p.rows.length, p.kind === 'sleep' ? 'night' : 'activity', p.kind === 'sleep' ? 'nights' : 'activities')}</b> found, covering ${esc(fmtDate(p.coverage.from))} to ${esc(fmtDate(p.coverage.to))}.${p.skipped ? ` ${p.skipped} rows could not be read and were skipped.` : ''}`));
        b.appendChild(el('p', 'dim veffect', 'The file is read on this device. Duplicates are skipped. Strength sessions from the watch are left out of conditioning load so they are not counted twice; you can include them below.'));
        const ok = el('button', 'btn primary', 'Import'); ok.onclick = () => { const r = Garmin.applyImport(S, p, Date.now()); H().persist(); Views.closeSheet(); H().renderAll(); H().toast(`Imported ${r.added}, skipped ${r.duplicates} already there.`); };
        b.appendChild(ok);
      });
    };
    c3.appendChild(file);
    c3.appendChild(el('p', 'dim veffect', 'Supported: Garmin Connect CSV exports (activities, sleep), TCX activities, and the sleep JSON in a Garmin data export. FIT files are not supported. Old data is shown with its dates and is never presented as today\'s readiness.'));
    const acts = w.activities.slice(-6).reverse();
    if (acts.length) acts.forEach(a => {
      const r = el('div', 'vnote'); const lb = el('label', 'vcheck'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = !a.excluded; cb.onchange = () => { a.excluded = !cb.checked; H().persist(); };
      lb.append(cb, document.createTextNode(` ${fmtDate(a.date)} ${a.type}, ${a.minutes} min (counts toward load)`)); r.appendChild(lb);
      r.appendChild(Views.select(['easy', 'moderate', 'hard'], a.intensity, v => { a.intensity = v; H().persist(); })); c3.appendChild(r);
    });
    if (w.imports.length) { const clr = el('button', 'btn sm ghost', 'Remove all imported data'); clr.onclick = async () => { if (await Views.confirmSheet('Remove imported data?', 'This deletes the sleep and activity rows you imported. Your training logs are not touched.', 'Remove', true)) { Garmin.clearAll(S); H().persist(); H().renderAll(); } }; c3.appendChild(clr); }
    root.appendChild(c3);

    // routines
    root.appendChild(Views.heading('Easy movement and relaxation'));
    const grid = el('div', 'vcards');
    searchRecovery({}).forEach(r => { const c = el('button', 'vwo'); c.type = 'button'; c.innerHTML = `<b>${esc(r.name)}</b><span class="muted">${esc(r.purpose)}</span><span class="tags"><span class="vtag">${r.durationMin} min</span><span class="vtag">${esc(lab(r.type))}</span></span>`; c.onclick = () => routinePreview(r, 'recovery'); grid.appendChild(c); });
    root.appendChild(grid);
    root.appendChild(el('p', 'dim veffect', 'These are general relaxation and easy movement. They are not rehabilitation and not a treatment for any injury. If something hurts, stop and see a doctor or physiotherapist.'));
  } });


  /* ========================================================= NUTRITION LOG */
  /* Food actually eaten, entered by the user. Planned meals are suggestions and
     are never counted as intake; nutrition proposals need this data. */
  Views.register('nutrition', { render(root) {
    const box = root.querySelector('#intakeBox'); if (!box) return;
    box.innerHTML = '';
    const S = H().S, today = todayISO(); S.intake = S.intake || {};
    const c = el('div', 'card'); c.innerHTML = '<span class="eyebrow">What you actually ate</span><p class="muted" style="margin:6px 0 10px">Log your daily totals. The meal plan above is a suggestion and is never counted as food eaten. Weekly nutrition changes are only proposed when most days are logged and there are enough weigh-ins.</p>';
    for (let i = 0; i < 7; i++) {
      const d = Plan.addDays(today, -i), cur = S.intake[d] || {};
      const row = el('div', 'vrow');
      const kcal = Views.field('number', cur.kcal != null ? cur.kcal : '', { inputmode: 'numeric', min: 0, max: 10000, 'aria-label': `Calories on ${d}` });
      const pro = Views.field('number', cur.protein != null ? cur.protein : '', { inputmode: 'numeric', min: 0, max: 600, 'aria-label': `Protein grams on ${d}` });
      const save = () => { const k = Number(kcal.value), p = Number(pro.value);
        if (!kcal.value && !pro.value) { delete S.intake[d]; } else if (k > 0 && k <= 10000) S.intake[d] = { kcal: k, protein: pro.value ? p : null, at: Date.now() };
        H().persist(); status.textContent = readiness(); };
      kcal.onchange = pro.onchange = save;
      row.appendChild(el('b', null, esc(i === 0 ? 'Today' : fmtDate(d)))); row.append(Views.labelled('kcal', kcal), Views.labelled('protein g', pro)); c.appendChild(row);
    }
    const readiness = () => { const r = Review.nutritionReadiness(S, Plan.addDays(today, -6), today); return r.ready ? 'Enough data for nutrition suggestions.' : 'Not enough data yet for nutrition suggestions: ' + r.missing.join(' '); };
    const status = el('p', 'dim veffect', readiness()); status.setAttribute('aria-live', 'polite'); c.appendChild(status);
    box.appendChild(c);
  } });

  window.MoveUI = { buildLibrarySession, finaliseBlocks, trainExtras, runRoutine };
})();
