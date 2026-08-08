import type { Env } from "../types";

export interface ClientField {
  key: "name" | "entity_type" | "annual_fee" | "est_hours" | "return_type";
  label: string;
  required: boolean;
  synonyms: string[];
}

export interface FieldSuggestion {
  field: ClientField["key"];
  label: string;
  required: boolean;
  /** Best-guess source column header, or null if nothing matched. */
  column: string | null;
  /** 0..1 confidence in the guess. */
  confidence: number;
}

export const CLIENT_FIELDS: ClientField[] = [
  {
    key: "name",
    label: "Client name",
    required: true,
    synonyms: ["name", "client", "client name", "company", "business", "taxpayer", "account", "entity name", "customer"],
  },
  {
    key: "entity_type",
    label: "Entity type",
    required: false,
    synonyms: ["entity", "entity type", "type", "structure", "org type", "filing status", "classification"],
  },
  {
    key: "return_type",
    label: "Return type",
    required: false,
    synonyms: ["return", "return type", "form", "tax form", "service", "engagement", "product"],
  },
  {
    key: "annual_fee",
    label: "Annual fee",
    required: true,
    synonyms: ["fee", "annual fee", "fees", "price", "revenue", "billing", "amount", "total fee", "invoice", "annual revenue"],
  },
  {
    key: "est_hours",
    label: "Estimated hours",
    required: true,
    synonyms: ["hours", "est hours", "estimated hours", "time", "hrs", "budget hours", "hours budget", "annual hours"],
  },
];

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(a.split(" ").filter(Boolean));
  const tb = new Set(b.split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / new Set([...ta, ...tb]).size;
}

/** Score how well a header matches a field: 0 (no match) .. 1 (exact synonym). */
function scoreHeader(headerNorm: string, field: ClientField): number {
  let best = 0;
  for (const syn of field.synonyms) {
    const s = norm(syn);
    if (headerNorm === s) return 1;
    if (headerNorm.includes(s) || s.includes(headerNorm)) best = Math.max(best, 0.8);
    best = Math.max(best, tokenOverlap(headerNorm, s) * 0.7);
  }
  return best;
}

const ACCEPT_THRESHOLD = 0.4;

/**
 * Suggest a column for each client field using header-name heuristics. A column
 * is assigned to at most one field (greedy by descending score), so a single
 * "amount" column will not map to both fee and hours.
 */
export function suggestMapping(headers: string[]): FieldSuggestion[] {
  const headerNorms = headers.map(norm);

  const candidates: { field: ClientField["key"]; colIndex: number; score: number }[] = [];
  for (const field of CLIENT_FIELDS) {
    headerNorms.forEach((hn, colIndex) => {
      const score = scoreHeader(hn, field);
      if (score >= ACCEPT_THRESHOLD) candidates.push({ field: field.key, colIndex, score });
    });
  }
  candidates.sort((a, b) => b.score - a.score);

  const fieldTaken = new Set<string>();
  const colTaken = new Set<number>();
  const chosen = new Map<string, { column: string; confidence: number }>();
  for (const c of candidates) {
    if (fieldTaken.has(c.field) || colTaken.has(c.colIndex)) continue;
    fieldTaken.add(c.field);
    colTaken.add(c.colIndex);
    chosen.set(c.field, { column: headers[c.colIndex], confidence: round2(c.score) });
  }

  return CLIENT_FIELDS.map((f) => {
    const pick = chosen.get(f.key);
    return {
      field: f.key,
      label: f.label,
      required: f.required,
      column: pick?.column ?? null,
      confidence: pick?.confidence ?? 0,
    };
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Optional LLM refinement (the "one LLM call for column mapping" from the brief).
 * Runs only when a Workers AI binding is present and only for fields the
 * heuristic left unmapped or low-confidence. Any failure falls back silently to
 * the heuristic result, so import never depends on the model being reachable.
 */
export async function refineWithLLM(
  env: Env,
  headers: string[],
  sample: string[][],
  base: FieldSuggestion[]
): Promise<FieldSuggestion[]> {
  if (!env.AI) return base;
  const weak = base.filter((s) => s.column == null || s.confidence < 0.6);
  if (weak.length === 0) return base;

  try {
    const prompt =
      `You map spreadsheet columns to client fields for an accounting tool.\n` +
      `Columns (headers): ${JSON.stringify(headers)}\n` +
      `Sample rows: ${JSON.stringify(sample.slice(0, 3))}\n` +
      `Fields needing a column: ${weak.map((w) => w.field).join(", ")}\n` +
      `Reply with ONLY a JSON object mapping each of those field keys to the exact ` +
      `header string that best fits, or null if none. No prose.`;

    const out = (await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [{ role: "user", content: prompt }],
    })) as { response?: string };

    const text = out?.response ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return base;
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;

    return base.map((s) => {
      const proposed = parsed[s.field];
      if ((s.column == null || s.confidence < 0.6) && typeof proposed === "string" && headers.includes(proposed)) {
        return { ...s, column: proposed, confidence: Math.max(s.confidence, 0.65) };
      }
      return s;
    });
  } catch {
    return base;
  }
}
