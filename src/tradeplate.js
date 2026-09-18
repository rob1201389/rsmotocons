/**
 * Trade plate record of use.
 *
 * Two trees, deliberately separated:
 *   /tradeplate/*          drivers. Outside Cloudflare Access so a scan does
 *                          not demand a login in the yard. Gated by DRIVER_PIN,
 *                          which is required — without it the tree stays shut.
 *   /members/tradeplate/*  the office. Behind Cloudflare Access; falls back to
 *                          ADMIN_PASSWORD while Access is not yet switched on.
 *
 * Everything personal in a record is encrypted at rest with AES-256-GCM under
 * DATA_KEY — the same key and scheme the site already uses for contact leads.
 * Only the columns needed to index, sort and filter (plate number, timestamps)
 * are stored in clear. A copy of the database without the key reads nothing.
 *
 * Static assets live at /assets/tradeplate/ so this module never has to hand a
 * request back to the asset server.
 */

import {
  rateLimitCheck,
  rateLimitFailure,
  rateLimitReset,
  audit,
  sameOrigin,
} from "./security.js";

const DRIVER = "/tradeplate";
const OFFICE = "/members/tradeplate";
const ASSET = "/assets/tradeplate";
const TZ = "Australia/Sydney";

/* ------------------------------------------------------------------ utils */

function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

function html(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
  });
}

function redirect(to, headers = {}) {
  return new Response(null, { status: 303, headers: { location: to, ...headers } });
}

function slugId() {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

/* ------------------------------------------------------ encryption at rest */

async function dataKey(env) {
  if (!env.DATA_KEY) throw new Error("DATA_KEY missing");
  const raw = Uint8Array.from(atob(env.DATA_KEY), (c) => c.charCodeAt(0));
  if (raw.length !== 32) throw new Error("DATA_KEY must be 32 bytes base64");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function seal(env, obj) {
  const key = await dataKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(obj)),
  );
  return JSON.stringify({
    v: 1,
    iv: btoa(String.fromCharCode(...iv)),
    ct: btoa(String.fromCharCode(...new Uint8Array(ct))),
  });
}

async function unseal(env, stored) {
  const key = await dataKey(env);
  const { iv, ct } = JSON.parse(stored);
  const ivB = Uint8Array.from(atob(iv), (c) => c.charCodeAt(0));
  const ctB = Uint8Array.from(atob(ct), (c) => c.charCodeAt(0));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivB }, key, ctB);
  return JSON.parse(new TextDecoder().decode(pt));
}

/** A trips row plus its decrypted contents, or a stub marked unreadable. */
async function readTrip(env, row) {
  const base = {
    id: row.id,
    plate_id: row.plate_id,
    plate_number: row.plate_number,
    out_at: row.out_at,
    in_at: row.in_at,
    created_at: row.created_at,
    completed_at: row.completed_at,
  };
  try {
    return { ...base, ...(await unseal(env, row.enc)) };
  } catch {
    return {
      ...base,
      unreadable: true,
      batch_number: "—",
      vehicle_make: "—",
      trip_destination: "—",
      driver_name: "Cannot decrypt — was DATA_KEY changed?",
    };
  }
}

/* --------------------------------------------------------------- settings */

/**
 * Operator-changeable settings, encrypted with the same key as record content.
 *
 * The driver PIN lives here once it has been changed in the office. Until then
 * the DRIVER_PIN platform secret is used, so a fresh deployment still works
 * before anyone visits the settings page.
 */
async function readSetting(env, key) {
  try {
    const row = await env.DB.prepare("SELECT enc FROM settings WHERE key = ?").bind(key).first();
    if (!row) return null;
    const v = await unseal(env, row.enc);
    return v.value ?? null;
  } catch {
    return null;
  }
}

async function writeSetting(env, key, value, who) {
  await env.DB.prepare(
    `INSERT INTO settings (key, enc, updated_at, updated_by) VALUES (?,?,?,?)
     ON CONFLICT(key) DO UPDATE SET enc = excluded.enc,
       updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  )
    .bind(key, await seal(env, { value }), new Date().toISOString(), who || null)
    .run();
}

/** The PIN in force: the one set in the office, else the platform secret. */
async function currentPin(env) {
  return (await readSetting(env, "driver_pin")) || env.DRIVER_PIN || "";
}

/**
 * Bumping this invalidates every remembered phone at once, which is what you
 * want the day someone leaves. Stored as a string, compared as one.
 */
async function driverEpoch(env) {
  return (await readSetting(env, "driver_epoch")) || "1";
}

/* ------------------------------------------------------------------- time */

function zonedParts(date) {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Milliseconds NSW is ahead of UTC at that instant (+10h AEST, +11h AEDT). */
function offsetMs(date) {
  const p = zonedParts(date);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime();
}

/** "2026-09-18T07:45" read as NSW wall time -> a UTC instant. */
function wallToDate(wall) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(wall).trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  // Two passes so the hour either side of a daylight saving change resolves.
  let result = naive - offsetMs(new Date(naive));
  result = naive - offsetMs(new Date(result));
  const out = new Date(result);
  return Number.isNaN(out.getTime()) ? null : out;
}

const pad = (n) => String(n).padStart(2, "0");

function dateToWall(date) {
  const p = zonedParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

function fmt(iso) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  })
    .format(new Date(iso))
    .replace(",", "");
}

function duration(fromIso, toIso) {
  const mins = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 6e4));
  const h = Math.floor(mins / 60);
  return h === 0 ? `${mins}m` : `${h}h ${mins % 60}m`;
}

const todayNsw = () => dateToWall(new Date()).slice(0, 10);

/**
 * Driving on an expired trade plate is the failure this guards against, so an
 * expired plate is blocked outright rather than merely flagged.
 */
function expiryStatus(expiry) {
  if (!expiry) return { state: "none", days: null, label: "Not set" };
  const days = Math.round(
    (Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${todayNsw()}T00:00:00Z`)) / 864e5,
  );
  const pretty = expiry.split("-").reverse().join("/");
  if (days < 0) return { state: "expired", days, label: `Expired ${pretty}` };
  if (days === 0) return { state: "soon", days, label: "Expires today" };
  if (days <= 30)
    return {
      state: "soon",
      days,
      label: `Expires ${pretty} (${days} day${days === 1 ? "" : "s"})`,
    };
  return { state: "ok", days, label: pretty };
}

/* --------------------------------------------------------------- sessions */

const OFFICE_COOKIE = "tp_office";
const DRIVER_COOKIE = "tp_driver";
const OFFICE_MAX_AGE = 60 * 60 * 2;
const DRIVER_MAX_AGE = 60 * 60 * 24 * 60;

async function sign(secret, payload) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(mac)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readCookie(request, name) {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

async function sessionCookie(secret, name, path, maxAge, epoch = "") {
  // The epoch is inside the signed payload, so it cannot be edited by the
  // holder; changing it in settings invalidates every cookie already issued.
  const payload = `${Date.now() + maxAge * 1000}~${epoch}`;
  return `${name}=${payload}.${await sign(secret, payload)}; Path=${path}; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

const clearCookie = (name, path) =>
  `${name}=; Path=${path}; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

async function validSession(request, secret, name, epoch = null) {
  const raw = readCookie(request, name);
  if (!raw) return false;
  const [payload, mac] = raw.split(".");
  if (!payload || !mac) return false;
  if (!safeEqual(mac, await sign(secret, payload))) return false;
  const [expires, cookieEpoch = ""] = payload.split("~");
  if (Number(expires) <= Date.now()) return false;
  if (epoch !== null && cookieEpoch !== epoch) return false;
  return true;
}

/** Cloudflare Access stamps these at the edge; they cannot be spoofed inbound. */
const accessEmail = (request) =>
  request.headers.get("cf-access-authenticated-user-email") || "";
const behindAccess = (request) => Boolean(request.headers.get("cf-access-jwt-assertion"));

async function officeAuthed(request, env) {
  if (behindAccess(request)) return true;
  return validSession(request, env.SESSION_SECRET, OFFICE_COOKIE);
}

/* ----------------------------------------------------------------- chrome */

function layout(o) {
  const nav = o.office
    ? `<a href="${OFFICE}/">Records</a>
       <a href="${OFFICE}/plates">Plates</a>
       <a href="${OFFICE}/settings">Settings</a>
       ${
         o.actor
           ? `<span class="tp-actor">${esc(o.actor)}</span>`
           : `<form method="post" action="${OFFICE}/logout" class="tp-inline-form">
                <button type="submit" class="linkish">Sign out</button>
              </form>`
       }`
    : `<a href="${DRIVER}/">Trade plates</a>`;

  return `<!DOCTYPE html>
<html lang="en-AU">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(o.title)} — RSMotoCons</title>
<meta name="robots" content="noindex, nofollow">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="stylesheet" href="/site.css">
<link rel="stylesheet" href="${ASSET}/tradeplate.css">
<script src="/app.js" defer></script>
<script src="${ASSET}/app.js" defer></script>
</head>
<body>
<div class="tricolore-bar" aria-hidden="true"></div>
<header>
  <div class="wrap nav">
    <a class="brand" href="/" aria-label="RSMotoCons home">
      <img src="/favicon.svg" alt="" width="40" height="40">
      <span>RS<span class="moto">Moto</span>Cons</span>
    </a>
    <button class="menu-toggle" aria-label="Toggle menu" aria-expanded="false">☰</button>
    <nav class="links">${nav}</nav>
  </div>
</header>
<main>
  <section class="page-hero tp-hero">
    <div class="wrap">
      <p class="crumb">${o.crumb}</p>
      <h1>${o.heading}</h1>
      ${o.lead ? `<p class="lead">${o.lead}</p>` : ""}
      <div class="stripe" aria-hidden="true"></div>
    </div>
  </section>
  <section class="tight">
    <div class="wrap${o.narrow ? " tp-narrow" : ""}">${o.body}</div>
  </section>
</main>
<footer>
  <div class="tricolore-bar" aria-hidden="true"></div>
  <div class="wrap">
    <div class="fbot">
      <p><span class="flag" aria-hidden="true"></span>© 2026 RSMotoCons · Trade plate record of use</p>
      <p><a href="${DRIVER}/privacy">Privacy notice</a></p>
    </div>
  </div>
</footer>
</body>
</html>`;
}

const banner = (tone, text) => `<div class="tp-banner ${tone}">${text}</div>`;
const pill = (tone, text) => `<span class="tp-pill ${tone}">${esc(text)}</span>`;

const fieldRow = (label, control, error, hint) => `<div class="tp-field">
    <label>${label}</label>
    ${control}
    ${error ? `<p class="tp-err">${esc(error)}</p>` : hint ? `<p class="tp-hint">${hint}</p>` : ""}
  </div>`;

const textInput = (name, value = "", placeholder = "") =>
  `<input type="text" id="${name}" name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off">`;

const dateTimeInput = (name, value) => `<div class="tp-now-row">
     <input type="datetime-local" id="${name}" name="${name}" value="${esc(value)}" required>
     <button type="button" class="tp-now" data-now-for="${name}">Now</button>
   </div>`;

const signatureBlock = (name, hint, error) => `<div class="tp-sig">
    <div class="tp-sig-head">
      <label>Driver&rsquo;s signature</label>
      <button type="button" class="linkish" data-clear-sig="${name}">Clear</button>
    </div>
    <canvas class="tp-canvas" data-sig="${name}" aria-label="Signature pad"></canvas>
    <p class="${error ? "tp-err" : "tp-hint"}" data-sig-hint="${name}">${esc(error || hint)}</p>
    <input type="hidden" name="${name}" data-sig-input="${name}">
    <noscript><p class="tp-err">Signing needs JavaScript. Record this trip on paper instead.</p></noscript>
  </div>`;

function collectionNotice(env) {
  const org = env.ORG_NAME || "RSMotoCons";
  const years = Number(env.RETENTION_YEARS || 5);
  return `<div class="tp-notice">
    <b>Privacy</b> — your name, signature, licence number and trip details are
    collected by ${esc(org)} to keep the record of use required for this trade
    plate. They are encrypted before being stored, held in Australia, may be
    produced to Transport for NSW, the NSW Police Force or an insurer on
    request, and are deleted after ${years} year${years === 1 ? "" : "s"}.
    <a href="${DRIVER}/privacy">Full privacy notice</a>.
  </div>`;
}

const PURPOSES = [
  "Delivery to customer",
  "Collection / pick-up",
  "Demonstration / test drive",
  "Road test after service",
  "To or from repairer",
  "To or from auction",
  "Inspection / blue slip",
  "Transfer between yards",
  "Other",
];

/* ---------------------------------------------------------------- queries */

const getPlateBySlug = (db, slug) =>
  db.prepare("SELECT * FROM plates WHERE qr_slug = ?").bind(slug).first();

const getOpenTripRow = (db, plateId) =>
  db
    .prepare(
      "SELECT * FROM trips WHERE plate_id = ? AND in_at IS NULL ORDER BY out_at DESC LIMIT 1",
    )
    .bind(plateId)
    .first();

const requestMeta = (request) => ({
  ip: request.headers.get("cf-connecting-ip") || null,
  ua: (request.headers.get("user-agent") || "").slice(0, 300) || null,
});

function validSignature(value) {
  if (!value) return null;
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value)) return null;
  if (value.length > 1500000) return null;
  return value;
}

/* =========================================================================
   DRIVER TREE   /tradeplate/*
   ========================================================================= */

const pinPage = (next, wrong) =>
  layout({
    title: "Access PIN",
    heading: 'Trade <span class="grad">plates</span>',
    lead: "Enter the access PIN to record a plate's use.",
    crumb: "Trade plates",
    narrow: true,
    body: `${wrong ? banner("bad", "Wrong PIN.") : ""}
      <form method="post" action="${DRIVER}/unlock" class="tp-form">
        <input type="hidden" name="next" value="${esc(next)}">
        ${fieldRow(
          "Access PIN",
          `<input type="password" id="pin" name="pin" inputmode="numeric" autocomplete="off" required>`,
          undefined,
          "Asked once on this phone, then remembered for 60 days.",
        )}
        <button type="submit" class="btn">Continue</button>
      </form>`,
  });

function boardPage(plates, openByPlate) {
  const rows = plates
    .map((p) => {
      const out = openByPlate.get(p.id);
      const ex = expiryStatus(p.expiry_date);
      const status =
        ex.state === "expired"
          ? pill("bad", "Expired")
          : out
            ? pill("out", "Out")
            : pill("in", "Available");
      const sub = out
        ? `${esc(out.driver_name)} to ${esc(out.trip_destination)}, since ${fmt(out.out_at)}`
        : "In the office";
      const warn =
        ex.state === "expired"
          ? `<div class="tp-row-warn bad">${esc(ex.label)}</div>`
          : ex.state === "soon"
            ? `<div class="tp-row-warn warn">${esc(ex.label)}</div>`
            : "";
      return `<a class="tp-plate-row" href="${DRIVER}/p/${esc(p.qr_slug)}">
        <span class="tp-plate-body">
          <span class="tp-plate-num">${esc(p.plate_number)}</span>
          <span class="tp-plate-sub">${sub}</span>
          ${warn}
        </span>
        ${status}
      </a>`;
    })
    .join("");

  return layout({
    title: "Trade plates",
    heading: 'Trade <span class="grad">plates</span>',
    lead: "Scan the QR code on the back of a plate, or pick it from the list.",
    crumb: "Trade plates",
    narrow: true,
    body: `${plates.length ? `<div class="tp-plate-list">${rows}</div>` : `<p class="tp-empty">No plates on file yet.</p>`}
      <p class="tp-footlinks">
        <a href="${DRIVER}/new">Manual entry</a> ·
        <a href="${DRIVER}/privacy">Privacy notice</a> ·
        <a href="${OFFICE}/">Office</a>
      </p>`,
  });
}

function outForm(env, opts) {
  const v = opts.values;
  const e = opts.errors;
  const purposeOptions = PURPOSES.map(
    (p) => `<option${v.purpose === p ? " selected" : ""}>${esc(p)}</option>`,
  ).join("");

  return `<form method="post" action="${esc(opts.action)}" class="tp-form">
    ${opts.plateSelect ?? ""}
    ${fieldRow("Date and time out", dateTimeInput("outAt", v.outAt || opts.defaultOutAt), e.outAt)}
    ${fieldRow("Batch number", textInput("batchNumber", v.batchNumber, "e.g. B-2261"), e.batchNumber, v.batchHint)}
    ${fieldRow("Vehicle make", textInput("vehicleMake", v.vehicleMake, "e.g. Toyota Hilux SR5"), e.vehicleMake)}
    ${fieldRow("Vehicle rego or VIN", textInput("vehicleRego", v.vehicleRego, "Optional"), e.vehicleRego, "Optional, but worth recording")}
    ${fieldRow("Trip destination", textInput("tripDestination", v.tripDestination, "e.g. Penrith then Blacktown"), e.tripDestination)}
    ${fieldRow("Purpose of use", `<select id="purpose" name="purpose"><option value="">Select a purpose</option>${purposeOptions}</select>`, e.purpose)}
    ${fieldRow("Driver&rsquo;s name", textInput("driverName", v.driverName, "Full name"), e.driverName)}
    ${fieldRow("Driver&rsquo;s licence number", textInput("driverLicence", v.driverLicence, "Optional"), e.driverLicence, "Optional")}
    ${collectionNotice(env)}
    ${signatureBlock("signatureOut", "Sign to confirm you have taken the plate", e.signatureOut)}
    <button type="submit" class="btn">Sign plate out</button>
  </form>`;
}

const inForm = (env, trip, slug, defaultInAt, values, errors) => `<dl class="tp-summary">
      <div><dt>Out</dt><dd>${fmt(trip.out_at)}</dd></div>
      <div><dt>Batch</dt><dd>${esc(trip.batch_number)}</dd></div>
      <div><dt>Vehicle</dt><dd>${esc(trip.vehicle_make)}</dd></div>
      <div><dt>Rego / VIN</dt><dd>${esc(trip.vehicle_rego || "–")}</dd></div>
      <div class="wide"><dt>Destination</dt><dd>${esc(trip.trip_destination)}</dd></div>
      <div class="wide"><dt>Driver</dt><dd>${esc(trip.driver_name)}</dd></div>
    </dl>
    <form method="post" action="${DRIVER}/p/${esc(slug)}" class="tp-form">
      <input type="hidden" name="action" value="in">
      <input type="hidden" name="tripId" value="${trip.id}">
      ${fieldRow("Date and time in", dateTimeInput("inAt", values.inAt || defaultInAt), errors.inAt)}
      ${fieldRow("Notes", `<textarea id="notes" name="notes" rows="3" placeholder="Damage, delays, fuel">${esc(values.notes || "")}</textarea>`, undefined, "Optional")}
      ${collectionNotice(env)}
      ${signatureBlock("signatureIn", "Sign to confirm the plate has been returned", errors.signatureIn)}
      <button type="submit" class="btn">Book plate back in</button>
    </form>`;

function historyBlock(recent) {
  if (!recent.length) return "";
  const items = recent
    .map(
      (t) => `<li>
        <div class="who">${esc(t.driver_name)}</div>
        <div>${esc(t.trip_destination)}</div>
        <div class="when">${fmt(t.out_at)} to ${fmt(t.in_at)} (${duration(t.out_at, t.in_at)})</div>
      </li>`,
    )
    .join("");
  return `<div class="tp-history"><h3>Last ${recent.length} trips on this plate</h3><ul>${items}</ul></div>`;
}

async function platePage(env, plate, saved, values, errors) {
  const db = env.DB;
  const openRow = await getOpenTripRow(db, plate.id);
  const open = openRow ? await readTrip(env, openRow) : null;
  const ex = expiryStatus(plate.expiry_date);
  const blocked = !open && ex.state === "expired";

  const recentRows = (
    await db
      .prepare(
        "SELECT * FROM trips WHERE plate_id = ? AND in_at IS NOT NULL ORDER BY out_at DESC LIMIT 5",
      )
      .bind(plate.id)
      .all()
  ).results;
  const recent = [];
  for (const r of recentRows) recent.push(await readTrip(env, r));

  const lastRow = await db
    .prepare("SELECT * FROM trips WHERE plate_id = ? ORDER BY out_at DESC LIMIT 1")
    .bind(plate.id)
    .first();
  const last = lastRow ? await readTrip(env, lastRow) : null;

  const now = new Date();
  let body = "";

  if (saved === "out") body += banner("ok", "Signed out. Scan this plate again when it comes back.");
  if (saved === "in") body += banner("ok", "Booked back in. Record closed off.");
  if (errors.form) body += banner("bad", esc(errors.form));
  if (!blocked && ex.state === "soon") body += banner("warn", `${esc(ex.label)}. Tell the office.`);

  if (open) {
    body += inForm(env, open, plate.qr_slug, dateToWall(now), values, errors);
  } else if (!plate.active) {
    body += `<p class="tp-empty">Speak to the office — this plate has been taken out of service.</p>`;
  } else if (blocked) {
    body += `<div class="tp-banner bad"><b>${esc(ex.label)}.</b><br>
      This plate cannot be signed out. Take a different plate and tell the office.</div>`;
  } else {
    body += outForm(env, {
      action: `${DRIVER}/p/${plate.qr_slug}`,
      defaultOutAt: dateToWall(now),
      values: {
        batchNumber: last && !last.unreadable ? last.batch_number : "",
        batchHint: last && !last.unreadable ? "Carried forward from this plate's last trip" : "",
        ...values,
      },
      errors,
    });
  }

  body += historyBlock(recent);

  return layout({
    title: `Plate ${plate.plate_number}`,
    heading: `Plate <span class="grad">${esc(plate.plate_number)}</span>`,
    lead: open
      ? `Currently out with ${esc(open.driver_name)}`
      : !plate.active
        ? "This plate is retired"
        : blocked
          ? "This plate&rsquo;s registration has expired"
          : "Available — fill in the details below",
    crumb: `<a href="${DRIVER}/">Trade plates</a> / ${esc(plate.plate_number)}`,
    narrow: true,
    body,
  });
}

async function manualEntryPage(env, values, errors) {
  const plates = (
    await env.DB.prepare(
      `SELECT p.* FROM plates p
       WHERE p.active = 1
         AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.plate_id = p.id AND t.in_at IS NULL)
       ORDER BY p.plate_number`,
    ).all()
  ).results.filter((p) => expiryStatus(p.expiry_date).state !== "expired");

  const options = plates
    .map(
      (p) =>
        `<option value="${esc(p.plate_number)}"${values.plateNumber === p.plate_number ? " selected" : ""}>${esc(p.plate_number)}</option>`,
    )
    .join("");

  const body = plates.length
    ? (errors.form ? banner("bad", esc(errors.form)) : "") +
      outForm(env, {
        action: `${DRIVER}/new`,
        plateSelect: fieldRow(
          "Plate number",
          `<select id="plateNumber" name="plateNumber" required><option value="">Select a plate</option>${options}</select>`,
          errors.plateNumber,
        ),
        defaultOutAt: dateToWall(new Date()),
        values,
        errors,
      })
    : `<p class="tp-empty">No plate is available — they are all signed out or expired.
       <a href="${DRIVER}/">View plates</a>.</p>`;

  return layout({
    title: "Sign a plate out",
    heading: 'Sign a plate <span class="grad">out</span>',
    lead: "Manual entry — for when a label is damaged.",
    crumb: `<a href="${DRIVER}/">Trade plates</a> / Manual entry`,
    narrow: true,
    body,
  });
}

async function handleSignOut(request, env, plate, form) {
  const get = (k) => String(form.get(k) ?? "").trim();
  const errors = {};

  let target = plate;
  if (!target) {
    target = await env.DB.prepare("SELECT * FROM plates WHERE plate_number = ?")
      .bind(get("plateNumber"))
      .first();
    if (!target) errors.plateNumber = "Choose a plate";
  }

  const values = {
    plateNumber: get("plateNumber"),
    outAt: get("outAt"),
    batchNumber: get("batchNumber"),
    vehicleMake: get("vehicleMake"),
    vehicleRego: get("vehicleRego"),
    tripDestination: get("tripDestination"),
    purpose: get("purpose"),
    driverName: get("driverName"),
    driverLicence: get("driverLicence"),
  };

  const rerender = async () =>
    plate
      ? html(await platePage(env, plate, null, values, errors), 400)
      : html(await manualEntryPage(env, values, errors), 400);

  if (!target) return rerender();

  if (!target.active) {
    errors.form = `Plate ${target.plate_number} is retired.`;
    return rerender();
  }
  if (expiryStatus(target.expiry_date).state === "expired") {
    errors.form = `Plate ${target.plate_number} has expired and cannot be signed out.`;
    return rerender();
  }
  if (await getOpenTripRow(env.DB, target.id)) {
    errors.form = `Plate ${target.plate_number} is already signed out. Scan it again to book it back in.`;
    return rerender();
  }

  const outAt = wallToDate(values.outAt);
  if (!outAt) errors.outAt = "Enter a valid date and time";
  if (!values.batchNumber) errors.batchNumber = "Batch number is required";
  if (!values.vehicleMake) errors.vehicleMake = "Vehicle make is required";
  if (!values.tripDestination) errors.tripDestination = "Trip destination is required";
  if (!values.driverName) errors.driverName = "Driver's name is required";

  const signature = validSignature(String(form.get("signatureOut") ?? ""));
  if (!signature) errors.signatureOut = "Signature is required";

  if (Object.keys(errors).length) {
    errors.form = "Check the highlighted fields.";
    return rerender();
  }

  const meta = requestMeta(request);
  const sealed = await seal(env, {
    batch_number: values.batchNumber,
    vehicle_make: values.vehicleMake,
    vehicle_rego: values.vehicleRego.toUpperCase() || null,
    trip_destination: values.tripDestination,
    purpose: values.purpose || null,
    driver_name: values.driverName,
    driver_licence: values.driverLicence || null,
    signature_out: signature,
    signature_in: null,
    notes: null,
    created_ip: meta.ip,
    created_ua: meta.ua,
    completed_ip: null,
    completed_ua: null,
  });

  try {
    await env.DB.prepare(
      "INSERT INTO trips (plate_id, plate_number, out_at, created_at, enc) VALUES (?,?,?,?,?)",
    )
      .bind(target.id, target.plate_number, outAt.toISOString(), new Date().toISOString(), sealed)
      .run();
  } catch {
    // The partial unique index catches two phones submitting at the same moment.
    errors.form = `Plate ${target.plate_number} was just signed out by someone else. Reload this page.`;
    return rerender();
  }

  await audit(env, request, "trip.out", `${target.plate_number}`, "ok");
  return redirect(`${DRIVER}/p/${target.qr_slug}?saved=out`);
}

async function handleBookIn(request, env, plate, form) {
  const errors = {};
  const tripId = Number(form.get("tripId"));
  const row = await env.DB.prepare("SELECT * FROM trips WHERE id = ?").bind(tripId).first();

  if (!row || row.in_at)
    return html(
      await platePage(env, plate, null, {}, { form: "That record is already closed off." }),
      400,
    );

  const values = {
    inAt: String(form.get("inAt") ?? "").trim(),
    notes: String(form.get("notes") ?? "").trim(),
  };

  const inAt = wallToDate(values.inAt);
  if (!inAt) errors.inAt = "Enter a valid date and time";
  else if (inAt.getTime() < Date.parse(row.out_at))
    errors.inAt = "Time in cannot be before time out";

  const signature = validSignature(String(form.get("signatureIn") ?? ""));
  if (!signature) errors.signatureIn = "Signature is required";

  if (Object.keys(errors).length) {
    errors.form = "Check the highlighted fields.";
    return html(await platePage(env, plate, null, values, errors), 400);
  }

  const current = await readTrip(env, row);
  if (current.unreadable)
    return html(
      await platePage(env, plate, null, {}, {
        form: "This record cannot be read, so it cannot be closed off. Tell the office.",
      }),
      500,
    );

  const meta = requestMeta(request);
  const sealed = await seal(env, {
    batch_number: current.batch_number,
    vehicle_make: current.vehicle_make,
    vehicle_rego: current.vehicle_rego,
    trip_destination: current.trip_destination,
    purpose: current.purpose,
    driver_name: current.driver_name,
    driver_licence: current.driver_licence,
    signature_out: current.signature_out,
    signature_in: signature,
    notes: values.notes ? [current.notes, values.notes].filter(Boolean).join(" | ") : current.notes,
    created_ip: current.created_ip,
    created_ua: current.created_ua,
    completed_ip: meta.ip,
    completed_ua: meta.ua,
  });

  await env.DB.prepare(
    "UPDATE trips SET in_at = ?, completed_at = ?, enc = ? WHERE id = ? AND in_at IS NULL",
  )
    .bind(inAt.toISOString(), new Date().toISOString(), sealed, tripId)
    .run();

  await audit(env, request, "trip.in", `${plate.plate_number}#${tripId}`, "ok");
  return redirect(`${DRIVER}/p/${plate.qr_slug}?saved=in`);
}

const tooManyPage = (msg) =>
  layout({
    title: "Too many attempts",
    heading: 'Too many <span class="grad">attempts</span>',
    lead: msg,
    crumb: "Trade plates",
    narrow: true,
    body: `<p class="tp-empty">This is a deliberate delay after repeated wrong entries. Try again shortly, or ask the office.</p>`,
  });

const notFoundPage = () =>
  layout({
    title: "Plate not recognised",
    heading: 'Plate not <span class="grad">recognised</span>',
    lead: "That QR code is not on file.",
    crumb: "Trade plates",
    narrow: true,
    body: `<p class="tp-empty">Check the label is the right one, or pick the plate from the list.</p>
      <p><a class="btn" href="${DRIVER}/">View plates</a></p>`,
  });

function privacyPage(env) {
  const org = env.ORG_NAME || "RSMotoCons";
  const years = Number(env.RETENTION_YEARS || 5);
  const contact = env.PRIVACY_CONTACT || "the Privacy Officer";
  const email = env.PRIVACY_CONTACT_EMAIL || "info@rsmotocons.com";
  const phone = env.PRIVACY_CONTACT_PHONE || "";
  const sec = (h, p) => `<section class="tp-prose"><h2>${h}</h2>${p}</section>`;

  return layout({
    title: "Privacy notice",
    heading: 'Privacy <span class="grad">notice</span>',
    lead: `How ${esc(org)} handles the personal information collected by the trade plate record.`,
    crumb: `<a href="${DRIVER}/">Trade plates</a> / Privacy`,
    narrow: true,
    body: `
      ${sec("What we collect", `<p>When a trade plate is signed out and back in, this system records your name, your driver licence number if you enter it, your signature, the plate number, batch number, vehicle make and registration or VIN, the destination and purpose of the trip, and the date and time the plate went out and came back.</p><p>It also records the IP address and browser of the device used for each entry, and the time the entry was saved, so an entry can be shown to be genuine.</p>`)}
      ${sec("Why we collect it", `<p>A record of use must be kept for each trade plate and produced on request. This system is that record. ${esc(org)} also uses it to know which plate is out, who has it, and when it is due back.</p><p>Your name and signature are what tie a particular trip to a particular driver. Without them the record does not do its job. Your licence number is optional.</p>`)}
      ${sec("Who can see it", `<p>Access is limited to the staff who administer plate use, who reach the records through an authenticated office area. The records are disclosed outside ${esc(org)} only to Transport for NSW, the NSW Police Force, an insurer handling a claim, or another body with a lawful entitlement to them.</p><p>Drivers see only the plate they are scanning: whether it is available, who has it if it is out, and the last few trips on it.</p>`)}
      ${sec("How it is protected", `<p>Your name, licence number, signature and trip details are encrypted with AES-256-GCM before they are written to the database. A copy of the database without the key reads nothing. Connections are HTTPS throughout, the office area is authenticated, and the driver forms require a shared PIN.</p>`)}
      ${sec("Where it is held", `<p>In a database hosted in Australia. Records are not sold, and are not used for marketing.</p>`)}
      ${sec("How long we keep it", `<p>Records are kept for ${years} year${years === 1 ? "" : "s"} from the date of the trip, then deleted.</p>`)}
      ${sec("Access, correction and complaints", `<p>You can ask for a copy of the records about you, or a correction, by contacting ${esc(contact)} at <a href="mailto:${esc(email)}">${esc(email)}</a>${phone ? ` or ${esc(phone)}` : ""}. Complaints go to the same contact. If you are not satisfied with the response you can take the complaint to the Office of the Australian Information Commissioner at oaic.gov.au.</p>`)}
      ${sec("If you would rather not use this system", `<p>Tell the office. A paper entry can be made instead. The same information is collected either way, because the record still has to be kept.</p>`)}`,
  });
}

async function driverRoutes(request, env, url, segments) {
  const db = env.DB;
  const path = segments.join("/");

  if (path === "privacy") return html(privacyPage(env));

  const pin = await currentPin(env);
  const epoch = await driverEpoch(env);

  // The PIN is not optional. Without it configured the tree stays shut.
  if (!pin)
    return html(
      layout({
        title: "Not configured",
        heading: 'Not <span class="grad">configured</span>',
        lead: "The driver PIN has not been set.",
        crumb: "Trade plates",
        narrow: true,
        body: `<p class="tp-empty">Set <code>DRIVER_PIN</code> on the worker, or set a PIN in the office settings. Until then this stays closed.</p>`,
      }),
      503,
    );

  if (path === "unlock" && request.method === "POST") {
    const ip = request.headers.get("cf-connecting-ip") || "";
    const gate = await rateLimitCheck(env, "pin", ip, 10, 60);
    if (!gate.ok) {
      await audit(env, request, "driver.pin", null, `rate-limited:${gate.scope}`);
      return html(tooManyPage("Too many PIN attempts. Wait ten minutes."), 429, {
        "retry-after": "600",
      });
    }
    const form = await request.formData();
    const next = String(form.get("next") ?? `${DRIVER}/`);
    const safeNext = /^\/tradeplate(\/[A-Za-z0-9/_-]*)?$/.test(next) ? next : `${DRIVER}/`;
    if (!safeEqual(String(form.get("pin") ?? ""), pin)) {
      await rateLimitFailure(env, "pin", ip, 600);
      await audit(env, request, "driver.pin", null, "wrong");
      return html(pinPage(safeNext, true), 401);
    }
    await rateLimitReset(env, "pin", ip);
    await audit(env, request, "driver.pin", null, "ok");
    return redirect(safeNext, {
      "set-cookie": await sessionCookie(
        env.SESSION_SECRET, DRIVER_COOKIE, DRIVER, DRIVER_MAX_AGE, epoch,
      ),
    });
  }

  if (!(await validSession(request, env.SESSION_SECRET, DRIVER_COOKIE, epoch)))
    return html(pinPage(`${DRIVER}/${path}`, false));

  if (path === "new") {
    if (request.method === "POST")
      return handleSignOut(request, env, null, await request.formData());
    return html(await manualEntryPage(env, {}, {}));
  }

  if (segments[0] === "p" && segments[1]) {
    const plate = await getPlateBySlug(db, segments[1]);
    if (!plate) return html(notFoundPage(), 404);
    if (request.method === "POST") {
      const form = await request.formData();
      return String(form.get("action")) === "in"
        ? handleBookIn(request, env, plate, form)
        : handleSignOut(request, env, plate, form);
    }
    return html(await platePage(env, plate, url.searchParams.get("saved"), {}, {}));
  }

  if (path === "") {
    const plates = (
      await db.prepare("SELECT * FROM plates WHERE active = 1 ORDER BY plate_number").all()
    ).results;
    const openRows = (await db.prepare("SELECT * FROM trips WHERE in_at IS NULL").all()).results;
    const map = new Map();
    for (const r of openRows) map.set(r.plate_id, await readTrip(env, r));
    return html(boardPage(plates, map));
  }

  return html(notFoundPage(), 404);
}

/* =========================================================================
   OFFICE TREE   /members/tradeplate/*
   ========================================================================= */

const loginPage = (wrong) =>
  layout({
    title: "Office sign in",
    heading: 'Office <span class="grad">sign in</span>',
    lead: "For viewing and exporting trade plate records.",
    crumb: `<a href="/members/">Members</a> / Trade plates`,
    narrow: true,
    body: `${wrong ? banner("bad", "Wrong password.") : ""}
      <form method="post" action="${OFFICE}/login" class="tp-form">
        ${fieldRow("Password", `<input type="password" id="password" name="password" autocomplete="current-password" required>`)}
        <button type="submit" class="btn">Sign in</button>
      </form>`,
  });

function readFilters(url) {
  const q = (k) => (url.searchParams.get(k) ?? "").trim();
  const dateOk = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
  const status = q("status");
  return {
    from: dateOk(q("from")),
    to: dateOk(q("to")),
    plate: q("plate"),
    driver: q("driver"),
    status: status === "open" || status === "closed" ? status : "",
  };
}

/**
 * Only the clear columns can be filtered in SQL. Driver name lives inside the
 * encrypted blob, so that filter runs after decryption.
 */
function filterSql(f) {
  const clauses = [];
  const binds = [];
  if (f.from) {
    const start = wallToDate(`${f.from}T00:00`);
    if (start) {
      clauses.push("out_at >= ?");
      binds.push(start.toISOString());
    }
  }
  if (f.to) {
    const end = wallToDate(`${f.to}T00:00`);
    if (end) {
      clauses.push("out_at < ?");
      binds.push(new Date(end.getTime() + 864e5).toISOString());
    }
  }
  if (f.plate) {
    clauses.push("plate_number = ?");
    binds.push(f.plate);
  }
  if (f.status === "open") clauses.push("in_at IS NULL");
  if (f.status === "closed") clauses.push("in_at IS NOT NULL");
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", binds };
}

async function loadTrips(env, f) {
  const { where, binds } = filterSql(f);
  const rows = (
    await env.DB.prepare(`SELECT * FROM trips ${where} ORDER BY out_at DESC`).bind(...binds).all()
  ).results;
  const out = [];
  for (const r of rows) out.push(await readTrip(env, r));
  if (!f.driver) return out;
  const q = f.driver.toLowerCase();
  return out.filter((t) => String(t.driver_name).toLowerCase().includes(q));
}

async function recordsPage(env, url, actor) {
  const f = readFilters(url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const pageSize = 100;

  const plates = (await env.DB.prepare("SELECT * FROM plates ORDER BY plate_number").all()).results;
  const all = await loadTrips(env, f);
  const total = all.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const rows = all.slice((page - 1) * pageSize, page * pageSize);

  const expired = plates.filter(
    (p) => p.active && expiryStatus(p.expiry_date).state === "expired",
  ).length;
  const soon = plates.filter(
    (p) => p.active && expiryStatus(p.expiry_date).state === "soon",
  ).length;
  const alertParts = [];
  if (expired) alertParts.push(`${expired} expired`);
  if (soon) alertParts.push(`${soon} expiring within 30 days`);

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) qs.set(k, v);

  const body = `
    <div class="tp-page-head">
      <div>
        <h2>Record of use</h2>
        <p>${total} record${total === 1 ? "" : "s"} matching${
          alertParts.length
            ? ` · <a class="tp-alert" href="${OFFICE}/plates">${alertParts.join(", ")}</a>`
            : ""
        }</p>
      </div>
      <a class="btn" href="${OFFICE}/export.csv?${qs.toString()}">Export CSV</a>
    </div>

    <form method="get" action="${OFFICE}/" class="tp-filters">
      <div><label for="from">From</label><input type="date" id="from" name="from" value="${esc(f.from)}"></div>
      <div><label for="to">To</label><input type="date" id="to" name="to" value="${esc(f.to)}"></div>
      <div><label for="plate">Plate</label>
        <select id="plate" name="plate"><option value="">All</option>
          ${plates.map((p) => `<option value="${esc(p.plate_number)}"${f.plate === p.plate_number ? " selected" : ""}>${esc(p.plate_number)}</option>`).join("")}
        </select>
      </div>
      <div><label for="driver">Driver</label><input type="text" id="driver" name="driver" value="${esc(f.driver)}" placeholder="Any"></div>
      <div><label for="status">Status</label>
        <select id="status" name="status">
          <option value=""${f.status === "" ? " selected" : ""}>All</option>
          <option value="open"${f.status === "open" ? " selected" : ""}>Still out</option>
          <option value="closed"${f.status === "closed" ? " selected" : ""}>Returned</option>
        </select>
      </div>
      <div class="tp-filter-btns">
        <button type="submit" class="btn ghost on-light">Filter</button>
        <a class="btn ghost on-light" href="${OFFICE}/">Reset</a>
      </div>
    </form>

    <div class="tp-table-scroll">
      <table class="tp-table">
        <thead><tr>
          <th>Plate</th><th>Out</th><th>In</th><th>Batch</th>
          <th>Vehicle</th><th>Destination</th><th>Driver</th><th>Signed</th><th></th>
        </tr></thead>
        <tbody>
          ${
            rows.length
              ? rows
                  .map(
                    (t) => `<tr>
              <td class="tp-plate-cell">${esc(t.plate_number)}</td>
              <td>${fmt(t.out_at)}</td>
              <td>${t.in_at ? `${fmt(t.in_at)}<div class="muted">${duration(t.out_at, t.in_at)}</div>` : pill("out", "Still out")}</td>
              <td>${esc(t.batch_number)}</td>
              <td>${esc(t.vehicle_make)}${t.vehicle_rego ? `<div class="muted">${esc(t.vehicle_rego)}</div>` : ""}</td>
              <td>${esc(t.trip_destination)}</td>
              <td>${esc(t.driver_name)}</td>
              <td class="muted">${t.signature_out ? "Out" : "–"}${t.signature_in ? " / In" : ""}</td>
              <td><a href="${OFFICE}/trips/${t.id}">View</a></td>
            </tr>`,
                  )
                  .join("")
              : `<tr><td colspan="9" class="tp-empty-cell">No records match those filters.</td></tr>`
          }
        </tbody>
      </table>
    </div>
    ${
      pages > 1
        ? `<p class="tp-pager">
            ${page > 1 ? `<a href="${OFFICE}/?${qs}&page=${page - 1}">Previous</a>` : `<span>Previous</span>`}
            <span>Page ${page} of ${pages}</span>
            ${page < pages ? `<a href="${OFFICE}/?${qs}&page=${page + 1}">Next</a>` : `<span>Next</span>`}
          </p>`
        : ""
    }`;

  return layout({
    title: "Record of use",
    heading: 'Record of <span class="grad">use</span>',
    lead: "Every trade plate trip, filterable and exportable for an audit request.",
    crumb: `<a href="/members/">Members</a> / Trade plates`,
    office: true,
    actor,
    body,
  });
}

function tripPage(t, actor) {
  const row = (label, value) => `<div><dt>${label}</dt><dd>${esc(value || "–")}</dd></div>`;
  const sigFigure = (caption, data) =>
    `<figure><figcaption>${caption}</figcaption>${
      data ? `<img src="${data}" alt="${caption}">` : `<div class="tp-nosig">Not signed</div>`
    }</figure>`;

  return layout({
    title: `Record ${t.id}`,
    heading: `Plate <span class="grad">${esc(t.plate_number)}</span> — record #${t.id}`,
    lead: `${fmt(t.out_at)} to ${t.in_at ? fmt(t.in_at) : "still out"}${t.in_at ? ` (${duration(t.out_at, t.in_at)})` : ""}`,
    crumb: `<a href="${OFFICE}/">Records</a> / #${t.id}`,
    narrow: true,
    office: true,
    actor,
    body: `
      <dl class="tp-detail">
        ${row("Date and time out", fmt(t.out_at))}
        ${row("Date and time in", t.in_at ? fmt(t.in_at) : "Not returned")}
        ${row("Batch number", t.batch_number)}
        ${row("Vehicle make", t.vehicle_make)}
        ${row("Vehicle rego / VIN", t.vehicle_rego)}
        ${row("Trip destination", t.trip_destination)}
        ${row("Purpose of use", t.purpose)}
        ${row("Driver&rsquo;s name", t.driver_name)}
        ${row("Driver&rsquo;s licence", t.driver_licence)}
        ${row("Notes", t.notes)}
      </dl>
      <div class="tp-sigs">
        ${sigFigure("Signed out by driver", t.signature_out)}
        ${sigFigure("Signed in by driver", t.signature_in)}
      </div>
      <p class="tp-provenance">
        Saved ${fmt(t.created_at)}${t.created_ip ? ` from ${esc(t.created_ip)}` : ""}.
        ${t.completed_at ? `Closed off ${fmt(t.completed_at)}${t.completed_ip ? ` from ${esc(t.completed_ip)}` : ""}.` : "Still open."}
      </p>
      <p><button type="button" class="btn ghost on-light" data-print>Print this record</button></p>`,
  });
}

async function platesPage(env, msg, actor) {
  const plates = (await env.DB.prepare("SELECT * FROM plates ORDER BY plate_number").all()).results;

  const rows = plates
    .map((p) => {
      const ex = expiryStatus(p.expiry_date);
      const tone =
        ex.state === "expired"
          ? "bad"
          : ex.state === "soon"
            ? "out"
            : ex.state === "ok"
              ? "in"
              : "off";
      return `<tr>
        <td class="tp-plate-cell">${esc(p.plate_number)}</td>
        <td>
          ${pill(tone, ex.label)}
          <form method="post" action="${OFFICE}/plates" class="tp-inline-form">
            <input type="hidden" name="action" value="expiry">
            <input type="hidden" name="id" value="${p.id}">
            <input type="date" name="expiryDate" value="${esc(p.expiry_date ?? "")}">
            <button type="submit" class="linkish">Save</button>
          </form>
        </td>
        <td class="tp-link-cell">${esc(p.qr_slug)}</td>
        <td>${p.active ? pill("in", "Active") : pill("off", "Retired")}</td>
        <td class="tp-right">
          <form method="post" action="${OFFICE}/plates" class="tp-inline-form">
            <input type="hidden" name="action" value="toggle">
            <input type="hidden" name="id" value="${p.id}">
            <input type="hidden" name="active" value="${p.active ? "0" : "1"}">
            <button type="submit" class="linkish">${p.active ? "Retire" : "Reactivate"}</button>
          </form>
        </td>
      </tr>`;
    })
    .join("");

  return layout({
    title: "Plates and QR codes",
    heading: 'Plates &amp; <span class="grad">QR codes</span>',
    lead: "Print the label sheet, cut them out and fix one to the back of each plate.",
    crumb: `<a href="${OFFICE}/">Records</a> / Plates`,
    office: true,
    actor,
    body: `
      ${msg ? banner("ok", esc(msg)) : ""}
      <div class="tp-page-head">
        <div><h2>${plates.length} plate${plates.length === 1 ? "" : "s"} on file</h2></div>
        <a class="btn" href="${OFFICE}/plates/print">Print QR label sheet</a>
      </div>
      <form method="post" action="${OFFICE}/plates" class="tp-addplate">
        <input type="hidden" name="action" value="add">
        <div><label for="plateNumber">Plate number</label><input type="text" id="plateNumber" name="plateNumber" placeholder="e.g. A3285" required></div>
        <div><label for="expiryDate">Expiry date</label><input type="date" id="expiryDate" name="expiryDate"></div>
        <div><label for="notes">Notes</label><input type="text" id="notes" name="notes" placeholder="Optional"></div>
        <button type="submit" class="btn ghost on-light">Add plate</button>
      </form>
      <div class="tp-table-scroll">
        <table class="tp-table">
          <thead><tr><th>Plate</th><th>Expiry</th><th>Scan code</th><th>Status</th><th></th></tr></thead>
          <tbody>${rows || `<tr><td colspan="5" class="tp-empty-cell">No plates yet.</td></tr>`}</tbody>
        </table>
      </div>`,
  });
}

async function settingsPage(env, msg, err, actor) {
  const custom = await readSetting(env, "driver_pin");
  const row = await env.DB.prepare("SELECT updated_at, updated_by FROM settings WHERE key = ?")
    .bind("driver_pin")
    .first();

  return layout({
    title: "Settings",
    heading: 'Trade plate <span class="grad">settings</span>',
    lead: "The driver PIN, and how to revoke phones that have it remembered.",
    crumb: `<a href="${OFFICE}/">Records</a> / Settings`,
    office: true,
    actor,
    narrow: true,
    body: `
      ${msg ? banner("ok", esc(msg)) : ""}
      ${err ? banner("bad", esc(err)) : ""}

      <div class="tp-notice" style="margin-bottom:22px">
        <b>In force now:</b> ${
          custom
            ? `a PIN set here${row?.updated_at ? ` on ${fmt(row.updated_at)}` : ""}${row?.updated_by ? ` by ${esc(row.updated_by)}` : ""}.`
            : "the PIN configured on the worker. Setting one here replaces it."
        }
        The PIN itself is encrypted before it is stored, so it is not readable from the database
        and cannot be shown back to you here — only replaced.
      </div>

      <form method="post" action="${OFFICE}/settings" class="tp-form">
        <input type="hidden" name="action" value="pin">
        ${fieldRow(
          "New driver PIN",
          `<input type="text" id="pin" name="pin" inputmode="numeric" autocomplete="off" pattern="[0-9]*" required>`,
          undefined,
          "4 to 8 digits. Drivers enter this once per phone.",
        )}
        ${fieldRow(
          "Confirm new PIN",
          `<input type="text" id="pin2" name="pin2" inputmode="numeric" autocomplete="off" pattern="[0-9]*" required>`,
        )}
        <label class="tp-check">
          <input type="checkbox" name="revoke" value="1">
          <span>Also sign out every phone that already has the old PIN remembered.
          Tick this when someone has left.</span>
        </label>
        <button type="submit" class="btn">Change PIN</button>
      </form>

      <hr class="tp-rule">

      <form method="post" action="${OFFICE}/settings" class="tp-form">
        <input type="hidden" name="action" value="revoke">
        <p class="tp-hint" style="margin:0">
          Sign out every phone without changing the PIN. Drivers will be asked for the
          current PIN again next time they scan.
        </p>
        <button type="submit" class="btn ghost on-light" style="align-self:flex-start">
          Sign out all phones
        </button>
      </form>`,
  });
}

async function handleSettingsAction(request, env, actor) {
  const form = await request.formData();
  const action = String(form.get("action") ?? "");

  if (action === "revoke") {
    const next = String(Number(await driverEpoch(env)) + 1);
    await writeSetting(env, "driver_epoch", next, actor);
    await audit(env, request, "settings.revoke_phones", `epoch=${next}`, "ok");
    return redirect(`${OFFICE}/settings?msg=${encodeURIComponent("All phones signed out. Drivers will be asked for the PIN again.")}`);
  }

  if (action === "pin") {
    const pin = String(form.get("pin") ?? "").trim();
    const pin2 = String(form.get("pin2") ?? "").trim();
    if (!/^[0-9]{4,8}$/.test(pin))
      return redirect(`${OFFICE}/settings?err=${encodeURIComponent("The PIN must be 4 to 8 digits.")}`);
    if (pin !== pin2)
      return redirect(`${OFFICE}/settings?err=${encodeURIComponent("The two PINs did not match.")}`);

    await writeSetting(env, "driver_pin", pin, actor);
    let note = "PIN changed. Tell the drivers.";
    if (String(form.get("revoke")) === "1") {
      const next = String(Number(await driverEpoch(env)) + 1);
      await writeSetting(env, "driver_epoch", next, actor);
      note = "PIN changed and every phone signed out. Tell the drivers.";
    }
    // The PIN is never written to the audit trail, only the fact of the change.
    await audit(env, request, "settings.pin_change", null, "ok");
    return redirect(`${OFFICE}/settings?msg=${encodeURIComponent(note)}`);
  }

  return redirect(`${OFFICE}/settings`);
}

async function handlePlateAction(request, env) {
  const form = await request.formData();
  const action = String(form.get("action") ?? "");
  const db = env.DB;

  if (action === "add") {
    const number = String(form.get("plateNumber") ?? "").trim().toUpperCase();
    const expiry = String(form.get("expiryDate") ?? "").trim();
    if (!number) return redirect(`${OFFICE}/plates?msg=Plate+number+is+required`);
    if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry))
      return redirect(`${OFFICE}/plates?msg=Enter+a+valid+expiry+date`);
    if (await db.prepare("SELECT id FROM plates WHERE plate_number = ?").bind(number).first())
      return redirect(`${OFFICE}/plates?msg=${encodeURIComponent(`${number} is already on file`)}`);

    await db
      .prepare("INSERT INTO plates (plate_number, qr_slug, expiry_date, notes) VALUES (?,?,?,?)")
      .bind(number, slugId(), expiry || null, String(form.get("notes") ?? "").trim() || null)
      .run();
    await audit(env, request, "plate.add", number, "ok");
    return redirect(
      `${OFFICE}/plates?msg=${encodeURIComponent(`${number} added. Reprint the label sheet.`)}`,
    );
  }

  const id = Number(form.get("id"));
  if (!Number.isInteger(id)) return redirect(`${OFFICE}/plates`);

  if (action === "expiry") {
    const value = String(form.get("expiryDate") ?? "").trim();
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value))
      return redirect(`${OFFICE}/plates?msg=Enter+a+valid+expiry+date`);
    await db.prepare("UPDATE plates SET expiry_date = ? WHERE id = ?").bind(value || null, id).run();
    await audit(env, request, "plate.expiry", `#${id}=${value || "cleared"}`, "ok");
    return redirect(`${OFFICE}/plates?msg=Expiry+updated`);
  }

  if (action === "toggle") {
    const active = String(form.get("active")) === "1" ? 1 : 0;
    if (!active && (await getOpenTripRow(db, id)))
      return redirect(
        `${OFFICE}/plates?msg=${encodeURIComponent("That plate is out. Book it back in before retiring it.")}`,
      );
    await db.prepare("UPDATE plates SET active = ? WHERE id = ?").bind(active, id).run();
    await audit(env, request, "plate.active", `#${id}=${active}`, "ok");
    return redirect(`${OFFICE}/plates?msg=Plate+updated`);
  }

  return redirect(`${OFFICE}/plates`);
}

async function labelSheetPage(env, url, actor) {
  const plates = (
    await env.DB.prepare("SELECT * FROM plates WHERE active = 1 ORDER BY plate_number").all()
  ).results;

  const cards = plates
    .map(
      (p) => `<div class="tp-label">
        <div class="tp-label-num">${esc(p.plate_number)}</div>
        <div class="tp-qr" data-qr="${esc(`${url.origin}${DRIVER}/p/${p.qr_slug}`)}"></div>
        <div class="tp-label-cta">Scan before every trip</div>
        <div class="tp-label-url">${esc(`${url.host}${DRIVER}/p/${p.qr_slug}`)}</div>
      </div>`,
    )
    .join("");

  return layout({
    title: "QR labels",
    heading: 'QR <span class="grad">labels</span>',
    lead: "Print on adhesive label stock, laminate, then fix to the back of the matching plate.",
    crumb: `<a href="${OFFICE}/plates">Plates</a> / Labels`,
    office: true,
    actor,
    body: `<p class="no-print"><button type="button" class="btn" data-print>Print</button></p>
      ${plates.length ? `<div class="tp-sheet">${cards}</div>` : `<p class="tp-empty">No active plates to print.</p>`}
      <script src="${ASSET}/qrcode.min.js" defer></script>`,
  });
}

async function exportCsv(env, url) {
  const rows = await loadTrips(env, readFilters(url));
  const headers = [
    "Record ID", "Plate number", "Date and time out", "Date and time in", "Duration",
    "Batch number", "Vehicle make", "Vehicle rego / VIN", "Trip destination",
    "Purpose of use", "Driver name", "Driver licence", "Signed out", "Signed in",
    "Notes", "Entry created", "Entry closed",
  ];
  const cell = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(cell).join(",")];
  for (const t of rows) {
    lines.push(
      [
        t.id, t.plate_number, fmt(t.out_at), t.in_at ? fmt(t.in_at) : "STILL OUT",
        t.in_at ? duration(t.out_at, t.in_at) : "", t.batch_number, t.vehicle_make,
        t.vehicle_rego ?? "", t.trip_destination, t.purpose ?? "", t.driver_name,
        t.driver_licence ?? "", t.signature_out ? "Yes" : "No", t.signature_in ? "Yes" : "No",
        t.notes ?? "", fmt(t.created_at), t.completed_at ? fmt(t.completed_at) : "",
      ].map(cell).join(","),
    );
  }
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="trade-plate-record-of-use-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}

async function officeRoutes(request, env, url, rest) {
  const authed = await officeAuthed(request, env);
  const actor = accessEmail(request);

  if (rest[0] === "login") {
    // Only reachable while Cloudflare Access is not yet in front of /members.
    if (behindAccess(request)) return redirect(`${OFFICE}/`);
    if (request.method === "POST") {
      const ip = request.headers.get("cf-connecting-ip") || "";
      const gate = await rateLimitCheck(env, "office", ip, 5, 30);
      if (!gate.ok) {
        await audit(env, request, "office.login", null, `rate-limited:${gate.scope}`);
        return html(tooManyPage("Too many sign-in attempts. Wait fifteen minutes."), 429, {
          "retry-after": "900",
        });
      }
      const form = await request.formData();
      if (!env.ADMIN_PASSWORD || !safeEqual(String(form.get("password") ?? ""), env.ADMIN_PASSWORD)) {
        await rateLimitFailure(env, "office", ip, 900);
        await audit(env, request, "office.login", null, "wrong-password");
        return html(loginPage(true), 401);
      }
      await rateLimitReset(env, "office", ip);
      await audit(env, request, "office.login", null, "ok");
      return redirect(`${OFFICE}/`, {
        "set-cookie": await sessionCookie(env.SESSION_SECRET, OFFICE_COOKIE, OFFICE, OFFICE_MAX_AGE),
      });
    }
    if (authed) return redirect(`${OFFICE}/`);
    return html(loginPage(false));
  }

  if (rest[0] === "logout")
    return redirect(`${OFFICE}/login`, { "set-cookie": clearCookie(OFFICE_COOKIE, OFFICE) });

  if (!authed) return redirect(`${OFFICE}/login`);

  if (rest[0] === "plates") {
    if (rest[1] === "print") return html(await labelSheetPage(env, url, actor));
    if (request.method === "POST") return handlePlateAction(request, env);
    return html(await platesPage(env, url.searchParams.get("msg"), actor));
  }

  if (rest[0] === "settings") {
    if (request.method === "POST") return handleSettingsAction(request, env, actor);
    return html(
      await settingsPage(env, url.searchParams.get("msg"), url.searchParams.get("err"), actor),
    );
  }

  if (rest[0] === "export.csv") {
    await audit(env, request, "records.export", url.search || "(no filter)", "ok");
    return exportCsv(env, url);
  }

  if (rest[0] === "trips" && rest[1]) {
    const row = await env.DB.prepare("SELECT * FROM trips WHERE id = ?").bind(Number(rest[1])).first();
    if (!row) return html(notFoundPage(), 404);
    await audit(env, request, "record.view", `#${rest[1]}`, "ok");
    return html(tripPage(await readTrip(env, row), actor));
  }

  return html(await recordsPage(env, url, actor));
}

/* =========================================================================
   entry point
   ========================================================================= */

const notConfigured = (what) =>
  html(
    `<h1>Not configured</h1><p><code>${esc(what)}</code> is not set on this Pages project, so the trade plate record cannot run.</p>`,
    503,
  );

/**
 * Returns a Response for a trade plate URL, or null when the path is not ours.
 * The caller applies the site's security headers.
 */
export async function handleTradeplate(request, env, url) {
  const p = url.pathname;
  const isDriver = p === DRIVER || p.startsWith(`${DRIVER}/`);
  const isOffice = p === OFFICE || p.startsWith(`${OFFICE}/`);
  if (!isDriver && !isOffice) return null;

  if (!env.DB) return notConfigured("DB");
  if (!env.SESSION_SECRET) return notConfigured("SESSION_SECRET");
  if (!env.DATA_KEY) return notConfigured("DATA_KEY");

  // Second layer behind SameSite=Lax cookies: refuse a cross-site write.
  if (request.method !== "GET" && request.method !== "HEAD" && !sameOrigin(request, url)) {
    await audit(env, request, "csrf.block", p, "rejected");
    return html("<h1>Request refused</h1><p>That request did not come from this site.</p>", 403);
  }

  const base = isDriver ? DRIVER : OFFICE;
  const segments = p.slice(base.length).split("/").filter(Boolean);

  try {
    return isDriver
      ? await driverRoutes(request, env, url, segments)
      : await officeRoutes(request, env, url, segments);
  } catch (err) {
    console.error("tradeplate error:", err && err.message);
    return html("<h1>Something went wrong</h1><p>Try again, or tell the office.</p>", 500);
  }
}
