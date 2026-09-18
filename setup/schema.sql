-- Trade plate record of use — Cloudflare D1.
-- Personal detail is encrypted into `enc` (AES-256-GCM under DATA_KEY).
-- Only what is needed to index, sort and filter is stored in clear.

CREATE TABLE IF NOT EXISTS plates (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  plate_number TEXT    NOT NULL UNIQUE,
  qr_slug      TEXT    NOT NULL UNIQUE,
  expiry_date  TEXT,
  active       INTEGER NOT NULL DEFAULT 1,
  notes        TEXT,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS trips (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  plate_id     INTEGER NOT NULL REFERENCES plates(id),
  plate_number TEXT    NOT NULL,
  out_at       TEXT    NOT NULL,
  in_at        TEXT,
  created_at   TEXT    NOT NULL,
  completed_at TEXT,
  -- encrypted: driver name and licence, both signatures, batch, vehicle,
  -- destination, purpose, notes, and the IP/browser of each entry
  enc          TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS trips_plate_id_idx ON trips (plate_id);
CREATE INDEX IF NOT EXISTS trips_out_at_idx   ON trips (out_at);

-- A plate can only be out once at a time, even if two phones submit together.
CREATE UNIQUE INDEX IF NOT EXISTS trips_one_open_per_plate_idx
  ON trips (plate_id) WHERE in_at IS NULL;

-- Operator-changeable settings. Values are encrypted with DATA_KEY, the same
-- way record content is, so the driver PIN is never stored in clear.
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  enc        TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
