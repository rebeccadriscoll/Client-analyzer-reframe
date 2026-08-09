-- Boundary CRM — Phase 1: firm settings + seasons.
ALTER TABLE firm ADD COLUMN min_fee REAL;
ALTER TABLE firm ADD COLUMN batch_size INTEGER;

-- A closed season is a snapshot of a decision cycle. Closing one archives the
-- summary here and clears the current decisions/commitments to start fresh.
CREATE TABLE IF NOT EXISTS season (
  id          TEXT PRIMARY KEY,
  firm_id     TEXT NOT NULL REFERENCES firm(id),
  label       TEXT NOT NULL,
  decided     INTEGER NOT NULL,
  committed   REAL NOT NULL,
  potential   REAL NOT NULL,
  tiers       TEXT,   -- JSON snapshot
  actions     TEXT,   -- JSON snapshot
  closed_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_season_firm ON season(firm_id);
