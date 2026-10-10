/* Outbound email. Provider chosen by environment:
     RESEND_API_KEY + MAIL_FROM   -> Resend HTTP API
     MAIL_PROVIDER === 'outbox'   -> in-memory array (tests and local development)
     otherwise                    -> not configured, nothing is sent
   Nothing here logs a message body, a recipient, a token or a key. */

export const outbox = [];

export function mailConfigured(env) {
  env = env || {};
  if (env.MAIL_PROVIDER === 'outbox') return true;
  return !!(env.RESEND_API_KEY && env.MAIL_FROM);
}

export async function sendMail(env, msg, fetchImpl) {
  env = env || {};
  const to = msg && msg.to;
  if (!to || !msg.subject) return { sent: false, reason: 'invalid_message' };
  if (env.RESEND_API_KEY && env.MAIL_FROM) {
    const f = fetchImpl || ((u, o) => globalThis.fetch(u, o));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    try {
      const res = await f('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject: msg.subject,
                               text: msg.text || undefined, html: msg.html || undefined }),
        signal: ctl.signal
      });
      if (!res || !res.ok) return { sent: false, reason: 'provider_error' };
      return { sent: true, provider: 'resend' };
    } catch (e) {
      return { sent: false, reason: 'send_failed' };
    } finally { clearTimeout(timer); }
  }
  if (env.MAIL_PROVIDER === 'outbox') {
    outbox.push({ to, subject: msg.subject, text: msg.text || '', html: msg.html || '', at: Date.now() });
    if (outbox.length > 200) outbox.shift();
    return { sent: true, provider: 'outbox' };
  }
  return { sent: false, reason: 'not_configured' };
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

export function verifyEmail(name, link) {
  const hi = name ? `Hi ${name},` : 'Hi,';
  return {
    subject: 'Confirm your email for Recomp',
    text: `${hi}\n\nThanks for signing up to Recomp. Please confirm your email address:\n\n${link}\n\n` +
          `The link works once and expires in 48 hours. After that, an administrator will review your request. ` +
          `If you did not sign up, you can ignore this message.\n`,
    html: `<p>${esc(hi)}</p><p>Thanks for signing up to Recomp. Please confirm your email address:</p>` +
          `<p><a href="${esc(link)}">Confirm my email</a></p>` +
          `<p>The link works once and expires in 48 hours. After that, an administrator will review your request. ` +
          `If you did not sign up, you can ignore this message.</p>`
  };
}
export function resetEmail(name, link) {
  const hi = name ? `Hi ${name},` : 'Hi,';
  return {
    subject: 'Reset your Recomp password',
    text: `${hi}\n\nSomeone asked to reset the password for this Recomp account. To choose a new one:\n\n${link}\n\n` +
          `The link works once and expires in 1 hour. If you did not ask for this, you can ignore this message.\n`,
    html: `<p>${esc(hi)}</p><p>Someone asked to reset the password for this Recomp account.</p>` +
          `<p><a href="${esc(link)}">Choose a new password</a></p>` +
          `<p>The link works once and expires in 1 hour. If you did not ask for this, you can ignore this message.</p>`
  };
}
