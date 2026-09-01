-- Bogus logs need to disappear from every list an admin or operator reads,
-- without the row actually leaving the database. A mis-recorded log is still
-- evidence of what the app did, and log_edits only makes sense if the log it
-- points at still exists — so this is a deactivation, not a DELETE.
ALTER TABLE logs ADD COLUMN deleted_at INTEGER;
ALTER TABLE logs ADD COLUMN deleted_by TEXT REFERENCES users(phone);

CREATE INDEX idx_logs_deleted ON logs(deleted_at);
