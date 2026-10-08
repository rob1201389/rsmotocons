/**
 * Car Studio (/photoai) AI glass clean-up.
 *
 * POST /photoai/api/glass  multipart: image (jpeg), mask (png, white = windows)
 *
 * Forwards to Stability AI's inpaint service, which repaints only the white
 * area of the mask. The app then keeps only pixels inside the window outlines,
 * so paint is never altered. Every call costs money, so it is locked down:
 *
 *   Secret  STABILITY_API_KEY   provider key (route returns 503 without it)
 *   Secret  PHOTOAI_KEY         access key the phones send in X-Photoai-Key
 *   Var     PHOTOAI_DAILY_LIMIT calls per day across everyone (default 300)
 *
 * Daily counting uses the LEADS KV namespace under its own prefix.
 */

const PROMPT =
  "clean dark tinted automotive window glass, smooth even soft reflection of a bright photo studio, no scenery, photorealistic, sharp";
const NEGATIVE = "trees, sky, clouds, buildings, people, person, text, logo, watermark, distorted, blurry, extra objects";
const MAX_BYTES = 15 * 1024 * 1024;
// The Android app runs from these origins; the website is same-origin.
const APP_ORIGINS = new Set(["https://localhost", "capacitor://localhost", "http://localhost"]);

export async function handlePhotoai(request, env, url) {
  if (url.pathname !== "/photoai/api/glass") return null;
  const origin = request.headers.get("origin");
  const cors = origin && APP_ORIGINS.has(origin)
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "X-Photoai-Key", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin" }
    : {};
  const reply = (body, status, extra = {}) =>
    new Response(body, { status, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store", ...cors, ...extra } });

  if (request.method === "OPTIONS") return reply(null, 204);
  if (request.method !== "POST") return reply("Method not allowed", 405);
  if (!env.STABILITY_API_KEY || !env.PHOTOAI_KEY) return reply("AI glass is not set up yet.", 503);
  if (!timingSafeEqual(request.headers.get("x-photoai-key") || "", env.PHOTOAI_KEY)) return reply("Wrong access key", 401);
  if (Number(request.headers.get("content-length") || 0) > MAX_BYTES) return reply("Image too large", 413);

  const limit = parseInt(env.PHOTOAI_DAILY_LIMIT || "300", 10) || 300;
  const dayKey = `rl:photoai:${new Date().toISOString().slice(0, 10)}`;
  const used = env.LEADS ? parseInt((await env.LEADS.get(dayKey)) || "0", 10) : 0;
  if (used >= limit) return reply("Daily limit reached", 429);

  let form;
  try {
    form = await request.formData();
  } catch {
    return reply("Send image and mask as multipart form data", 400);
  }
  const image = form.get("image"), mask = form.get("mask");
  if (!(image instanceof File) || !(mask instanceof File)) return reply("Send image and mask", 400);

  const out = new FormData();
  out.append("image", image, "image.jpg");
  out.append("mask", mask, "mask.png");
  out.append("prompt", PROMPT);
  out.append("negative_prompt", NEGATIVE);
  out.append("grow_mask", "4");
  out.append("output_format", "jpeg");
  const r = await fetch(env.STABILITY_URL || "https://api.stability.ai/v2beta/stable-image/edit/inpaint", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.STABILITY_API_KEY}`, Accept: "image/*" },
    body: out,
  });
  if (!r.ok) {
    console.error("photoai provider", r.status, (await r.text()).slice(0, 300));
    return reply(`Image service error (${r.status})`, 502);
  }
  if (env.LEADS) await env.LEADS.put(dayKey, String(used + 1), { expirationTtl: 60 * 60 * 48 });
  return new Response(r.body, { status: 200, headers: { "Content-Type": r.headers.get("content-type") || "image/jpeg", "Cache-Control": "no-store", ...cors } });
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
