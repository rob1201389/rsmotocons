/**
 * Trade plate record of use.
 *
 * One Cloudflare Pages Function serving everything under
 * /members/tradeplate, backed by a D1 database. Pages routes every request
 * under that path here; `params.path` holds the segments after it.
 *
 * Pages are rendered server-side using the site's own stylesheet, so the app
 * looks like the rest of rsmotocons.com. The site's CSP forbids inline
 * scripts, so all behaviour lives in /members/tradeplate/app.js.
 */

const BASE = "/members/tradeplate";
const TZ = "Australia/Sydney";

/** Served by Pages from members/tradeplate/, not by this Function. */
const STATIC_FILES = new Set(["app.js", "tradeplate.css", "qrcode.min.js"]);

/* ------------------------------------------------------------------ types */

interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: { changes?: number; last_row_id?: number };
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface Env {
  DB: D1Database;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
  DRIVER_PIN?: string;
  ORG_NAME?: string;
  PRIVACY_CONTACT?: string;
  PRIVACY_CONTACT_EMAIL?: string;
  PRIVACY_CONTACT_PHONE?: string;
  RETENTION_YEARS?: string;
}

interface Ctx {
  request: Request;
  env: Env;
  params: { path?: string[] };
  /** Hands the request on to the Pages static asset server. */
  next: () => Promise<Response>;
}

type Plate = {
  id: number;
  plate_number: string;
  qr_slug: string;
  expiry_date: string | null;
  active: number;
  notes: string | null;
};

type Trip = {
  id: number;
  plate_id: number;
  plate_number: string;
  batch_number: string;
  vehicle_make: string;
  vehicle_rego: string | null;
  trip_destination: string;
  purpose: string | null;
  driver_name: string;
  driver_licence: string | null;
  out_at: string;
  in_at: string | null;
  signature_out: string | null;
  signature_in: string | null;
  notes: string | null;
  created_at: string;
  created_ip: string | null;
  created_ua: string | null;
  completed_at: string | null;
  completed_ip: string | null;
  completed_ua: string | null;
};

/* -------------------------------------------------------------- utilities */

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
      c
    ] as string,
  );
}

function html(body: string, status = 200, headers: HeadersInit = {}): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
  });
}

function redirect(to: string, headers: HeadersInit = {}): Response {
  return new Response(null, { status: 303, headers: { location: to, ...headers } });
}

function slugId(): string {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

/* ------------------------------------------------------------------- time */

function zonedParts(date: Date) {
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
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
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
function offsetMs(date: Date): number {
  const p = zonedParts(date);
  return (
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) -
    date.getTime()
  );
}

/** "2026-09-18T07:45" read as NSW wall time -> a UTC instant. */
function wallToDate(wall: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(wall.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  // Two passes so the hour either side of a daylight saving change resolves.
  let result = naive - offsetMs(new Date(naive));
  result = naive - offsetMs(new Date(result));
  const out = new Date(result);
  return Number.isNaN(out.getTime()) ? null : out;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** For prefilling datetime-local inputs. */
function dateToWall(date: Date): string {
  const p = zonedParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

function fmt(iso: string | null | undefined): string {
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

function duration(fromIso: string, toIso: string): string {
  const mins = Math.max(
    0,
    Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60000),
  );
  const h = Math.floor(mins / 60);
  return h === 0 ? `${mins}m` : `${h}h ${mins % 60}m`;
}

function todayNsw(): string {
  return dateToWall(new Date()).slice(0, 10);
}

type ExpiryState = "none" | "ok" | "soon" | "expired";

/**
 * Driving on an expired trade plate is the failure this guards against, so an
 * expired plate is blocked outright rather than merely flagged.
 */
function expiryStatus(expiry: string | null): {
  state: ExpiryState;
  days: number | null;
  label: string;
} {
  if (!expiry) return { state: "none", days: null, label: "Not set" };
  const days = Math.round(
    (Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${todayNsw()}T00:00:00Z`)) /
      86400000,
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

const ADMIN_COOKIE = "tp_admin";
const DRIVER_COOKIE = "tp_driver";
const ADMIN_MAX_AGE = 60 * 60 * 12;
const DRIVER_MAX_AGE = 60 * 60 * 24 * 60;

async function sign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return btoa(String.fromCharCode(...new Uint8Array(mac)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

async function sessionCookie(
  secret: string,
  name: string,
  maxAge: number,
): Promise<string> {
  const expires = Date.now() + maxAge * 1000;
  const payload = String(expires);
  const value = `${payload}.${await sign(secret, payload)}`;
  return `${name}=${value}; Path=${BASE}; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearCookie(name: string): string {
  return `${name}=; Path=${BASE}; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

async function validSession(
  request: Request,
  secret: string,
  name: string,
): Promise<boolean> {
  const raw = readCookie(request, name);
  if (!raw) return false;
  const [payload, mac] = raw.split(".");
  if (!payload || !mac) return false;
  if (!safeEqual(mac, await sign(secret, payload))) return false;
  return Number(payload) > Date.now();
}

/* ------------------------------------------------------------------ chrome */

type LayoutOpts = {
  title: string;
  heading: string;
  lead?: string;
  crumb: string;
  body: string;
  narrow?: boolean;
  authed?: boolean;
};

function layout(o: LayoutOpts): string {
  return `<!DOCTYPE html>
<html lang="en-AU">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(o.title)} — RSMotoCons</title>
<meta name="robots" content="noindex, nofollow">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="stylesheet" href="/site.css">
<link rel="stylesheet" href="${BASE}/tradeplate.css">
<script src="/app.js" defer></script>
<script src="${BASE}/app.js" defer></script>
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
    <nav class="links">
      <a href="/#tools">Tools</a>
      <a href="/platform.html">Platform</a>
      <a href="/members/" class="active">Members</a>
      ${
        o.authed
          ? `<a href="${BASE}/admin">Records</a>
      <a href="${BASE}/admin/plates">Plates</a>
      <form method="post" action="${BASE}/admin/logout" class="inline-form">
        <button type="submit" class="linkish">Sign out</button>
      </form>`
          : `<a href="${BASE}/">Trade plates</a>`
      }
    </nav>
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
    <div class="wrap${o.narrow ? " tp-narrow" : ""}">
      ${o.body}
    </div>
  </section>
</main>
<footer>
  <div class="tricolore-bar" aria-hidden="true"></div>
  <div class="wrap">
    <div class="fbot">
      <p><span class="flag" aria-hidden="true"></span>© 2026 RSMotoCons · Trade plate record of use</p>
      <p><a href="${BASE}/privacy">Privacy notice</a></p>
    </div>
  </div>
</footer>
</body>
</html>`;
}

function banner(tone: "ok" | "warn" | "bad", text: string): string {
  return `<div class="tp-banner ${tone}">${text}</div>`;
}

function pill(tone: string, text: string): string {
  return `<span class="tp-pill ${tone}">${esc(text)}</span>`;
}

/* ------------------------------------------------------------------ forms */

type Errors = Record<string, string>;

function fieldRow(
  label: string,
  control: string,
  error?: string,
  hint?: string,
): string {
  return `<div class="tp-field">
    <label>${label}</label>
    ${control}
    ${
      error
        ? `<p class="tp-err">${esc(error)}</p>`
        : hint
          ? `<p class="tp-hint">${hint}</p>`
          : ""
    }
  </div>`;
}

function textInput(
  name: string,
  value = "",
  placeholder = "",
  extra = "",
): string {
  return `<input type="text" id="${name}" name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" ${extra}>`;
}

function dateTimeInput(name: string, value: string): string {
  return `<div class="tp-now-row">
    <input type="datetime-local" id="${name}" name="${name}" value="${esc(value)}" required>
    <button type="button" class="tp-now" data-now-for="${name}">Now</button>
  </div>`;
}

function signatureBlock(name: string, hint: string, error?: string): string {
  return `<div class="tp-sig">
    <div class="tp-sig-head">
      <label>Driver&rsquo;s signature</label>
      <button type="button" class="linkish" data-clear-sig="${name}">Clear</button>
    </div>
    <canvas class="tp-canvas" data-sig="${name}" aria-label="Signature pad"></canvas>
    <p class="${error ? "tp-err" : "tp-hint"}" data-sig-hint="${name}">${esc(error || hint)}</p>
    <input type="hidden" name="${name}" data-sig-input="${name}">
    <noscript><p class="tp-err">Signing needs JavaScript. Use a different phone or record this trip on paper.</p></noscript>
  </div>`;
}

function collectionNotice(env: Env): string {
  const org = env.ORG_NAME || "RSMotoCons";
  const years = Number(env.RETENTION_YEARS || 5);
  return `<div class="tp-notice">
    <b>Privacy</b> — your name, signature, licence number and trip details are
    collected by ${esc(org)} to keep the record of use required for this trade
    plate. They may be produced to Transport for NSW, the NSW Police Force or an
    insurer on request, are held in Australia, and are deleted after ${years}
    year${years === 1 ? "" : "s"}.
    <a href="${BASE}/privacy">Full privacy notice</a>.
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

/* ------------------------------------------------------------------ pages */

function driverPinPage(next: string, wrong: boolean): string {
  return layout({
    title: "Access PIN",
    heading: "Trade <span class=\"grad\">plates</span>",
    lead: "Enter the access PIN to record a plate's use.",
    crumb: `<a href="/members/">Members</a> / Trade plates`,
    narrow: true,
    body: `
      ${wrong ? banner("bad", "Wrong PIN.") : ""}
      <form method="post" action="${BASE}/unlock" class="tp-form">
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
}

function boardPage(
  plates: Plate[],
  openByPlate: Map<number, Trip>,
): string {
  const rows = plates
    .map((p) => {
      const open = openByPlate.get(p.id);
      const ex = expiryStatus(p.expiry_date);
      const status =
        ex.state === "expired"
          ? pill("bad", "Expired")
          : open
            ? pill("out", "Out")
            : pill("in", "Available");
      const sub = open
        ? `${esc(open.driver_name)} to ${esc(open.trip_destination)}, since ${fmt(open.out_at)}`
        : "In the office";
      const warn =
        ex.state === "expired"
          ? `<div class="tp-row-warn bad">${esc(ex.label)}</div>`
          : ex.state === "soon"
            ? `<div class="tp-row-warn warn">${esc(ex.label)}</div>`
            : "";
      return `<a class="tp-plate-row" href="${BASE}/p/${esc(p.qr_slug)}">
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
    heading: "Trade <span class=\"grad\">plates</span>",
    lead: "Scan the QR code on the back of a plate, or pick it from the list.",
    crumb: `<a href="/members/">Members</a> / Trade plates`,
    narrow: true,
    body: `
      ${plates.length ? `<div class="tp-plate-list">${rows}</div>` : `<p class="tp-empty">No plates on file yet.</p>`}
      <p class="tp-footlinks">
        <a href="${BASE}/new">Manual entry</a> ·
        <a href="${BASE}/privacy">Privacy notice</a> ·
        <a href="${BASE}/admin">Office login</a>
      </p>`,
  });
}

function outFormBody(
  env: Env,
  opts: {
    action: string;
    plateSelect?: string;
    defaultOutAt: string;
    values: Record<string, string>;
    errors: Errors;
  },
): string {
  const v = opts.values;
  const e = opts.errors;
  const purposeOptions = PURPOSES.map(
    (p) =>
      `<option${v.purpose === p ? " selected" : ""}>${esc(p)}</option>`,
  ).join("");

  return `<form method="post" action="${esc(opts.action)}" class="tp-form">
    ${opts.plateSelect ?? ""}
    ${fieldRow("Date and time out", dateTimeInput("outAt", v.outAt || opts.defaultOutAt), e.outAt)}
    ${fieldRow("Batch number", textInput("batchNumber", v.batchNumber, "e.g. B-2261"), e.batchNumber, v.batchHint)}
    ${fieldRow("Vehicle make", textInput("vehicleMake", v.vehicleMake, "e.g. Toyota Hilux SR5"), e.vehicleMake)}
    ${fieldRow("Vehicle rego or VIN", textInput("vehicleRego", v.vehicleRego, "Optional"), e.vehicleRego, "Optional, but worth recording")}
    ${fieldRow("Trip destination", textInput("tripDestination", v.tripDestination, "e.g. Penrith then Blacktown"), e.tripDestination)}
    ${fieldRow(
      "Purpose of use",
      `<select id="purpose" name="purpose"><option value="">Select a purpose</option>${purposeOptions}</select>`,
      e.purpose,
    )}
    ${fieldRow("Driver&rsquo;s name", textInput("driverName", v.driverName, "Full name"), e.driverName)}
    ${fieldRow("Driver&rsquo;s licence number", textInput("driverLicence", v.driverLicence, "Optional"), e.driverLicence, "Optional")}
    ${collectionNotice(env)}
    ${signatureBlock("signatureOut", "Sign to confirm you have taken the plate", e.signatureOut)}
    <button type="submit" class="btn">Sign plate out</button>
  </form>`;
}

function inFormBody(
  env: Env,
  trip: Trip,
  defaultInAt: string,
  values: Record<string, string>,
  errors: Errors,
): string {
  return `<dl class="tp-summary">
      <div><dt>Out</dt><dd>${fmt(trip.out_at)}</dd></div>
      <div><dt>Batch</dt><dd>${esc(trip.batch_number)}</dd></div>
      <div><dt>Vehicle</dt><dd>${esc(trip.vehicle_make)}</dd></div>
      <div><dt>Rego / VIN</dt><dd>${esc(trip.vehicle_rego || "–")}</dd></div>
      <div class="wide"><dt>Destination</dt><dd>${esc(trip.trip_destination)}</dd></div>
      <div class="wide"><dt>Driver</dt><dd>${esc(trip.driver_name)}</dd></div>
    </dl>
    <form method="post" action="${BASE}/p/${esc(values.slug)}" class="tp-form">
      <input type="hidden" name="action" value="in">
      <input type="hidden" name="tripId" value="${trip.id}">
      ${fieldRow("Date and time in", dateTimeInput("inAt", values.inAt || defaultInAt), errors.inAt)}
      ${fieldRow("Notes", `<textarea id="notes" name="notes" rows="3" placeholder="Damage, delays, fuel">${esc(values.notes || "")}</textarea>`, undefined, "Optional")}
      ${collectionNotice(env)}
      ${signatureBlock("signatureIn", "Sign to confirm the plate has been returned", errors.signatureIn)}
      <button type="submit" class="btn">Book plate back in</button>
    </form>`;
}

function historyBlock(recent: Trip[]): string {
  if (!recent.length) return "";
  const items = recent
    .map(
      (t) => `<li>
        <div class="who">${esc(t.driver_name)}</div>
        <div>${esc(t.trip_destination)}</div>
        <div class="when">${fmt(t.out_at)} to ${fmt(t.in_at)} (${duration(t.out_at, t.in_at as string)})</div>
      </li>`,
    )
    .join("");
  return `<div class="tp-history">
    <h3>Last ${recent.length} trips on this plate</h3>
    <ul>${items}</ul>
  </div>`;
}

/* ---------------------------------------------------------------- queries */

async function getPlateBySlug(db: D1Database, slug: string) {
  return db
    .prepare("SELECT * FROM plates WHERE qr_slug = ?")
    .bind(slug)
    .first<Plate>();
}

async function getOpenTrip(db: D1Database, plateId: number) {
  return db
    .prepare(
      "SELECT * FROM trips WHERE plate_id = ? AND in_at IS NULL ORDER BY out_at DESC LIMIT 1",
    )
    .bind(plateId)
    .first<Trip>();
}

function requestMeta(request: Request) {
  return {
    ip:
      request.headers.get("cf-connecting-ip") ||
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      null,
    ua: request.headers.get("user-agent")?.slice(0, 300) ?? null,
  };
}

function validSignature(value: string): string | null {
  if (!value) return null;
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value)) return null;
  if (value.length > 1_500_000) return null;
  return value;
}

/* ----------------------------------------------------------------- router */

export const onRequest = async (context: Ctx): Promise<Response> => {
  const { request, env } = context;
  const segments = context.params.path ?? [];
  const path = segments.join("/");
  const url = new URL(request.url);

  // This Function is a catch-all for /members/tradeplate/*, which includes the
  // app's own stylesheet and scripts. Those are static files - hand them back
  // to Pages, or the page loads with no signature pad.
  if (STATIC_FILES.has(path)) return context.next();

  if (!env.SESSION_SECRET || !env.ADMIN_PASSWORD) {
    return html(
      "<h1>Not configured</h1><p>SESSION_SECRET and ADMIN_PASSWORD must be set on the Pages project.</p>",
      500,
    );
  }

  try {
    if (path.startsWith("admin")) return await adminRoutes(context, segments, url);
    return await driverRoutes(context, segments, path, url);
  } catch (err) {
    return html(
      `<h1>Something went wrong</h1><p>${esc((err as Error).message)}</p>`,
      500,
    );
  }
};

/* ------------------------------------------------------------ driver side */

async function driverRoutes(
  { request, env }: Ctx,
  segments: string[],
  path: string,
  url: URL,
): Promise<Response> {
  const db = env.DB;
  const pinRequired = Boolean(env.DRIVER_PIN);
  const unlocked =
    !pinRequired || (await validSession(request, env.SESSION_SECRET, DRIVER_COOKIE));

  if (path === "privacy") return html(privacyPage(env));

  if (path === "unlock" && request.method === "POST") {
    const form = await request.formData();
    const pin = String(form.get("pin") ?? "");
    const next = String(form.get("next") ?? `${BASE}/`);
    const safeNext = /^\/members\/tradeplate(\/[A-Za-z0-9/_-]*)?$/.test(next)
      ? next
      : `${BASE}/`;
    if (!safeEqual(pin, env.DRIVER_PIN ?? "")) {
      return html(driverPinPage(safeNext, true), 401);
    }
    return redirect(safeNext, {
      "set-cookie": await sessionCookie(
        env.SESSION_SECRET,
        DRIVER_COOKIE,
        DRIVER_MAX_AGE,
      ),
    });
  }

  if (!unlocked) {
    return html(driverPinPage(`${BASE}/${path}`, false));
  }

  /* ---- manual entry ---- */
  if (path === "new") {
    if (request.method === "POST") return await handleSignOut(request, env, null);
    return html(await manualEntryPage(env, {}, {}));
  }

  /* ---- a specific plate ---- */
  if (segments[0] === "p" && segments[1]) {
    const plate = await getPlateBySlug(db, segments[1]);
    if (!plate) return html(notFoundPage(), 404);

    if (request.method === "POST") {
      const form = await request.formData();
      if (String(form.get("action")) === "in")
        return await handleBookIn(request, env, plate, form);
      return await handleSignOut(request, env, plate, form);
    }
    return html(await platePage(env, plate, url.searchParams.get("saved"), {}, {}));
  }

  /* ---- the board ---- */
  if (path === "" || path === "/") {
    const plates = (
      await db
        .prepare("SELECT * FROM plates WHERE active = 1 ORDER BY plate_number")
        .all<Plate>()
    ).results;
    const open = (
      await db.prepare("SELECT * FROM trips WHERE in_at IS NULL").all<Trip>()
    ).results;
    return html(boardPage(plates, new Map(open.map((t) => [t.plate_id, t]))));
  }

  return html(notFoundPage(), 404);
}

async function platePage(
  env: Env,
  plate: Plate,
  saved: string | null,
  values: Record<string, string>,
  errors: Errors,
): Promise<string> {
  const db = env.DB;
  const open = await getOpenTrip(db, plate.id);
  const ex = expiryStatus(plate.expiry_date);
  const blocked = !open && ex.state === "expired";

  const recent = (
    await db
      .prepare(
        "SELECT * FROM trips WHERE plate_id = ? AND in_at IS NOT NULL ORDER BY out_at DESC LIMIT 5",
      )
      .bind(plate.id)
      .all<Trip>()
  ).results;

  const last = await db
    .prepare("SELECT batch_number FROM trips WHERE plate_id = ? ORDER BY out_at DESC LIMIT 1")
    .bind(plate.id)
    .first<{ batch_number: string }>();

  const now = new Date();
  let body = "";

  if (saved === "out")
    body += banner("ok", "Signed out. Scan this plate again when it comes back.");
  if (saved === "in") body += banner("ok", "Booked back in. Record closed off.");
  if (errors.form) body += banner("bad", esc(errors.form));
  if (!blocked && ex.state === "soon")
    body += banner("warn", `${esc(ex.label)}. Tell the office.`);

  if (open) {
    body += inFormBody(env, open, dateToWall(now), { ...values, slug: plate.qr_slug }, errors);
  } else if (!plate.active) {
    body += `<p class="tp-empty">Speak to the office — this plate has been taken out of service.</p>`;
  } else if (blocked) {
    body += `<div class="tp-banner bad"><b>${esc(ex.label)}.</b><br>
      This plate cannot be signed out. Take a different plate and tell the office.</div>`;
  } else {
    body += outFormBody(env, {
      action: `${BASE}/p/${plate.qr_slug}`,
      defaultOutAt: dateToWall(now),
      values: {
        batchNumber: last?.batch_number ?? "",
        batchHint: last ? "Carried forward from this plate's last trip" : "",
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
    crumb: `<a href="/members/">Members</a> / <a href="${BASE}/">Trade plates</a> / ${esc(plate.plate_number)}`,
    narrow: true,
    body,
  });
}

async function manualEntryPage(
  env: Env,
  values: Record<string, string>,
  errors: Errors,
): Promise<string> {
  const plates = (
    await env.DB.prepare(
      `SELECT p.* FROM plates p
       WHERE p.active = 1
         AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.plate_id = p.id AND t.in_at IS NULL)
       ORDER BY p.plate_number`,
    ).all<Plate>()
  ).results.filter((p) => expiryStatus(p.expiry_date).state !== "expired");

  const options = plates
    .map(
      (p) =>
        `<option value="${esc(p.plate_number)}"${values.plateNumber === p.plate_number ? " selected" : ""}>${esc(p.plate_number)}</option>`,
    )
    .join("");

  const body = plates.length
    ? (errors.form ? banner("bad", esc(errors.form)) : "") +
      outFormBody(env, {
        action: `${BASE}/new`,
        plateSelect: fieldRow(
          "Plate number",
          `<select id="plateNumber" name="plateNumber" required>
             <option value="">Select a plate</option>${options}
           </select>`,
          errors.plateNumber,
        ),
        defaultOutAt: dateToWall(new Date()),
        values,
        errors,
      })
    : `<p class="tp-empty">No plate is available — they are all signed out or expired.
       <a href="${BASE}/">View plates</a>.</p>`;

  return layout({
    title: "Sign a plate out",
    heading: "Sign a plate <span class=\"grad\">out</span>",
    lead: "Manual entry — for when a label is damaged.",
    crumb: `<a href="/members/">Members</a> / <a href="${BASE}/">Trade plates</a> / Manual entry`,
    narrow: true,
    body,
  });
}

async function handleSignOut(
  request: Request,
  env: Env,
  plate: Plate | null,
  preread?: FormData,
): Promise<Response> {
  const form = preread ?? (await request.formData());
  const get = (k: string) => String(form.get(k) ?? "").trim();
  const errors: Errors = {};

  let target = plate;
  if (!target) {
    const number = get("plateNumber");
    target = await env.DB.prepare("SELECT * FROM plates WHERE plate_number = ?")
      .bind(number)
      .first<Plate>();
    if (!target) errors.plateNumber = "Choose a plate";
  }

  const values: Record<string, string> = {
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
    target && plate
      ? html(await platePage(env, target, null, values, errors), 400)
      : html(await manualEntryPage(env, values, errors), 400);

  if (!target) return await rerender();

  if (!target.active) {
    errors.form = `Plate ${target.plate_number} is retired.`;
    return await rerender();
  }
  if (expiryStatus(target.expiry_date).state === "expired") {
    errors.form = `Plate ${target.plate_number} has expired and cannot be signed out.`;
    return await rerender();
  }
  if (await getOpenTrip(env.DB, target.id)) {
    errors.form = `Plate ${target.plate_number} is already signed out. Scan it again to book it back in.`;
    return await rerender();
  }

  const outAt = wallToDate(values.outAt);
  if (!outAt) errors.outAt = "Enter a valid date and time";
  if (!values.batchNumber) errors.batchNumber = "Batch number is required";
  if (!values.vehicleMake) errors.vehicleMake = "Vehicle make is required";
  if (!values.tripDestination)
    errors.tripDestination = "Trip destination is required";
  if (!values.driverName) errors.driverName = "Driver's name is required";

  const signature = validSignature(String(form.get("signatureOut") ?? ""));
  if (!signature) errors.signatureOut = "Signature is required";

  if (Object.keys(errors).length) {
    errors.form = "Check the highlighted fields.";
    return await rerender();
  }

  const meta = requestMeta(request);
  try {
    await env.DB.prepare(
      `INSERT INTO trips
        (plate_id, plate_number, batch_number, vehicle_make, vehicle_rego,
         trip_destination, purpose, driver_name, driver_licence, out_at,
         signature_out, created_at, created_ip, created_ua)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
      .bind(
        target.id,
        target.plate_number,
        values.batchNumber,
        values.vehicleMake,
        values.vehicleRego.toUpperCase() || null,
        values.tripDestination,
        values.purpose || null,
        values.driverName,
        values.driverLicence || null,
        (outAt as Date).toISOString(),
        signature,
        new Date().toISOString(),
        meta.ip,
        meta.ua,
      )
      .run();
  } catch (err) {
    // The partial unique index catches two phones submitting at the same moment.
    errors.form = `Plate ${target.plate_number} was just signed out by someone else. Reload this page.`;
    return await rerender();
  }

  return redirect(`${BASE}/p/${target.qr_slug}?saved=out`);
}

async function handleBookIn(
  request: Request,
  env: Env,
  plate: Plate,
  form: FormData,
): Promise<Response> {
  const errors: Errors = {};
  const tripId = Number(form.get("tripId"));
  const trip = await env.DB.prepare("SELECT * FROM trips WHERE id = ?")
    .bind(tripId)
    .first<Trip>();

  if (!trip || trip.in_at) {
    return html(
      await platePage(env, plate, null, {}, { form: "That record is already closed off." }),
      400,
    );
  }

  const values: Record<string, string> = {
    inAt: String(form.get("inAt") ?? "").trim(),
    notes: String(form.get("notes") ?? "").trim(),
  };

  const inAt = wallToDate(values.inAt);
  if (!inAt) errors.inAt = "Enter a valid date and time";
  else if (inAt.getTime() < Date.parse(trip.out_at))
    errors.inAt = "Time in cannot be before time out";

  const signature = validSignature(String(form.get("signatureIn") ?? ""));
  if (!signature) errors.signatureIn = "Signature is required";

  if (Object.keys(errors).length) {
    errors.form = "Check the highlighted fields.";
    return html(await platePage(env, plate, null, values, errors), 400);
  }

  const meta = requestMeta(request);
  const notes = values.notes
    ? [trip.notes, values.notes].filter(Boolean).join(" | ")
    : trip.notes;

  await env.DB.prepare(
    `UPDATE trips
        SET in_at = ?, signature_in = ?, notes = ?,
            completed_at = ?, completed_ip = ?, completed_ua = ?
      WHERE id = ? AND in_at IS NULL`,
  )
    .bind(
      (inAt as Date).toISOString(),
      signature,
      notes,
      new Date().toISOString(),
      meta.ip,
      meta.ua,
      tripId,
    )
    .run();

  return redirect(`${BASE}/p/${plate.qr_slug}?saved=in`);
}

function notFoundPage(): string {
  return layout({
    title: "Plate not recognised",
    heading: "Plate not <span class=\"grad\">recognised</span>",
    lead: "That QR code is not on file.",
    crumb: `<a href="/members/">Members</a> / Trade plates`,
    narrow: true,
    body: `<p class="tp-empty">Check the label is the right one, or pick the plate from the list.</p>
      <p><a class="btn" href="${BASE}/">View plates</a></p>`,
  });
}

function privacyPage(env: Env): string {
  const org = env.ORG_NAME || "RSMotoCons";
  const years = Number(env.RETENTION_YEARS || 5);
  const contact = env.PRIVACY_CONTACT || "the Privacy Officer";
  const email = env.PRIVACY_CONTACT_EMAIL || "info@rsmotocons.com";
  const phone = env.PRIVACY_CONTACT_PHONE || "";

  const sec = (h: string, p: string) =>
    `<section class="tp-prose"><h2>${h}</h2>${p}</section>`;

  return layout({
    title: "Privacy notice",
    heading: "Privacy <span class=\"grad\">notice</span>",
    lead: `How ${esc(org)} handles the personal information collected by the trade plate record.`,
    crumb: `<a href="/members/">Members</a> / <a href="${BASE}/">Trade plates</a> / Privacy`,
    narrow: true,
    body: `
      ${sec("What we collect", `<p>When a trade plate is signed out and back in, this system records your name, your driver licence number if you enter it, your signature, the plate number, batch number, vehicle make and registration or VIN, the destination and purpose of the trip, and the date and time the plate went out and came back.</p><p>It also records the IP address and browser of the device used for each entry, and the time the entry was saved, so an entry can be shown to be genuine.</p>`)}
      ${sec("Why we collect it", `<p>A record of use must be kept for each trade plate and produced on request. This system is that record. ${esc(org)} also uses it to know which plate is out, who has it, and when it is due back.</p><p>Your name and signature are what tie a particular trip to a particular driver. Without them the record does not do its job. Your licence number is optional.</p>`)}
      ${sec("Who can see it", `<p>Access is limited to the staff who administer plate use. The records are disclosed outside ${esc(org)} only to Transport for NSW, the NSW Police Force, an insurer handling a claim, or another body with a lawful entitlement to them, and to the providers who host the system on our behalf.</p><p>Signed-out details for the plate you are scanning are visible on that plate's page, along with the last few trips on it, so the next driver can see whether the plate is available. Nothing else is shown to drivers.</p>`)}
      ${sec("Where it is held", `<p>The records are held in a database hosted in Australia, encrypted in transit and at rest. The administration area is password protected. Records are not sold, and are not used for marketing.</p>`)}
      ${sec("How long we keep it", `<p>Records are kept for ${years} year${years === 1 ? "" : "s"} from the date of the trip, then deleted.</p>`)}
      ${sec("Access, correction and complaints", `<p>You can ask for a copy of the records about you, or ask for a correction, by contacting ${esc(contact)} at <a href="mailto:${esc(email)}">${esc(email)}</a>${phone ? ` or ${esc(phone)}` : ""}. Complaints about how your information has been handled go to the same contact. If you are not satisfied with the response you can take the complaint to the Office of the Australian Information Commissioner at oaic.gov.au.</p>`)}
      ${sec("If you would rather not use this system", `<p>Tell the office. A paper entry can be made instead. The same information is collected either way, because the record still has to be kept.</p>`)}
    `,
  });
}

/* ------------------------------------------------------------ office side */

async function adminRoutes(
  { request, env }: Ctx,
  segments: string[],
  url: URL,
): Promise<Response> {
  const db = env.DB;
  const rest = segments.slice(1);
  const authed = await validSession(request, env.SESSION_SECRET, ADMIN_COOKIE);

  if (rest[0] === "login") {
    if (request.method === "POST") {
      const form = await request.formData();
      const password = String(form.get("password") ?? "");
      if (!safeEqual(password, env.ADMIN_PASSWORD)) {
        return html(loginPage(true), 401);
      }
      return redirect(`${BASE}/admin`, {
        "set-cookie": await sessionCookie(
          env.SESSION_SECRET,
          ADMIN_COOKIE,
          ADMIN_MAX_AGE,
        ),
      });
    }
    if (authed) return redirect(`${BASE}/admin`);
    return html(loginPage(false));
  }

  if (rest[0] === "logout") {
    return redirect(`${BASE}/admin/login`, {
      "set-cookie": clearCookie(ADMIN_COOKIE),
    });
  }

  if (!authed) return redirect(`${BASE}/admin/login`);

  /* ---- plates ---- */
  if (rest[0] === "plates") {
    if (rest[1] === "print") return html(await labelSheetPage(db, url));
    if (request.method === "POST") return await handlePlateAction(request, env);
    return html(await platesPage(db, url.searchParams.get("msg")));
  }

  /* ---- csv ---- */
  if (rest[0] === "export.csv") return await exportCsv(db, url);

  /* ---- single record ---- */
  if (rest[0] === "trips" && rest[1]) {
    const trip = await db
      .prepare("SELECT * FROM trips WHERE id = ?")
      .bind(Number(rest[1]))
      .first<Trip>();
    if (!trip) return html(notFoundPage(), 404);
    return html(tripPage(trip));
  }

  /* ---- records ---- */
  return html(await recordsPage(db, url));
}

function loginPage(wrong: boolean): string {
  return layout({
    title: "Office login",
    heading: "Office <span class=\"grad\">login</span>",
    lead: "For viewing and exporting trade plate records.",
    crumb: `<a href="/members/">Members</a> / <a href="${BASE}/">Trade plates</a> / Office`,
    narrow: true,
    body: `
      ${wrong ? banner("bad", "Wrong password.") : ""}
      <form method="post" action="${BASE}/admin/login" class="tp-form">
        ${fieldRow("Password", `<input type="password" id="password" name="password" autocomplete="current-password" required>`)}
        <button type="submit" class="btn">Sign in</button>
      </form>`,
  });
}

type Filters = {
  from: string;
  to: string;
  plate: string;
  driver: string;
  status: string;
};

function readFilters(url: URL): Filters {
  const q = (k: string) => (url.searchParams.get(k) ?? "").trim();
  const dateOk = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
  const status = q("status");
  return {
    from: dateOk(q("from")),
    to: dateOk(q("to")),
    plate: q("plate"),
    driver: q("driver"),
    status: status === "open" || status === "closed" ? status : "",
  };
}

function filterSql(f: Filters): { where: string; binds: unknown[] } {
  const clauses: string[] = [];
  const binds: unknown[] = [];

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
      binds.push(new Date(end.getTime() + 86400000).toISOString());
    }
  }
  if (f.plate) {
    clauses.push("plate_number = ?");
    binds.push(f.plate);
  }
  if (f.driver) {
    clauses.push("lower(driver_name) LIKE ?");
    binds.push(`%${f.driver.toLowerCase()}%`);
  }
  if (f.status === "open") clauses.push("in_at IS NULL");
  if (f.status === "closed") clauses.push("in_at IS NOT NULL");

  return {
    where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    binds,
  };
}

async function recordsPage(db: D1Database, url: URL): Promise<string> {
  const f = readFilters(url);
  const { where, binds } = filterSql(f);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const pageSize = 100;

  const plates = (
    await db.prepare("SELECT * FROM plates ORDER BY plate_number").all<Plate>()
  ).results;

  const counted = await db
    .prepare(`SELECT COUNT(*) AS n FROM trips ${where}`)
    .bind(...binds)
    .first<{ n: number }>();
  const total = counted?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const rows = (
    await db
      .prepare(
        `SELECT * FROM trips ${where} ORDER BY out_at DESC LIMIT ? OFFSET ?`,
      )
      .bind(...binds, pageSize, (page - 1) * pageSize)
      .all<Trip>()
  ).results;

  const expired = plates.filter(
    (p) => p.active && expiryStatus(p.expiry_date).state === "expired",
  ).length;
  const soon = plates.filter(
    (p) => p.active && expiryStatus(p.expiry_date).state === "soon",
  ).length;
  const alertParts: string[] = [];
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
            ? ` · <a class="tp-alert" href="${BASE}/admin/plates">${alertParts.join(", ")}</a>`
            : ""
        }</p>
      </div>
      <a class="btn" href="${BASE}/admin/export.csv?${qs.toString()}">Export CSV</a>
    </div>

    <form method="get" action="${BASE}/admin" class="tp-filters">
      <div><label for="from">From</label><input type="date" id="from" name="from" value="${esc(f.from)}"></div>
      <div><label for="to">To</label><input type="date" id="to" name="to" value="${esc(f.to)}"></div>
      <div><label for="plate">Plate</label>
        <select id="plate" name="plate">
          <option value="">All</option>
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
        <a class="btn ghost on-light" href="${BASE}/admin">Reset</a>
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
              <td>${
                t.in_at
                  ? `${fmt(t.in_at)}<div class="muted">${duration(t.out_at, t.in_at)}</div>`
                  : pill("out", "Still out")
              }</td>
              <td>${esc(t.batch_number)}</td>
              <td>${esc(t.vehicle_make)}${t.vehicle_rego ? `<div class="muted">${esc(t.vehicle_rego)}</div>` : ""}</td>
              <td>${esc(t.trip_destination)}</td>
              <td>${esc(t.driver_name)}</td>
              <td class="muted">${t.signature_out ? "Out" : "–"}${t.signature_in ? " / In" : ""}</td>
              <td><a href="${BASE}/admin/trips/${t.id}">View</a></td>
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
            ${page > 1 ? `<a href="${BASE}/admin?${qs}&page=${page - 1}">Previous</a>` : `<span>Previous</span>`}
            <span>Page ${page} of ${pages}</span>
            ${page < pages ? `<a href="${BASE}/admin?${qs}&page=${page + 1}">Next</a>` : `<span>Next</span>`}
          </p>`
        : ""
    }`;

  return layout({
    title: "Record of use",
    heading: "Record of <span class=\"grad\">use</span>",
    lead: "Every trade plate trip, filterable and exportable for an audit request.",
    crumb: `<a href="/members/">Members</a> / <a href="${BASE}/">Trade plates</a> / Records`,
    authed: true,
    body,
  });
}

function tripPage(t: Trip): string {
  const row = (label: string, value: string | null) =>
    `<div><dt>${label}</dt><dd>${esc(value || "–")}</dd></div>`;
  const sigFigure = (caption: string, data: string | null) =>
    `<figure>
      <figcaption>${caption}</figcaption>
      ${
        data
          ? `<img src="${data}" alt="${caption}">`
          : `<div class="tp-nosig">Not signed</div>`
      }
    </figure>`;

  return layout({
    title: `Record ${t.id}`,
    heading: `Plate <span class="grad">${esc(t.plate_number)}</span> — record #${t.id}`,
    lead: `${fmt(t.out_at)} to ${t.in_at ? fmt(t.in_at) : "still out"}${t.in_at ? ` (${duration(t.out_at, t.in_at)})` : ""}`,
    crumb: `<a href="${BASE}/admin">Records</a> / #${t.id}`,
    narrow: true,
    authed: true,
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

async function platesPage(db: D1Database, msg: string | null): Promise<string> {
  const plates = (
    await db.prepare("SELECT * FROM plates ORDER BY plate_number").all<Plate>()
  ).results;

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
          <form method="post" action="${BASE}/admin/plates" class="tp-inline-form">
            <input type="hidden" name="action" value="expiry">
            <input type="hidden" name="id" value="${p.id}">
            <input type="date" name="expiryDate" value="${esc(p.expiry_date ?? "")}">
            <button type="submit" class="linkish">Save</button>
          </form>
        </td>
        <td class="tp-link-cell">${esc(p.qr_slug)}</td>
        <td>${p.active ? pill("in", "Active") : pill("off", "Retired")}</td>
        <td class="tp-right">
          <form method="post" action="${BASE}/admin/plates" class="tp-inline-form">
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
    heading: "Plates &amp; <span class=\"grad\">QR codes</span>",
    lead: "Print the label sheet, cut them out and fix one to the back of each plate.",
    crumb: `<a href="/members/">Members</a> / <a href="${BASE}/">Trade plates</a> / Plates`,
    authed: true,
    body: `
      ${msg ? banner("ok", esc(msg)) : ""}
      <div class="tp-page-head">
        <div><h2>${plates.length} plate${plates.length === 1 ? "" : "s"} on file</h2></div>
        <a class="btn" href="${BASE}/admin/plates/print">Print QR label sheet</a>
      </div>

      <form method="post" action="${BASE}/admin/plates" class="tp-addplate">
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

async function handlePlateAction(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  const action = String(form.get("action") ?? "");
  const db = env.DB;

  if (action === "add") {
    const number = String(form.get("plateNumber") ?? "")
      .trim()
      .toUpperCase();
    const expiry = String(form.get("expiryDate") ?? "").trim();
    if (!number) return redirect(`${BASE}/admin/plates?msg=Plate+number+is+required`);
    if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry))
      return redirect(`${BASE}/admin/plates?msg=Enter+a+valid+expiry+date`);

    const existing = await db
      .prepare("SELECT id FROM plates WHERE plate_number = ?")
      .bind(number)
      .first();
    if (existing)
      return redirect(`${BASE}/admin/plates?msg=${encodeURIComponent(`${number} is already on file`)}`);

    await db
      .prepare(
        "INSERT INTO plates (plate_number, qr_slug, expiry_date, notes) VALUES (?,?,?,?)",
      )
      .bind(
        number,
        slugId(),
        expiry || null,
        String(form.get("notes") ?? "").trim() || null,
      )
      .run();
    return redirect(
      `${BASE}/admin/plates?msg=${encodeURIComponent(`${number} added. Reprint the label sheet.`)}`,
    );
  }

  const id = Number(form.get("id"));
  if (!Number.isInteger(id)) return redirect(`${BASE}/admin/plates`);

  if (action === "expiry") {
    const value = String(form.get("expiryDate") ?? "").trim();
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value))
      return redirect(`${BASE}/admin/plates?msg=Enter+a+valid+expiry+date`);
    await db
      .prepare("UPDATE plates SET expiry_date = ? WHERE id = ?")
      .bind(value || null, id)
      .run();
    return redirect(`${BASE}/admin/plates?msg=Expiry+updated`);
  }

  if (action === "toggle") {
    const active = String(form.get("active")) === "1" ? 1 : 0;
    if (!active && (await getOpenTrip(db, id))) {
      return redirect(
        `${BASE}/admin/plates?msg=${encodeURIComponent("That plate is out. Book it back in before retiring it.")}`,
      );
    }
    await db
      .prepare("UPDATE plates SET active = ? WHERE id = ?")
      .bind(active, id)
      .run();
    return redirect(`${BASE}/admin/plates?msg=Plate+updated`);
  }

  return redirect(`${BASE}/admin/plates`);
}

async function labelSheetPage(db: D1Database, url: URL): Promise<string> {
  const plates = (
    await db
      .prepare("SELECT * FROM plates WHERE active = 1 ORDER BY plate_number")
      .all<Plate>()
  ).results;

  const origin = url.origin;
  const cards = plates
    .map(
      (p) => `<div class="tp-label">
        <div class="tp-label-num">${esc(p.plate_number)}</div>
        <div class="tp-qr" data-qr="${esc(`${origin}${BASE}/p/${p.qr_slug}`)}"></div>
        <div class="tp-label-cta">Scan before every trip</div>
        <div class="tp-label-url">${esc(`${origin.replace(/^https?:\/\//, "")}${BASE}/p/${p.qr_slug}`)}</div>
      </div>`,
    )
    .join("");

  return layout({
    title: "QR labels",
    heading: "QR <span class=\"grad\">labels</span>",
    lead: "Print on adhesive label stock, laminate, then fix to the back of the matching plate.",
    crumb: `<a href="${BASE}/admin/plates">Plates</a> / Labels`,
    authed: true,
    body: `
      <p class="no-print"><button type="button" class="btn" data-print>Print</button></p>
      ${plates.length ? `<div class="tp-sheet">${cards}</div>` : `<p class="tp-empty">No active plates to print.</p>`}
      <script src="${BASE}/qrcode.min.js" defer></script>`,
  });
}

async function exportCsv(db: D1Database, url: URL): Promise<Response> {
  const f = readFilters(url);
  const { where, binds } = filterSql(f);
  const rows = (
    await db
      .prepare(`SELECT * FROM trips ${where} ORDER BY out_at DESC`)
      .bind(...binds)
      .all<Trip>()
  ).results;

  const headers = [
    "Record ID",
    "Plate number",
    "Date and time out",
    "Date and time in",
    "Duration",
    "Batch number",
    "Vehicle make",
    "Vehicle rego / VIN",
    "Trip destination",
    "Purpose of use",
    "Driver name",
    "Driver licence",
    "Signed out",
    "Signed in",
    "Notes",
    "Entry created",
    "Entry closed",
  ];

  const cell = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [headers.map(cell).join(",")];
  for (const t of rows) {
    lines.push(
      [
        t.id,
        t.plate_number,
        fmt(t.out_at),
        t.in_at ? fmt(t.in_at) : "STILL OUT",
        t.in_at ? duration(t.out_at, t.in_at) : "",
        t.batch_number,
        t.vehicle_make,
        t.vehicle_rego ?? "",
        t.trip_destination,
        t.purpose ?? "",
        t.driver_name,
        t.driver_licence ?? "",
        t.signature_out ? "Yes" : "No",
        t.signature_in ? "Yes" : "No",
        t.notes ?? "",
        fmt(t.created_at),
        t.completed_at ? fmt(t.completed_at) : "",
      ]
        .map(cell)
        .join(","),
    );
  }

  // BOM so Excel opens it as UTF-8.
  const csv = `﻿${lines.join("\r\n")}\r\n`;
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="trade-plate-record-of-use-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}
