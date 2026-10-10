/* Public page content managed by administrators, operator details for the
   privacy policy, the privacy and security setup checklist, and security events.
   Content is validated against a small block format: no HTML is accepted, and
   links may only be https, mailto or in-page anchors. */
import { audit } from './auth.js';
import { json, err, readBody } from './http.js';
import { hasRecentAuth, reauthRequired } from './security.js';
import { mailConfigured } from './mail.js';
import { aiConfigured } from './ai.js';

export const CONTENT_KEYS = ['about', 'why'];
const TYPES = new Set(['h2', 'h3', 'p', 'ul', 'ol', 'table', 'note', 'steps', 'cards']);
const LINK = /\[([^\]]*)\]\(([^)]*)\)/g;
const SAFE_URL = /^(https:\/\/[^\s<>"']+|mailto:[^\s<>"']+|#[A-Za-z0-9_-]+)$/;
function badText(t, max) {
  if (typeof t !== 'string') return 'text must be a string';
  if (t.length > (max || 2000)) return 'text is too long';
  if (/[<>]/.test(t)) return 'angle brackets are not allowed';
  let m; LINK.lastIndex = 0;
  while ((m = LINK.exec(t))) if (!SAFE_URL.test(m[2])) return 'links may only use https, mailto or #anchor';
  return null;
}
export function validateContent(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return 'Content must be an object.';
  for (const k of ['title', 'summary', 'version', 'updated']) if (c[k] != null) { const e = badText(c[k], k === 'summary' ? 600 : 120); if (e) return `${k}: ${e}`; }
  if (c.status != null && !['draft', 'published'].includes(c.status)) return 'status must be draft or published.';
  if (!Array.isArray(c.blocks) || c.blocks.length > 200) return 'blocks must be a list of at most 200.';
  for (let i = 0; i < c.blocks.length; i++) {
    const b = c.blocks[i], at = `block ${i + 1}`;
    if (!b || typeof b !== 'object' || !TYPES.has(b.t)) return `${at}: unknown block type.`;
    const extra = Object.keys(b).filter(k => !['t', 'id', 'text', 'items', 'head', 'rows', 'caption'].includes(k));
    if (extra.length) return `${at}: unknown field ${extra[0]}.`;
    if (b.id != null && !/^[A-Za-z0-9_-]{1,60}$/.test(b.id)) return `${at}: id may only use letters, digits, - and _.`;
    if (['h2', 'h3', 'p', 'note'].includes(b.t)) { const e = badText(b.text); if (e) return `${at}: ${e}`; }
    if (['ul', 'ol'].includes(b.t)) { if (!Array.isArray(b.items) || b.items.length > 60) return `${at}: items must be a list.`; for (const it of b.items) { const e = badText(it); if (e) return `${at}: ${e}`; } }
    if (b.t === 'table') {
      if (!Array.isArray(b.rows) || b.rows.length > 80) return `${at}: rows must be a list.`;
      for (const cell of [].concat(b.head || [], ...b.rows.map(r => Array.isArray(r) ? r : [null]), b.caption != null ? [b.caption] : [])) { const e = badText(cell, 600); if (e) return `${at}: ${e}`; }
    }
    if (['steps', 'cards'].includes(b.t)) {
      if (!Array.isArray(b.items) || b.items.length > 24) return `${at}: items must be a list.`;
      for (const it of b.items) {
        if (!it || typeof it !== 'object') return `${at}: each item needs a title.`;
        const ex = Object.keys(it).filter(k => !['title', 'text', 'badge'].includes(k)); if (ex.length) return `${at}: unknown field ${ex[0]}.`;
        for (const k of ['title', 'text', 'badge']) if (it[k] != null) { const e = badText(it[k], k === 'text' ? 600 : 80); if (e) return `${at}: ${e}`; }
      }
    }
  }
  return null;
}
export async function getContent(rc, key) {
  if (!CONTENT_KEYS.includes(key)) return err(404, 'No such page.');
  const r = await rc.db.get('SELECT content, updated_at FROM site_content WHERE key = ?', 'content:' + key);
  let content = null; try { content = r ? JSON.parse(r.content) : null; } catch (e) { content = null; }
  return json({ content, updatedAt: r ? r.updated_at : null }, 200, { 'Cache-Control': 'no-cache' });
}
export async function putContent(rc, actor, session, key) {
  if (!CONTENT_KEYS.includes(key)) return err(404, 'No such page.');
  if (!(await hasRecentAuth(rc.db, session.id, rc.now))) return reauthRequired();
  const b = await readBody(rc.req, 200 * 1024);
  if (b.content === null) {
    await rc.db.run('DELETE FROM site_content WHERE key = ?', 'content:' + key);
    await audit(rc.db, actor, 'site.content_reset', key, null, rc.ip);
    return json({ ok: true, content: null });
  }
  const problem = validateContent(b.content);
  if (problem) return err(400, problem);
  const c = { title: b.content.title, summary: b.content.summary, version: b.content.version, updated: b.content.updated, status: b.content.status || 'published', blocks: b.content.blocks };
  await rc.db.run('INSERT OR REPLACE INTO site_content (key, content, updated_at, updated_by) VALUES (?,?,?,?)', 'content:' + key, JSON.stringify(c), rc.now, actor.id);
  await audit(rc.db, actor, 'site.content_updated', key, { blocks: c.blocks.length }, rc.ip);
  return json({ ok: true, content: c });
}

/* --------------------------------------------------------------- operator */
const OP_FIELDS = ['name', 'legalName', 'abn', 'privacyEmail', 'address', 'country'];
async function readOperator(db) {
  const r = await db.get("SELECT content FROM site_content WHERE key = 'operator'");
  let o = null; try { o = r ? JSON.parse(r.content) : null; } catch (e) { o = null; }
  return o || { operator: {}, policy: {} };
}
const complete = o => !!(o.operator.name && o.operator.privacyEmail && o.operator.country && o.policy.effectiveDate);
export async function getOperator(rc) {
  const o = await readOperator(rc.db);
  return json({ operator: o.operator, policy: o.policy, complete: complete(o) }, 200, { 'Cache-Control': 'no-cache' });
}
export async function putOperator(rc, actor, session) {
  if (!(await hasRecentAuth(rc.db, session.id, rc.now))) return reauthRequired();
  const b = await readBody(rc.req);
  const op = {}, pol = {};
  for (const k of OP_FIELDS) {
    const v = b.operator && b.operator[k] != null ? String(b.operator[k]).trim() : '';
    if (v.length > 200 || /[<>]/.test(v)) return err(400, `${k} is too long or contains < or >.`);
    if (v) op[k] = v;
  }
  if (op.privacyEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(op.privacyEmail)) return err(400, 'Enter a valid privacy contact email.');
  if (op.abn && !/^\d{2}\s?\d{3}\s?\d{3}\s?\d{3}$/.test(op.abn)) return err(400, 'An ABN has 11 digits.');
  const ed = b.policy && b.policy.effectiveDate ? String(b.policy.effectiveDate) : '';
  if (ed && !/^\d{4}-\d{2}-\d{2}$/.test(ed)) return err(400, 'The effective date must be YYYY-MM-DD.');
  if (ed) pol.effectiveDate = ed;
  const o = { operator: op, policy: pol };
  await rc.db.run("INSERT OR REPLACE INTO site_content (key, content, updated_at, updated_by) VALUES ('operator', ?, ?, ?)", JSON.stringify(o), rc.now, actor.id);
  await audit(rc.db, actor, 'site.operator_updated', null, { fields: Object.keys(op).concat(Object.keys(pol)) }, rc.ip);
  return json({ ok: true, operator: op, policy: pol, complete: complete(o) });
}

/* ------------------------------------------------------- setup checklist */
export const MANUAL_ITEMS = [
  ['legal_review', 'An Australian privacy lawyer has reviewed the privacy policy and the applicability analysis'],
  ['privacy_contact_monitored', 'The privacy contact email is monitored and someone is responsible for replies'],
  ['retention_decided', 'Retention periods for each kind of data are decided and written into the policy'],
  ['markets_decided', 'Decided which countries Recomp accepts users from (and whether EU or UK users are accepted)'],
  ['provider_terms', 'Cloudflare, Resend and Anthropic data processing terms are accepted and filed'],
  ['ai_retention_checked', 'Anthropic account data retention and training settings are checked and match the policy'],
  ['min_age', 'Minimum age decided and stated in the policy'],
  ['incident_contact', 'A named person and phone number for security incidents and data breach notification'],
  ['restore_tested', 'A database restore from Time Travel has been tested on a copy'],
  ['pentest', 'An independent penetration test is booked or done']
];
export async function checklist(rc) {
  const env = rc.env, db = rc.db;
  const o = await readOperator(db);
  const owners = await db.all("SELECT u.id FROM users u WHERE u.role IN ('owner','admin') AND u.status = 'active'");
  let withMfa = 0;
  for (const u of owners) { const t = await db.get('SELECT enabled_at FROM mfa_totp WHERE user_id = ? AND enabled_at IS NOT NULL', u.id); const p = await db.get('SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?', u.id); if (t || (p && p.n)) withMfa++; }
  const auto = [
    ['operator_details', 'Operator name, privacy email, country and policy effective date entered', complete(o), complete(o) ? '' : 'Enter them under Operator details.'],
    ['mail', 'Email delivery is configured (Resend)', mailConfigured(env) && env.MAIL_PROVIDER !== 'outbox', 'Set RESEND_API_KEY and MAIL_FROM on the gym worker. Until then verification, reset and security emails are not sent.'],
    ['ai', 'AI service is configured (Anthropic)', aiConfigured(env), 'Optional. Set ANTHROPIC_API_KEY to offer AI-worded reviews. Members still choose whether to use it.'],
    ['encryption_key', 'Application-level encryption key is set (DATA_ENC_KEY)', !!env.DATA_ENC_KEY, 'Set a random 32-byte base64 secret named DATA_ENC_KEY. Data is already encrypted at rest by Cloudflare; this adds a second layer that database exports do not bypass.'],
    ['admin_mfa', 'Every owner and administrator has two-step verification', owners.length > 0 && withMfa === owners.length, `${withMfa} of ${owners.length} have it.`],
    ['hibp', 'Breached-password screening is on', !(env.HIBP_CHECK === 'off' || env.HIBP_CHECK === '0'), 'Remove HIBP_CHECK=off to turn it back on.'],
    ['bootstrap_secret_removed', 'No bootstrap owner password is configured', !env.BOOTSTRAP_OWNER_PASSWORD, 'Delete the BOOTSTRAP_OWNER_PASSWORD secret; it is only needed before the first owner exists.']
  ].map(([id, label, done, detail]) => ({ id, label, done: !!done, detail: done ? '' : detail, kind: 'automatic' }));
  const ticks = {}; (await db.all('SELECT * FROM checklist_manual')).forEach(r => { ticks[r.id] = r; });
  const manual = MANUAL_ITEMS.map(([id, label]) => ({ id, label, done: !!(ticks[id] && ticks[id].done), detail: ticks[id] ? 'Updated ' + new Date(ticks[id].updated_at).toISOString().slice(0, 10) : '', kind: 'manual' }));
  return json({ items: auto.concat(manual), publishable: auto.filter(i => ['operator_details', 'mail', 'admin_mfa'].includes(i.id)).every(i => i.done) && manual.filter(i => ['legal_review', 'privacy_contact_monitored', 'retention_decided', 'markets_decided', 'min_age'].includes(i.id)).every(i => i.done) });
}
export async function tickChecklist(rc, actor, id) {
  if (!MANUAL_ITEMS.some(x => x[0] === id)) return err(404, 'That item is checked automatically or does not exist.');
  const b = await readBody(rc.req);
  if (typeof b.done !== 'boolean') return err(400, 'done must be true or false.');
  await rc.db.run('INSERT OR REPLACE INTO checklist_manual (id, done, updated_at, updated_by) VALUES (?,?,?,?)', id, b.done ? 1 : 0, rc.now, actor.id);
  await audit(rc.db, actor, 'site.checklist_' + (b.done ? 'done' : 'undone'), id, null, rc.ip);
  return json({ ok: true });
}

/* --------------------------------------------------------- security events */
const SECURITY_PREFIXES = ['auth.', 'security.', 'admin.', 'privacy.', 'setup.', 'bootstrap.', 'access.', 'site.', 'signup.'];
export async function securityEvents(rc, actor) {
  const limit = Math.min(300, Math.max(1, parseInt(rc.url.searchParams.get('limit') || '100', 10) || 100));
  const rows = await rc.db.all(`SELECT a.at, a.action, a.actor_id, a.target_id, a.detail, u.name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
    WHERE ${SECURITY_PREFIXES.map(() => 'a.action LIKE ?').join(' OR ')} ORDER BY a.at DESC LIMIT ?`, ...SECURITY_PREFIXES.map(p => p + '%'), limit);
  return json({ events: rows.map(r => {
    let d = null; try { d = r.detail ? JSON.parse(r.detail) : null; } catch (e) { d = null; }
    if (d && typeof d === 'object') ['email', 'note', 'text', 'message'].forEach(k => { if (k in d) d[k] = '[hidden]'; });
    return { at: r.at, action: r.action, actorId: r.actor_id, actorName: r.actor_name || null, targetId: r.target_id, detail: d };
  }) });
}
