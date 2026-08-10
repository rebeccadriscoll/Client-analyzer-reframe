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
 * Grade a single realized rate against a firm's target rate ($/hr). This is the
 * honest, absolute view: "D" means genuinely below what the work needs to earn,
 * not merely the bottom of this particular book.
 *   A >= 1.25x target, B >= target, C >= 0.6x target, else D.
 */
export function tierForRate(rate: number, target: number): Tier {
  if (rate >= target * 1.25) return "A";
  if (rate >= target) return "B";
  if (rate >= target * 0.6) return "C";
  return "D";
}

/**
 * Assign tiers to a set. With a positive `target`, each client is graded against
 * that absolute target rate (a book of all-strong clients can be all A/B). Without
 * one, it falls back to realized-rate percentile within the set (top 20% / bottom
 * 20%). Items without a realized rate stay null (unranked).
 */
export function computeTiers<T>(
  items: T[],
  getRate: (item: T) => number | null,
  target?: number | null
): (Tier | null)[] {
  if (target != null && target > 0) {
    return items.map((item) => {
      const rate = getRate(item);
      return rate == null ? null : tierForRate(rate, target);
    });
  }

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
