/* Sliding-window rate limiting backed by the rate_events table. */
export async function hit(db, key, now) {
  await db.run('INSERT INTO rate_events (key, at) VALUES (?,?)', key, now);
  // Housekeeping: nothing here is needed for longer than two days.
  await db.run('DELETE FROM rate_events WHERE at < ?', now - 2 * 24 * 3600 * 1000);
}
export async function countSince(db, key, windowMs, now) {
  const r = await db.get('SELECT COUNT(*) AS n FROM rate_events WHERE key = ? AND at >= ?', key, now - windowMs);
  return r ? r.n : 0;
}
/* True when the key is already at or over its limit. Does not record anything. */
export async function isOver(db, key, max, windowMs, now) {
  return (await countSince(db, key, windowMs, now)) >= max;
}
export const HOUR = 3600 * 1000;
export const DAY = 24 * HOUR;
