import type { Env, Firm } from "./types";
import { parseCookies } from "./crypto";
import {
  getOrCreateFirm,
  createMagicToken,
  consumeMagicToken,
  createSession,
  getFirmBySession,
  deleteSession,
  insertClients,
  listClients,
  deleteClientsForFirm,
  clientBelongsToFirm,
  getDecisions,
  upsertDecision,
  getDecisionForClient,
  setDraftedMessage,
  getClient,
  getWaves,
  upsertWave,
  getCommitments,
  upsertCommitment,
  getCommitmentContextByToken,
  setCommitmentStateByToken,
  getVoiceSamples,
  addVoiceSample,
  countVoiceSamples,
  type NewClient,
} from "./db";
import type { Action, WaveType, WaveStatus, CommitmentState } from "./types";
import { generateWords } from "./words";
import { WAVE_ORDER, WAVE_META, proposedFee } from "./rollout";
import { renderCommitPage } from "./commit_page";
import { sendMagicLink } from "./email";
import { SpreadsheetImporter } from "./import/importer";
import { suggestMapping, refineWithLLM, CLIENT_FIELDS } from "./import/mapping";
import { realizedRate, computeTiers, parseNumeric } from "./scoring";

const MAX_CSV_BYTES = 2_000_000; // 2 MB
const MAX_ROWS = 5000;

const SESSION_COOKIE = "bcrm_session";
const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // seconds

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    try {
      if (pathname === "/api/auth/request" && request.method === "POST") {
        return await handleAuthRequest(request, env, url);
      }
      if (pathname === "/auth/verify" && request.method === "GET") {
        return await handleVerify(env, url);
      }
      // Public commitment confirm page + response (token-authenticated, no session).
      if (pathname.startsWith("/c/") && request.method === "GET") {
        return await handleCommitPage(env, decodeURIComponent(pathname.slice(3)));
      }
      if (pathname.startsWith("/api/commit/") && request.method === "POST") {
        return await handleCommitRespond(request, env, decodeURIComponent(pathname.slice("/api/commit/".length)));
      }
      if (pathname === "/api/me" && request.method === "GET") {
        return await handleMe(request, env);
      }
      if (pathname === "/api/auth/logout" && request.method === "POST") {
        return await handleLogout(request, env);
      }
      if (pathname === "/api/clients" && request.method === "GET") {
        return await handleListClients(request, env);
      }
      if (pathname === "/api/import/preview" && request.method === "POST") {
        return await handleImportPreview(request, env);
      }
      if (pathname === "/api/import/commit" && request.method === "POST") {
        return await handleImportCommit(request, env);
      }
      if (pathname === "/api/decisions" && request.method === "GET") {
        return await handleListDecisions(request, env);
      }
      if (pathname === "/api/decisions" && request.method === "POST") {
        return await handleSaveDecision(request, env);
      }
      if (pathname === "/api/words/generate" && request.method === "POST") {
        return await handleWordsGenerate(request, env);
      }
      if (pathname === "/api/words/save" && request.method === "POST") {
        return await handleWordsSave(request, env);
      }
      if (pathname === "/api/voice" && request.method === "GET") {
        return await handleVoiceStatus(request, env);
      }
      if (pathname === "/api/voice/teach" && request.method === "POST") {
        return await handleVoiceTeach(request, env);
      }
      if (pathname === "/api/rollout" && request.method === "GET") {
        return await handleRollout(request, env);
      }
      if (pathname === "/api/waves" && request.method === "POST") {
        return await handleSaveWave(request, env);
      }
      if (pathname === "/api/commitments" && request.method === "POST") {
        return await handleSaveCommitment(request, env);
      }
      // Any other /api/* path is a real 404, not the HTML shell.
      if (pathname.startsWith("/api/")) {
        return json({ error: "not_found" }, 404);
      }
    } catch (err) {
      console.error("boundary-crm error:", err);
      return json({ error: "server_error" }, 500);
    }

    // Everything else is served by the static assets binding (the shell).
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

/** POST /api/auth/request { email } — issue and send a magic link. */
async function handleAuthRequest(request: Request, env: Env, url: URL): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const email =
    body && typeof body === "object" && typeof (body as { email?: unknown }).email === "string"
      ? (body as { email: string }).email.trim()
      : "";
  if (!isValidEmail(email)) return json({ error: "invalid_email" }, 400);

  const firm = await getOrCreateFirm(env, email);
  const rawToken = await createMagicToken(env, firm.id);
  const base = (env.APP_URL || url.origin).replace(/\/$/, "");
  const link = `${base}/auth/verify?token=${rawToken}`;
  const result = await sendMagicLink(env, firm.owner_email, link);

  // Response shape is identical whether or not the firm already existed, so it
  // never reveals which emails have accounts. devLink is only ever set in dev.
  return json({ ok: true, emailSent: result.sent, devLink: result.devLink ?? null });
}

/** GET /auth/verify?token=... — consume the token, start a session, redirect home. */
async function handleVerify(env: Env, url: URL): Promise<Response> {
  const base = (env.APP_URL || url.origin).replace(/\/$/, "");
  const token = url.searchParams.get("token");
  if (!token) return redirect(`${base}/?auth=invalid`);

  const firmId = await consumeMagicToken(env, token);
  if (!firmId) return redirect(`${base}/?auth=invalid`);

  const session = await createSession(env, firmId);
  const headers = new Headers({ Location: `${base}/` });
  headers.append("Set-Cookie", sessionCookie(session, SESSION_MAX_AGE));
  return new Response(null, { status: 302, headers });
}

/** GET /api/me — who is signed in for this session. */
async function handleMe(request: Request, env: Env): Promise<Response> {
  const cookies = parseCookies(request.headers.get("Cookie"));
  const firm = await getFirmBySession(env, cookies[SESSION_COOKIE]);
  if (!firm) return json({ authenticated: false }, 401);
  return json({ authenticated: true, firm: { email: firm.owner_email, name: firm.name } });
}

/** POST /api/auth/logout — revoke the session and clear the cookie. */
async function handleLogout(request: Request, env: Env): Promise<Response> {
  const cookies = parseCookies(request.headers.get("Cookie"));
  await deleteSession(env, cookies[SESSION_COOKIE]);
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append("Set-Cookie", sessionCookie("", 0));
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

/** Resolve the signed-in firm from the session cookie, or null. */
async function firmFromRequest(request: Request, env: Env): Promise<Firm | null> {
  const cookies = parseCookies(request.headers.get("Cookie"));
  return getFirmBySession(env, cookies[SESSION_COOKIE]);
}

/** GET /api/clients — the firm's clients with a tier breakdown. */
async function handleListClients(request: Request, env: Env): Promise<Response> {
  const firm = await firmFromRequest(request, env);
  if (!firm) return json({ error: "unauthorized" }, 401);
  const clients = await listClients(env, firm.id);
  return json({ clients, tiers: tierCounts(clients), count: clients.length });
}

/** POST /api/import/preview { csv } — parse and suggest a column mapping. */
async function handleImportPreview(request: Request, env: Env): Promise<Response> {
  const firm = await firmFromRequest(request, env);
  if (!firm) return json({ error: "unauthorized" }, 401);

  const csv = await readCsvBody(request);
  if (csv === null) return json({ error: "invalid_csv" }, 400);
  if (csv.length > MAX_CSV_BYTES) return json({ error: "too_large" }, 413);

  const table = new SpreadsheetImporter().parse(csv);
  if (table.headers.length === 0) return json({ error: "empty" }, 400);
  if (table.rows.length > MAX_ROWS) return json({ error: "too_many_rows", max: MAX_ROWS }, 413);

  const sample = table.rows.slice(0, 5);
  let suggestions = suggestMapping(table.headers);
  suggestions = await refineWithLLM(env, table.headers, sample, suggestions);

  return json({
    headers: table.headers,
    sample,
    rowCount: table.rows.length,
    suggestions,
  });
}

/** POST /api/import/commit { csv, mapping, replace? } — write clients. */
async function handleImportCommit(request: Request, env: Env): Promise<Response> {
  const firm = await firmFromRequest(request, env);
  if (!firm) return json({ error: "unauthorized" }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const b = body as { csv?: unknown; mapping?: unknown; replace?: unknown };
  if (typeof b.csv !== "string" || !b.mapping || typeof b.mapping !== "object") {
    return json({ error: "bad_request" }, 400);
  }
  if (b.csv.length > MAX_CSV_BYTES) return json({ error: "too_large" }, 413);

  const mapping = b.mapping as Record<string, string | null>;
  const table = new SpreadsheetImporter().parse(b.csv);
  if (table.headers.length === 0) return json({ error: "empty" }, 400);
  if (table.rows.length > MAX_ROWS) return json({ error: "too_many_rows", max: MAX_ROWS }, 413);

  // Column header -> index, and each field -> its chosen column index.
  const colIndex = new Map<string, number>();
  table.headers.forEach((h, i) => colIndex.set(h, i));
  const fieldCol = new Map<string, number>();
  for (const f of CLIENT_FIELDS) {
    const col = mapping[f.key];
    if (typeof col === "string" && colIndex.has(col)) fieldCol.set(f.key, colIndex.get(col)!);
  }
  if (!fieldCol.has("name")) return json({ error: "name_unmapped" }, 400);

  const cell = (row: string[], field: string): string | null => {
    const idx = fieldCol.get(field);
    if (idx === undefined) return null;
    const v = row[idx];
    return v == null ? null : v.trim();
  };

  let skipped = 0;
  const staged: NewClient[] = [];
  for (const row of table.rows) {
    const name = cell(row, "name");
    if (!name) {
      skipped++;
      continue;
    }
    const annual_fee = parseNumeric(cell(row, "annual_fee"));
    const est_hours = parseNumeric(cell(row, "est_hours"));
    staged.push({
      name,
      entity_type: emptyToNull(cell(row, "entity_type")),
      return_type: emptyToNull(cell(row, "return_type")),
      annual_fee,
      est_hours,
      realized_rate: realizedRate(annual_fee, est_hours),
      tier: null,
    });
  }

  if (staged.length === 0) return json({ error: "no_rows", skipped }, 400);

  const tiers = computeTiers(staged, (c) => c.realized_rate);
  staged.forEach((c, i) => (c.tier = tiers[i]));

  if (b.replace === true) await deleteClientsForFirm(env, firm.id);
  const created = await insertClients(env, firm.id, staged);
  const all = await listClients(env, firm.id);

  return json({
    imported: created.length,
    skipped,
    tiers: tierCounts(created),
    clients: all,
    count: all.length,
  });
}

const ACTIONS: Action[] = ["keep", "raise", "fire", "nudge"];

/** GET /api/decisions — every decision for the firm. */
async function handleListDecisions(request: Request, env: Env): Promise<Response> {
  const firm = await firmFromRequest(request, env);
  if (!firm) return json({ error: "unauthorized" }, 401);
  const decisions = await getDecisions(env, firm.id);
  return json({ decisions, count: decisions.length });
}

/** POST /api/decisions { client_id, action, new_fee? } — save one decision. */
async function handleSaveDecision(request: Request, env: Env): Promise<Response> {
  const firm = await firmFromRequest(request, env);
  if (!firm) return json({ error: "unauthorized" }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const b = body as { client_id?: unknown; action?: unknown; new_fee?: unknown };

  if (typeof b.client_id !== "string") return json({ error: "bad_request" }, 400);
  if (typeof b.action !== "string" || !ACTIONS.includes(b.action as Action)) {
    return json({ error: "invalid_action" }, 400);
  }
  const action = b.action as Action;

  let new_fee: number | null = null;
  if (action === "raise") {
    const fee = typeof b.new_fee === "number" ? b.new_fee : Number(b.new_fee);
    new_fee = Number.isFinite(fee) && fee > 0 ? fee : null;
  }

  if (!(await clientBelongsToFirm(env, firm.id, b.client_id))) {
    return json({ error: "not_found" }, 404);
  }

  const decision = await upsertDecision(env, firm.id, { client_id: b.client_id, action, new_fee });
  return json({ decision });
}

/** POST /api/words/generate { client_id } — draft a message for the decision. */
async function handleWordsGenerate(request: Request, env: Env): Promise<Response> {
  const firm = await firmFromRequest(request, env);
  if (!firm) return json({ error: "unauthorized" }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const clientId = (body as { client_id?: unknown }).client_id;
  if (typeof clientId !== "string") return json({ error: "bad_request" }, 400);

  const client = await getClient(env, firm.id, clientId);
  if (!client) return json({ error: "not_found" }, 404);
  const decision = await getDecisionForClient(env, firm.id, clientId);
  if (!decision) return json({ error: "no_decision" }, 400);

  const samples = await getVoiceSamples(env, firm.id);
  const message = await generateWords(env, client, decision, samples);
  return json({ message, inVoice: samples.length > 0 && !!env.ANTHROPIC_API_KEY });
}

/** GET /api/voice — how many voice samples the firm has taught. */
async function handleVoiceStatus(request: Request, env: Env): Promise<Response> {
  const firm = await firmFromRequest(request, env);
  if (!firm) return json({ error: "unauthorized" }, 401);
  const count = await countVoiceSamples(env, firm.id);
  return json({ count, ready: count > 0 && !!env.ANTHROPIC_API_KEY });
}

/** POST /api/voice/teach { client_id, message } — save the owner's own wording
 *  as both this decision's message and a voice example for future drafts. */
async function handleVoiceTeach(request: Request, env: Env): Promise<Response> {
  const firm = await firmFromRequest(request, env);
  if (!firm) return json({ error: "unauthorized" }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const b = body as { client_id?: unknown; message?: unknown };
  if (typeof b.client_id !== "string" || typeof b.message !== "string" || b.message.trim().length < 10) {
    return json({ error: "bad_request" }, 400);
  }

  const decision = await getDecisionForClient(env, firm.id, b.client_id);
  if (!decision) return json({ error: "no_decision" }, 400);

  await setDraftedMessage(env, firm.id, b.client_id, b.message);
  await addVoiceSample(env, firm.id, decision.action, b.message);
  const count = await countVoiceSamples(env, firm.id);
  return json({ ok: true, count, ready: count > 0 && !!env.ANTHROPIC_API_KEY });
}

/** POST /api/words/save { client_id, message } — persist the final message. */
async function handleWordsSave(request: Request, env: Env): Promise<Response> {
  const firm = await firmFromRequest(request, env);
  if (!firm) return json({ error: "unauthorized" }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const b = body as { client_id?: unknown; message?: unknown };
  if (typeof b.client_id !== "string" || typeof b.message !== "string") {
    return json({ error: "bad_request" }, 400);
  }

  const decision = await getDecisionForClient(env, firm.id, b.client_id);
  if (!decision) return json({ error: "no_decision" }, 400);

  const saved = await setDraftedMessage(env, firm.id, b.client_id, b.message);
  return json({ decision: saved });
}

const WAVE_STATUSES: WaveStatus[] = ["draft", "scheduled", "sent"];
const COMMIT_STATES: CommitmentState[] = ["told", "silent", "agreed", "declined"];

/** GET /api/rollout — waves + tracker rows + committed-revenue total. */
async function handleRollout(request: Request, env: Env): Promise<Response> {
  const firm = await firmFromRequest(request, env);
  if (!firm) return json({ error: "unauthorized" }, 401);

  const [clients, decisions, waves, commitments] = await Promise.all([
    listClients(env, firm.id),
    getDecisions(env, firm.id),
    getWaves(env, firm.id),
    getCommitments(env, firm.id),
  ]);
  const byId = new Map(clients.map((c) => [c.id, c]));
  const waveByType = new Map(waves.map((w) => [w.type, w]));
  const commByClient = new Map(commitments.map((c) => [c.client_id, c]));

  const wavesOut = WAVE_ORDER.map((type) => {
    const members = decisions
      .filter((d) => d.action === type)
      .map((d) => {
        const c = byId.get(d.client_id);
        return c ? { client_id: c.id, name: c.name, tier: c.tier, fee: proposedFee(c, d) } : null;
      })
      .filter((m): m is NonNullable<typeof m> => m != null);
    const meta = waveByType.get(type);
    return {
      type,
      label: WAVE_META[type].label,
      blurb: WAVE_META[type].blurb,
      count: members.length,
      revenue: members.reduce((s, m) => s + m.fee, 0),
      send_date: meta?.send_date ?? null,
      status: meta?.status ?? "draft",
      members,
    };
  });

  const tracker = decisions
    .map((d) => {
      const c = byId.get(d.client_id);
      if (!c) return null;
      const comm = commByClient.get(d.client_id) ?? null;
      return {
        client: { id: c.id, name: c.name, tier: c.tier, entity_type: c.entity_type },
        action: d.action,
        proposed_fee: proposedFee(c, d),
        state: comm?.state ?? null,
        link_token: comm?.link_token ?? null,
        committed_fee: comm?.committed_fee ?? null,
      };
    })
    .filter((t): t is NonNullable<typeof t> => t != null);

  const total_committed = commitments
    .filter((x) => x.state === "agreed")
    .reduce((s, x) => s + (x.committed_fee ?? 0), 0);
  const potential = tracker
    .filter((t) => t.action !== "fire")
    .reduce((s, t) => s + t.proposed_fee, 0);

  return json({ waves: wavesOut, tracker, total_committed, potential });
}

/** POST /api/waves { type, send_date?, status } — set a wave's schedule. */
async function handleSaveWave(request: Request, env: Env): Promise<Response> {
  const firm = await firmFromRequest(request, env);
  if (!firm) return json({ error: "unauthorized" }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const b = body as { type?: unknown; send_date?: unknown; status?: unknown };
  if (typeof b.type !== "string" || !WAVE_ORDER.includes(b.type as WaveType)) {
    return json({ error: "invalid_type" }, 400);
  }
  const status = typeof b.status === "string" && WAVE_STATUSES.includes(b.status as WaveStatus)
    ? (b.status as WaveStatus)
    : "draft";
  const sendDate = typeof b.send_date === "string" && b.send_date.trim() !== "" ? b.send_date.trim() : null;

  const wave = await upsertWave(env, firm.id, b.type as WaveType, sendDate, status);
  return json({ wave });
}

/** POST /api/commitments { client_id, state } — owner sets a client's response state. */
async function handleSaveCommitment(request: Request, env: Env): Promise<Response> {
  const firm = await firmFromRequest(request, env);
  if (!firm) return json({ error: "unauthorized" }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const b = body as { client_id?: unknown; state?: unknown };
  if (typeof b.client_id !== "string") return json({ error: "bad_request" }, 400);
  if (typeof b.state !== "string" || !COMMIT_STATES.includes(b.state as CommitmentState)) {
    return json({ error: "invalid_state" }, 400);
  }
  const state = b.state as CommitmentState;

  const client = await getClient(env, firm.id, b.client_id);
  if (!client) return json({ error: "not_found" }, 404);
  const decision = await getDecisionForClient(env, firm.id, b.client_id);
  if (!decision) return json({ error: "no_decision" }, 400);

  const committed_fee = state === "agreed" ? proposedFee(client, decision) : 0;
  const commitment = await upsertCommitment(env, firm.id, b.client_id, { state, committed_fee });
  return json({ commitment });
}

/** GET /c/:token — public confirm page. */
async function handleCommitPage(env: Env, token: string): Promise<Response> {
  const ctx = await getCommitmentContextByToken(env, token);
  const html = renderCommitPage(ctx, token);
  return new Response(html, {
    status: ctx ? 200 : 404,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/** POST /api/commit/:token { response } — public agree/decline. */
async function handleCommitRespond(request: Request, env: Env, token: string): Promise<Response> {
  const ctx = await getCommitmentContextByToken(env, token);
  if (!ctx) return json({ error: "not_found" }, 404);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const response = (body as { response?: unknown }).response;
  if (response !== "agreed" && response !== "declined") return json({ error: "bad_request" }, 400);

  const fee = response === "agreed" ? proposedFee(ctx.client, ctx.decision) : 0;
  await setCommitmentStateByToken(env, token, response, fee);
  return json({ ok: true, state: response });
}

/** Read a CSV body from either raw text or a JSON { csv } envelope. */
async function readCsvBody(request: Request): Promise<string | null> {
  const type = request.headers.get("Content-Type") || "";
  if (type.includes("application/json")) {
    try {
      const body = (await request.json()) as { csv?: unknown };
      return typeof body.csv === "string" ? body.csv : null;
    } catch {
      return null;
    }
  }
  const text = await request.text();
  return text.length > 0 ? text : null;
}

function tierCounts(clients: { tier: string | null }[]): Record<string, number> {
  const counts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, unranked: 0 };
  for (const c of clients) counts[c.tier ?? "unranked"]++;
  return counts;
}

function emptyToNull(s: string | null): string | null {
  return s && s.length > 0 ? s : null;
}

// ---- helpers ----

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}

function sessionCookie(value: string, maxAge: number): string {
  return [
    `${SESSION_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ].join("; ");
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
