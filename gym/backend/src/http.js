/* Small shared HTTP helpers. */
export const json = (data, status, headers) => new Response(JSON.stringify(data), {
  status: status || 200,
  headers: Object.assign({ 'Content-Type': 'application/json',
    'Cache-Control': 'no-store, private',       // never cache authenticated responses
    'X-Content-Type-Options': 'nosniff' }, headers || {})
});
export const err = (status, message, extra) => json(Object.assign({ error: message }, extra || {}), status);
export async function readBody(req) { try { const b = await req.json(); return b && typeof b === 'object' ? b : {}; } catch (e) { return {}; } }
