/**
 * RSMotoCons site worker (Cloudflare Pages advanced mode).
 *
 * - POST /api/contact           — receives contact-form submissions, encrypts
 *                                 them (AES-256-GCM) with DATA_KEY, stores in
 *                                 the LEADS KV namespace. Nothing is emailed.
 * - GET  /members/api/leads     — decrypts and returns stored messages.
 * - POST /members/api/leads/delete — deletes one message.
 *   Both /members/api/* routes rely on Cloudflare Access protecting
 *   /members/* at the edge; they also refuse to run if Access is absent
 *   (no CF-Access-JWT header) unless ALLOW_UNLOCKED=true is set for testing.
 * - Everything else falls through to the static site, with security headers
 *   applied here (advanced mode bypasses the _headers file).
 *
 * - /tradeplate/*  and /members/tradeplate/*
 *                               — trade plate record of use, in tradeplate.js.
 *                                 Records are encrypted with the same DATA_KEY.
 *
 * Required settings:
 *   KV binding:  LEADS    → a KV namespace
 *   D1 binding:  DB       → the tradeplate database
 *   Secret:      DATA_KEY → base64 32-byte key (openssl rand -base64 32)
 *   Secret:      SESSION_SECRET, DRIVER_PIN, ADMIN_PASSWORD
 */

import { handleTradeplate } from "./tradeplate.js";

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; " +
  "base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests";

const MAX = { name: 120, email: 254, department: 60, message: 4000 };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/contact" && request.method === "POST") {
        return await handleContact(request, env);
      }
      if (url.pathname === "/members/api/leads" && request.method === "GET") {
        return await requireMembers(request, env, url, () => listLeads(request, env));
      }
      if (url.pathname === "/members/api/leads/delete" && request.method === "POST") {
        return await requireMembers(request, env, url, () => deleteLead(request, env));
      }

      // Trade plate record of use. Returns null when the path is not its own.
      const plates = await handleTradeplate(request, env, url);
      if (plates) return withSecurityHeaders(plates, url.pathname);

      // Setup files must never be served, whatever ends up in the assets dir.
      if (/^\/(schema\.sql|plates\.sql|\.dev\.vars|wrangler\.(toml|jsonc?))$/.test(url.pathname)) {
        return new Response("Not found", { status: 404 });
      }
    } catch (err) {
      // Generic error to the outside; detail only to the platform log stream.
      console.error("worker error:", err && err.message);
      return json({ success: false, error: "Server error." }, 500);
    }

    const res = await env.ASSETS.fetch(request);
    return withSecurityHeaders(res, url.pathname);
  },
};

/* ───────────── helpers ───────────── */

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function withSecurityHeaders(res, pathname) {
  const out = new Response(res.body, res);
  out.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  out.headers.set("X-Content-Type-Options", "nosniff");
  out.headers.set("X-Frame-Options", "DENY");
  out.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  out.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  out.headers.set("Content-Security-Policy", CSP);
  out.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  out.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  if (pathname.startsWith("/members") || pathname.startsWith("/tradeplate")) {
    out.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    out.headers.set("Cache-Control", "no-store");
    // A plate URL is effectively a key; do not leak it in a referrer header.
    if (pathname.startsWith("/tradeplate")) out.headers.set("Referrer-Policy", "no-referrer");
  } else if (/\.(svg|css|js)$/.test(pathname)) {
    out.headers.set("Cache-Control", "public, max-age=3600");
  }
  return out;
}

function clientIp(request) {
  return request.headers.get("cf-connecting-ip") || "unknown";
}

/**
 * Members API guard.
 * - Requires Cloudflare Access to be active on /members/* (the Access JWT
 *   header is stamped by Cloudflare's edge after login; it cannot be spoofed
 *   from outside because Access strips inbound copies).
 * - CSRF defence for state-changing calls: the Origin must be our own host
 *   and the request must carry the custom X-Requested-With header, which
 *   cross-site forms and no-cors fetches cannot set.
 */
async function requireMembers(request, env, url, next) {
  const hasAccess = request.headers.get("cf-access-jwt-assertion");
  if (!hasAccess && env.ALLOW_UNLOCKED !== "true") {
    return json(
      { success: false, error: "locked", detail: "Cloudflare Access is not active on /members yet." },
      403
    );
  }
  if (request.method !== "GET") {
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) {
      return json({ success: false, error: "Forbidden." }, 403);
    }
    if (request.headers.get("x-requested-with") !== "fetch") {
      return json({ success: false, error: "Forbidden." }, 403);
    }
  }
  return next();
}

/** Who is acting, per Cloudflare Access (empty string before lock is on). */
function actor(request) {
  return request.headers.get("cf-access-authenticated-user-email") || "";
}

/**
 * Append-only audit trail (separate `audit:` keyspace; the members API has
 * no write/delete route for it, so members cannot alter their own trail).
 * Entries hold identifiers and actor metadata only — never message content.
 */
async function auditLog(env, request, action, target, result) {
  try {
    const invTs = String(1e13 - Date.now()).padStart(13, "0");
    await env.LEADS.put(
      `audit:${invTs}:${crypto.randomUUID().slice(0, 8)}`,
      JSON.stringify({
        at: new Date().toISOString(),
        action,
        target: target || null,
        result,
        actor: actor(request),
        ip: clientIp(request),
        ua: (request.headers.get("user-agent") || "").slice(0, 200),
      }),
      { expirationTtl: 60 * 60 * 24 * 730 } // keep audit entries 2 years
    );
  } catch (e) {
    console.error("audit write failed:", e && e.message);
  }
}

/** Retention: stored leads auto-delete after RETENTION_DAYS (default 365). */
function retentionSeconds(env) {
  const days = parseInt(env.RETENTION_DAYS || "365", 10);
  return (isNaN(days) || days < 1 ? 365 : days) * 24 * 60 * 60;
}

/* ───────────── crypto (AES-256-GCM) ───────────── */

async function getKey(env) {
  if (!env.DATA_KEY) throw new Error("DATA_KEY missing");
  const raw = Uint8Array.from(atob(env.DATA_KEY), (c) => c.charCodeAt(0));
  if (raw.length !== 32) throw new Error("DATA_KEY must be 32 bytes base64");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptJson(env, obj) {
  const key = await getKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(obj))
  );
  return JSON.stringify({
    v: 1,
    iv: btoa(String.fromCharCode(...iv)),
    ct: btoa(String.fromCharCode(...new Uint8Array(ct))),
  });
}

async function decryptJson(env, stored) {
  const key = await getKey(env);
  const { iv, ct } = JSON.parse(stored);
  const ivB = Uint8Array.from(atob(iv), (c) => c.charCodeAt(0));
  const ctB = Uint8Array.from(atob(ct), (c) => c.charCodeAt(0));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivB }, key, ctB);
  return JSON.parse(new TextDecoder().decode(pt));
}

/* ───────────── contact intake ───────────── */

async function handleContact(request, env) {
  if (!env.LEADS || !env.DATA_KEY) {
    return json({ success: false, error: "Storage is not configured yet." }, 503);
  }

  // Rate limit: 5 submissions per minute per IP.
  const rlKey = `rl:${clientIp(request)}`;
  const count = parseInt((await env.LEADS.get(rlKey)) || "0", 10);
  if (count >= 5) return json({ success: false, error: "Too many messages — try again in a minute." }, 429);
  await env.LEADS.put(rlKey, String(count + 1), { expirationTtl: 60 });

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: "Invalid request." }, 400);
  }

  // Honeypot: bots fill the hidden field; drop silently as a fake success.
  if (body.botcheck) return json({ success: true });

  const name = str(body.name, MAX.name);
  const email = str(body.email, MAX.email);
  const department = str(body.department, MAX.department);
  const message = str(body.message, MAX.message);
  const marketingOptIn = body.marketingOptIn === true || body.marketingOptIn === "Yes";

  if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ success: false, error: "Please provide a valid name and email." }, 422);
  }

  const record = {
    name,
    email,
    department,
    message,
    marketingOptIn,
    receivedAt: new Date().toISOString(),
  };

  // Key sorts newest-first lexicographically (inverted timestamp).
  const invTs = String(1e13 - Date.now()).padStart(13, "0");
  const id = `lead:${invTs}:${crypto.randomUUID().slice(0, 8)}`;
  await env.LEADS.put(id, await encryptJson(env, record), {
    expirationTtl: retentionSeconds(env),
  });
  await auditLog(env, request, "lead.received", id, "ok");

  return json({ success: true });
}

function str(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/* ───────────── members inbox ───────────── */

async function listLeads(request, env) {
  if (!env.LEADS || !env.DATA_KEY) {
    return json({ success: false, error: "Storage is not configured yet." }, 503);
  }
  const list = await env.LEADS.list({ prefix: "lead:", limit: 200 });
  const items = [];
  for (const k of list.keys) {
    const stored = await env.LEADS.get(k.name);
    if (!stored) continue;
    try {
      items.push({ id: k.name, ...(await decryptJson(env, stored)) });
    } catch {
      items.push({ id: k.name, error: "Cannot decrypt (was DATA_KEY changed?)" });
    }
  }
  await auditLog(env, request, "inbox.view", null, `ok:${items.length}`);
  return json({ success: true, items });
}

async function deleteLead(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: "Invalid request." }, 400);
  }
  if (typeof body.id !== "string" || !body.id.startsWith("lead:")) {
    return json({ success: false, error: "Invalid id." }, 400);
  }
  await env.LEADS.delete(body.id);
  await auditLog(env, request, "lead.delete", body.id, "ok");
  return json({ success: true });
}
