-- Multi-user: a firm can have several members who share the whole book.
-- A member is a person (by email); a firm is the shared workspace. The founding
-- user is the 'owner' (can invite and remove); invited users are 'member'.

CREATE TABLE IF NOT EXISTS member (
  id          TEXT PRIMARY KEY,
  firm_id     TEXT NOT NULL REFERENCES firm(id),
  email       TEXT NOT NULL UNIQUE,
  role        TEXT NOT NULL DEFAULT 'member',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_member_firm ON member(firm_id);

-- A pending invitation: when this email next signs in, they join firm_id.
CREATE TABLE IF NOT EXISTS firm_invite (
  id          TEXT PRIMARY KEY,
  firm_id     TEXT NOT NULL REFERENCES firm(id),
  email       TEXT NOT NULL UNIQUE,
  role        TEXT NOT NULL DEFAULT 'member',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invite_firm ON firm_invite(firm_id);

-- Who acts in a session / which member a magic link belongs to.
ALTER TABLE session ADD COLUMN member_id TEXT;
ALTER TABLE magic_link_token ADD COLUMN member_id TEXT;

-- Optional per-client "managed by" tag (shared book stays visible to everyone).
ALTER TABLE client ADD COLUMN owner_member_id TEXT;

-- Backfill: every existing firm's owner becomes an owner member.
INSERT INTO member (id, firm_id, email, role, created_at)
  SELECT lower(hex(randomblob(16))), firm.id, firm.owner_email, 'owner', firm.created_at
  FROM firm
  WHERE NOT EXISTS (SELECT 1 FROM member m WHERE m.firm_id = firm.id);
