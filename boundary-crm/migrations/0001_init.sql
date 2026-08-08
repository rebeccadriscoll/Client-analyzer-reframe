-- Boundary CRM — Phase 0, Step 1: auth foundation.
-- Single firm per owner email. Magic-link tokens and sessions are stored hashed.
-- Later steps add client / decision / wave / commitment (see the product data model).

CREATE TABLE IF NOT EXISTS firm (
  id           TEXT PRIMARY KEY,
  owner_email  TEXT NOT NULL UNIQUE,
  name         TEXT,
  created_at   INTEGER NOT NULL
);

-- One-time sign-in tokens. Only the SHA-256 hash of the token is stored, so a
-- database leak never exposes a usable link. Tokens are single-use and expire.
CREATE TABLE IF NOT EXISTS magic_link_token (
  id           TEXT PRIMARY KEY,
  firm_id      TEXT NOT NULL REFERENCES firm(id),
  token_hash   TEXT NOT NULL UNIQUE,
  expires_at   INTEGER NOT NULL,
  consumed_at  INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_magic_firm ON magic_link_token(firm_id);
CREATE INDEX IF NOT EXISTS idx_magic_expires ON magic_link_token(expires_at);

-- Session tokens, also stored hashed. The raw token lives only in the owner's
-- httpOnly cookie.
CREATE TABLE IF NOT EXISTS session (
  id           TEXT PRIMARY KEY,
  firm_id      TEXT NOT NULL REFERENCES firm(id),
  token_hash   TEXT NOT NULL UNIQUE,
  expires_at   INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_firm ON session(firm_id);
CREATE INDEX IF NOT EXISTS idx_session_expires ON session(expires_at);
