import type { Env, Firm, Client, Tier } from "./types";
import { randomToken, sha256Hex } from "./crypto";

const MAGIC_TTL_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Find the firm for this owner email, creating it on first sign-in. */
export async function getOrCreateFirm(env: Env, rawEmail: string): Promise<Firm> {
  const email = normalizeEmail(rawEmail);
  const existing = await env.DB.prepare("SELECT * FROM firm WHERE owner_email = ?")
    .bind(email)
    .first<Firm>();
  if (existing) return existing;

  const firm: Firm = {
    id: crypto.randomUUID(),
    owner_email: email,
    name: null,
    created_at: Date.now(),
  };
  await env.DB.prepare(
    "INSERT INTO firm (id, owner_email, name, created_at) VALUES (?, ?, ?, ?)"
  )
    .bind(firm.id, firm.owner_email, firm.name, firm.created_at)
    .run();
  return firm;
}

/** Issue a single-use magic-link token, returning the raw value (only the hash is stored). */
export async function createMagicToken(env: Env, firmId: string): Promise<string> {
  const raw = randomToken();
  const hash = await sha256Hex(raw);
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO magic_link_token (id, firm_id, token_hash, expires_at, consumed_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)"
  )
    .bind(crypto.randomUUID(), firmId, hash, now + MAGIC_TTL_MS, now)
    .run();
  return raw;
}

/** Validate + atomically consume a magic-link token. Returns the firm id or null. */
export async function consumeMagicToken(env: Env, rawToken: string): Promise<string | null> {
  const hash = await sha256Hex(rawToken);
  const now = Date.now();
  const row = await env.DB.prepare(
    "SELECT id, firm_id, expires_at, consumed_at FROM magic_link_token WHERE token_hash = ?"
  )
    .bind(hash)
    .first<{ id: string; firm_id: string; expires_at: number; consumed_at: number | null }>();

  if (!row) return null;
  if (row.consumed_at !== null) return null;
  if (row.expires_at < now) return null;

  // Guard against double-redemption: only the update that flips consumed_at wins.
  const res = await env.DB.prepare(
    "UPDATE magic_link_token SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL"
  )
    .bind(now, row.id)
    .run();
  if (!res.meta.changes) return null;
  return row.firm_id;
}

/** Create a session, returning the raw token for the httpOnly cookie. */
export async function createSession(env: Env, firmId: string): Promise<string> {
  const raw = randomToken();
  const hash = await sha256Hex(raw);
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO session (id, firm_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(crypto.randomUUID(), firmId, hash, now + SESSION_TTL_MS, now)
    .run();
  return raw;
}

/** Resolve a session cookie to its firm, or null if missing/expired. */
export async function getFirmBySession(env: Env, rawToken: string | undefined): Promise<Firm | null> {
  if (!rawToken) return null;
  const hash = await sha256Hex(rawToken);
  const row = await env.DB.prepare(
    `SELECT f.* FROM session s JOIN firm f ON f.id = s.firm_id
     WHERE s.token_hash = ? AND s.expires_at > ?`
  )
    .bind(hash, Date.now())
    .first<Firm>();
  return row ?? null;
}

/** Revoke a session (logout). */
export async function deleteSession(env: Env, rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  const hash = await sha256Hex(rawToken);
  await env.DB.prepare("DELETE FROM session WHERE token_hash = ?").bind(hash).run();
}

// ---- clients ----

export interface NewClient {
  name: string;
  entity_type: string | null;
  return_type: string | null;
  annual_fee: number | null;
  est_hours: number | null;
  realized_rate: number | null;
  tier: Tier | null;
}

/** Insert a batch of clients for a firm and return the created rows. */
export async function insertClients(env: Env, firmId: string, news: NewClient[]): Promise<Client[]> {
  const now = Date.now();
  const rows: Client[] = news.map((c) => ({
    id: crypto.randomUUID(),
    firm_id: firmId,
    name: c.name,
    entity_type: c.entity_type,
    return_type: c.return_type,
    annual_fee: c.annual_fee,
    est_hours: c.est_hours,
    realized_rate: c.realized_rate,
    tier: c.tier,
    flags: null,
    created_at: now,
  }));

  if (rows.length === 0) return rows;

  const stmts = rows.map((c) =>
    env.DB.prepare(
      `INSERT INTO client
         (id, firm_id, name, entity_type, return_type, annual_fee, est_hours, realized_rate, tier, flags, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      c.id, c.firm_id, c.name, c.entity_type, c.return_type,
      c.annual_fee, c.est_hours, c.realized_rate, c.tier, c.flags, c.created_at
    )
  );
  await env.DB.batch(stmts);
  return rows;
}

/** All clients for a firm, best tier and highest realized rate first. */
export async function listClients(env: Env, firmId: string): Promise<Client[]> {
  const res = await env.DB.prepare(
    `SELECT * FROM client WHERE firm_id = ?
     ORDER BY (tier IS NULL), tier ASC, realized_rate DESC, name ASC`
  )
    .bind(firmId)
    .all<Client>();
  return res.results ?? [];
}

/** Remove every client for a firm (used by "replace" re-import). */
export async function deleteClientsForFirm(env: Env, firmId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM client WHERE firm_id = ?").bind(firmId).run();
}
