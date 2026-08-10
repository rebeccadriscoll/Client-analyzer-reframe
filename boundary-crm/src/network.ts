import { BANDS, type Band } from "./benchmarks";

/** A single contributed data point: enough to classify and aggregate, nothing else. */
export interface ContributedFee {
  entity_type: string | null;
  return_type: string | null;
  annual_fee: number;
  firm_id: string;
}

export interface NetworkStat {
  key: string;
  label: string;
  count: number;
  firms: number;
  median: number;
  p25: number;
  p75: number;
}

// Privacy floors: a service's aggregate is only exposed once it draws on enough
// distinct firms and data points that no single client can be inferred.
const MIN_FIRMS = 2;
const MIN_POINTS = 5;

function classifyRaw(entity: string | null, ret: string | null): Band | null {
  const h = `${entity ?? ""} ${ret ?? ""}`.toLowerCase();
  if (/1120-?s|s-?corp/.test(h)) return BANDS.find((b) => b.key === "scorp")!;
  if (/1120|c-?corp/.test(h)) return BANDS.find((b) => b.key === "ccorp")!;
  if (/1065|partnership/.test(h)) return BANDS.find((b) => b.key === "partnership")!;
  if (/1041|trust|estate/.test(h)) return BANDS.find((b) => b.key === "trust")!;
  if (/990|non-?profit|nonprofit/.test(h)) return BANDS.find((b) => b.key === "nonprofit")!;
  if (/sch(edule)?\s*c|sole\s*prop/.test(h)) return BANDS.find((b) => b.key === "schedc")!;
  if (/1040|individual/.test(h)) return BANDS.find((b) => b.key === "individual")!;
  return null;
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[idx];
}

/**
 * Aggregate contributed fees into per-service network benchmarks. Returns only
 * the services that clear the privacy floor; individual fees never leave here.
 */
export function computeNetworkBenchmarks(rows: ContributedFee[]): NetworkStat[] {
  const groups = new Map<string, { fees: number[]; firms: Set<string>; band: Band }>();
  for (const r of rows) {
    if (r.annual_fee == null || r.annual_fee <= 0) continue;
    const band = classifyRaw(r.entity_type, r.return_type);
    if (!band) continue;
    let g = groups.get(band.key);
    if (!g) {
      g = { fees: [], firms: new Set(), band };
      groups.set(band.key, g);
    }
    g.fees.push(r.annual_fee);
    g.firms.add(r.firm_id);
  }

  const out: NetworkStat[] = [];
  for (const g of groups.values()) {
    if (g.firms.size < MIN_FIRMS || g.fees.length < MIN_POINTS) continue;
    const sorted = g.fees.slice().sort((a, b) => a - b);
    out.push({
      key: g.band.key,
      label: g.band.label,
      count: sorted.length,
      firms: g.firms.size,
      median: Math.round(pct(sorted, 0.5)),
      p25: Math.round(pct(sorted, 0.25)),
      p75: Math.round(pct(sorted, 0.75)),
    });
  }
  // Keep the reference order from BANDS.
  const order = new Map(BANDS.map((b, i) => [b.key, i]));
  out.sort((a, z) => (order.get(a.key) ?? 99) - (order.get(z.key) ?? 99));
  return out;
}
