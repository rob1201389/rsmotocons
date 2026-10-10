/* Small shared HTTP helpers. Every API response is JSON, never cached, never
   framed, and carries a CSP that allows nothing (it is data, not a page). */
export const SECURITY_HEADERS = {
  'Cache-Control': 'no-store, private',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin'
};
export const json = (data, status, headers) => new Response(JSON.stringify(data), {
  status: status || 200,
  headers: Object.assign({ 'Content-Type': 'application/json' }, SECURITY_HEADERS, headers || {})
});
export const err = (status, message, extra, headers) => json(Object.assign({ error: message }, extra || {}), status, headers);

/* Request bodies are capped so no endpoint can be used as an upload sink. */
export const DEFAULT_BODY_LIMIT = 64 * 1024;
export class BodyTooLarge extends Error { constructor() { super('body too large'); this.status = 413; } }
export async function readText(req, max) {
  const limit = max || DEFAULT_BODY_LIMIT;
  const len = parseInt(req.headers.get('content-length') || '0', 10);
  if (len > limit) throw new BodyTooLarge();
  const text = await req.text();
  if (text.length > limit) throw new BodyTooLarge();
  return text;
}
/* Parsed JSON object, or {} for a missing or invalid body. Too large throws (413). */
const parsedBodies = new WeakMap();
export async function readBody(req, max) {
  if (parsedBodies.has(req)) return parsedBodies.get(req);
  const text = await readText(req, max);
  let b = {};
  try { const v = JSON.parse(text || '{}'); b = v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch (e) { b = {}; }
  parsedBodies.set(req, b);
  return b;
}
