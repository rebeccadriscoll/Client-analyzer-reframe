import type {
  Env, Firm, Client, Tier, Action, Decision,
  Wave, WaveType, WaveStatus, Commitment, CommitmentState, VoiceSample, Note, Season,
  Member, FirmInvite, MemberRole,
} from "./types";
import { randomToken, sha256Hex } from "./crypto";
import { realizedRate, computeTiers } from "./scoring";

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
    min_fee: null,
    batch_size: null,
    target_rate: null,
    contribute_benchmarks: null,
  };
  await env.DB.prepare(
    "INSERT INTO firm (id, owner_email, name, created_at) VALUES (?, ?, ?, ?)"
  )
    .bind(firm.id, firm.owner_email, firm.name, firm.created_at)
    .run();
  return firm;
}

/**
 * Resolve the member for a signing-in email: an existing member, or a pending
 * invite turned into a member, or a brand-new firm with this email as owner.
 */
export async function resolveMemberForSignin(env: Env, rawEmail: string): Promise<Member> {
  const email = normalizeEmail(rawEmail);
  const existing = await env.DB.prepare("SELECT * FROM member WHERE email = ?").bind(email).first<Member>();
  if (existing) return existing;

  const invite = await env.DB.prepare("SELECT * FROM firm_invite WHERE email = ?")
    .bind(email)
    .first<FirmInvite>();
  if (invite) {
    const member: Member = {
      id: crypto.randomUUID(),
      firm_id: invite.firm_id,
      email,
      role: (invite.role as MemberRole) || "member",
      created_at: Date.now(),
    };
    await env.DB.batch([
      env.DB.prepare("INSERT INTO member (id, firm_id, email, role, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(member.id, member.firm_id, member.email, member.role, member.created_at),
      env.DB.prepare("DELETE FROM firm_invite WHERE id = ?").bind(invite.id),
    ]);
    return member;
  }

  const firm = await getOrCreateFirm(env, email);
  const owner: Member = { id: crypto.randomUUID(), firm_id: firm.id, email, role: "owner", created_at: Date.now() };
  await env.DB.prepare("INSERT INTO member (id, firm_id, email, role, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(owner.id, firm.id, owner.email, owner.role, owner.created_at)
    .run();
  return owner;
}

// ---- team ----

export async function listMembers(env: Env, firmId: string): Promise<Member[]> {
  const res = await env.DB.prepare("SELECT * FROM member WHERE firm_id = ? ORDER BY (role = 'owner') DESC, created_at ASC")
    .bind(firmId)
    .all<Member>();
  return res.results ?? [];
}

export async function listInvites(env: Env, firmId: string): Promise<FirmInvite[]> {
  const res = await env.DB.prepare("SELECT * FROM firm_invite WHERE firm_id = ? ORDER BY created_at ASC")
    .bind(firmId)
    .all<FirmInvite>();
  return res.results ?? [];
}

/** Invite an email to a firm. Returns an error code, or null on success. */
export async function inviteMember(env: Env, firmId: string, rawEmail: string): Promise<string | null> {
  const email = normalizeEmail(rawEmail);
  const existingMember = await env.DB.prepare("SELECT firm_id FROM member WHERE email = ?").bind(email).first<{ firm_id: string }>();
  if (existingMember) return existingMember.firm_id === firmId ? "already_member" : "in_other_firm";
  const existingInvite = await env.DB.prepare("SELECT firm_id FROM firm_invite WHERE email = ?").bind(email).first<{ firm_id: string }>();
  if (existingInvite) return existingInvite.firm_id === firmId ? "already_invited" : "invited_elsewhere";
  await env.DB.prepare("INSERT INTO firm_invite (id, firm_id, email, role, created_at) VALUES (?, ?, ?, 'member', ?)")
    .bind(crypto.randomUUID(), firmId, email, Date.now())
    .run();
  return null;
}

export async function cancelInvite(env: Env, firmId: string, rawEmail: string): Promise<void> {
  await env.DB.prepare("DELETE FROM firm_invite WHERE firm_id = ? AND email = ?")
    .bind(firmId, normalizeEmail(rawEmail))
    .run();
}

/** Remove a member from a firm. Owners cannot be removed here. */
export async function removeMember(env: Env, firmId: string, memberId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM member WHERE id = ? AND firm_id = ? AND role != 'owner'")
    .bind(memberId, firmId)
    .run();
}

/** Update firm-level settings. */
export async function updateSettings(
  env: Env,
  firmId: string,
  s: { name: string | null; min_fee: number | null; batch_size: number | null; target_rate: number | null; contribute_benchmarks: number | null }
): Promise<Firm> {
  await env.DB.prepare("UPDATE firm SET name = ?, min_fee = ?, batch_size = ?, target_rate = ?, contribute_benchmarks = ? WHERE id = ?")
    .bind(s.name, s.min_fee, s.batch_size, s.target_rate, s.contribute_benchmarks, firmId)
    .run();
  const row = await env.DB.prepare("SELECT * FROM firm WHERE id = ?").bind(firmId).first<Firm>();
  return row!;
}

/** Anonymized fees from every firm that has opted into the benchmark network. */
export async function getContributedFees(
  env: Env
): Promise<Array<{ entity_type: string | null; return_type: string | null; annual_fee: number; firm_id: string }>> {
  const res = await env.DB.prepare(
    `SELECT c.entity_type, c.return_type, c.annual_fee, c.firm_id
     FROM client c JOIN firm f ON f.id = c.firm_id
     WHERE f.contribute_benchmarks = 1 AND c.annual_fee IS NOT NULL AND c.annual_fee > 0`
  ).all<{ entity_type: string | null; return_type: string | null; annual_fee: number; firm_id: string }>();
  return res.results ?? [];
}

/** The firm's target realized rate, or null. Used to grade tiers absolutely. */
export async function getTargetRate(env: Env, firmId: string): Promise<number | null> {
  const row = await env.DB.prepare("SELECT target_rate FROM firm WHERE id = ?")
    .bind(firmId)
    .first<{ target_rate: number | null }>();
  return row?.target_rate ?? null;
}

// ---- seasons ----

export async function listSeasons(env: Env, firmId: string): Promise<Season[]> {
  const res = await env.DB.prepare("SELECT * FROM season WHERE firm_id = ? ORDER BY closed_at DESC")
    .bind(firmId)
    .all<Season>();
  return res.results ?? [];
}

/** Snapshot the current cycle as a season, then clear decisions + commitments. */
export async function closeSeason(
  env: Env,
  firmId: string,
  snapshot: {
    label: string; decided: number; committed: number; potential: number;
    tiers: unknown; actions: unknown;
    gross_revenue: number; book_rate: number | null; clients: number;
  }
): Promise<Season> {
  const season: Season = {
    id: crypto.randomUUID(),
    firm_id: firmId,
    label: snapshot.label,
    decided: snapshot.decided,
    committed: snapshot.committed,
    potential: snapshot.potential,
    tiers: JSON.stringify(snapshot.tiers),
    actions: JSON.stringify(snapshot.actions),
    gross_revenue: snapshot.gross_revenue,
    book_rate: snapshot.book_rate,
    clients: snapshot.clients,
    closed_at: Date.now(),
  };
  await env.DB.prepare(
    `INSERT INTO season (id, firm_id, label, decided, committed, potential, tiers, actions, gross_revenue, book_rate, clients, closed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(season.id, firmId, season.label, season.decided, season.committed, season.potential, season.tiers, season.actions,
      season.gross_revenue, season.book_rate, season.clients, season.closed_at)
    .run();
  // Clear the current cycle (clients + notes stay).
  await env.DB.batch([
    env.DB.prepare("DELETE FROM commitment WHERE firm_id = ?").bind(firmId),
    env.DB.prepare("DELETE FROM decision WHERE firm_id = ?").bind(firmId),
  ]);
  return season;
}

/** Issue a single-use magic-link token, returning the raw value (only the hash is stored). */
export async function createMagicToken(env: Env, firmId: string, memberId: string): Promise<string> {
  const raw = randomToken();
  const hash = await sha256Hex(raw);
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO magic_link_token (id, firm_id, token_hash, expires_at, consumed_at, created_at, member_id) VALUES (?, ?, ?, ?, NULL, ?, ?)"
  )
    .bind(crypto.randomUUID(), firmId, hash, now + MAGIC_TTL_MS, now, memberId)
    .run();
  return raw;
}

/** Validate + atomically consume a magic-link token. Returns firm + member ids, or null. */
export async function consumeMagicToken(
  env: Env,
  rawToken: string
): Promise<{ firm_id: string; member_id: string | null } | null> {
  const hash = await sha256Hex(rawToken);
  const now = Date.now();
  const row = await env.DB.prepare(
    "SELECT id, firm_id, member_id, expires_at, consumed_at FROM magic_link_token WHERE token_hash = ?"
  )
    .bind(hash)
    .first<{ id: string; firm_id: string; member_id: string | null; expires_at: number; consumed_at: number | null }>();

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
  return { firm_id: row.firm_id, member_id: row.member_id };
}

/** Create a session, returning the raw token for the httpOnly cookie. */
export async function createSession(env: Env, firmId: string, memberId: string | null): Promise<string> {
  const raw = randomToken();
  const hash = await sha256Hex(raw);
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO session (id, firm_id, token_hash, expires_at, created_at, member_id) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(crypto.randomUUID(), firmId, hash, now + SESSION_TTL_MS, now, memberId)
    .run();
  return raw;
}

/** Resolve a session cookie to its firm, or null if missing/expired. */
export async function getFirmBySession(env: Env, rawToken: string | undefined): Promise<Firm | null> {
  const ctx = await getSessionContext(env, rawToken);
  return ctx?.firm ?? null;
}

/** Resolve a session cookie to the firm and the acting member (who is signed in). */
export async function getSessionContext(
  env: Env,
  rawToken: string | undefined
): Promise<{ firm: Firm; member: Member } | null> {
  if (!rawToken) return null;
  const hash = await sha256Hex(rawToken);
  const row = await env.DB.prepare(
    `SELECT f.*, s.member_id AS session_member_id FROM session s JOIN firm f ON f.id = s.firm_id
     WHERE s.token_hash = ? AND s.expires_at > ?`
  )
    .bind(hash, Date.now())
    .first<Firm & { session_member_id: string | null }>();
  if (!row) return null;
  const { session_member_id, ...firm } = row;

  let member: Member | null = null;
  if (session_member_id) {
    member = await env.DB.prepare("SELECT * FROM member WHERE id = ? AND firm_id = ?")
      .bind(session_member_id, firm.id)
      .first<Member>();
  }
  // Legacy session (no member_id) or a removed member: fall back to the firm owner.
  if (!member) {
    member = await env.DB.prepare(
      "SELECT * FROM member WHERE firm_id = ? ORDER BY (role = 'owner') DESC, created_at ASC LIMIT 1"
    )
      .bind(firm.id)
      .first<Member>();
  }
  if (!member) return null;
  return { firm: firm as Firm, member };
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

/** Clamp a risk/relationship input to 1..3, or null. */
function level(v: number | null | undefined): number | null {
  if (v == null) return null;
  const n = Math.round(v);
  return n >= 1 && n <= 3 ? n : null;
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
    risk_level: null,
    relationship_level: null,
    owner_member_id: null,
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

/** A realistic demo book (varied fees/hours so tiers spread A-D). */
const SAMPLE_CLIENTS: Array<Omit<NewClient, "realized_rate" | "tier"> & { entity_type: string; return_type: string }> = [
  { name: "Summit Dental", email: "office@summitdental.example.com", entity_type: "S-Corp", return_type: "1120-S", annual_fee: 6800, est_hours: 17 },
  { name: "Rivera Landscaping", email: "ana@riveralandscaping.example.com", entity_type: "LLC", return_type: "1065", annual_fee: 5200, est_hours: 16 },
  { name: "Blue Harbor Cafe", email: "hello@blueharborcafe.example.com", entity_type: "LLC", return_type: "1065", annual_fee: 4200, est_hours: 14 },
  { name: "Nguyen Family Trust", email: "trust@nguyenfamily.example.com", entity_type: "Trust", return_type: "1041", annual_fee: 3600, est_hours: 14 },
  { name: "Keystone Realty", email: "admin@keystonerealty.example.com", entity_type: "S-Corp", return_type: "1120-S", annual_fee: 3000, est_hours: 15 },
  { name: "Orchard Pediatrics", email: "billing@orchardpeds.example.com", entity_type: "S-Corp", return_type: "1120-S", annual_fee: 3800, est_hours: 20 },
  { name: "Delgado Consulting", email: "sam@delgadoconsulting.example.com", entity_type: "Sole Prop", return_type: "Schedule C", annual_fee: 2200, est_hours: 14 },
  { name: "Maple Street Bakery", email: "orders@maplestreetbakery.example.com", entity_type: "LLC", return_type: "1065", annual_fee: 1900, est_hours: 16 },
  { name: "Harbor Freight Hauling", email: "dispatch@harborhauling.example.com", entity_type: "LLC", return_type: "1065", annual_fee: 1600, est_hours: 18 },
  { name: "Pinewood Daycare", email: "care@pinewooddaycare.example.com", entity_type: "Sole Prop", return_type: "Schedule C", annual_fee: 1400, est_hours: 20 },
  { name: "Ace Handyman", email: "jobs@acehandyman.example.com", entity_type: "Sole Prop", return_type: "Schedule C", annual_fee: 1100, est_hours: 22 },
  { name: "Corner Laundromat", email: "owner@cornerlaundromat.example.com", entity_type: "LLC", return_type: "1065", annual_fee: 900, est_hours: 20 },
];

/** True if the firm has any clients at all. */
export async function firmHasClients(env: Env, firmId: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT 1 AS ok FROM client WHERE firm_id = ? LIMIT 1").bind(firmId).first<{ ok: number }>();
  return row != null;
}

/** Load the demo book, tagged flags='sample' so it can be cleared cleanly. */
export async function loadSampleClients(env: Env, firmId: string): Promise<Client[]> {
  const now = Date.now();
  const staged: NewClient[] = SAMPLE_CLIENTS.map((c) => ({
    name: c.name,
    email: c.email,
    entity_type: c.entity_type,
    return_type: c.return_type,
    annual_fee: c.annual_fee,
    est_hours: c.est_hours,
    realized_rate: realizedRate(c.annual_fee, c.est_hours),
    tier: null,
  }));
  const target = await getTargetRate(env, firmId);
  const tiers = computeTiers(staged, (c) => c.realized_rate, target);
  const stmts = staged.map((c, i) =>
    env.DB.prepare(
      `INSERT INTO client (id, firm_id, name, email, entity_type, return_type, annual_fee, est_hours, realized_rate, tier, flags, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sample', ?)`
    ).bind(
      crypto.randomUUID(), firmId, c.name, c.email, c.entity_type, c.return_type,
      c.annual_fee, c.est_hours, c.realized_rate, tiers[i], now
    )
  );
  await env.DB.batch(stmts);
  return listClients(env, firmId);
}

/** Remove only the sample clients (and anything hanging off them), then re-tier. */
export async function clearSampleClients(env: Env, firmId: string): Promise<void> {
  const rows = await env.DB.prepare("SELECT id FROM client WHERE firm_id = ? AND flags = 'sample'")
    .bind(firmId)
    .all<{ id: string }>();
  const ids = (rows.results ?? []).map((r) => r.id);
  if (ids.length === 0) return;
  const stmts: D1PreparedStatement[] = [];
  for (const id of ids) {
    stmts.push(env.DB.prepare("DELETE FROM note WHERE client_id = ? AND firm_id = ?").bind(id, firmId));
    stmts.push(env.DB.prepare("DELETE FROM commitment WHERE client_id = ? AND firm_id = ?").bind(id, firmId));
    stmts.push(env.DB.prepare("DELETE FROM decision WHERE client_id = ? AND firm_id = ?").bind(id, firmId));
    stmts.push(env.DB.prepare("DELETE FROM client WHERE id = ? AND firm_id = ?").bind(id, firmId));
  }
  await env.DB.batch(stmts);
  await retierFirm(env, firmId);
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

export interface ClientFields {
  name: string;
  email: string | null;
  entity_type: string | null;
  return_type: string | null;
  annual_fee: number | null;
  est_hours: number | null;
  risk_level?: number | null;
  relationship_level?: number | null;
  owner_member_id?: string | null;
}

/** Return the id only if it names a member of this firm; else null. */
async function validMember(env: Env, firmId: string, memberId: string | null | undefined): Promise<string | null> {
  if (!memberId) return null;
  const row = await env.DB.prepare("SELECT 1 AS ok FROM member WHERE id = ? AND firm_id = ?")
    .bind(memberId, firmId)
    .first<{ ok: number }>();
  return row ? memberId : null;
}

/** Recompute A-D tiers across a firm's whole book (after any add/edit/delete). */
export async function retierFirm(env: Env, firmId: string): Promise<void> {
  const clients = await listClients(env, firmId);
  const target = await getTargetRate(env, firmId);
  const tiers = computeTiers(clients, (c) => c.realized_rate, target);
  const stmts = clients.map((c, i) =>
    env.DB.prepare("UPDATE client SET tier = ? WHERE id = ?").bind(tiers[i], c.id)
  );
  if (stmts.length) await env.DB.batch(stmts);
}

/** Create a single client by hand, then re-tier. */
export async function createClient(env: Env, firmId: string, f: ClientFields): Promise<Client> {
  const client: Client = {
    id: crypto.randomUUID(),
    firm_id: firmId,
    name: f.name,
    email: f.email,
    entity_type: f.entity_type,
    return_type: f.return_type,
    annual_fee: f.annual_fee,
    est_hours: f.est_hours,
    realized_rate: realizedRate(f.annual_fee, f.est_hours),
    tier: null,
    flags: null,
    risk_level: level(f.risk_level),
    relationship_level: level(f.relationship_level),
    owner_member_id: await validMember(env, firmId, f.owner_member_id),
    created_at: Date.now(),
  };
  await env.DB.prepare(
    `INSERT INTO client (id, firm_id, name, email, entity_type, return_type, annual_fee, est_hours, realized_rate, tier, flags, risk_level, relationship_level, owner_member_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(client.id, firmId, client.name, client.email, client.entity_type, client.return_type,
      client.annual_fee, client.est_hours, client.realized_rate, client.tier, client.flags,
      client.risk_level, client.relationship_level, client.owner_member_id, client.created_at)
    .run();
  await retierFirm(env, firmId);
  return (await getClient(env, firmId, client.id))!;
}

/** Update a client's fields, recompute its realized rate, then re-tier. */
export async function updateClient(env: Env, firmId: string, id: string, f: ClientFields): Promise<Client | null> {
  const existing = await getClient(env, firmId, id);
  if (!existing) return null;
  const rate = realizedRate(f.annual_fee, f.est_hours);
  const ownerMember = await validMember(env, firmId, f.owner_member_id);
  await env.DB.prepare(
    `UPDATE client SET name = ?, email = ?, entity_type = ?, return_type = ?, annual_fee = ?, est_hours = ?, realized_rate = ?, risk_level = ?, relationship_level = ?, owner_member_id = ?
     WHERE id = ? AND firm_id = ?`
  )
    .bind(f.name, f.email, f.entity_type, f.return_type, f.annual_fee, f.est_hours, rate,
      level(f.risk_level), level(f.relationship_level), ownerMember, id, firmId)
    .run();
  await retierFirm(env, firmId);
  return getClient(env, firmId, id);
}

/** Delete one client and everything hanging off it, then re-tier. */
export async function deleteClient(env: Env, firmId: string, id: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM note WHERE client_id = ? AND firm_id = ?").bind(id, firmId),
    env.DB.prepare("DELETE FROM commitment WHERE client_id = ? AND firm_id = ?").bind(id, firmId),
    env.DB.prepare("DELETE FROM decision WHERE client_id = ? AND firm_id = ?").bind(id, firmId),
    env.DB.prepare("DELETE FROM client WHERE id = ? AND firm_id = ?").bind(id, firmId),
  ]);
  await retierFirm(env, firmId);
}

/** Remove every client for a firm (used by "replace" re-import). */
export async function deleteClientsForFirm(env: Env, firmId: string): Promise<void> {
  // Clear everything that references clients first, to keep the data consistent.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM note WHERE firm_id = ?").bind(firmId),
    env.DB.prepare("DELETE FROM commitment WHERE firm_id = ?").bind(firmId),
    env.DB.prepare("DELETE FROM decision WHERE firm_id = ?").bind(firmId),
    env.DB.prepare("DELETE FROM client WHERE firm_id = ?").bind(firmId),
  ]);
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

// ---- notes ----

export async function addNote(env: Env, firmId: string, clientId: string, bodyText: string): Promise<Note> {
  const note: Note = {
    id: crypto.randomUUID(),
    firm_id: firmId,
    client_id: clientId,
    body: bodyText,
    created_at: Date.now(),
  };
  await env.DB.prepare("INSERT INTO note (id, firm_id, client_id, body, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(note.id, note.firm_id, note.client_id, note.body, note.created_at)
    .run();
  return note;
}

export async function getNotes(env: Env, firmId: string, clientId: string): Promise<Note[]> {
  const res = await env.DB.prepare(
    "SELECT * FROM note WHERE firm_id = ? AND client_id = ? ORDER BY created_at DESC"
  )
    .bind(firmId, clientId)
    .all<Note>();
  return res.results ?? [];
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
