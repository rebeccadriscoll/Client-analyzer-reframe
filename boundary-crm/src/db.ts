import type {
  Env, Firm, Client, Tier, Action, Decision,
  Wave, WaveType, WaveStatus, Commitment, CommitmentState, VoiceSample,
} from "./types";
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
  email: string | null;
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
    email: c.email,
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
         (id, firm_id, name, email, entity_type, return_type, annual_fee, est_hours, realized_rate, tier, flags, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      c.id, c.firm_id, c.name, c.email, c.entity_type, c.return_type,
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
  // Decisions reference clients, so clear them first to keep the data consistent.
  await env.DB.prepare("DELETE FROM decision WHERE firm_id = ?").bind(firmId).run();
  await env.DB.prepare("DELETE FROM client WHERE firm_id = ?").bind(firmId).run();
}

/** One client, scoped to the firm, or null. */
export async function getClient(env: Env, firmId: string, clientId: string): Promise<Client | null> {
  const row = await env.DB.prepare("SELECT * FROM client WHERE id = ? AND firm_id = ?")
    .bind(clientId, firmId)
    .first<Client>();
  return row ?? null;
}

/** True if the client exists and belongs to this firm. */
export async function clientBelongsToFirm(env: Env, firmId: string, clientId: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT 1 AS ok FROM client WHERE id = ? AND firm_id = ?")
    .bind(clientId, firmId)
    .first<{ ok: number }>();
  return row != null;
}

// ---- decisions ----

/** All decisions for a firm. */
export async function getDecisions(env: Env, firmId: string): Promise<Decision[]> {
  const res = await env.DB.prepare("SELECT * FROM decision WHERE firm_id = ?").bind(firmId).all<Decision>();
  return res.results ?? [];
}

/**
 * Create or update the decision for a client. On update, action/new_fee/timestamp
 * change but drafted_message is preserved (it is owned by Step 4).
 */
export async function upsertDecision(
  env: Env,
  firmId: string,
  input: { client_id: string; action: Action; new_fee: number | null }
): Promise<Decision> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO decision (id, client_id, firm_id, action, new_fee, drafted_message, decided_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?)
     ON CONFLICT(client_id) DO UPDATE SET
       action = excluded.action,
       new_fee = excluded.new_fee,
       decided_at = excluded.decided_at`
  )
    .bind(crypto.randomUUID(), input.client_id, firmId, input.action, input.new_fee, now)
    .run();

  const row = await env.DB.prepare("SELECT * FROM decision WHERE client_id = ?")
    .bind(input.client_id)
    .first<Decision>();
  return row!;
}

/** The decision for one client, scoped to the firm. */
export async function getDecisionForClient(env: Env, firmId: string, clientId: string): Promise<Decision | null> {
  const row = await env.DB.prepare("SELECT * FROM decision WHERE client_id = ? AND firm_id = ?")
    .bind(clientId, firmId)
    .first<Decision>();
  return row ?? null;
}

/** Save the drafted message (The Words) onto an existing decision. */
export async function setDraftedMessage(
  env: Env,
  firmId: string,
  clientId: string,
  message: string
): Promise<Decision | null> {
  await env.DB.prepare("UPDATE decision SET drafted_message = ? WHERE client_id = ? AND firm_id = ?")
    .bind(message, clientId, firmId)
    .run();
  return getDecisionForClient(env, firmId, clientId);
}

// ---- waves ----

export async function getWaves(env: Env, firmId: string): Promise<Wave[]> {
  const res = await env.DB.prepare("SELECT * FROM wave WHERE firm_id = ?").bind(firmId).all<Wave>();
  return res.results ?? [];
}

/** Set a wave's send date and status, creating the wave row on first touch. */
export async function upsertWave(
  env: Env,
  firmId: string,
  type: WaveType,
  sendDate: string | null,
  status: WaveStatus
): Promise<Wave> {
  await env.DB.prepare(
    `INSERT INTO wave (id, firm_id, type, send_date, status)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(firm_id, type) DO UPDATE SET send_date = excluded.send_date, status = excluded.status`
  )
    .bind(crypto.randomUUID(), firmId, type, sendDate, status)
    .run();
  const row = await env.DB.prepare("SELECT * FROM wave WHERE firm_id = ? AND type = ?")
    .bind(firmId, type)
    .first<Wave>();
  return row!;
}

// ---- commitments ----

export async function getCommitments(env: Env, firmId: string): Promise<Commitment[]> {
  const res = await env.DB.prepare("SELECT * FROM commitment WHERE firm_id = ?").bind(firmId).all<Commitment>();
  return res.results ?? [];
}

export async function getCommitmentByClient(env: Env, firmId: string, clientId: string): Promise<Commitment | null> {
  const row = await env.DB.prepare("SELECT * FROM commitment WHERE client_id = ? AND firm_id = ?")
    .bind(clientId, firmId)
    .first<Commitment>();
  return row ?? null;
}

/**
 * Create or update a client's commitment. A link_token is minted once on
 * creation and never changes. Fields left undefined keep their current value.
 */
export async function upsertCommitment(
  env: Env,
  firmId: string,
  clientId: string,
  opts: { state?: CommitmentState; committed_fee?: number | null }
): Promise<Commitment> {
  const now = Date.now();
  const existing = await getCommitmentByClient(env, firmId, clientId);
  if (existing) {
    const state = opts.state ?? existing.state;
    const fee = opts.committed_fee !== undefined ? opts.committed_fee : existing.committed_fee;
    await env.DB.prepare("UPDATE commitment SET state = ?, committed_fee = ?, updated_at = ? WHERE id = ?")
      .bind(state, fee, now, existing.id)
      .run();
    return { ...existing, state, committed_fee: fee, updated_at: now };
  }
  const commitment: Commitment = {
    id: crypto.randomUUID(),
    client_id: clientId,
    firm_id: firmId,
    link_token: randomToken(),
    state: opts.state ?? "told",
    committed_fee: opts.committed_fee ?? null,
    updated_at: now,
  };
  await env.DB.prepare(
    `INSERT INTO commitment (id, client_id, firm_id, link_token, state, committed_fee, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      commitment.id, commitment.client_id, commitment.firm_id, commitment.link_token,
      commitment.state, commitment.committed_fee, commitment.updated_at
    )
    .run();
  return commitment;
}

/** Public lookup by link token: the commitment plus the client and decision it references. */
export async function getCommitmentContextByToken(
  env: Env,
  token: string
): Promise<{ commitment: Commitment; client: Client; decision: Decision } | null> {
  const commitment = await env.DB.prepare("SELECT * FROM commitment WHERE link_token = ?")
    .bind(token)
    .first<Commitment>();
  if (!commitment) return null;
  const client = await env.DB.prepare("SELECT * FROM client WHERE id = ?")
    .bind(commitment.client_id)
    .first<Client>();
  const decision = await env.DB.prepare("SELECT * FROM decision WHERE client_id = ?")
    .bind(commitment.client_id)
    .first<Decision>();
  if (!client || !decision) return null;
  return { commitment, client, decision };
}

// ---- voice samples (The Words) ----

/** Store a message the owner wrote as a voice example. */
export async function addVoiceSample(
  env: Env,
  firmId: string,
  action: Action | null,
  message: string
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO voice_sample (id, firm_id, action, message, created_at) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(crypto.randomUUID(), firmId, action, message, Date.now())
    .run();
}

/** The most recent voice examples for a firm (newest first). */
export async function getVoiceSamples(env: Env, firmId: string, limit = 4): Promise<VoiceSample[]> {
  const res = await env.DB.prepare(
    "SELECT * FROM voice_sample WHERE firm_id = ? ORDER BY created_at DESC LIMIT ?"
  )
    .bind(firmId, limit)
    .all<VoiceSample>();
  return res.results ?? [];
}

/** How many voice examples a firm has taught. */
export async function countVoiceSamples(env: Env, firmId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM voice_sample WHERE firm_id = ?")
    .bind(firmId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Public state change from the confirm page. */
export async function setCommitmentStateByToken(
  env: Env,
  token: string,
  state: CommitmentState,
  committedFee: number | null
): Promise<void> {
  await env.DB.prepare("UPDATE commitment SET state = ?, committed_fee = ?, updated_at = ? WHERE link_token = ?")
    .bind(state, committedFee, Date.now(), token)
    .run();
}
