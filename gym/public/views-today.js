/* TODAY: the cards under the hero. The hero itself (planned session, Start or
   Resume) is rendered by app.js. Everything here reads the saved plan. */
(function () {
  'use strict';
  const H = () => window.RecompHost;
  const { el, esc, fmtDate, plural } = Views;

  function noPlanCard(root) {
    const c = el('div', 'card');
    c.innerHTML = `<span class="eyebrow">Your plan</span><h3 style="margin:6px 0">Set your goals</h3>
      <p class="muted" style="margin:0 0 10px">Tell Recomp what you are training for, your days, time and equipment. It builds a weekly plan, explains each setting, and adapts it every week from what you actually do.</p>`;
    const b = el('button', 'btn primary', 'Set up my plan'); b.onclick = () => PlanUI.openGoals(true);
    c.appendChild(b); root.appendChild(c);
  }

  function adaptCard(root, slot, live) {
    const c = el('div', 'card');
    c.innerHTML = `<span class="eyebrow">Change today's session</span><p class="dim" style="margin:4px 0 10px;font-size:.82rem">You see exactly what changes before anything is saved.</p>`;
    const row = el('div', 'opts vwrap');
    [['less_time', 'I have less time'], ['equipment', 'Equipment unavailable'], ['feel_different', 'I feel different today']].forEach(([k, label]) => {
      const b = el('button', null, esc(label)); b.type = 'button'; b.onclick = () => adaptFlow(slot.id, k); row.appendChild(b);
    });
    c.appendChild(row); root.appendChild(c);
  }
  function adaptFlow(slotId, kind) {
    if (kind === 'less_time') {
      Views.sheet('How long do you have?', (b) => {
        [20, 30, 40, 45, 60].forEach(m => { const bt = el('button', 'btn block', m + ' minutes'); bt.style.marginTop = '8px'; bt.onclick = () => { Views.closeSheet(); Views.openAdjust(slotId, 'less_time', { minutes: m }); }; b.appendChild(bt); });
      });
    } else if (kind === 'equipment') {
      const eq = ['barbell', 'dumbbell', 'machine', 'cable', 'bands', 'kettlebell'].filter(x => H().S.goals.equipment[x] !== false);
      let picked = [];
      Views.sheet('What is not available?', (b) => {
        b.appendChild(Views.chips(eq, [], v => { picked = v; }, true, 'Unavailable equipment'));
        const go = el('button', 'btn primary block', 'Preview changes'); go.style.marginTop = '12px';
        go.onclick = () => { if (!picked.length) { H().toast('Choose at least one', 'warn'); return; } Views.closeSheet(); Views.openAdjust(slotId, 'equipment', { unavailable: picked }); };
        b.appendChild(go);
      });
    } else {
      Views.sheet('How do you feel?', (b) => {
        [['worse', 'Worse than usual', 'Accessory sets drop by one and no load increases today.'], ['better', 'Better than usual', 'Nothing is added on a good day. Loads still only rise through the normal rules.']].forEach(([v, l, d]) => {
          const bt = el('button', 'vlink'); bt.type = 'button'; bt.innerHTML = `<b>${l}</b><span class="muted">${d}</span>`; bt.onclick = () => { Views.closeSheet(); Views.openAdjust(slotId, 'feel_different', { level: v }); }; b.appendChild(bt);
        });
      });
    }
  }

  /* sessions planned earlier this week that did not happen */
  function missedCards(root) {
    const S = H().S, today = H().todayISO();
    const wk = Plan.ensureWeek(S, today); if (!wk) return;
    wk.slots.filter(s => (s.kind === 'training' || s.kind === 'conditioning') && s.status === 'missed' && !s.missReason).forEach(s => {
      const c = el('div', 'card');
      c.innerHTML = `<span class="eyebrow">Not done</span><h3 style="margin:6px 0">${esc(s.label)} on ${esc(fmtDate(s.agreedDate || s.date))}</h3>
        <p class="muted" style="margin:0 0 10px">What got in the way? It changes what the plan does next: running out of time shortens sessions, low energy lowers the load.</p>`;
      const row = el('div', 'opts vwrap');
      [['time', 'Ran out of time'], ['capacity', 'Not up to it'], ['illness', 'Unwell'], ['travel', 'Travel'], ['other', 'Something else']].forEach(([k, l]) => {
        const b = el('button', null, esc(l)); b.type = 'button';
        b.onclick = () => { Plan.classifyMiss(S, s.id, k); Plan.logChange(S, { type: 'miss', slotId: s.id, label: s.label, category: k }); H().persist(); H().renderAll(); H().toast('Noted. It is not added on top of other sessions.'); };
        row.appendChild(b);
      });
      c.appendChild(row);
      if (s.kind === 'training') {
        const sug = Plan.suggestReschedule(S, s.id, today);
        if (sug.options.length) {
          const r = el('div', 'row'); r.style.marginTop = '10px'; r.style.flexWrap = 'wrap';
          sug.options.forEach(o => { const b = el('button', 'btn sm', `Move to ${esc(fmtDate(o.date))}`); b.onclick = () => PlanUI.confirmMove(s.id, o.date, true); r.appendChild(b); });
          c.appendChild(r);
        }
        c.appendChild(el('p', 'dim', esc(sug.options.length ? 'These days keep a rest day and do not stack hard sessions.' : sug.note || '')));
      }
      root.appendChild(c);
    });
  }

  function changeCard(root) {
    const S = H().S, today = H().todayISO();
    const recent = Plan.planHistory(S).filter(h => (h.type === 'version' && h.source !== 'initial') || h.type === 'daily' || h.type === 'extra' || h.type === 'move').slice(0, 1)[0];
    if (!recent) return;
    const when = new Date(recent.at).toISOString().slice(0, 10);
    if (Plan.diffDays(when, today) > 7) return;
    const lines = recent.type === 'version' ? recent.changes : recent.type === 'daily' ? [recent.reason] : recent.type === 'move' ? [`${recent.label} moved from ${fmtDate(recent.from)} to ${fmtDate(recent.to)}. ${recent.reason || ''}`] : [`An extra session was added on ${fmtDate(recent.date)}.`];
    const c = el('div', 'card');
    c.innerHTML = `<span class="eyebrow">What changed in your plan</span>
      <p style="margin:6px 0 4px"><b>${esc(recent.type === 'version' ? recent.reason : lines[0] || '')}</b></p>
      ${recent.type === 'version' && recent.changes.length ? '<ul class="vlist">' + recent.changes.slice(0, 4).map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : ''}`;
    const b = el('button', 'btn sm ghost', 'See full history'); b.onclick = () => PlanUI.openHistory(); c.appendChild(b);
    root.appendChild(c);
  }

  function reviewCard(root) {
    const S = H().S;
    const sch = Review.reviewSchedule(S, Date.now()); if (!sch) return;
    if (S.prefs && S.prefs.reviewReminder === false && sch.status !== 'done') return;   // turned off in Settings
    const c = el('div', 'card');
    const draft = (S.reviews || []).find(r => r.periodEnd === sch.periodEnd && r.status === 'draft');
    if (sch.status === 'due' || sch.status === 'overdue') {
      c.innerHTML = `<span class="eyebrow">Weekly review</span><h3 style="margin:6px 0">${sch.status === 'overdue' ? 'Your review is overdue' : 'Your weekly review is ready'}</h3>
        <p class="muted" style="margin:0 0 10px">Week of ${esc(fmtDate(sch.periodStart))} to ${esc(fmtDate(sch.periodEnd))}. ${draft ? 'You have a draft in progress.' : 'It starts with your numbers, then a few questions. If you skip it, the plan carries on unchanged.'}</p>`;
      const b = el('button', 'btn primary', draft ? 'Continue review' : 'Start review'); b.onclick = () => ReviewUI.open(); c.appendChild(b);
    } else if (sch.status === 'done') {
      c.innerHTML = `<span class="eyebrow">Weekly review</span><p style="margin:6px 0 8px"><b>This week's review is done.</b> Next one ${esc(fmtDate(sch.nextReview))} at ${esc(sch.reviewTime)}.</p>`;
      const b = el('button', 'btn sm ghost', 'Read it again'); b.onclick = () => ReviewUI.openHistory(); c.appendChild(b);
    } else {
      c.innerHTML = `<span class="eyebrow">Weekly review</span><p style="margin:6px 0 8px">Next review: <b>${esc(fmtDate(sch.nextReview))}</b> at ${esc(sch.reviewTime)}, ${esc(sch.tz.replace('_', ' '))} time. ${sch.daysUntilNext === 1 ? 'That is tomorrow.' : `In ${sch.daysUntilNext} days.`}</p>`;
    }
    root.appendChild(c);
  }

  function summaryCard(root) {
    const S = H().S, today = H().todayISO();
    const wk = Plan.ensureWeek(S, today); if (!wk) return;
    const st = Review.computeWeekStats(S, wk, today).stats;
    const c = el('div', 'card');
    c.innerHTML = `<span class="eyebrow">This week so far</span>
      <div class="grid4" style="margin-top:8px">
        <div class="stat"><div class="n">${st.completed}/${st.planned}</div><div class="l">planned done</div></div>
        <div class="stat"><div class="n">${st.uniqueTrainingDays}</div><div class="l">training days</div></div>
        <div class="stat"><div class="n">${st.additional}</div><div class="l">extra</div></div>
        <div class="stat"><div class="n">${st.hardSets}</div><div class="l">hard sets</div></div>
      </div>
      <p class="dim" style="margin:8px 0 0;font-size:.8rem">Planned sessions done are counted against the agreed plan only. Extra workouts add to your load but never raise that figure above 100 per cent.</p>`;
    root.appendChild(c);
  }

  function readinessCard(root) {
    const S = H().S, today = H().todayISO();
    const cur = Garmin.current(S, today), ck = S.lastCheckin;
    const c = el('div', 'card');
    const ckLine = ck && ck.at && new Date(ck.at).toISOString().slice(0, 10) === today ? `Your check-in today: energy ${ck.energy || '–'}, sleep ${ck.sleep || '–'}, soreness ${ck.soreness || '–'} (out of 5).` : 'No readiness check-in yet today.';
    c.innerHTML = `<span class="eyebrow">Readiness</span><p style="margin:6px 0 4px">${esc(ckLine)}</p><p class="dim" style="margin:0;font-size:.82rem">${esc(cur.message)}</p>`;
    root.appendChild(c);
  }

  function updatesCard(root) {
    const S = H().S;
    const c = el('div', 'card');
    c.innerHTML = '<span class="eyebrow">Training updates</span>';
    const notes = (S.notes || []).slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 3);
    if (!notes.length) c.appendChild(el('p', 'muted', 'Write down anything the numbers will not show: how a lift felt, a hard week at work, something you want to change. It is used in your weekly review.'));
    notes.forEach(n => {
      const r = el('div', 'vnote'); r.innerHTML = `<div class="spread"><span class="pill">${esc(n.category || 'update')}</span><span class="dim">${esc(fmtDate(n.date))}${n.editedAt ? ' · edited' : ''}</span></div><p style="margin:6px 0">${esc(n.text)}</p>`;
      const e = el('button', 'btn sm ghost', 'Edit'); e.onclick = () => NotesUI.compose({ edit: n });
      const d = el('button', 'btn sm ghost', 'Delete'); d.onclick = async () => { if (await Views.confirmSheet('Delete this update?', 'It is removed from your records and from any report it appeared in.', 'Delete', true)) { Review.deleteNote(S, n.id); H().persist(); H().renderAll(); H().toast('Update deleted'); } };
      const rw = el('div', 'row'); rw.append(e, d); r.appendChild(rw); c.appendChild(r);
    });
    const draft = Review.getDraft(S, 'today');
    const add = el('button', 'btn' + (notes.length ? ' ghost' : ''), draft ? 'Continue your draft' : 'Add training update'); add.id = 'addUpdateBtn';
    add.style.marginTop = '8px'; add.onclick = () => NotesUI.compose({ key: 'today' }); c.appendChild(add);
    root.appendChild(c);
  }


  /* Administrators see waiting sign-up requests on Today. Counts come from the server. */
  function adminCard(root) {
    if (!Views.isAdmin() || H().AUTH_MODE !== 'server') return;
    const c = el('div', 'card'); c.id = 'adminTodayCard'; c.hidden = true; root.prepend(c);
    Promise.all(['pending_approval', 'pending_verification'].map(st => AUTH.api('/api/admin/requests?status=' + st).catch(() => null))).then(rs => {
      const [ap, ve] = rs.map(r => r && r.status === 200 && r.data.requests ? r.data.requests.length : 0);
      if (!ap && !ve) return;
      c.innerHTML = `<span class="eyebrow">Administration</span><p style="margin:6px 0 8px"><b>${plural(ap, 'request')} waiting for approval</b>${ve ? `, ${plural(ve, 'more')} waiting for email verification` : ''}.</p>`;
      const b = el('button', 'btn primary', 'Review requests'); b.onclick = () => Admin.open(b); c.appendChild(b); c.hidden = false;
    });
  }

  Views.register('today', { render(root) {
    root.innerHTML = '';
    adminCard(root);
    const S = H().S, today = H().todayISO();
    if (!Plan.hasPlan(S)) { noPlanCard(root); updatesCard(root); return; }
    const slots = Plan.slotsOn(S, today);
    const slot = slots.find(x => x.kind === 'training' && x.status === 'planned');
    const live = H().currentSession();
    const liveSlot = live && live.slotId ? Plan.findSlot(S, live.slotId) : null;
    if (liveSlot && liveSlot.slot.kind === 'training') adaptCard(root, liveSlot.slot, live);
    else if (slot) adaptCard(root, slot);
    ReviewUI.autoCarryOver(S);
    missedCards(root); changeCard(root); reviewCard(root); summaryCard(root); readinessCard(root); updatesCard(root);
  } });
  window.TodayUI = { adaptFlow };
})();
