-- Boundary CRM — Phase 0, Step 3: decisions.
-- One decision per client (keep | raise | fire | nudge). drafted_message is
-- filled in Step 4 (The Words) and left untouched when a decision is re-saved.

CREATE TABLE IF NOT EXISTS decision (
  id               TEXT PRIMARY KEY,
  client_id        TEXT NOT NULL UNIQUE REFERENCES client(id),
  firm_id          TEXT NOT NULL REFERENCES firm(id),
  action           TEXT NOT NULL,   -- 'keep' | 'raise' | 'fire' | 'nudge'
  new_fee          REAL,
  drafted_message  TEXT,
  decided_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_decision_firm ON decision(firm_id);
