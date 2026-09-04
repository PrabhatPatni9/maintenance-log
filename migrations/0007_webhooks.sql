-- Outbound integrations, configured in the super admin panel. A webhook
-- fires a signed POST to a URL the owner supplies (a Google Apps Script Web
-- App URL, most likely) every time a maintenance log is approved or a
-- meter reading is recorded — no cost, no third party API, just an outbound
-- fetch() from the Worker (CLAUDE.md section 2.6: everything free).
--
-- Scoped like meters are scoped to a shed: 'global' fires for everything,
-- 'shed' only for that shed's logs/readings, 'machine' only for that
-- machine's logs (a meter reading has no single machine — it can cover
-- several — so machine-scoped webhooks never fire for meter_reading events,
-- only shed and global ones do; see fireWebhooks in lib/webhooks.ts).
CREATE TABLE webhooks (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'shed', 'machine')),
  scope_id TEXT, -- shed id or machine id; NULL for 'global'
  url TEXT NOT NULL,
  secret TEXT NOT NULL, -- shown once at creation, used to HMAC-sign the delivery body
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL REFERENCES users(phone),
  created_at INTEGER NOT NULL,
  last_fired_at INTEGER,
  last_status INTEGER, -- HTTP status of the most recent delivery attempt
  last_error TEXT      -- set instead of last_status when the fetch itself failed
);

CREATE INDEX idx_webhooks_scope ON webhooks(scope_type, scope_id);
CREATE INDEX idx_webhooks_active ON webhooks(active);
