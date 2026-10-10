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

/* Password policy. If the configured bootstrap password is rejected, the
   caller surfaces this reason rather than lowering the bar. */
function passwordProblems(pw) {
  const out = [];
  if (!pw || pw.length < 12) out.push('at least 12 characters');
  if (!/[a-z]/.test(pw || '')) out.push('a lowercase letter');
  if (!/[A-Z]/.test(pw || '') && !/[^A-Za-z0-9]/.test(pw || ''))
    out.push('an uppercase letter or a symbol');
  if (!/[0-9]/.test(pw || '')) out.push('a digit');
  if (/^(.)\1+$/.test(pw || '')) out.push('more than one distinct character');
  return out;
}

export { hashPassword, verifyPassword, randomToken, randomBytes, sha256hex, newId,
         timingSafeEqual, passwordProblems, b64, PBKDF2_ITERATIONS };
