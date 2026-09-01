-- Three role tiers, added without touching `users`' existing shape.
--
-- The obvious approach — recreate `users` with role CHECK widened to include
-- 'super_admin' — does not work on D1: dropping/renaming a table that other
-- tables reference by foreign key fails with a FOREIGN KEY constraint error
-- even inside a transaction with `defer_foreign_keys` set, which is the
-- pragma meant for exactly that case in ordinary SQLite. Proved locally on
-- both the real schema and a minimal two-table repro before writing this,
-- so this is a real D1 limitation, not a mistake in the recreate script.
--
-- `role` therefore stays 'admin' | 'operator' at the DB level, completely
-- untouched. The owner tier is a flag on top of 'admin': a plain ADD COLUMN
-- needs no table recreation and so has none of the above problem. The app
-- layer treats role='admin' AND is_super_admin=1 as the owner tier and a
-- plain 'admin' row as the shed-scoped tier.
ALTER TABLE users ADD COLUMN is_super_admin INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_users_super_admin ON users(is_super_admin);

-- Permanent record of destructive owner-tier actions (purging a log,
-- deleting a shed). Deliberately NOT foreign-keyed to the rows it describes:
-- a purge removes the row it is about, and an audit trail that vanished with
-- the thing it was auditing would defeat the point of having one.
CREATE TABLE admin_audit (
  id          TEXT PRIMARY KEY,
  actor_phone TEXT NOT NULL,
  action      TEXT NOT NULL,       -- 'purge_log' | 'delete_shed' | 'restore_log'
  target_type TEXT NOT NULL,       -- 'log' | 'shed'
  target_id   TEXT NOT NULL,
  detail      TEXT,                -- free text: what it was before it went, why
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_admin_audit_created ON admin_audit(created_at DESC);
