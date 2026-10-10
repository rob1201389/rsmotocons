/* MY PLAN: calendar, goals and what each setting does, milestones, moving and
   skipping sessions, next-week availability, plan history and rollback. */
const PlanUI = (function () {
  'use strict';
  const H = () => window.RecompHost;
  const { el, esc, fmtDate, fmtLong, plural } = Views;
  const KIND = { training: ['T', 'Training'], conditioning: ['C', 'Conditioning'], stretch: ['S', 'Stretch'], recovery: ['R', 'Recovery'], rest: ['–', 'Rest'] };
  const STATUS_WORD = { planned: 'Planned', completed: 'Done', partial: 'Partly done', skipped: 'Skipped', missed: 'Not done', in_progress: 'In progress' };
  const EQUIP = ['barbell', 'dumbbell', 'machine', 'cable', 'bands', 'kettlebell', 'bodyweight'];
  const MINUTES = [20, 30, 40, 45, 60, 75, 90];
  const LIMIT_AREAS = ['Shoulder', 'Elbow', 'Wrist', 'Lower back', 'Hip', 'Knee', 'Ankle', 'Neck'];

  /* ------------------------------------------------------------- calendar */
  function weekCard(S, wk, today, label, root) {
    const c = el('div', 'card');
    const ts = wk.slots.filter(x => x.kind === 'training');
    c.innerHTML = `<div class="spread"><b>${esc(label)}</b><span class="dim">${esc(fmtDate(wk.start))} to ${esc(fmtDate(wk.end))}${wk.frozenAt ? ' · agreed' : ' · draft'}</span></div>`;
    const list = el('div', 'vcal');
    wk.slots.forEach(sl => {
      const k = KIND[sl.kind] || ['·', sl.kind];
      const row = el('div', 'vslot ' + sl.kind + ' ' + sl.status + (sl.date === today ? ' today' : ''));
      const fin = sl.status === 'completed' || sl.status === 'partial';
      let sub = '';
      if (sl.kind === 'training' && sl.status !== 'skipped') { const r = Plan.sessionRoster(S, sl); sub = `${Math.round(r.minutes)} min · ${r.items.length} exercises`; }
      else if (sl.minutes) sub = `${sl.minutes} min`;
      if (sl.mods && sl.mods.length) sub += (sub ? ' · ' : '') + `${plural(sl.mods.length, 'change')} applied`;
      const moved = sl.moves && sl.moves.length ? ` · moved from ${fmtDate(sl.agreedDate)}` : '';
      row.innerHTML = `<span class="vd"><b>${esc(fmtDate(sl.date).split(' ')[0])}</b><span class="dim">${esc(fmtDate(sl.date).split(' ').slice(1).join(' '))}</span></span>
        <span class="vk" aria-hidden="true">${k[0]}</span>
        <span class="vt"><b>${esc(sl.label)}</b><span class="dim">${esc(sub)}${esc(moved)}</span></span>
        <span class="pill ${fin ? 'go' : sl.status === 'missed' || sl.status === 'skipped' ? 'down' : ''}">${esc(STATUS_WORD[sl.status] || sl.status)}</span>`;
      row.tabIndex = 0; row.setAttribute('role', 'button'); row.setAttribute('aria-label', `${fmtLong(sl.date)}: ${sl.label}, ${STATUS_WORD[sl.status] || sl.status}. Open details.`);
      const open = () => openSlot(sl.id);
      row.onclick = open; row.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
      list.appendChild(row);
    });
    c.appendChild(list);
    root.appendChild(c);
  }

  function openSlot(slotId) {
    const S = H().S, today = H().todayISO();
    const f = Plan.findSlot(S, slotId); if (!f) return;
    const { slot, week } = f;
    Views.sheet(slot.label, (b) => {
      b.appendChild(el('p', 'muted', `${esc(fmtLong(slot.date))} · ${esc(STATUS_WORD[slot.status] || slot.status)}${slot.agreedDate && slot.agreedDate !== slot.date ? ` · agreed for ${esc(fmtDate(slot.agreedDate))}` : ''}`));
      if (slot.kind === 'training') {
        const r = Plan.sessionRoster(S, slot);
        const ul = el('ul', 'vlist');
        r.items.forEach(i => ul.appendChild(el('li', null, `<b>${esc(Views.exName(i.id))}</b> · ${i.sets} × ${i.repMin}–${i.repMax}${i.modified ? ' <span class="pill hold">changed</span>' : ''}`)));
        b.appendChild(ul);
        if (r.notes.length) r.notes.forEach(n => b.appendChild(el('p', 'dim', esc(n))));
        b.appendChild(el('p', 'dim', `About ${Math.round(r.minutes)} minutes. Loads come from your own history when the session starts.`));
      } else if (slot.kind === 'rest') b.appendChild(el('p', 'muted', 'A planned rest day. Keeping it is part of the plan, and it counts as a success.'));
      else if (slot.kind === 'recovery') b.appendChild(el('p', 'muted', 'Easy movement and gentle mobility. Open Recovery for ideas.'));
      else if (slot.kind === 'stretch') b.appendChild(el('p', 'muted', 'A stretch session. Open Stretch to choose a routine.'));
      else if (slot.kind === 'conditioning') b.appendChild(el('p', 'muted', 'Conditioning at the planned intensity. Pick a session in Workouts that fits.'));
      if (slot.history && slot.history.length) {
        b.appendChild(el('span', 'eyebrow', 'History'));
        const ul = el('ul', 'vlist');
        slot.history.slice(-5).forEach(h => ul.appendChild(el('li', 'dim', esc(`${h.action}${h.from ? ' from ' + fmtDate(h.from) : ''}${h.to && h.to.length === 10 ? ' to ' + fmtDate(h.to) : ''}${h.reason ? ': ' + h.reason : ''}`))));
        b.appendChild(ul);
      }
      const row = el('div', 'row'); row.style.cssText = 'margin-top:12px;flex-wrap:wrap';
      if (slot.status === 'planned' && slot.date >= today) {
        if (slot.kind === 'training') {
          const mv = el('button', 'btn', 'Move'); mv.onclick = () => { Views.closeSheet(); chooseMove(slot.id); }; row.appendChild(mv);
          const lt = el('button', 'btn', 'Shorten'); lt.onclick = () => { Views.closeSheet(); TodayUI.adaptFlow(slot.id, 'less_time'); }; row.appendChild(lt);
        }
        if (slot.kind === 'training' || slot.kind === 'conditioning') {
          const sk = el('button', 'btn ghost', 'Skip'); sk.onclick = () => { Views.closeSheet(); chooseSkip(slot.id); }; row.appendChild(sk);
        }
      }
      b.appendChild(row);
    });
  }

  function chooseMove(slotId) {
    const S = H().S, today = H().todayISO();
    const f = Plan.findSlot(S, slotId); const { week, slot } = f;
    Views.sheet('Move ' + slot.label, (b) => {
      const sug = Plan.suggestReschedule(S, slotId, today > slot.date ? today : Plan.addDays(slot.date, 0));
      b.appendChild(el('p', 'muted', 'Sessions move within their own week, never into the past, and never onto a day that would stack hard sessions. Progress is tied to each exercise, so moving a session does not cost any.'));
      const opts = [];
      for (let d = week.start; d <= week.end; d = Plan.addDays(d, 1)) { if (d < today || d === slot.date) continue; const chk = Plan.crampCheck(S, week, slot, d); opts.push({ d, chk }); }
      if (!opts.length) b.appendChild(el('p', 'dim', 'There are no days left this week to move to.'));
      opts.forEach(({ d, chk }) => {
        const bt = el('button', 'vlink'); bt.type = 'button';
        const ok = chk.problems.length === 0 && !slotAt(week, d, slot);
        bt.disabled = !ok;
        bt.innerHTML = `<b>${esc(fmtLong(d))}</b><span class="muted">${esc(ok ? (chk.warnings[0] || 'Fits the week.') : (chk.problems[0] || 'Another session is on that day.'))}</span>`;
        bt.onclick = () => { Views.closeSheet(); confirmMove(slotId, d); };
        b.appendChild(bt);
      });
    });
  }
  const slotAt = (week, d, except) => week.slots.find(s => s.date === d && s !== except && ['training', 'conditioning'].includes(s.kind) && !['skipped', 'missed'].includes(s.status));
  function confirmMove(slotId, toDate, quiet) {
    const S = H().S, today = H().todayISO();
    const r = Plan.moveSlot(S, slotId, toDate, 'moved by you', today);
    if (!r.ok) { H().toast(r.problems[0], 'warn'); return; }
    H().persist(); H().renderAll();
    H().toast(`Moved to ${fmtDate(toDate)}.${r.warnings && r.warnings.length ? ' ' + r.warnings[0] : ''}`);
  }
  function chooseSkip(slotId) {
    const S = H().S;
    Views.sheet('Skip this session?', (b) => {
      b.appendChild(el('p', 'muted', 'It stays in your history as skipped and is not added to other days. Saying why helps the plan respond properly: time makes sessions shorter, capacity lowers the load.'));
      [['time', 'Not enough time'], ['capacity', 'Not up to it'], ['illness', 'Unwell'], ['travel', 'Travel'], ['other', 'Something else']].forEach(([k, l]) => {
        const bt = el('button', 'btn block', esc(l)); bt.style.marginTop = '8px';
        bt.onclick = () => { Plan.skipSlot(S, slotId, l, k); H().persist(); Views.closeSheet(); H().renderAll(); H().toast('Skipped. Nothing was added on top.'); };
        b.appendChild(bt);
      });
    });
  }

  /* ----------------------------------------------------------- milestones */
  function milestoneCard(S, today, root) {
    const c = el('div', 'card');
    c.innerHTML = '<div class="spread"><b>Milestones</b></div>';
    const ms = (S.goals.milestones || []);
    if (!ms.length) c.appendChild(el('p', 'muted', 'No milestones yet. A milestone is a target you choose, such as a bodyweight, a lift, or a run of consistent weeks, with a date to look back and check.'));
    ms.forEach(m => {
      const p = Plan.milestoneProgress(S, m, today);
      const r = el('div', 'vms');
      const word = p.status === 'reached' ? 'Reached' : p.status === 'overdue' ? 'Past its date' : p.status === 'no_data' ? 'No data yet' : `${p.pct}%`;
      r.innerHTML = `<div class="spread"><b>${esc(m.label)}</b><span class="pill ${p.status === 'reached' ? 'go' : p.status === 'overdue' ? 'hold' : ''}">${esc(word)}</span></div>`;
      r.appendChild(Views.progressBar(p.pct, m.label));
      r.appendChild(el('span', 'dim', esc(m.due ? `Review date ${fmtDate(m.due)}. ` : '') + (p.status === 'no_data' ? (m.kind === 'bodyweight' ? 'Log your weight to see progress.' : 'Log training to see progress.') : '')));
      const rm = el('button', 'btn sm ghost', 'Remove'); rm.onclick = () => { S.goals.milestones = S.goals.milestones.filter(x => x.id !== m.id); H().persist(); H().renderAll(); };
      r.appendChild(rm); c.appendChild(r);
    });
    const add = el('button', 'btn sm', 'Add a milestone'); add.style.marginTop = '8px'; add.onclick = () => openMilestone(); c.appendChild(add);
    root.appendChild(c);
  }
  function openMilestone() {
    const S = H().S; const d = { kind: 'bodyweight', label: '', target: '', due: '', exerciseId: 'bench-barbell', weeks: 8 };
    Views.sheet('Add a milestone', (b) => {
      b.appendChild(Views.chips([{ value: 'bodyweight', label: 'Bodyweight' }, { value: 'lift', label: 'A lift' }, { value: 'consistency', label: 'Consistency' }], d.kind, v => { d.kind = v; paint(); }, false, 'Type'));
      const body = el('div', 'stack'); body.style.marginTop = '10px'; b.appendChild(body);
      const paint = () => {
        body.innerHTML = '';
        const lab = Views.field('text', d.label, { maxlength: 60, placeholder: 'e.g. Bench press 90 kg' }); lab.oninput = () => { d.label = lab.value; };
        body.appendChild(Views.labelled('Name', lab));
        if (d.kind === 'consistency') { const w = Views.field('number', d.weeks, { min: 2, max: 52 }); w.oninput = () => { d.weeks = Number(w.value); }; body.appendChild(Views.labelled('Weeks in a row with at least 75% of planned sessions done', w)); }
        else {
          if (d.kind === 'lift') {
            const ex = Views.select(Object.values(H().EX_INDEX).filter(e => !e.libraryOnly).map(e => ({ value: e.id, label: e.short || e.name })), d.exerciseId, v => { d.exerciseId = v; });
            body.appendChild(Views.labelled('Exercise', ex));
          }
          const t = Views.field('number', d.target, { step: '0.1', inputmode: 'decimal' }); t.oninput = () => { d.target = t.value; };
          body.appendChild(Views.labelled(d.kind === 'lift' ? 'Target estimated 1RM (kg)' : 'Target weight (kg)', t, d.kind === 'lift' ? 'Measured from your logged sets, so it moves only with real performance.' : null));
        }
        const due = Views.field('date', d.due); due.onchange = () => { d.due = due.value; };
        body.appendChild(Views.labelled('Review date (optional)', due));
        const err = el('p', 'autherr', ''); err.setAttribute('role', 'alert'); err.hidden = true; body.appendChild(err);
        const save = el('button', 'btn primary block', 'Add milestone');
        save.onclick = () => {
          if (!d.label.trim()) { err.textContent = 'Give the milestone a name.'; err.hidden = false; return; }
          const spec = { kind: d.kind, label: d.label.trim(), due: d.due || null };
          if (d.kind === 'consistency') { spec.weeks = Math.max(2, Math.min(52, d.weeks || 8)); spec.target = spec.weeks; }
          else { const n = Number(d.target); if (!(n > 0)) { err.textContent = 'Enter a target number.'; err.hidden = false; return; } spec.target = n; if (d.kind === 'lift') spec.exerciseId = d.exerciseId; }
          Plan.addMilestone(S, spec); H().persist(); Views.closeSheet(); H().renderAll(); H().toast('Milestone added');
        };
        body.appendChild(save);
      };
      paint();
    });
  }

  /* -------------------------------------------- next week's availability */
  function openNextWeek() {
    const S = H().S, today = H().todayISO();
    const wk = Plan.ensureWeek(S, today); const nextStart = Plan.addDays(wk.end, 1);
    const g = S.goals; const d = { days: g.daysPerWeek, minutes: g.sessionMinutes, unavailable: [] };
    Views.sheet('Plan around next week', (b) => {
      b.appendChild(el('p', 'muted', `Only ${esc(fmtDate(nextStart))} onwards for one week. Your goals do not change. Shorter or fewer sessions are laid out properly, not squeezed in.`));
      b.appendChild(Views.labelled('Training days', Views.select([1, 2, 3, 4, 5, 6].map(n => ({ value: n, label: n + (n === 1 ? ' day' : ' days') })), d.days, v => { d.days = Number(v); })));
      b.appendChild(Views.labelled('Minutes per session', Views.select(MINUTES.map(m => ({ value: m, label: m + ' min' })), d.minutes, v => { d.minutes = Number(v); })));
      b.appendChild(el('span', 'eyebrow', 'Equipment you will not have'));
      b.appendChild(Views.chips(EQUIP.filter(x => g.equipment[x] !== false && x !== 'bodyweight'), [], v => { d.unavailable = v; }, true, 'Unavailable'));
      const out = el('div'); out.style.marginTop = '12px';
      const prev = el('button', 'btn block', 'Preview next week'); prev.style.marginTop = '12px';
      b.append(prev, out);
      prev.onclick = () => {
        const ops = [];
        if (d.days < g.daysPerWeek) ops.push({ op: 'week_days', days: d.days, weekStart: nextStart, text: `Next week has ${d.days} training days.` });
        if (d.minutes < g.sessionMinutes) ops.push({ op: 'week_minutes', minutes: d.minutes, weekStart: nextStart, text: `Next week's sessions trimmed to about ${d.minutes} minutes.` });
        if (d.unavailable.length) ops.push({ op: 'week_equipment', unavailable: d.unavailable, weekStart: nextStart, text: `Next week avoids ${d.unavailable.join(', ')}.` });
        out.innerHTML = '';
        if (!ops.length) { out.appendChild(el('p', 'muted', 'That matches your usual week, so nothing would change.')); return; }
        const props = [{ id: 'pp_manual_' + Date.now(), kind: 'availability', title: 'Next week availability', ops }];
        const sched = Review.previewSchedule(S, wk, props, today);
        out.appendChild(el('span', 'eyebrow', 'Next week would be'));
        const ul = el('ul', 'vlist'); sched.forEach(s => ul.appendChild(el('li', null, `<b>${esc(fmtDate(s.date))}</b> ${esc(s.label)}${s.kind === 'training' ? ' · ' + Math.round(s.minutes) + ' min' : ''}`))); out.appendChild(ul);
        const ok = el('button', 'btn primary block', 'Apply to next week');
        ok.onclick = () => { const res = Review.applyProposalOps(S, props, today, 'availability'); H().persist(); Views.closeSheet(); H().renderAll(); H().toast(res.applied.length ? 'Next week updated.' : 'Nothing needed changing.'); };
        out.appendChild(ok);
      };
    });
  }

  /* --------------------------------------------------------------- history */
  function openHistory() {
    const S = H().S;
    Views.sheet('Plan history', (b) => {
      const cur = Plan.currentVersion(S);
      b.appendChild(el('span', 'eyebrow', 'Versions'));
      S.plan.versions.slice().reverse().forEach(v => {
        const c = el('div', 'vver' + (cur && v.id === cur.id ? ' current' : ''));
        c.innerHTML = `<div class="spread"><b>Version ${v.n}${cur && v.id === cur.id ? ' · current' : ''}</b><span class="dim">from ${esc(fmtDate(v.effectiveFrom))}</span></div><p class="muted" style="margin:4px 0">${esc(v.reason || '')}</p>`;
        if (v.changes && v.changes.length) { const ul = el('ul', 'vlist'); v.changes.slice(0, 6).forEach(x => ul.appendChild(el('li', null, esc(x)))); c.appendChild(ul); }
        if (cur && v.id !== cur.id) {
          const rb = el('button', 'btn sm', 'Go back to this version');
          rb.onclick = async () => {
            const nextW = Plan.nextWeekStart(S, H().todayISO());
            if (!(await Views.confirmSheet('Go back to version ' + v.n + '?', `This creates a new version from ${fmtDate(nextW)}. Everything you have already done, and this week's sessions, stay exactly as they are. Nothing is deleted.`, 'Go back'))) return;
            const r = Plan.rollbackTo(S, v.id, H().todayISO());
            if (!r.ok) { H().toast(r.problems[0], 'warn'); return; }
            H().persist(); H().renderAll(); H().toast('Plan restored from next week.');
          };
          c.appendChild(rb);
        }
        b.appendChild(c);
      });
      b.appendChild(el('span', 'eyebrow', 'Everything that changed'));
      const log = el('ul', 'vlist');
      Plan.planHistory(S).slice(0, 40).forEach(h => {
        const when = new Date(h.at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
        const text = h.type === 'version' ? `Plan version ${h.n}: ${h.reason}` : h.type === 'move' ? `${h.label} moved ${fmtDate(h.from)} to ${fmtDate(h.to)}` : h.type === 'skip' ? `${h.label} skipped (${h.category})` : h.type === 'daily' ? `Daily change: ${h.reason}` : h.type === 'extra' ? `Extra session on ${fmtDate(h.date)}` : h.type === 'adjust' ? (h.applied || []).join(' ') : h.type === 'miss' ? `${h.label} not done (${h.category})` : h.type;
        log.appendChild(el('li', null, `<span class="dim">${esc(when)}</span> ${esc(text)}`));
      });
      b.appendChild(log);
    });
  }

  /* ------------------------------------------------------------ goals form */
  function openGoals(first) {
    const S = H().S, today = H().todayISO();
    const tzGuess = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Australia/Sydney'; } catch (e) { return 'Australia/Sydney'; } })();
    const base = S.goals ? JSON.parse(JSON.stringify(S.goals)) : Plan.defaultGoals(S.profile, tzGuess);
    const g = base;
    Views.sheet(first ? 'Set up your plan' : 'Goals and settings', (b, close) => {
      const form = el('form', 'vform'); form.noValidate = true; b.appendChild(form);
      const effect = (key, fn) => { const p = el('p', 'veffect dim'); p.id = 'eff-' + key; p.textContent = fn(); return p; };
      // primary
      const pri = Views.select(Plan.GOAL_IDS.map(id => ({ value: id, label: Plan.GOALS[id].label })), g.primary, v => { g.primary = v; if (g.secondary) g.secondary = g.secondary.filter(x => x !== v); pe.textContent = Plan.explainSetting('primary', v); paintSec(); });
      pri.id = 'gPrimary';
      form.appendChild(Views.labelled('Main goal', pri));
      const pe = effect('primary', () => Plan.explainSetting('primary', g.primary)); form.appendChild(pe);
      // secondary
      form.appendChild(el('span', 'eyebrow', 'Secondary goals (optional, up to two)'));
      const secBox = el('div'); form.appendChild(secBox);
      const se = effect('secondary', () => Plan.explainSetting('secondary', (g.secondary || [])[0])); 
      const paintSec = () => { secBox.innerHTML = ''; secBox.appendChild(Views.chips(Plan.GOAL_IDS.filter(x => x !== g.primary).map(id => ({ value: id, label: Plan.GOALS[id].label })), g.secondary || [], v => { g.secondary = v.slice(0, 2); se.textContent = Plan.explainSetting('secondary', g.secondary[0]); paintSec(); }, true, 'Secondary goals')); };
      paintSec(); form.appendChild(se);
      // experience
      const xp = Views.select([{ value: 'novice', label: 'New to lifting' }, { value: 'intermediate', label: 'Some experience' }, { value: 'advanced', label: 'Experienced' }], g.experience, v => { g.experience = v; xe.textContent = Plan.explainSetting('experience', v); });
      form.appendChild(Views.labelled('Experience', xp)); const xe = effect('experience', () => Plan.explainSetting('experience', g.experience)); form.appendChild(xe);
      // days
      const dd = Views.select([1, 2, 3, 4, 5, 6].map(n => ({ value: n, label: n + (n === 1 ? ' day a week' : ' days a week') })), g.daysPerWeek, v => { g.daysPerWeek = Number(v); de.textContent = Plan.explainSetting('daysPerWeek', g.daysPerWeek); });
      form.appendChild(Views.labelled('Days available to train', dd)); const de = effect('daysPerWeek', () => Plan.explainSetting('daysPerWeek', g.daysPerWeek)); form.appendChild(de);
      form.appendChild(el('span', 'eyebrow', 'Preferred days (optional)'));
      form.appendChild(Views.chips(Plan.DOW_NAMES.slice(1).map((n, i) => ({ value: i + 1, label: n.slice(0, 3) })), g.preferredDays || [], v => { g.preferredDays = v; }, true, 'Preferred days'));
      form.appendChild(effect('preferredDays', () => Plan.explainSetting('preferredDays')));
      // minutes
      const mm = Views.select(MINUTES.map(m => ({ value: m, label: m + ' minutes' })), g.sessionMinutes, v => { g.sessionMinutes = Number(v); me.textContent = Plan.explainSetting('sessionMinutes', g.sessionMinutes); });
      form.appendChild(Views.labelled('Time per session', mm)); const me = effect('sessionMinutes', () => Plan.explainSetting('sessionMinutes', g.sessionMinutes)); form.appendChild(me);
      // equipment
      form.appendChild(el('span', 'eyebrow', 'Equipment you have'));
      form.appendChild(Views.chips(EQUIP, EQUIP.filter(x => g.equipment[x] !== false), v => { EQUIP.forEach(x => { g.equipment[x] = v.indexOf(x) >= 0; }); }, true, 'Equipment'));
      form.appendChild(effect('equipment', () => Plan.explainSetting('equipment')));
      // preferences
      const names = Object.values(H().EX_INDEX).filter(e => !e.libraryOnly);
      const dl = el('datalist'); dl.id = 'gExList'; names.forEach(e => { const o = el('option'); o.value = e.name; dl.appendChild(o); }); form.appendChild(dl);
      const prefBox = el('div'); const paintPrefs = () => {
        prefBox.innerHTML = '';
        [['disliked', 'Exercises to avoid'], ['liked', 'Exercises you enjoy']].forEach(([k, lab]) => {
          const wrap = el('div'); wrap.appendChild(el('span', 'eyebrow', lab));
          const row = el('div', 'opts vwrap');
          (g.preferences[k] || []).forEach(id => { const bt = el('button', null, esc(Views.exName(id)) + ' ✕'); bt.type = 'button'; bt.setAttribute('aria-label', 'Remove ' + Views.exName(id)); bt.onclick = () => { g.preferences[k] = g.preferences[k].filter(x => x !== id); paintPrefs(); }; row.appendChild(bt); });
          wrap.appendChild(row);
          const inp = Views.field('text', '', { list: 'gExList', placeholder: 'Type an exercise name', 'aria-label': lab });
          const add = el('button', 'btn sm', 'Add'); add.type = 'button';
          add.onclick = () => { const ex = names.find(e => e.name.toLowerCase() === inp.value.trim().toLowerCase()); if (!ex) { H().toast('Pick an exercise from the list', 'warn'); return; } g.preferences[k] = Array.from(new Set((g.preferences[k] || []).concat([ex.id]))); const other = k === 'disliked' ? 'liked' : 'disliked'; g.preferences[other] = (g.preferences[other] || []).filter(x => x !== ex.id); paintPrefs(); };
          const r2 = el('div', 'row'); r2.append(inp, add); wrap.appendChild(r2); prefBox.appendChild(wrap);
        });
      };
      paintPrefs(); form.appendChild(prefBox);
      form.appendChild(el('p', 'dim veffect', 'The main lifts stay consistent from week to week so progress can be measured. Avoided exercises are replaced, and accessories you enjoy are kept when they fit the plan.'));
      // limitations
      form.appendChild(el('span', 'eyebrow', 'Areas to be careful with (optional)'));
      const limBox = el('div'); form.appendChild(limBox);
      const paintLim = () => {
        limBox.innerHTML = '';
        g.limitations.forEach((l, i) => {
          const r = el('div', 'vnote'); r.innerHTML = `<b>${esc(l.area)}</b> <span class="dim">${esc(l.note || '')}${l.avoidExercises && l.avoidExercises.length ? ' · avoiding ' + l.avoidExercises.map(Views.exName).map(esc).join(', ') : ''}</span>`;
          const rm = el('button', 'btn sm ghost', 'Remove'); rm.type = 'button'; rm.onclick = () => { g.limitations.splice(i, 1); paintLim(); }; r.appendChild(rm); limBox.appendChild(r);
        });
        const area = Views.select([{ value: '', label: 'Add an area…' }].concat(LIMIT_AREAS.map(a => ({ value: a, label: a }))), '', () => {});
        area.setAttribute('aria-label', 'Area');
        const note = Views.field('text', '', { placeholder: 'What to avoid, in your words', maxlength: 120, 'aria-label': 'Note' });
        const ex = Views.field('text', '', { list: 'gExList', placeholder: 'Exercise to avoid (optional)', 'aria-label': 'Exercise to avoid' });
        const add = el('button', 'btn sm', 'Add'); add.type = 'button';
        add.onclick = () => { if (!area.value) { H().toast('Choose an area', 'warn'); return; } const e1 = names.find(e => e.name.toLowerCase() === ex.value.trim().toLowerCase()); g.limitations.push({ area: area.value, note: note.value.trim(), avoidExercises: e1 ? [e1.id] : [] }); paintLim(); };
        const grid = el('div', 'stack'); grid.append(area, note, ex, add); limBox.appendChild(grid);
        limBox.appendChild(el('p', 'dim veffect', 'These are your own choices, not a diagnosis. Recomp avoids what you list. For pain, see a qualified clinician.'));
      };
      paintLim();
      // review
      form.appendChild(el('span', 'eyebrow', 'Weekly review'));
      const rd = Views.select(Plan.DOW_NAMES.slice(1).map((n, i) => ({ value: i + 1, label: n })), g.reviewDay, v => { g.reviewDay = Number(v); });
      form.appendChild(Views.labelled('Review day', rd)); form.appendChild(effect('reviewDay', () => Plan.explainSetting('reviewDay')));
      const rt = Views.field('time', g.reviewTime); rt.onchange = () => { g.reviewTime = rt.value || '18:00'; };
      form.appendChild(Views.labelled('Review time', rt, 'In your local time zone: ' + g.timezone));
      const tz = Views.field('text', g.timezone, { 'aria-label': 'Time zone' }); tz.onchange = () => { const v = tz.value.trim(); try { new Intl.DateTimeFormat('en', { timeZone: v }); g.timezone = v; } catch (e) { H().toast('That time zone is not recognised', 'warn'); tz.value = g.timezone; } };
      form.appendChild(Views.labelled('Time zone', tz));
      const err = el('p', 'autherr'); err.setAttribute('role', 'alert'); err.hidden = true; form.appendChild(err);
      const save = el('button', 'btn primary block lg', first ? 'Build my plan' : 'Save and update my plan'); save.type = 'submit'; form.appendChild(save);
      form.onsubmit = e => {
        e.preventDefault();
        const problems = Plan.validateGoals(g);
        if (problems.length) { err.textContent = problems[0]; err.hidden = false; return; }
        err.hidden = true;
        if (!S.goals || first) {
          g.startDate = today; g.updatedAt = Date.now(); S.goals = g;
          Plan.createInitialPlan(S, today, g); Plan.ensureWeek(S, today); Plan.reconcile(S, today);
          H().persist(); Views.closeSheet(); H().go('plan'); H().toast('Your plan is ready.');
        } else {
          const patch = {}; ['primary', 'secondary', 'experience', 'daysPerWeek', 'preferredDays', 'sessionMinutes', 'equipment', 'preferences', 'limitations', 'reviewDay', 'reviewTime', 'timezone'].forEach(k => { if (JSON.stringify(g[k]) !== JSON.stringify(S.goals[k])) patch[k] = g[k]; });
          if (!Object.keys(patch).length) { Views.closeSheet(); H().toast('Nothing changed.'); return; }
          const res = Plan.changeGoals(S, patch, today, 'You changed your goals and settings.');
          if (!res.ok) { err.textContent = (res.problems || ['That change could not be saved.'])[0]; err.hidden = false; return; }
          H().persist(); Views.closeSheet(); H().renderAll();
          Views.sheet('Plan updated', (bb) => {
            bb.appendChild(el('p', null, `<b>New plan from ${esc(fmtDate(res.effectiveFrom))}.</b> Everything you have done is kept, and this week's sessions are unchanged.`));
            const ul = el('ul', 'vlist'); res.changes.slice(0, 12).forEach(x => ul.appendChild(el('li', null, esc(x)))); bb.appendChild(ul);
            bb.appendChild(el('p', 'dim', 'You can go back to the previous version any time from Plan history.'));
          });
        }
      };
    });
  }

  /* ---------------------------------------------------------------- render */
  Views.register('plan', { render(root) {
    root.innerHTML = '';
    const S = H().S, today = H().todayISO();
    if (!Plan.hasPlan(S)) {
      const c = el('div', 'card'); c.innerHTML = '<h3 style="margin:0 0 6px">No plan yet</h3><p class="muted">Set your goals and Recomp builds the plan, explains it, and adapts it each week.</p>';
      const b = el('button', 'btn primary', 'Set up my plan'); b.onclick = () => openGoals(true); c.appendChild(b); root.appendChild(c); return;
    }
    Plan.reconcile(S, today);
    const wk = Plan.ensureWeek(S, today), v = Plan.currentVersion(S), bi = Plan.blockInfo(S, wk.start);
    const g = S.goals;
    const top = el('div', 'hero stack');
    top.innerHTML = `<span class="eyebrow">${esc(Plan.GOALS[g.primary].label)}${g.secondary && g.secondary.length ? ' · ' + g.secondary.map(x => esc(Plan.GOALS[x].label)).join(', ') : ''}</span>
      <h2 style="margin:0">Week ${bi.weekIndex}, block ${bi.block}</h2>
      <p class="muted" style="margin:0">${bi.phase === 'consolidate' ? 'A consolidation week: the last week of a block eases off before the next one.' : `Building: week ${bi.weekInBlock} of ${bi.blockLength} in this block.`} The plan has no end date. It continues in blocks of ${bi.blockLength} weeks, and each weekly review decides what changes. ${plural(g.daysPerWeek, 'day')} a week, about ${g.sessionMinutes} minutes. Plan version ${v.n}.</p>`;
    const row = el('div', 'row'); row.style.flexWrap = 'wrap';
    const sg = el('button', 'btn', 'Goals and settings'); sg.onclick = () => openGoals(false);
    const nw = el('button', 'btn', 'Plan around next week'); nw.onclick = openNextWeek;
    const hs = el('button', 'btn ghost', 'History'); hs.onclick = openHistory;
    row.append(sg, nw, hs); top.appendChild(row); root.appendChild(top);

    root.appendChild(Views.heading('Calendar'));
    weekCard(S, wk, today, 'This week', root);
    const nextStart = Plan.addDays(wk.end, 1);
    const w2 = Plan.ensureWeek(S, nextStart); weekCard(S, w2, today, 'Next week', root);
    root.appendChild(el('p', 'dim', 'Next week is a draft until it starts. Your weekly review can change it, and once a week starts its sessions are the agreed plan: you can move, shorten or skip them, and every change is kept.'));

    root.appendChild(Views.heading('Milestones'));
    milestoneCard(S, today, root);

    root.appendChild(Views.heading('Why the plan looks like this'));
    const why = el('div', 'card'); why.innerHTML = `<p style="margin:0 0 6px">${esc(v.reason || '')}</p>`;
    const eff = Plan.GOALS[g.primary].effect; why.appendChild(el('p', 'muted', esc(eff)));
    root.appendChild(why);
  } });

  return { openGoals, openHistory, openSlot, openMilestone, openNextWeek, confirmMove, chooseSkip, chooseMove };
})();
window.PlanUI = PlanUI;
