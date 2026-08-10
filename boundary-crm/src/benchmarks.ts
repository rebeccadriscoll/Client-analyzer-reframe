import type { Client } from "./types";

export interface Band {
  key: string;
  label: string;
  low: number;
  high: number;
}

/**
 * General US small-firm fee ranges by service, as a starting reference. These
 * are ballpark defaults, not gospel; once enough firms are on the platform they
 * can be swapped for real aggregated benchmarks. Order matters in classify():
 * more specific patterns (1120-S) are checked before broader ones (1120).
 */
export const BANDS: Band[] = [
  { key: "scorp", label: "S-Corp (1120-S)", low: 1200, high: 2800 },
  { key: "ccorp", label: "C-Corp (1120)", low: 1500, high: 3500 },
  { key: "partnership", label: "Partnership (1065)", low: 1000, high: 2500 },
  { key: "trust", label: "Trust / Estate (1041)", low: 800, high: 1800 },
  { key: "nonprofit", label: "Nonprofit (990)", low: 1000, high: 3000 },
  { key: "schedc", label: "Sole proprietor (Sch C)", low: 400, high: 900 },
  { key: "individual", label: "Individual (1040)", low: 250, high: 700 },
];

function band(key: string): Band {
  return BANDS.find((b) => b.key === key)!;
}

/** Map a client to a benchmark band from its entity/return type, or null. */
export function classify(client: Client): Band | null {
  const h = `${client.entity_type ?? ""} ${client.return_type ?? ""}`.toLowerCase();
  if (/1120-?s|s-?corp/.test(h)) return band("scorp");
  if (/1120|c-?corp/.test(h)) return band("ccorp");
  if (/1065|partnership/.test(h)) return band("partnership");
  if (/1041|trust|estate/.test(h)) return band("trust");
  if (/990|non-?profit|nonprofit/.test(h)) return band("nonprofit");
  if (/sch(edule)?\s*c|sole\s*prop/.test(h)) return band("schedc");
  if (/1040|individual/.test(h)) return band("individual");
  return null;
}

export type BenchStatus = "below" | "within" | "above";

export interface BenchRow {
  client_id: string;
  name: string;
  service: string;
  fee: number;
  low: number;
  high: number;
  status: BenchStatus;
  gap: number; // raise headroom to reach the low end (0 unless below)
}

export interface BenchmarkReport {
  rows: BenchRow[];
  summary: { below: number; within: number; above: number; unmatched: number; headroom: number };
  bands: Band[];
}

/**
 * Compare each priced, classifiable client to its service benchmark. "Below"
 * clients are underpriced against the market, raise candidates the realized-rate
 * view can miss. Headroom is the total fee gap to lift every below-market client
 * to the low end of its range.
 */
export function computeBenchmarks(clients: Client[]): BenchmarkReport {
  const rows: BenchRow[] = [];
  let below = 0;
  let within = 0;
  let above = 0;
  let unmatched = 0;
  let headroom = 0;

  for (const c of clients) {
    const b = classify(c);
    if (!b || c.annual_fee == null) {
      unmatched++;
      continue;
    }
    const fee = c.annual_fee;
    let status: BenchStatus;
    let gap = 0;
    if (fee < b.low) {
      status = "below";
      gap = Math.round(b.low - fee);
      headroom += gap;
      below++;
    } else if (fee > b.high) {
      status = "above";
      above++;
    } else {
      status = "within";
      within++;
    }
    rows.push({
      client_id: c.id,
      name: c.name,
      service: b.label,
      fee,
      low: b.low,
      high: b.high,
      status,
      gap,
    });
  }

  const rank: Record<BenchStatus, number> = { below: 0, within: 1, above: 2 };
  rows.sort((a, z) => rank[a.status] - rank[z.status] || z.gap - a.gap || z.fee - a.fee);

  return { rows, summary: { below, within, above, unmatched, headroom }, bands: BANDS };
}
