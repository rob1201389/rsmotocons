/* Database-level protection for the security log. Created from code (one
   statement per prepare) rather than in schema.sql, because the deploy step
   and the D1 adapter split schema files on semicolons, which would break a
   trigger body. Each statement is idempotent.

   The app can append to audit_log and can only ever blank actor_email and ip
   (for account deletion). Rewriting or deleting an entry is refused by the
   database itself. This protects against application bugs and injected SQL;
   someone with direct database access in the Cloudflare account can still
   drop the triggers, which is an externally managed risk. */
const TRIGGERS = [
  `CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log
     BEGIN SELECT RAISE(ABORT, 'audit log entries cannot be deleted'); END`,
  `CREATE TRIGGER IF NOT EXISTS audit_log_no_rewrite BEFORE UPDATE ON audit_log
     WHEN NEW.id IS NOT OLD.id OR NEW.at IS NOT OLD.at OR NEW.action IS NOT OLD.action
       OR NEW.actor_id IS NOT OLD.actor_id OR NEW.target_id IS NOT OLD.target_id OR NEW.detail IS NOT OLD.detail
       OR (NEW.actor_email IS NOT NULL AND NEW.actor_email IS NOT OLD.actor_email)
       OR (NEW.ip IS NOT NULL AND NEW.ip IS NOT OLD.ip)
     BEGIN SELECT RAISE(ABORT, 'audit log entries cannot be changed'); END`
];
const done = new WeakSet();
let d1Done = false;                              // one D1 database per worker; the adapter is rebuilt per request
export let protectionStatus = { ok: null, error: null };
export async function ensureAuditProtection(db) {
  if (db.kind === 'd1') { if (d1Done) return protectionStatus; d1Done = true; }
  else { if (done.has(db)) return protectionStatus; done.add(db); }
  try {
    for (const t of TRIGGERS) await db.run(t);
    protectionStatus = { ok: true, error: null };
  } catch (e) {
    protectionStatus = { ok: false, error: 'trigger creation failed' };
  }
  return protectionStatus;
}
