-- Boundary CRM — Phase 1: client notes / history.
CREATE TABLE IF NOT EXISTS note (
  id          TEXT PRIMARY KEY,
  firm_id     TEXT NOT NULL REFERENCES firm(id),
  client_id   TEXT NOT NULL REFERENCES client(id),
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_note_client ON note(client_id);
CREATE INDEX IF NOT EXISTS idx_note_firm ON note(firm_id);
