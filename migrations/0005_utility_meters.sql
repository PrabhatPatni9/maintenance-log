-- Utility operator role, plus meters + daily readings for tracking per-shed
-- and per-machine electricity consumption. No costing anywhere in this
-- migration or the routes built on it — logged kWh and PF only, by design
-- (the human explicitly said not to add rates to the system).
--
-- Fourth role tier the same way the third one was added (see 0004's
-- comment): `users.role` stays 'admin' | 'operator' at the DB level — D1
-- still refuses to recreate a table other tables hold a foreign key into,
-- so no CHECK-widening. A plain ADD COLUMN needs no recreation. The app
-- layer treats role='operator' AND is_utility=1 as the utility_operator
-- tier; mapUser() is the one place that folds it into the app's Role type.
ALTER TABLE users ADD COLUMN is_utility INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_users_utility ON users(is_utility);

-- One meter belongs to one shed. code is the identifier as read off the
-- physical meter/panel (e.g. "M1"), unique within the shed the same way a
-- machine number is.
CREATE TABLE meters (
  id          TEXT PRIMARY KEY,
  shed_id     TEXT NOT NULL REFERENCES sheds(id),
  code        TEXT NOT NULL,
  name        TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  UNIQUE (shed_id, code)
);

CREATE INDEX idx_meters_shed ON meters(shed_id, active);

-- A machine draws power through exactly one meter's circuit — this is a
-- partition ("the meters can be divided among machinery"), not an overlap,
-- so a nullable FK column on machines is the right shape, not a join table.
-- Nullable because a machine can exist before anyone has wired up which
-- meter it sits behind.
ALTER TABLE machines ADD COLUMN meter_id TEXT REFERENCES meters(id);

CREATE INDEX idx_machines_meter ON machines(meter_id);

-- One row per meter per calendar day. Cumulative kWh as shown on the meter
-- — daily consumption is derived at query time as today's reading minus the
-- most recent earlier day's reading (a window function over this table),
-- never stored redundantly. PF (power factor) is logged alongside kWh
-- because that is what the electrician actually reads off the meter each
-- day, but nothing here computes a bill from it.
CREATE TABLE meter_readings (
  id            TEXT PRIMARY KEY,
  meter_id      TEXT NOT NULL REFERENCES meters(id),
  reading_date  TEXT NOT NULL,          -- 'YYYY-MM-DD', shed's local day
  kwh_reading   REAL NOT NULL,
  pf_reading    REAL,                   -- 0..1, optional
  note          TEXT,
  recorded_by   TEXT NOT NULL REFERENCES users(phone),
  recorded_at   INTEGER NOT NULL,
  UNIQUE (meter_id, reading_date)
);

CREATE INDEX idx_meter_readings_meter_date ON meter_readings(meter_id, reading_date DESC);

-- Append-only correction trail for a past day's reading, same shape and
-- reasoning as log_edits: a reading already used as the next day's delta
-- baseline is not silently overwritten, it is corrected with a reason on
-- record. Same-day resubmission by whoever logged it does not go through
-- this table (see meter-readings.ts) — this is for an admin fixing a
-- mistake after the fact.
CREATE TABLE meter_reading_edits (
  id            TEXT PRIMARY KEY,
  reading_id    TEXT NOT NULL REFERENCES meter_readings(id),
  admin_phone   TEXT NOT NULL,
  field         TEXT NOT NULL,          -- 'kwh_reading' | 'pf_reading'
  value_before  TEXT,
  value_after   TEXT,
  reason        TEXT NOT NULL,
  edited_at     INTEGER NOT NULL
);
