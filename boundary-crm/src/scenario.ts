import type { Client } from "./types";
import { realizedRate, computeTiers } from "./scoring";
import { computeValuation, type Valuation } from "./valuation";
import { classify } from "./benchmarks";

export interface ScenarioLevers {
  /** What to do with C-tier clients: 'keep' | 'raise' (to target). */
  c: "keep" | "raise";
  /** What to do with D-tier clients: 'keep' | 'raise' | 'drop'. */
  d: "keep" | "raise" | "drop";
  /** Also lift any below-market client to the low end of its service range. */
  belowMarket: boolean;
}

export interface ScenarioResult {
  before: Valuation;
  after: Valuation;
  revenue_now: number;
  revenue_after: number;
  revenue_delta: number;
  hours_freed: number;
  dropped: number;
  raised: number;
}

/** Weighted book realized rate ($/hr), the fallback raise ceiling when no target. */
function bookRate(clients: Client[]): number | null {
  let f = 0;
  let h = 0;
  for (const c of clients) {
    if (c.annual_fee != null && c.est_hours && c.est_hours > 0) {
      f += c.annual_fee;
      h += c.est_hours;
    }
  }
  return h > 0 ? f / h : null;
}

/**
 * Model a set of pricing moves across the book and report the before/after
 * impact: revenue, freed hours (capacity), realized rate, tier mix, and the
 * practice-value estimate. Raises lift a client's realized rate to the target
 * (or the book average when no target is set), rounded to $50, never below the
 * current fee or the firm minimum. Nothing is written; this is a projection.
 */
export function runScenario(
  clients: Client[],
  target: number | null,
  minFee: number | null,
  levers: ScenarioLevers
): ScenarioResult {
  const ceiling = target || bookRate(clients) || null;
  const modeled: Client[] = [];
  let hoursFreed = 0;
  let dropped = 0;
  let raised = 0;

  for (const c of clients) {
    const isD = c.tier === "D";
    const isC = c.tier === "C";

    if (isD && levers.d === "drop") {
      dropped++;
      if (c.est_hours) hoursFreed += c.est_hours;
      continue;
    }

    const tierRaise = (isC && levers.c === "raise") || (isD && levers.d === "raise");
    let belowLow: number | null = null;
    if (levers.belowMarket) {
      const b = classify(c);
      if (b && c.annual_fee != null && c.annual_fee < b.low) belowLow = b.low;
    }

    let fee = c.annual_fee ?? 0;
    if (tierRaise && ceiling && c.est_hours && c.est_hours > 0) {
      fee = Math.max(fee, Math.ceil((ceiling * c.est_hours) / 50) * 50);
    }
    if (belowLow != null) fee = Math.max(fee, belowLow);
    fee = Math.max(fee, minFee || 0);

    if (fee > (c.annual_fee ?? 0)) raised++;
    modeled.push({ ...c, annual_fee: fee, realized_rate: realizedRate(fee, c.est_hours) });
  }

  const tiers = computeTiers(modeled, (x) => x.realized_rate, target);
  modeled.forEach((m, i) => (m.tier = tiers[i]));

  const before = computeValuation(clients, target);
  const after = computeValuation(modeled, target);
  const revenueNow = clients.reduce((s, c) => s + (c.annual_fee ?? 0), 0);
  const revenueAfter = modeled.reduce((s, c) => s + (c.annual_fee ?? 0), 0);

  return {
    before,
    after,
    revenue_now: revenueNow,
    revenue_after: revenueAfter,
    revenue_delta: revenueAfter - revenueNow,
    hours_freed: hoursFreed,
    dropped,
    raised,
  };
}
