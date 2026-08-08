-- Boundary CRM — Phase 0, Step 2: clients.
-- Written on import. realized_rate = annual_fee / est_hours; tier is A-D,
-- assigned by realized-rate percentile within the imported set.

CREATE TABLE IF NOT EXISTS client (
  id             TEXT PRIMARY KEY,
  firm_id        TEXT NOT NULL REFERENCES firm(id),
  name           TEXT NOT NULL,
  entity_type    TEXT,
  return_type    TEXT,
  annual_fee     REAL,
  est_hours      REAL,
  realized_rate  REAL,
  tier           TEXT,          -- 'A' | 'B' | 'C' | 'D' | NULL (unranked)
  flags          TEXT,          -- JSON, reserved for later steps
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_client_firm ON client(firm_id);
CREATE INDEX IF NOT EXISTS idx_client_tier ON client(firm_id, tier);
