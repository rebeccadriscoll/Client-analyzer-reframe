-- Boundary CRM — Phase 1: voice samples for The Words.
-- When the owner rewrites a message in their own words, it is stored here and
-- used as a style example so Claude drafts the other messages in their voice.

CREATE TABLE IF NOT EXISTS voice_sample (
  id          TEXT PRIMARY KEY,
  firm_id     TEXT NOT NULL REFERENCES firm(id),
  action      TEXT,               -- the action the sample was written for, or NULL
  message     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_voice_firm ON voice_sample(firm_id);
