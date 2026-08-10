import type { Client } from "./types";
import { computeValuation } from "./valuation";
import { classify } from "./benchmarks";

export interface ServiceLine {
  service: string;
  count: number;
  revenue: number;
  pct: number;
}

export interface TopClient {
  name: string;
  fee: number;
  pct: number;
}

export interface DataRoom {
  clients: number;
  priced: number;
  gross_revenue: number;
  avg_fee: number;
  median_fee: number;
  book_rate: number | null;
  tiers: Record<string, number>;
  concentration: { top1_pct: number; top5_pct: number; top10_pct: number; top_clients: TopClient[] };
  by_service: ServiceLine[];
  value: { multiple: number; low: number; high: number };
}

/**
 * The metrics a buyer or acquirer asks for when valuing a small practice:
 * revenue, average and median fee, realized rate, client concentration, revenue
 * by service line, tier mix, and the value estimate. Read-only; a diligence view
 * built from the same numbers the rest of the app uses.
 */
export function computeDataRoom(clients: Client[], target: number | null): DataRoom {
  const val = computeValuation(clients, target);
  const gross = val.gross_revenue;

  const fees = clients
    .map((c) => c.annual_fee)
    .filter((f): f is number => f != null && f > 0)
    .sort((a, b) => a - b);
  const priced = fees.length;
  const avg = priced ? gross / priced : 0;
  const median = priced ? fees[Math.floor((priced - 1) / 2)] : 0;

  const byFee = clients
    .filter((c) => (c.annual_fee ?? 0) > 0)
    .sort((a, b) => (b.annual_fee ?? 0) - (a.annual_fee ?? 0));
  const topN = (n: number) => byFee.slice(0, n).reduce((s, c) => s + (c.annual_fee ?? 0), 0);
  const top10Pct = gross > 0 ? topN(10) / gross : 0;
  const topClients: TopClient[] = byFee.slice(0, 5).map((c) => ({
    name: c.name,
    fee: c.annual_fee ?? 0,
    pct: gross > 0 ? (c.annual_fee ?? 0) / gross : 0,
  }));

  const map = new Map<string, ServiceLine>();
  for (const c of clients) {
    const b = classify(c);
    const key = b ? b.label : "Unclassified";
    const e = map.get(key) ?? { service: key, count: 0, revenue: 0, pct: 0 };
    e.count++;
    e.revenue += c.annual_fee ?? 0;
    map.set(key, e);
  }
  const byService = [...map.values()]
    .map((e) => ({ ...e, pct: gross > 0 ? e.revenue / gross : 0 }))
    .sort((a, z) => z.revenue - a.revenue);

  return {
    clients: clients.length,
    priced,
    gross_revenue: gross,
    avg_fee: Math.round(avg),
    median_fee: median,
    book_rate: val.book_rate,
    tiers: val.tiers,
    concentration: {
      top1_pct: val.concentration.top1_pct,
      top5_pct: val.concentration.top5_pct,
      top10_pct: top10Pct,
      top_clients: topClients,
    },
    by_service: byService,
    value: { multiple: val.multiple, low: val.value_low, high: val.value_high },
  };
}
