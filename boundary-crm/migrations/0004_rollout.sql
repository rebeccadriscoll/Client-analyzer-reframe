-- Boundary CRM — Phase 0, Step 5: rollout waves + commitments.

-- One wave per action type, per firm. Order and membership are derived from
-- decisions; this table stores the owner's send date and status per wave.
CREATE TABLE IF NOT EXISTS wave (
  id         TEXT PRIMARY KEY,
  firm_id    TEXT NOT NULL REFERENCES firm(id),
  type       TEXT NOT NULL,                 -- 'raise' | 'keep' | 'nudge' | 'fire'
  send_date  TEXT,                          -- ISO date (YYYY-MM-DD) or NULL
  status     TEXT NOT NULL DEFAULT 'draft', -- 'draft' | 'scheduled' | 'sent'
  UNIQUE(firm_id, type)
);

-- One commitment per client. link_token backs a public confirm page; state
-- tracks the client's response; committed_fee is the revenue locked in on agree.
CREATE TABLE IF NOT EXISTS commitment (
  id             TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL UNIQUE REFERENCES client(id),
  firm_id        TEXT NOT NULL REFERENCES firm(id),
  link_token     TEXT NOT NULL UNIQUE,
  state          TEXT NOT NULL DEFAULT 'told', -- 'told' | 'silent' | 'agreed' | 'declined'
  committed_fee  REAL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_commitment_firm ON commitment(firm_id);
