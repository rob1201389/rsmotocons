/* Roles, features and per-user overrides.

   Enforcement is server-side on every request. The browser is told what it may
   show, but is never trusted: hiding a tab is presentation, the check in
   `can()` is the security boundary. */

export const ROLES = ['owner', 'admin', 'coach', 'member'];

export const FEATURES = [
  'training',    // workout planning and logging
  'library',     // exercise and mobility library
  'nutrition',   // nutrition and macro tracking
  'recipes',     // recipes and meal planning
  'garmin',      // Garmin import
  'progress',    // progress reports
  'reviews'      // workout reviews
];

/* Features every account has, whatever its role or overrides: weekly reviews are
   part of how the plan adapts, so no one can be switched off from them. */
export const ALWAYS_ON = ['reviews'];

/* Sensible presets. A per-user override wins over its role's preset. */
export const PRESETS = {
  owner:  { training:true,  library:true,  nutrition:true,  recipes:true,  garmin:true,  progress:true,  reviews:true },
  admin:  { training:true,  library:true,  nutrition:true,  recipes:true,  garmin:true,  progress:true,  reviews:true },
  coach:  { training:true,  library:true,  nutrition:false, recipes:false, garmin:false, progress:true,  reviews:true },
  member: { training:true,  library:true,  nutrition:true,  recipes:true,  garmin:true,  progress:true,  reviews:true }
};

export function effectivePermissions(user) {
  const base = PRESETS[user.role] || PRESETS.member;
  let over = {};
  try { over = user.permissions ? JSON.parse(user.permissions) : {}; } catch (e) { over = {}; }
  const out = {};
  FEATURES.forEach(f => { out[f] = ALWAYS_ON.includes(f) ? true : (f in over) ? !!over[f] : !!base[f]; });
  return out;
}

export function can(user, feature) {
  if (!user) return false;
  if (user.status !== 'active') return false;         // pending/suspended/revoked: nothing
  return !!effectivePermissions(user)[feature];
}

export const isOwner = u => !!u && u.role === 'owner';
export const isAdmin = u => !!u && (u.role === 'owner' || u.role === 'admin');
export const isReviewer = u => !!u && (u.role === 'coach' || u.role === 'owner' || u.role === 'admin');

/* Who may read another user's personal records.
   Admin status alone does NOT grant it: an admin must be explicitly assigned,
   same as a coach, and every such read is audited by the caller. */
export async function mayAccessUserData(db, actor, targetId) {
  if (!actor || actor.status !== 'active') return { ok: false, reason: 'inactive' };
  if (actor.id === targetId) return { ok: true, scope: 'self' };
  if (!isReviewer(actor)) return { ok: false, reason: 'not_a_reviewer' };
  const row = await db.get(
    'SELECT 1 AS x FROM coach_assignments WHERE coach_id = ? AND member_id = ?', actor.id, targetId);
  if (!row) return { ok: false, reason: 'not_assigned' };
  if (!can(actor, 'reviews')) return { ok: false, reason: 'no_reviews_permission' };
  return { ok: true, scope: 'assigned' };
}
