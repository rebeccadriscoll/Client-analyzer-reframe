export type Tier = "A" | "B" | "C" | "D";

/** realized_rate = annual_fee / est_hours. Null when either input is missing or
 *  hours are not positive (avoids divide-by-zero and nonsense rates). */
export function realizedRate(fee: number | null, hours: number | null): number | null {
  if (fee == null || hours == null) return null;
  if (!(hours > 0)) return null;
  return fee / hours;
}

/** Map a 0..1 rank (0 = lowest realized rate, 1 = highest) to an A-D tier.
 *  A = top 20%, B = next 30%, C = next 30%, D = bottom 20%. */
export function tierForRank(rankPct: number): Tier {
  if (rankPct >= 0.8) return "A";
  if (rankPct >= 0.5) return "B";
  if (rankPct >= 0.2) return "C";
  return "D";
}

/**
 * Assign tiers to a set by realized-rate percentile. Items without a realized
 * rate stay null (unranked). Tiers are relative to the set being ranked, which
 * matches the analyzer's "top 20% / bottom 20%" framing.
 */
export function computeTiers<T>(items: T[], getRate: (item: T) => number | null): (Tier | null)[] {
  const valid = items
    .map((item, i) => ({ i, rate: getRate(item) }))
    .filter((x): x is { i: number; rate: number } => x.rate != null)
    .sort((a, b) => a.rate - b.rate);

  const tiers: (Tier | null)[] = new Array(items.length).fill(null);
  const n = valid.length;
  valid.forEach((x, idx) => {
    const rankPct = n <= 1 ? 1 : idx / (n - 1);
    tiers[x.i] = tierForRank(rankPct);
  });
  return tiers;
}

/** Parse a currency/number-ish cell ("$1,200", "12.5", "") into a number or null. */
export function parseNumeric(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[^0-9.\-]/g, "").trim();
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}
