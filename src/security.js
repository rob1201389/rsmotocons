/**
 * Shared security controls for the trade plate record.
 *
 * Rate limiting and the audit trail both use the LEADS KV namespace, under
 * their own key prefixes, so they inherit the same binding and retention
 * handling the contact-lead code already uses.
 *
 * Nothing here writes record content. The audit trail holds identifiers and
 * actor metadata only, so reading the whole trail discloses who did what and
 * when, never what a driver's name or signature was.
 */

/* ---------------------------------------------------------- rate limiting */

/**
 * Failure counters for the two guessable secrets: the driver PIN and the
 * office password. Both are low-entropy by necessity, so throttling is what
 * actually stops an online guessing run.
 *
 * Two dimensions are kept. Per-IP catches the ordinary case. A global counter
 * sits behind it because per-IP alone is evaded by anyone with a handful of
 * addresses; the global limit is set well above normal use, so a yard full of
 * drivers mistyping a PIN stays under it and a distributed run does not.
 *
 * Only failures count. A correct entry is never charged against either limit,
 * and clears the caller's own counter.
 *
 * Two honest limitations:
 *  - KV reads are eventually consistent, so a burst inside the propagation
 *    window can overshoot slightly. This slows a sustained attack; it does not
 *    stop an instantaneous one.
 *  - It fails OPEN if KV is unavailable. A broken counter must not strand a
 *    driver in the yard, and neither secret is the only control.
 */

const rlKey = (kind, who) => `rl:tp:${kind}:${who}`;

async function count(env, key) {
  try {
    return parseInt((await env.LEADS.get(key)) || "0", 10);
  } catch {
    return 0;
  }
}

/** Read-only: is this request already over either limit? */
export async function rateLimitCheck(env, kind, ip, perIp, globalLimit) {
  if (!env.LEADS) return { ok: true };
  if (ip && (await count(env, rlKey(kind, ip))) >= perIp) return { ok: false, scope: "ip" };
  if ((await count(env, rlKey(kind, "global"))) >= globalLimit) return { ok: false, scope: "global" };
  return { ok: true };
}

/** Charge one failure against both counters. */
export async function rateLimitFailure(env, kind, ip, windowSeconds) {
  if (!env.LEADS) return;
  try {
    for (const who of [ip, "global"]) {
      if (!who) continue;
      const key = rlKey(kind, who);
      await env.LEADS.put(key, String((await count(env, key)) + 1), {
        expirationTtl: windowSeconds,
      });
    }
  } catch {
    /* non-fatal */
  }
}

/** Clears this caller's counter after a success. The global counter stands. */
export async function rateLimitReset(env, kind, ip) {
  if (!env.LEADS || !ip) return;
  try {
    await env.LEADS.delete(rlKey(kind, ip));
  } catch {
    /* non-fatal */
  }
}

/* ------------------------------------------------------------ audit trail */

/**
 * Append-only. There is no route in this application that updates or deletes
 * an `audit:tp:` key, so a person who can reach the office area cannot edit
 * their own trail through the app.
 *
 * Keys sort newest-first (inverted timestamp) to match the existing lead keys.
 */
export async function audit(env, request, action, target, result) {
  if (!env.LEADS) return;
  try {
    const invTs = String(1e13 - Date.now()).padStart(13, "0");
    await env.LEADS.put(
      `audit:tp:${invTs}:${crypto.randomUUID().slice(0, 8)}`,
      JSON.stringify({
        at: new Date().toISOString(),
        action,
        target: target ?? null,
        result,
        actor: request.headers.get("cf-access-authenticated-user-email") || "",
        ip: request.headers.get("cf-connecting-ip") || "",
        ua: (request.headers.get("user-agent") || "").slice(0, 200),
      }),
      { expirationTtl: 60 * 60 * 24 * 730 }, // two years
    );
  } catch (err) {
    console.error("tradeplate audit write failed:", err && err.message);
  }
}

/* -------------------------------------------------------------- CSRF / origin */

/**
 * Same-origin check for state-changing requests.
 *
 * The session cookies are SameSite=Lax, which already stops a cross-site form
 * POST carrying them. This is the second layer: a request that declares a
 * foreign Origin or Referer is refused outright.
 *
 * Requests that declare neither are allowed. That is deliberate: an opaque
 * ("null") Origin with no Referer is what a normal same-origin form post looks
 * like under a strict referrer policy, and blocking it would lock drivers out
 * of the yard while adding nothing - SameSite=Lax already withholds the session
 * cookie from a genuine cross-site post, so such a request cannot act as anyone.
 */
export function sameOrigin(request, url) {
  const origin = request.headers.get("origin");
  // "null" is an opaque origin. Browsers send it for ordinary same-origin form
  // posts under a strict referrer policy, so it is not evidence of a
  // cross-site request - fall through to Referer.
  if (origin && origin !== "null") return origin === url.origin;
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin === url.origin;
    } catch {
      return false;
    }
  }
  return true;
}

/* ------------------------------------------------------ retention purge */

/**
 * Deletes closed records whose trip date is older than RETENTION_YEARS.
 *
 * Open records are never touched: a plate that has not come back is still in
 * use and its record is not yet complete. Deletion is a hard DELETE of the row,
 * which removes the ciphertext — there is no soft-delete flag to overlook.
 *
 * Returns the number of rows removed. Called from the scheduled handler and
 * safe to run repeatedly.
 */
export async function purgeExpiredTrips(env) {
  if (!env.DB) return { deleted: 0, cutoff: null };
  const years = Math.max(1, parseInt(env.RETENTION_YEARS || "5", 10) || 5);
  const cutoff = new Date();
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
  const iso = cutoff.toISOString();

  const counted = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM trips WHERE in_at IS NOT NULL AND out_at < ?",
  )
    .bind(iso)
    .first();

  const n = counted?.n ?? 0;
  if (n > 0) {
    await env.DB.prepare("DELETE FROM trips WHERE in_at IS NOT NULL AND out_at < ?")
      .bind(iso)
      .run();
  }
  return { deleted: n, cutoff: iso };
}
