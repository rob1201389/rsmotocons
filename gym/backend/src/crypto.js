/* Password hashing and token handling. WebCrypto only, so the same code runs
   on Cloudflare Workers and on Node. No secrets are ever stored in the app
   bundle — the bootstrap password comes from a server-side environment value. */

/* Cloudflare Workers refuse PBKDF2 above 100,000 iterations (the call throws),
   so that is the ceiling here. OWASP's figure for PBKDF2-HMAC-SHA256 is 600,000;
   the shortfall is covered by the password policy and login rate limiting. The
   count is stored in each hash, so raising it later needs no migration. */
const PBKDF2_ITERATIONS = 100000;
const KEY_BITS = 256;

const enc = new TextEncoder();
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = s => {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '==='.slice((t.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

function randomBytes(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}
function randomToken(bytes) { return b64(randomBytes(bytes || 32)); }

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, KEY_BITS);
  return new Uint8Array(bits);
}

/* Stored form: pbkdf2$<iterations>$<salt_b64>$<hash_b64> */
async function hashPassword(password, iterations) {
  const it = iterations || PBKDF2_ITERATIONS;
  const salt = randomBytes(16);
  const hash = await pbkdf2(password, salt, it);
  return `pbkdf2$${it}$${b64(salt)}$${b64(hash)}`;
}
async function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const it = parseInt(parts[1], 10);
  if (!Number.isFinite(it) || it < 1000) return false;
  const salt = unb64(parts[2]);
  const expected = unb64(parts[3]);
  const actual = await pbkdf2(password, salt, it);
  return timingSafeEqual(actual, expected);
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${b64(randomBytes(9))}`;
}

/* Password policy, following OWASP ASVS 5.0 (6.2.x): length, not composition.
   At least 12 characters, up to 256, any characters allowed, and not a common
   or context-specific password. Breached-password screening is separate and
   asynchronous (screenPassword). */
const COMMON = new Set(['password', 'password1', 'password12', 'password123', 'password1234', 'passw0rd', 'qwerty', 'qwertyuiop',
  'qwerty123', '123456789012', '1234567890', '12345678910', '111111111111', 'iloveyou', 'letmein', 'welcome', 'welcome123',
  'admin', 'administrator', 'changeme', 'trustno1', 'football', 'baseball', 'superman', 'dragon', 'monkey', 'sunshine',
  'princess', 'starwars', 'whatever', 'abcdefghijkl', 'abc123abc123', 'zaq12wsxcde3', '1q2w3e4r5t6y', 'qazwsxedcrfv',
  'australia', 'melbourne', 'sydney', 'brisbane', 'adelaide', 'canberra', 'kangaroo', 'fitness', 'workout', 'bodybuilding',
  'gymrat', 'strength', 'recomposition']);
const CONTEXT = ['recomp', 'rsmotocons', 'rs motocons', 'motocons', 'gym.rsmotocons'];
function passwordProblems(pw, ctx) {
  const out = [];
  const p = typeof pw === 'string' ? pw : '';
  if (p.length < 12) out.push('at least 12 characters');
  if (p.length > 256) out.push('no more than 256 characters');
  if (p && /^(.)\1+$/.test(p)) out.push('more than one distinct character');
  const low = p.toLowerCase().replace(/[^a-z0-9]/g, '');
  const words = CONTEXT.concat(((ctx && ctx.words) || []).map(w => String(w || '').toLowerCase()).filter(w => w.length >= 4));
  if (low && (COMMON.has(low) || COMMON.has(low.replace(/\d+$/, '')) || words.some(w => { const x = w.replace(/[^a-z0-9]/g, ''); return x.length >= 4 && low.replace(/\d+$/, '') === x; })))
    out.push('to be less easy to guess (it is a common password or uses the app or your own name)');
  return out;
}
/* Have I Been Pwned range API (k-anonymity): only the first five hex characters of
   the SHA-1 hash leave the server. Resolves true (breached), false (not found) or
   null (could not check; the caller lets the password through and does not log it). */
async function sha1hexUpper(s) {
  const d = await crypto.subtle.digest('SHA-1', enc.encode(s));
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}
async function pwnedPassword(pw, opts) {
  opts = opts || {};
  if (opts.disabled) return null;
  const f = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) return null;
  const h = await sha1hexUpper(pw);
  const prefix = h.slice(0, 5), suffix = h.slice(5);
  try {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => ctrl && ctrl.abort(), opts.timeoutMs || 2500);
    const r = await f('https://api.pwnedpasswords.com/range/' + prefix, { headers: { 'Add-Padding': 'true', 'User-Agent': 'Recomp-password-check' }, signal: ctrl ? ctrl.signal : undefined });
    clearTimeout(timer);
    if (!r.ok) return null;
    const text = await r.text();
    for (const line of text.split('\n')) { const [suf, n] = line.trim().split(':'); if (suf === suffix && parseInt(n, 10) > 0) return true; }
    return false;
  } catch (e) { return null; }
}
/* Policy plus breach check. Returns an array of problems (empty = fine). */
async function screenPassword(pw, env, ctx, fetchImpl) {
  const problems = passwordProblems(pw, ctx);
  if (problems.length) return problems;
  const off = env && (env.HIBP_CHECK === 'off' || env.HIBP_CHECK === '0');
  const breached = await pwnedPassword(pw, { disabled: off, fetch: fetchImpl });
  if (breached === true) return ['to not be one that has appeared in a known data breach (choose a different password)'];
  return [];
}

/* ------------------------------------------------------------ TOTP (RFC 6238) */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(bytes) {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(s) {
  const clean = String(s).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) { value = (value << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return new Uint8Array(out);
}
async function hotp(keyBytes, counter, digits) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const msg = new Uint8Array(8); let c = counter;
  for (let i = 7; i >= 0; i--) { msg[i] = c & 255; c = Math.floor(c / 256); }
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const off = mac[mac.length - 1] & 15;
  const bin = ((mac[off] & 127) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(bin % Math.pow(10, digits || 6)).padStart(digits || 6, '0');
}
/* Returns the matched time step, or null. Accepts one step either side for clock drift.
   The server clock is the time source; the client never supplies a time. */
async function verifyTotp(secretB32, code, nowMs, lastStep) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const key = base32Decode(secretB32);
  const step = Math.floor(nowMs / 30000);
  for (const d of [0, -1, 1]) {
    const st = step + d;
    if (lastStep != null && st <= lastStep) continue;          // each code works once
    if (timingSafeEqual(enc.encode(await hotp(key, st, 6)), enc.encode(c))) return st;
  }
  return null;
}

/* ------------------------------------------------- field encryption at rest
   AES-256-GCM with a key from the DATA_ENC_KEY secret (base64, 32 bytes). Stored
   form: enc1:<keyId>:<iv b64>:<ciphertext b64>. Values written before the key was
   set (plain text) are still read; they are encrypted on their next write. */
const keyCache = new Map();
async function encKey(env) {
  const raw = env && env.DATA_ENC_KEY;
  if (!raw) return null;
  if (keyCache.has(raw)) return keyCache.get(raw);
  const bytes = unb64(String(raw).trim());
  if (bytes.length !== 32) throw new Error('DATA_ENC_KEY must be 32 bytes, base64 encoded');
  const k = { id: (env.DATA_ENC_KEY_ID || 'k1').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12) || 'k1',
    key: await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']) };
  keyCache.set(raw, k); return k;
}
async function sealText(env, text) {
  if (text == null) return text;
  const k = await encKey(env); if (!k) return text;
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k.key, enc.encode(String(text)));
  return `enc1:${k.id}:${b64(iv)}:${b64(ct)}`;
}
async function openText(env, stored) {
  if (stored == null || typeof stored !== 'string' || !stored.startsWith('enc1:')) return stored;
  const [, kid, ivb, ctb] = stored.split(':');
  const k = await encKey(env);
  if (!k) throw new Error('Encrypted data found but DATA_ENC_KEY is not set');
  const prev = env.DATA_ENC_KEY_PREVIOUS && kid !== k.id ? await encKey({ DATA_ENC_KEY: env.DATA_ENC_KEY_PREVIOUS, DATA_ENC_KEY_ID: kid }) : null;
  const use = kid === k.id ? k : prev;
  if (!use) throw new Error('No key for encrypted data id ' + kid);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(ivb) }, use.key, unb64(ctb));
  return new TextDecoder().decode(pt);
}
const isSealed = v => typeof v === 'string' && v.startsWith('enc1:');

export { hashPassword, verifyPassword, randomToken, randomBytes, sha256hex, newId,
         timingSafeEqual, passwordProblems, screenPassword, pwnedPassword, sha1hexUpper, b64, unb64, PBKDF2_ITERATIONS,
         base32Encode, base32Decode, hotp, verifyTotp, sealText, openText, isSealed, encKey };
