-- Ratanmoti Maintenance : initial schema
-- D1 / SQLite. Timestamps are integer epoch milliseconds, UTC.
-- IDs are UUIDv7 strings, generated client side where the client owns the record.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  phone       TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('admin', 'operator')),
  lang        TEXT NOT NULL DEFAULT 'hi' CHECK (lang IN ('en', 'hi', 'mr')),
  pass_hash   TEXT NOT NULL,
  pass_salt   TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  created_by  TEXT REFERENCES users(phone)
);

CREATE INDEX idx_users_active ON users(active);

-- ---------------------------------------------------------------------------
-- Plant
-- ---------------------------------------------------------------------------

CREATE TABLE sheds (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,   -- short, used in R2 keys. e.g. "B"
  name        TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);

CREATE TABLE machines (
  id            TEXT PRIMARY KEY,
  shed_id       TEXT NOT NULL REFERENCES sheds(id),
  machine_no    TEXT NOT NULL,        -- as painted on the loom. Latin digits.
  make          TEXT,
  model         TEXT,
  loom_type     TEXT,
  shedview_id   TEXT,                 -- join key to ShedView. Populate from day one.
  installed_on  TEXT,                 -- ISO date
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  UNIQUE (shed_id, machine_no)
);

CREATE INDEX idx_machines_shed ON machines(shed_id, active);
CREATE INDEX idx_machines_shedview ON machines(shedview_id);

-- ---------------------------------------------------------------------------
-- Controlled vocabulary
--
-- The synonym list is the whole matching engine. Every item must carry
-- synonyms in BOTH Devanagari and Latin script, because Web Speech returns
-- Devanagari for hi-IN and mr-IN but Latin for en-IN. See CLAUDE.md section 8.
-- ---------------------------------------------------------------------------

CREATE TABLE taxonomy_items (
  code        TEXT PRIMARY KEY,       -- e.g. OIL_CHANGE, RAPIER_TAPE
  kind        TEXT NOT NULL CHECK (kind IN ('action', 'part')),
  category    TEXT NOT NULL,          -- lubrication, pneumatics, electrical, ...
  label_en    TEXT NOT NULL,
  label_hi    TEXT NOT NULL,
  label_mr    TEXT NOT NULL,
  unit        TEXT,                   -- for parts: nos, ltr, kg, mtr
  sort_order  INTEGER NOT NULL DEFAULT 100,
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_taxonomy_kind ON taxonomy_items(kind, active, sort_order);

CREATE TABLE taxonomy_synonyms (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  code    TEXT NOT NULL REFERENCES taxonomy_items(code) ON DELETE CASCADE,
  phrase  TEXT NOT NULL,              -- stored lowercase, already normalised
  script  TEXT NOT NULL CHECK (script IN ('deva', 'latn')),
  UNIQUE (code, phrase)
);

CREATE INDEX idx_synonyms_code ON taxonomy_synonyms(code);

-- ---------------------------------------------------------------------------
-- Maintenance logs
-- ---------------------------------------------------------------------------

CREATE TABLE logs (
  id                 TEXT PRIMARY KEY,   -- client generated, makes retries idempotent
  machine_id         TEXT NOT NULL REFERENCES machines(id),
  operator_phone     TEXT NOT NULL REFERENCES users(phone),
  status             TEXT NOT NULL
                     CHECK (status IN ('pending_transcription', 'awaiting_review',
                                       'approved', 'failed')),
  capture_lang       TEXT NOT NULL CHECK (capture_lang IN ('en', 'hi', 'mr')),
  transcript         TEXT,               -- joined from segments, denormalised for search
  typed_note         TEXT,               -- operator typed instead of, or alongside, speech
  client_created_at  INTEGER NOT NULL,   -- when the operator actually recorded it
  server_received_at INTEGER NOT NULL,
  approved_at        INTEGER,
  device_id          TEXT,
  retry_count        INTEGER NOT NULL DEFAULT 0,
  fail_reason        TEXT
);

CREATE INDEX idx_logs_machine ON logs(machine_id, client_created_at DESC);
CREATE INDEX idx_logs_operator ON logs(operator_phone, client_created_at DESC);
CREATE INDEX idx_logs_status ON logs(status, server_received_at);

-- One 50 second recording. A log has one or more.
-- This table is what makes "record more" work without losing anything.
CREATE TABLE log_segments (
  id              TEXT PRIMARY KEY,
  log_id          TEXT NOT NULL REFERENCES logs(id) ON DELETE CASCADE,
  seq             INTEGER NOT NULL,
  audio_key       TEXT,                -- audio/{shed_code}/{machine_no}/{log_id}/{seq}.webm
  audio_bytes     INTEGER,
  duration_ms     INTEGER,
  source          TEXT NOT NULL
                  CHECK (source IN ('webspeech', 'webspeech_local', 'whisper', 'typed')),
  transcript      TEXT,
  confidence      REAL,
  transcribed_at  INTEGER,
  UNIQUE (log_id, seq)
);

CREATE INDEX idx_segments_log ON log_segments(log_id, seq);

-- The structured output. Every future report reads from this table.
CREATE TABLE log_items (
  id         TEXT PRIMARY KEY,
  log_id     TEXT NOT NULL REFERENCES logs(id) ON DELETE CASCADE,
  code       TEXT NOT NULL REFERENCES taxonomy_items(code),
  qty        REAL,
  unit       TEXT,
  origin     TEXT NOT NULL CHECK (origin IN ('auto', 'manual')),
  UNIQUE (log_id, code)
);

CREATE INDEX idx_items_code ON log_items(code);
CREATE INDEX idx_items_log ON log_items(log_id);

-- Append only. Nothing here is ever updated or deleted.
CREATE TABLE log_edits (
  id            TEXT PRIMARY KEY,
  log_id        TEXT NOT NULL REFERENCES logs(id) ON DELETE CASCADE,
  admin_phone   TEXT NOT NULL REFERENCES users(phone),
  field         TEXT NOT NULL,       -- 'transcript' | 'items'
  value_before  TEXT NOT NULL,
  value_after   TEXT NOT NULL,
  reason        TEXT NOT NULL,
  edited_at     INTEGER NOT NULL
);

CREATE INDEX idx_edits_log ON log_edits(log_id, edited_at DESC);

-- ---------------------------------------------------------------------------
-- Match quality. Feeds the phase 6 report that tells the supervisor which
-- synonyms are missing. Written on every review, cheap, high value.
-- ---------------------------------------------------------------------------

CREATE TABLE match_misses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id      TEXT NOT NULL REFERENCES logs(id) ON DELETE CASCADE,
  code        TEXT NOT NULL REFERENCES taxonomy_items(code),
  transcript  TEXT NOT NULL,          -- what they said that the regex did not catch
  recorded_at INTEGER NOT NULL
);
