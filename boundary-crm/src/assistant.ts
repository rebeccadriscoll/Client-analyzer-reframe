import type { Env, Firm, Client, Action, CommitmentState } from "./types";
import {
  listClients,
  getDecisions,
  getCommitments,
  getDecisionForClient,
  upsertCommitment,
  addNote,
} from "./db";
import { proposedFee } from "./rollout";

/** One thing the assistant did, surfaced to the UI as a chip. */
export interface AssistantAction {
  type: "set_response" | "add_note";
  client: string;
  detail: string;
}

export interface AssistantResult {
  reply: string;
  actions: AssistantAction[];
}

/** A single chat turn from the browser (text only). */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const MAX_ITERATIONS = 6;
const ACTIONS: Action[] = ["keep", "raise", "fire", "nudge"];
const STATES: CommitmentState[] = ["told", "silent", "agreed", "declined"];

/** The tools Claude may call. Each maps to a firm-scoped D1 operation. */
const TOOLS = [
  {
    name: "get_summary",
    description:
      "Get a high-level summary of the firm's book: client count, tier breakdown, how many decisions are made, committed and potential revenue, and how many clients have gone silent.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_clients",
    description:
      "List the firm's clients. Optionally filter by tier (A/B/C/D), by the decided action (keep/raise/fire/nudge), or by response state (told/silent/agreed/declined). Returns names, tiers, fees, decisions, and response state.",
    input_schema: {
      type: "object",
      properties: {
        tier: { type: "string", enum: ["A", "B", "C", "D"] },
        action: { type: "string", enum: ACTIONS },
        state: { type: "string", enum: STATES },
        limit: { type: "number", description: "Max clients to return. Defaults to 25." },
      },
      required: [],
    },
  },
  {
    name: "find_client",
    description:
      "Look up one client by name (a partial name is fine) and get their full detail: tier, fee, hours, realized rate, decision, and response state.",
    input_schema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
  {
    name: "set_response",
    description:
      "Record how a client responded to their message. state must be one of: agreed (they accepted), declined (they said no), told (message sent, awaiting reply), silent (no reply yet). When a client agrees, their committed fee is locked in automatically.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        state: { type: "string", enum: STATES },
      },
      required: ["name", "state"],
    },
  },
  {
    name: "add_note",
    description: "Add a short private note to a client's record.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        note: { type: "string" },
      },
      required: ["name", "note"],
    },
  },
];

function systemPrompt(firm: Firm): string {
  const firmName = firm.name ? `${firm.name}` : "this firm";
  return (
    `You are the built-in assistant inside Boundary CRM, a tool that helps a solo accountant or small firm ` +
    `owner re-price and re-shape their client book. You are helping the owner of ${firmName}. ` +
    `You work only with this firm's own clients, never anyone else's.\n\n` +
    `What the app does: every client is scored by realized rate (annual fee divided by estimated hours) and ` +
    `sorted into tiers A through D. The owner decides an action for each client: keep (no change), raise ` +
    `(higher fee), nudge (small changes to fix the fit), or fire (part ways). Then they send each client a ` +
    `message and track who agreed, declined, or has gone silent.\n\n` +
    `Your job: answer the owner's questions about their book and, when they ask, update records for them. ` +
    `Use the tools to read real data before answering. Never invent client names, fees, or numbers. If you ` +
    `are not sure which client they mean, ask.\n\n` +
    `Before you change anything (a response state or a note), make sure the owner actually asked for that ` +
    `change. Nothing you do sends an email or contacts a client. After you make a change, say plainly what ` +
    `you did.\n\n` +
    `Voice rules for everything you write: warm, plain, and short. No em dashes or en dashes anywhere. Never ` +
    `use the words honestly, quietly, genuinely, or straightforward. Money in whole dollars.`
  );
}

function money(n: number | null | undefined): string {
  if (n == null) return "n/a";
  return "$" + Math.round(n).toLocaleString("en-US");
}

/** Resolve a name to clients: exact (case-insensitive) first, else substring. */
function matchClients(clients: Client[], raw: string): Client[] {
  const q = raw.trim().toLowerCase();
  if (!q) return [];
  const exact = clients.filter((c) => c.name.toLowerCase() === q);
  if (exact.length) return exact;
  return clients.filter((c) => c.name.toLowerCase().includes(q));
}

/**
 * Run the tool-use loop. Reads/writes are firm-scoped through db.ts. Returns the
 * assistant's final text plus a log of any changes it made (for UI chips).
 */
export async function runAssistant(
  env: Env,
  firm: Firm,
  history: ChatMessage[]
): Promise<AssistantResult> {
  if (!env.ANTHROPIC_API_KEY) {
    return {
      reply:
        "The assistant needs an Anthropic API key to be set on the app before it can answer. Once that is in place it will work here.",
      actions: [],
    };
  }

  const model = env.ASSISTANT_MODEL || env.DRAFT_MODEL || "claude-haiku-4-5-20251001";
  const actions: AssistantAction[] = [];

  // Build the running message array from the browser history (text only).
  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = history
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content }));

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: systemPrompt(firm),
        tools: TOOLS,
        messages,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Anthropic assistant failed (${res.status}): ${detail}`);
    }

    const data = (await res.json()) as {
      stop_reason?: string;
      content?: Array<Record<string, unknown>>;
    };
    const content = data.content ?? [];

    // Record the assistant turn verbatim so tool_use ids line up with results.
    messages.push({ role: "assistant", content });

    if (data.stop_reason !== "tool_use") {
      const text = content
        .filter((b) => b.type === "text")
        .map((b) => (b as { text?: string }).text ?? "")
        .join("")
        .trim();
      return { reply: text || "Done.", actions };
    }

    // Execute each requested tool and feed the results back.
    const toolResults: Array<Record<string, unknown>> = [];
    for (const block of content) {
      if (block.type !== "tool_use") continue;
      const name = block.name as string;
      const input = (block.input as Record<string, unknown>) ?? {};
      let result: unknown;
      try {
        result = await runTool(env, firm, name, input, actions);
      } catch (err) {
        result = { error: err instanceof Error ? err.message : "tool_failed" };
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(result),
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return {
    reply:
      "I went back and forth a few times without landing a clear answer. Try asking in a smaller, more specific way.",
    actions,
  };
}

/** Dispatch one tool call against the firm's data. */
async function runTool(
  env: Env,
  firm: Firm,
  name: string,
  input: Record<string, unknown>,
  actions: AssistantAction[]
): Promise<unknown> {
  const clients = await listClients(env, firm.id);

  if (name === "get_summary") {
    const [decisions, commitments] = await Promise.all([
      getDecisions(env, firm.id),
      getCommitments(env, firm.id),
    ]);
    const byId = new Map(clients.map((c) => [c.id, c]));
    const tiers: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, unranked: 0 };
    for (const c of clients) tiers[c.tier ?? "unranked"]++;
    const actionCounts: Record<Action, number> = { keep: 0, raise: 0, nudge: 0, fire: 0 };
    for (const d of decisions) actionCounts[d.action]++;
    const committed = commitments
      .filter((c) => c.state === "agreed")
      .reduce((s, c) => s + (c.committed_fee ?? 0), 0);
    let potential = 0;
    for (const d of decisions) {
      const c = byId.get(d.client_id);
      if (c && d.action !== "fire") potential += proposedFee(c, d);
    }
    const now = Date.now();
    const silent = commitments.filter(
      (c) => c.state === "told" && now - c.updated_at > 7 * 86400000
    ).length;
    return {
      clients: clients.length,
      tiers,
      decided: decisions.length,
      undecided: clients.length - decisions.length,
      actions: actionCounts,
      committed_revenue: committed,
      potential_revenue: potential,
      book_revenue: clients.reduce((s, c) => s + (c.annual_fee ?? 0), 0),
      silent,
    };
  }

  if (name === "list_clients") {
    const [decisions, commitments] = await Promise.all([
      getDecisions(env, firm.id),
      getCommitments(env, firm.id),
    ]);
    const decByClient = new Map(decisions.map((d) => [d.client_id, d]));
    const commByClient = new Map(commitments.map((c) => [c.client_id, c]));
    const tier = typeof input.tier === "string" ? input.tier : null;
    const action = typeof input.action === "string" ? input.action : null;
    const state = typeof input.state === "string" ? input.state : null;
    const limit = typeof input.limit === "number" && input.limit > 0 ? Math.min(input.limit, 100) : 25;

    let rows = clients.map((c) => {
      const d = decByClient.get(c.id) ?? null;
      const comm = commByClient.get(c.id) ?? null;
      return {
        name: c.name,
        tier: c.tier,
        annual_fee: c.annual_fee,
        realized_rate: c.realized_rate,
        action: d?.action ?? null,
        state: comm?.state ?? null,
      };
    });
    if (tier) rows = rows.filter((r) => r.tier === tier);
    if (action) rows = rows.filter((r) => r.action === action);
    if (state) rows = rows.filter((r) => r.state === state);
    return { count: rows.length, clients: rows.slice(0, limit) };
  }

  if (name === "find_client") {
    const matches = matchClients(clients, String(input.name ?? ""));
    if (matches.length === 0) return { found: false, message: "No client by that name." };
    if (matches.length > 5) {
      return { found: true, ambiguous: true, names: matches.slice(0, 10).map((c) => c.name) };
    }
    const detailed = await Promise.all(
      matches.map(async (c) => {
        const d = await getDecisionForClient(env, firm.id, c.id);
        return {
          name: c.name,
          email: c.email,
          tier: c.tier,
          entity_type: c.entity_type,
          return_type: c.return_type,
          annual_fee: c.annual_fee,
          est_hours: c.est_hours,
          realized_rate: c.realized_rate,
          action: d?.action ?? null,
          new_fee: d?.new_fee ?? null,
          has_message: !!d?.drafted_message,
        };
      })
    );
    return { found: true, clients: detailed };
  }

  if (name === "set_response") {
    const state = String(input.state ?? "");
    if (!STATES.includes(state as CommitmentState)) {
      return { ok: false, message: `state must be one of ${STATES.join(", ")}.` };
    }
    const matches = matchClients(clients, String(input.name ?? ""));
    if (matches.length === 0) return { ok: false, message: "No client by that name." };
    if (matches.length > 1) {
      return { ok: false, ambiguous: true, names: matches.map((c) => c.name) };
    }
    const client = matches[0];
    const decision = await getDecisionForClient(env, firm.id, client.id);
    const fee = state === "agreed" && decision ? proposedFee(client, decision) : 0;
    await upsertCommitment(env, firm.id, client.id, { state: state as CommitmentState, committed_fee: fee });
    const detail =
      state === "agreed"
        ? `agreed, ${money(fee)} locked in`
        : state === "declined"
        ? "declined"
        : state;
    actions.push({ type: "set_response", client: client.name, detail });
    return { ok: true, client: client.name, state, committed_fee: fee };
  }

  if (name === "add_note") {
    const note = String(input.note ?? "").trim();
    if (note.length < 1) return { ok: false, message: "The note is empty." };
    const matches = matchClients(clients, String(input.name ?? ""));
    if (matches.length === 0) return { ok: false, message: "No client by that name." };
    if (matches.length > 1) {
      return { ok: false, ambiguous: true, names: matches.map((c) => c.name) };
    }
    const client = matches[0];
    await addNote(env, firm.id, client.id, note);
    actions.push({ type: "add_note", client: client.name, detail: note.slice(0, 60) });
    return { ok: true, client: client.name };
  }

  return { error: `Unknown tool: ${name}` };
}
