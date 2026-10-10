-- Recomp backend schema. Portable between Cloudflare D1 and node:sqlite.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,     -- login identifier only; no mail is sent
  name            TEXT,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'member',  -- owner | admin | coach | member
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | active | suspended | revoked
  must_change_pw  INTEGER NOT NULL DEFAULT 0,
  mfa_secret      TEXT,
  permissions     TEXT,                     -- JSON object of per-feature overrides
  created_at      INTEGER NOT NULL,
  created_by      TEXT,
  approved_at     INTEGER,
  approved_by     TEXT,
  last_login_at   INTEGER,
  last_login_ip   TEXT,
  pw_changed_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,            -- sha256 of the opaque token
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  ip           TEXT,
  user_agent   TEXT,
  revoked_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT NOT NULL,                 -- email|ip
  at         INTEGER NOT NULL,
  ok         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempts_key ON login_attempts(key, at);

-- One row per user: the whole Recomp state document, owned and scoped.
CREATE TABLE IF NOT EXISTS user_state (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  doc        TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS coach_assignments (
  coach_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  PRIMARY KEY (coach_id, member_id)
);

CREATE TABLE IF NOT EXISTS reviews (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_ref   TEXT,                       -- the Recomp session id this is about
  session_date  TEXT,
  difficulty    TEXT,
  satisfaction  TEXT,
  effective     TEXT,                       -- JSON array of variant ids
  unsuitable    TEXT,                       -- JSON array of variant ids
  technique_q   TEXT,
  pain_note     TEXT,
  wanted        TEXT,                       -- more | less | about_right
  comment       TEXT,
  wants_review  INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'new',-- new | in_review | replied | resolved
  assigned_to   TEXT REFERENCES users(id),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_user ON reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);

CREATE TABLE IF NOT EXISTS review_messages (
  id         TEXT PRIMARY KEY,
  review_id  TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msgs_review ON review_messages(review_id);

-- A reviewer proposes a change; it only takes effect if the user accepts.
CREATE TABLE IF NOT EXISTS plan_proposals (
  id          TEXT PRIMARY KEY,
  review_id   TEXT REFERENCES reviews(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  proposed_by TEXT NOT NULL REFERENCES users(id),
  variant_id  TEXT,
  change      TEXT NOT NULL,                -- JSON describing the proposed change
  reason      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'proposed', -- proposed | accepted | declined
  created_at  INTEGER NOT NULL,
  decided_at  INTEGER
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          INTEGER NOT NULL,
  actor_id    TEXT,
  actor_email TEXT,
  action      TEXT NOT NULL,
  target_id   TEXT,
  detail      TEXT,
  ip          TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
