-- Trade plate record of use - Cloudflare D1 schema.
-- Apply with:  npx wrangler d1 execute tradeplate --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS plates (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  plate_number TEXT    NOT NULL UNIQUE,
  qr_slug      TEXT    NOT NULL UNIQUE,
  expiry_date  TEXT,                       -- YYYY-MM-DD, NULL until set
  active       INTEGER NOT NULL DEFAULT 1,
  notes        TEXT,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS trips (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  plate_id         INTEGER NOT NULL REFERENCES plates(id),
  plate_number     TEXT    NOT NULL,       -- snapshot, so history survives a rename
  batch_number     TEXT    NOT NULL,
  vehicle_make     TEXT    NOT NULL,
  vehicle_rego     TEXT,
  trip_destination TEXT    NOT NULL,
  purpose          TEXT,
  driver_name      TEXT    NOT NULL,
  driver_licence   TEXT,
  out_at           TEXT    NOT NULL,       -- ISO 8601 UTC
  in_at            TEXT,                   -- ISO 8601 UTC, NULL while the plate is out
  signature_out    TEXT,                   -- PNG data URL
  signature_in     TEXT,
  notes            TEXT,
  created_at       TEXT    NOT NULL,
  created_ip       TEXT,
  created_ua       TEXT,
  completed_at     TEXT,
  completed_ip     TEXT,
  completed_ua     TEXT
);

CREATE INDEX IF NOT EXISTS trips_plate_id_idx ON trips (plate_id);
CREATE INDEX IF NOT EXISTS trips_out_at_idx   ON trips (out_at);

-- A plate can only be out once at a time, even if two phones submit together.
CREATE UNIQUE INDEX IF NOT EXISTS trips_one_open_per_plate_idx
  ON trips (plate_id) WHERE in_at IS NULL;
