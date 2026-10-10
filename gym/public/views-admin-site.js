/* Administrator tools for the site and privacy set-up: the publishing checklist,
   operator details used by the privacy policy, page content for About and Why,
   member requests, and security events. The server enforces every permission;
   this screen only presents what the API returns. */
const AdminSite = (function () {
  'use strict';
  const H = () => window.RecompHost;
  const { el, esc, fmtDate } = Views;
  let tab = 'checklist';

  /* ------------------------------------------ simple text format for pages
     ## Heading {#id}     ### Subheading      > Note      - item      1. item
     [card Available now] Title | text        [step] Title | text
     | a | b |  (first row is the header)      blank line between blocks   */
  function toText(blocks) {
    return (blocks || []).map(b => {
      const id = b.id ? ` {#${b.id}}` : '';
      if (b.t === 'h2') return `## ${b.text}${id}`;
      if (b.t === 'h3') return `### ${b.text}${id}`;
      if (b.t === 'note') return `> ${b.text}`;
      if (b.t === 'ul') return b.items.map(i => `- ${i}`).join('\n');
      if (b.t === 'ol') return b.items.map((i, n) => `${n + 1}. ${i}`).join('\n');
      if (b.t === 'steps') return b.items.map(i => `[step] ${i.title}${i.text ? ' | ' + i.text : ''}`).join('\n');
      if (b.t === 'cards') return b.items.map(i => `[card${i.badge ? ' ' + i.badge : ''}] ${i.title}${i.text ? ' | ' + i.text : ''}`).join('\n');
      if (b.t === 'table') return [b.head || []].concat(b.rows || []).map(r => '| ' + r.join(' | ') + ' |').join('\n');
      return b.text || '';
    }).join('\n\n');
  }
  function fromText(text) {
    const out = [];
    String(text || '').replace(/\r/g, '').split(/\n\s*\n/).forEach(chunk => {
      const lines = chunk.split('\n').map(l => l.trimEnd()).filter(l => l.trim());
      if (!lines.length) return;
      const first = lines[0];
      const head = (t, s) => { const m = s.match(/^(.*?)\s*\{#([A-Za-z0-9_-]+)\}\s*$/); out.push(m ? { t, text: m[1], id: m[2] } : { t, text: s }); };
      if (lines.every(l => /^- /.test(l))) out.push({ t: 'ul', items: lines.map(l => l.slice(2).trim()) });
      else if (lines.every(l => /^\d+\. /.test(l))) out.push({ t: 'ol', items: lines.map(l => l.replace(/^\d+\.\s*/, '')) });
      else if (lines.every(l => /^\[step\]/.test(l))) out.push({ t: 'steps', items: lines.map(l => { const [a, b] = l.replace(/^\[step\]\s*/, '').split(' | '); return b ? { title: a, text: b } : { title: a }; }) });
      else if (lines.every(l => /^\[card[^\]]*\]/.test(l))) out.push({ t: 'cards', items: lines.map(l => { const m = l.match(/^\[card\s*([^\]]*)\]\s*(.*)$/); const [a, b] = m[2].split(' | '); const it = { title: a }; if (b) it.text = b; if (m[1]) it.badge = m[1]; return it; }) });
      else if (lines.every(l => /^\|.*\|$/.test(l))) { const rows = lines.map(l => l.slice(1, -1).split('|').map(c => c.trim())); out.push({ t: 'table', head: rows[0], rows: rows.slice(1) }); }
      else if (/^### /.test(first) && lines.length === 1) head('h3', first.slice(4));
      else if (/^## /.test(first) && lines.length === 1) head('h2', first.slice(3));
      else if (/^> /.test(first)) out.push({ t: 'note', text: lines.map(l => l.replace(/^> ?/, '')).join(' ') });
      else out.push({ t: 'p', text: lines.join(' ') });
    });
    return out;
  }

  async function call(method, path, body) {
    return Settings.withReauth(() => AUTH.call(method, path, body), 'Confirm it is you before changing site or privacy settings.');
  }

  /* ---------------------------------------------------------------- panes */
  async function paneChecklist(box) {
    const r = await AUTH.call('GET', '/api/admin/privacy-checklist');
    box.innerHTML = '';
    if (!r.ok) { box.appendChild(el('p', 'autherr', esc(r.error))); return; }
    box.appendChild(el('div', 'banner' + (r.data.publishable ? ' ok' : ''), `<div><b>${r.data.publishable ? 'The essentials are done.' : 'The privacy policy is not ready to publish.'}</b><br><span class="muted">${r.data.publishable ? 'Review the remaining items before removing the draft label.' : 'It shows a draft banner until the operator details are entered and the key items below are done.'}</span></div>`));
    const sec = (title, items) => {
      box.appendChild(el('span', 'eyebrow', esc(title)));
      items.forEach(i => {
        const row = el('div', 'set-row');
        row.appendChild(el('div', 'set-t', `<b>${i.done ? '✓ ' : ''}${esc(i.label)}</b>${i.detail ? `<span>${esc(i.detail)}</span>` : ''}`));
        if (i.kind === 'manual') {
          const sw = el('label', 'switch'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = i.done; cb.setAttribute('role', 'switch'); cb.setAttribute('aria-label', i.label);
          cb.onchange = async () => { const x = await call('PUT', '/api/admin/privacy-checklist/' + i.id, { done: cb.checked }); if (!x.ok) { cb.checked = !cb.checked; if (!x.cancelled) H().toast(x.error, 'warn'); } };
          sw.append(cb, el('i')); row.appendChild(sw);
        } else row.appendChild(el('span', 'pill ' + (i.done ? 'go' : 'hold'), i.done ? 'Done' : 'To do'));
        box.appendChild(row);
      });
    };
    sec('Checked automatically from the server configuration', r.data.items.filter(i => i.kind === 'automatic'));
    sec('Confirmed by you', r.data.items.filter(i => i.kind === 'manual'));
    box.appendChild(el('p', 'dim veffect', 'Ticking an item records who ticked it and when. It does not change how the app works. The full list of facts still needed is in the setup notes (docs/privacy/UNRESOLVED-FACTS.md).'));
  }
  async function paneOperator(box) {
    const r = await AUTH.call('GET', '/api/operator');
    box.innerHTML = '';
    const o = (r.ok && r.data.operator) || {}, pol = (r.ok && r.data.policy) || {};
    box.appendChild(el('p', 'muted', 'These details appear in the privacy policy and About page. Leave a field empty rather than guessing: the pages show "not yet supplied" and stay marked as a draft.'));
    const f = {};
    [['name', 'Trading name shown to members', 'text'], ['legalName', 'Legal name of the person or business', 'text'], ['abn', 'ABN (if you have one)', 'text'], ['privacyEmail', 'Privacy contact email (must be monitored)', 'email'], ['address', 'Postal address for privacy requests', 'text'], ['country', 'Country the operator is based in', 'text']]
      .forEach(([k, l, t]) => { f[k] = Views.field(t, o[k] || '', { maxlength: 200 }); box.appendChild(Views.labelled(l, f[k])); });
    const ed = Views.field('date', pol.effectiveDate || ''); box.appendChild(Views.labelled('Privacy policy effective date', ed));
    const err = el('p', 'autherr'); err.setAttribute('role', 'alert'); err.hidden = true; box.appendChild(err);
    const save = el('button', 'btn primary block', 'Save operator details'); box.appendChild(save);
    save.onclick = async () => {
      const operator = {}; Object.keys(f).forEach(k => { operator[k] = f[k].value.trim(); });
      const x = await call('PUT', '/api/admin/operator', { operator, policy: { effectiveDate: ed.value } });
      if (!x.ok) { if (!x.cancelled) { err.textContent = x.error; err.hidden = false; } return; }
      err.hidden = true; Content.invalidate(); H().toast(x.data.complete ? 'Saved. The essentials are complete.' : 'Saved. Some details are still missing.');
    };
  }
  async function panePages(box) {
    box.innerHTML = '';
    let key = 'about';
    const pick = Views.chips([{ value: 'about', label: 'About Recomp' }, { value: 'why', label: 'Why Recomp' }], key, v => { key = v; load(); }, false, 'Page');
    box.appendChild(pick);
    const area = el('div'); box.appendChild(area);
    async function load() {
      area.innerHTML = '<p class="dim">Loading…</p>';
      Content.invalidate(key);
      const doc = await Content.load(key);
      area.innerHTML = '';
      if (!doc) { area.appendChild(el('p', 'autherr', 'The page could not be loaded.')); return; }
      area.appendChild(el('p', 'muted', doc.overridden ? 'This page has been edited here. Reset to go back to the version that ships with the app.' : 'This is the version that ships with the app. Saving creates your own edited version.'));
      const title = Views.field('text', doc.title || '', { maxlength: 120 }); area.appendChild(Views.labelled('Title', title));
      const sum = el('textarea', 'vtext'); sum.rows = 3; sum.maxLength = 600; sum.value = doc.summary || ''; area.appendChild(Views.labelled('Summary', sum));
      const ta = el('textarea', 'vtext'); ta.rows = 18; ta.value = toText(doc.blocks); ta.style.fontFamily = 'var(--mono)'; ta.style.fontSize = '.82rem';
      area.appendChild(Views.labelled('Content', ta, '## heading {#id}, ### subheading, - list, 1. list, > note, [card Available now] Title | text, [step] Title | text, | table | rows |. Bold **like this**, links [label](https://…). No HTML.'));
      const status = Views.select([{ value: 'published', label: 'Published' }, { value: 'draft', label: 'Draft' }], doc.status || 'draft', () => {}); area.appendChild(Views.labelled('Status', status));
      const prev = el('div', 'card'); prev.style.marginTop = '10px';
      const paint = () => { prev.innerHTML = ''; prev.appendChild(el('span', 'eyebrow', 'Preview')); prev.appendChild(Content.blocks(fromText(ta.value), { operator: {}, policy: {} }, { toc: [], missing: new Set() })); };
      ta.oninput = paint; paint(); area.appendChild(prev);
      const err = el('p', 'autherr'); err.setAttribute('role', 'alert'); err.hidden = true; area.appendChild(err);
      const row = el('div', 'row'); row.style.cssText = 'flex-wrap:wrap;margin-top:10px';
      const save = el('button', 'btn primary', 'Save page'); const reset = el('button', 'btn ghost', 'Reset to the shipped version');
      save.onclick = async () => {
        const today = H().todayISO();
        const content = { title: title.value.trim(), summary: sum.value.trim(), version: today + '.edit', updated: today, status: status.value, blocks: fromText(ta.value) };
        const x = await call('PUT', '/api/admin/content/' + key, { content });
        if (!x.ok) { if (!x.cancelled) { err.textContent = x.error; err.hidden = false; } return; }
        err.hidden = true; Content.invalidate(key); H().toast('Page saved');
      };
      reset.onclick = async () => {
        if (!(await Views.confirmSheet('Reset this page?', 'Your edits are removed and the version that ships with the app is shown again.', 'Reset'))) { open('pages'); return; }
        const x = await call('PUT', '/api/admin/content/' + key, { content: null }); if (x.ok) { Content.invalidate(key); H().toast('Reset'); } open('pages');
      };
      row.append(save, reset); area.appendChild(row);
    }
    load();
  }
  async function paneRequests(box) {
    const r = await AUTH.call('GET', '/api/admin/account-requests');
    box.innerHTML = '';
    if (!r.ok) { box.appendChild(el('p', 'autherr', esc(r.error))); return; }
    if (!r.data.requests.length) box.appendChild(el('p', 'muted', 'No requests from members.'));
    r.data.requests.forEach(q => {
      const c = el('div', 'vver');
      c.innerHTML = `<div class="spread"><b>${esc(q.name || q.email)}</b><span class="pill ${q.status === 'done' ? 'go' : 'hold'}">${esc(q.status)}</span></div><p class="dim" style="margin:2px 0">${esc(q.type)} · ${esc(new Date(q.createdAt).toLocaleString('en-AU'))} · ${esc(q.email)}</p><p style="margin:6px 0">${esc(q.message)}</p>`;
      const b = el('button', 'btn sm', q.status === 'done' ? 'Reopen' : 'Mark done');
      b.onclick = async () => { const x = await AUTH.call('PATCH', '/api/admin/account-requests/' + encodeURIComponent(q.id), { status: q.status === 'done' ? 'open' : 'done' }); if (x.ok) paneRequests(box); else H().toast(x.error, 'warn'); };
      c.appendChild(b); box.appendChild(c);
    });
    box.appendChild(el('p', 'dim veffect', 'Reply to the member by email. Reading this list is recorded in the security log.'));
  }
  async function paneEvents(box) {
    const r = await AUTH.call('GET', '/api/admin/security-events?limit=150');
    box.innerHTML = '';
    if (!r.ok) { box.appendChild(el('p', 'autherr', esc(r.error))); return; }
    const ul = el('ul', 'vlist');
    r.data.events.forEach(e => ul.appendChild(el('li', null, `<span class="dim">${esc(new Date(e.at).toLocaleString('en-AU', { dateStyle: 'short', timeStyle: 'short' }))}</span> <b>${esc(e.action)}</b>${e.actorName ? ' by ' + esc(e.actorName) : ''}${e.targetId ? ' <span class="dim">on ' + esc(String(e.targetId).slice(0, 14)) + '</span>' : ''}`)));
    box.appendChild(ul);
    box.appendChild(el('p', 'dim veffect', 'The security log cannot be edited or deleted from the app. Personal details are removed from it when an account is deleted.'));
  }

  function open(which) {
    if (which) tab = which;
    Views.sheet('Site, privacy and security', (b) => {
      b.appendChild(Views.chips([{ value: 'checklist', label: 'Setup checklist' }, { value: 'operator', label: 'Operator details' }, { value: 'pages', label: 'Pages' }, { value: 'requests', label: 'Member requests' }, { value: 'events', label: 'Security events' }],
        tab, v => { tab = v; paint(); }, false, 'Section'));
      const box = el('div'); box.style.marginTop = '12px'; b.appendChild(box);
      const paint = () => { box.innerHTML = '<p class="dim">Loading…</p>'; ({ checklist: paneChecklist, operator: paneOperator, pages: panePages, requests: paneRequests, events: paneEvents })[tab](box); };
      paint();
    });
  }
  return { open, toText, fromText };
})();
window.AdminSite = AdminSite;
