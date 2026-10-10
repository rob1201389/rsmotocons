/* Passkeys (WebAuthn Level 2), implemented with WebCrypto only.
   - Registration asks for no attestation ('none'): the server trusts the key it
     receives for this account, not a device maker's certificate.
   - ES256 (P-256) and RS256 keys. User presence and user verification are both
     required, so a passkey sign-in is two factors in one step (the device, plus
     its PIN or biometric).
   - Origin and RP ID are checked on every ceremony, challenges are single use and
     expire after five minutes, and a sign counter that goes backwards is refused. */
import { randomBytes, newId, sha256hex } from './crypto.js';
import { audit, sessionCookie } from './auth.js';
import { json, err, readBody } from './http.js';
import { hasRecentAuth, reauthRequired, startSession, mfaSummary, needsMfa, alertOwners, clearPendingCookie } from './security.js';
import { readCookie } from './auth.js';
import { isOver, hit, HOUR } from './limits.js';

const CHALLENGE_MS = 5 * 60 * 1000;
const enc = new TextEncoder();
export const b64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64u = s => { const t = String(s || '').replace(/-/g, '+').replace(/_/g, '/'); const bin = atob(t + '==='.slice((t.length + 3) % 4)); const o = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o; };
const sha256 = async bytes => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
const eqBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/* ---------------------------------------------------- minimal CBOR decoder */
export function cborDecode(bytes) {
  let p = 0;
  const u = n => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + bytes[p++]; return v; };
  function len(ai) { if (ai < 24) return ai; if (ai === 24) return u(1); if (ai === 25) return u(2); if (ai === 26) return u(4); if (ai === 27) return u(8); throw new Error('cbor: indefinite lengths are not supported'); }
  function item(depth) {
    if (depth > 16) throw new Error('cbor: too deep');
    if (p >= bytes.length) throw new Error('cbor: truncated');
    const ib = bytes[p++], mt = ib >> 5, ai = ib & 31;
    if (mt === 0) return len(ai);
    if (mt === 1) return -1 - len(ai);
    if (mt === 2) { const n = len(ai); if (p + n > bytes.length) throw new Error('cbor: truncated'); const v = bytes.slice(p, p + n); p += n; return v; }
    if (mt === 3) { const n = len(ai); const v = new TextDecoder().decode(bytes.slice(p, p + n)); p += n; return v; }
    if (mt === 4) { const n = len(ai); if (n > 64) throw new Error('cbor: array too long'); const a = []; for (let i = 0; i < n; i++) a.push(item(depth + 1)); return a; }
    if (mt === 5) { const n = len(ai); if (n > 64) throw new Error('cbor: map too long'); const m = new Map(); for (let i = 0; i < n; i++) { const k = item(depth + 1); m.set(k, item(depth + 1)); } return m; }
    if (mt === 7) { if (ai === 20) return false; if (ai === 21) return true; if (ai === 22) return null; throw new Error('cbor: unsupported simple value'); }
    throw new Error('cbor: unsupported type');
  }
  const v = item(0);
  return { value: v, end: p };
}

/* authenticatorData: rpIdHash(32) flags(1) signCount(4) [aaguid(16) credIdLen(2) credId COSEkey] */
function parseAuthData(ad) {
  if (ad.length < 37) throw new Error('authData too short');
  const out = { rpIdHash: ad.slice(0, 32), flags: ad[32], signCount: ((ad[33] << 24) >>> 0) + (ad[34] << 16) + (ad[35] << 8) + ad[36] };
  out.up = !!(out.flags & 0x01); out.uv = !!(out.flags & 0x04); out.at = !!(out.flags & 0x40);
  if (out.at) {
    const idLen = (ad[53] << 8) + ad[54];
    out.credId = ad.slice(55, 55 + idLen);
    const k = cborDecode(ad.slice(55 + idLen));
    out.coseKey = k.value;
  }
  return out;
}
function coseToJwk(m) {
  if (!(m instanceof Map)) throw new Error('bad key');
  const kty = m.get(1), alg = m.get(3);
  if (kty === 2 && alg === -7 && m.get(-1) === 1) return { alg: -7, jwk: { kty: 'EC', crv: 'P-256', x: b64u(m.get(-2)), y: b64u(m.get(-3)), ext: true } };
  if (kty === 3 && alg === -257) return { alg: -257, jwk: { kty: 'RSA', n: b64u(m.get(-1)), e: b64u(m.get(-2)), alg: 'RS256', ext: true } };
  throw new Error('Only ES256 and RS256 passkeys are supported.');
}
/* ECDSA signatures from authenticators are ASN.1 DER. WebCrypto wants raw r||s. */
function derToRaw(der) {
  if (der[0] !== 0x30) throw new Error('bad signature');
  let p = 2; if (der[1] & 0x80) p = 2 + (der[1] & 0x7f);
  const read = () => { if (der[p++] !== 0x02) throw new Error('bad signature'); const n = der[p++]; let v = der.slice(p, p + n); p += n; while (v.length > 32 && v[0] === 0) v = v.slice(1); if (v.length > 32) throw new Error('bad signature'); const o = new Uint8Array(32); o.set(v, 32 - v.length); return o; };
  const r = read(), s = read(); const out = new Uint8Array(64); out.set(r, 0); out.set(s, 32); return out;
}
async function verifySig(alg, jwk, data, sig) {
  if (alg === -7) {
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(sig), data);
  }
  if (alg === -257) {
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, data);
  }
  return false;
}

/* ------------------------------------------------------------ relying party */
function rp(rc) {
  const pub = rc.env.PUBLIC_URL ? new URL(rc.env.PUBLIC_URL) : null;
  const id = rc.env.RP_ID || (pub ? pub.hostname : rc.url.hostname);
  const origins = new Set([rc.url.origin]); if (pub) origins.add(pub.origin);
  return { id, origins };
}
async function newChallenge(rc, userId, kind) {
  const c = b64u(randomBytes(32)), id = newId('wc');
  await rc.db.run('INSERT INTO webauthn_challenges (id, user_id, kind, challenge, created_at, expires_at) VALUES (?,?,?,?,?,?)', id, userId || null, kind, c, rc.now, rc.now + CHALLENGE_MS);
  return { id, challenge: c };
}
async function takeChallenge(rc, id, kind) {
  const r = await rc.db.get('SELECT * FROM webauthn_challenges WHERE id = ?', String(id || ''));
  if (!r) return null;
  await rc.db.run('DELETE FROM webauthn_challenges WHERE id = ?', r.id);       // single use, whatever happens next
  if (r.kind !== kind || r.expires_at < rc.now) return null;
  return r;
}
function checkClientData(rc, raw, type, challenge) {
  let cd; try { cd = JSON.parse(new TextDecoder().decode(raw)); } catch (e) { return 'bad client data'; }
  if (cd.type !== type) return 'wrong ceremony type';
  if (cd.challenge !== challenge) return 'challenge mismatch';
  if (!rp(rc).origins.has(cd.origin)) return 'origin mismatch';
  return null;
}

/* ----------------------------------------------------------------- routes */
export async function list(rc, user) {
  const rows = await rc.db.all('SELECT id, label, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at', user.id);
  return json({ supported: true, passkeys: rows.map(r => ({ id: r.id, label: r.label, createdAt: r.created_at, lastUsedAt: r.last_used_at })) });
}
export async function registerBegin(rc, user, session) {
  if (!(await hasRecentAuth(rc.db, session.id, rc.now))) return reauthRequired();
  const existing = await rc.db.all('SELECT id FROM passkeys WHERE user_id = ?', user.id);
  if (existing.length >= 10) return err(409, 'You already have 10 passkeys. Remove one first.');
  const ch = await newChallenge(rc, user.id, 'register');
  const r = rp(rc);
  return json({ challengeId: ch.id, options: {
    challenge: ch.challenge, rp: { id: r.id, name: 'Recomp' },
    user: { id: b64u(enc.encode(user.id)), name: user.email, displayName: user.name || user.email },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    timeout: 60000, attestation: 'none',
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    excludeCredentials: existing.map(e => ({ type: 'public-key', id: e.id }))
  } });
}
export async function registerFinish(rc, user, session) {
  if (!(await hasRecentAuth(rc.db, session.id, rc.now))) return reauthRequired();
  const b = await readBody(rc.req);
  const ch = await takeChallenge(rc, b.challengeId, 'register');
  if (!ch || ch.user_id !== user.id) return err(400, 'That passkey request has expired. Try again.');
  try {
    const cred = b.credential || {}, resp = cred.response || {};
    const cdRaw = unb64u(resp.clientDataJSON);
    const bad = checkClientData(rc, cdRaw, 'webauthn.create', ch.challenge);
    if (bad) return err(400, 'That passkey could not be verified (' + bad + ').');
    const att = cborDecode(unb64u(resp.attestationObject)).value;
    if (!(att instanceof Map) || !(att.get('authData') instanceof Uint8Array)) return err(400, 'That passkey could not be read.');
    const ad = parseAuthData(att.get('authData'));
    if (!eqBytes(ad.rpIdHash, await sha256(enc.encode(rp(rc).id)))) return err(400, 'That passkey is for a different site.');
    if (!ad.up || !ad.uv) return err(400, 'Your device must confirm it is you (PIN, fingerprint or face).');
    if (!ad.at || !ad.credId) return err(400, 'That passkey could not be read.');
    const { alg, jwk } = coseToJwk(ad.coseKey);
    const id = b64u(ad.credId);
    if (await rc.db.get('SELECT id FROM passkeys WHERE id = ?', id)) return err(409, 'That passkey is already registered.');
    const label = String(b.label || '').replace(/[<>]/g, '').trim().slice(0, 60) || 'Passkey';
    await rc.db.run('INSERT INTO passkeys (id, user_id, public_key, alg, sign_count, label, transports, created_at) VALUES (?,?,?,?,?,?,?,?)',
      id, user.id, JSON.stringify(jwk), alg, ad.signCount, label, JSON.stringify(Array.isArray(resp.transports) ? resp.transports.slice(0, 6) : []), rc.now);
    await audit(rc.db, user, 'security.passkey_added', user.id, null, rc.ip);
    return json({ ok: true, id, label });
  } catch (e) { return err(400, 'That passkey could not be verified.'); }
}
export async function remove(rc, user, session, id) {
  if (!(await hasRecentAuth(rc.db, session.id, rc.now))) return reauthRequired();
  const row = await rc.db.get('SELECT id FROM passkeys WHERE id = ? AND user_id = ?', id, user.id);
  if (!row) return err(404, 'That passkey was not found.');
  const m = await mfaSummary(rc.db, user);
  if (needsMfa(user) && !m.totp && m.passkeys <= 1) return err(403, 'This is your only second step. Add an authenticator app or another passkey first.', { code: 'mfa_required' });
  await rc.db.run('DELETE FROM passkeys WHERE id = ? AND user_id = ?', id, user.id);
  await audit(rc.db, user, 'security.passkey_removed', user.id, null, rc.ip);
  if (needsMfa(user)) await alertOwners(rc, 'Passkey removed', `A passkey was removed from the ${user.role} account ${user.email}.`);
  return json({ ok: true });
}
/* Sign-in: as the second step after a password (pending login), or passwordless. */
export async function loginBegin(rc) {
  if (await isOver(rc.db, 'pklogin|' + (rc.ip || 'noip'), 30, HOUR, rc.now)) return err(429, 'Too many attempts. Try again later.');
  await hit(rc.db, 'pklogin|' + (rc.ip || 'noip'), rc.now);
  const tok = readCookie(rc.req, 'recomp_mfa');
  let userId = null, allow = [];
  if (tok) {
    const p = await rc.db.get('SELECT user_id, expires_at FROM pending_logins WHERE id = ?', await sha256hex(tok));
    if (p && p.expires_at > rc.now) { userId = p.user_id; allow = (await rc.db.all('SELECT id FROM passkeys WHERE user_id = ?', userId)).map(r => ({ type: 'public-key', id: r.id })); }
  }
  const ch = await newChallenge(rc, userId, 'login');
  return json({ challengeId: ch.id, options: { challenge: ch.challenge, rpId: rp(rc).id, timeout: 60000, userVerification: 'required', allowCredentials: allow } });
}
export async function loginFinish(rc, fullUser) {
  const b = await readBody(rc.req);
  const ch = await takeChallenge(rc, b.challengeId, 'login');
  const fail = async (why, user) => { await audit(rc.db, user || null, 'auth.passkey_failed', user ? user.id : null, { why }, rc.ip); return err(400, 'That passkey was not accepted.'); };
  if (!ch) return fail('challenge');
  try {
    const cred = b.credential || {}, resp = cred.response || {};
    const pk = await rc.db.get('SELECT * FROM passkeys WHERE id = ?', String(cred.id || ''));
    if (!pk) return fail('unknown credential');
    if (ch.user_id && ch.user_id !== pk.user_id) return fail('wrong account');
    const user = await rc.db.get('SELECT * FROM users WHERE id = ?', pk.user_id);
    if (!user || (user.status !== 'active' && user.status !== 'pending')) return fail('account not active', user);
    const cdRaw = unb64u(resp.clientDataJSON);
    const bad = checkClientData(rc, cdRaw, 'webauthn.get', ch.challenge);
    if (bad) return fail(bad, user);
    const adRaw = unb64u(resp.authenticatorData);
    const ad = parseAuthData(adRaw);
    if (!eqBytes(ad.rpIdHash, await sha256(enc.encode(rp(rc).id)))) return fail('rp id', user);
    if (!ad.up || !ad.uv) return fail('user verification', user);
    const signed = new Uint8Array(adRaw.length + 32); signed.set(adRaw, 0); signed.set(await sha256(cdRaw), adRaw.length);
    const ok = await verifySig(pk.alg, JSON.parse(pk.public_key), signed, unb64u(resp.signature));
    if (!ok) return fail('signature', user);
    if (pk.sign_count > 0 && ad.signCount <= pk.sign_count) { await audit(rc.db, user, 'security.passkey_counter_regressed', user.id, null, rc.ip); return fail('counter', user); }
    await rc.db.run('UPDATE passkeys SET sign_count = ?, last_used_at = ? WHERE id = ?', ad.signCount, rc.now, pk.id);
    if (ch.user_id) await rc.db.run('DELETE FROM pending_logins WHERE user_id = ?', user.id);
    const token = await startSession(rc, user);
    await rc.db.run('UPDATE users SET last_login_at = ?, last_login_ip = ? WHERE id = ?', rc.now, rc.ip || null, user.id);
    await audit(rc.db, user, 'auth.login', user.id, { method: 'passkey' }, rc.ip);
    const res = json({ user: await fullUser(user) }, 200);
    res.headers.append('Set-Cookie', sessionCookie(token, rc.secure));
    res.headers.append('Set-Cookie', clearPendingCookie(rc.secure));
    return res;
  } catch (e) { return fail('malformed'); }
}
