import type { Client } from "./types";

/** A grooming lever: something the owner can do to lift the sale multiple. */
export interface Lever {
  title: string;
  detail: string;
  kind: "lift" | "strength" | "clean";
}

export interface Valuation {
  gross_revenue: number;
  book_hours: number;
  book_rate: number | null;
  target_rate: number | null;
  clients: number;
  tiers: Record<string, number>;
  ab_share: number; // 0..1 of ranked clients
  d_share: number;
  concentration: { top1_pct: number; top5_pct: number; top_client: string | null };
  multiple: number;
  value_low: number;
  value_high: number;
  levers: Lever[];
}

/**
 * A rough practice-value estimate: small firms trade near a multiple of annual
 * recurring fees, and that multiple moves with realization, client mix, and
 * concentration. This is a defensible estimate for grooming decisions, not a
 * formal appraisal, and the levers say exactly what would move it.
 */
export function computeValuation(clients: Client[], target: number | null): Valuation {
  const gross = clients.reduce((s, c) => s + (c.annual_fee ?? 0), 0);
  const bookHours = clients.reduce((s, c) => s + (c.est_hours ?? 0), 0);

  let feeSum = 0;
  let hourSum = 0;
  for (const c of clients) {
    if (c.annual_fee != null && c.est_hours && c.est_hours > 0) {
      feeSum += c.annual_fee;
      hourSum += c.est_hours;
    }
  }
  const bookRate = hourSum > 0 ? feeSum / hourSum : null;

  const tiers: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, unranked: 0 };
  for (const c of clients) tiers[c.tier ?? "unranked"]++;
  const ranked = tiers.A + tiers.B + tiers.C + tiers.D;
  const abShare = ranked ? (tiers.A + tiers.B) / ranked : 0;
  const dShare = ranked ? tiers.D / ranked : 0;

  const byFee = clients
    .filter((c) => (c.annual_fee ?? 0) > 0)
    .sort((a, b) => (b.annual_fee ?? 0) - (a.annual_fee ?? 0));
  const top1 = byFee.length ? byFee[0].annual_fee ?? 0 : 0;
  const top5 = byFee.slice(0, 5).reduce((s, c) => s + (c.annual_fee ?? 0), 0);
  const top1Pct = gross > 0 ? top1 / gross : 0;
  const top5Pct = gross > 0 ? top5 / gross : 0;
  const topName = byFee.length ? byFee[0].name : null;

  // Heuristic multiple of recurring revenue, starting from ~1.0x.
  let m = 1.0;
  m += Math.min(0.25, Math.max(0, abShare - 0.5) * 0.5); // reward A/B share above half
  if (target && bookRate) {
    m += bookRate >= target ? 0.1 : Math.max(-0.15, (bookRate / target - 1) * 0.3);
  }
  m -= Math.min(0.15, dShare * 0.3); // D-tier drag
  if (top1Pct > 0.15) m -= Math.min(0.3, (top1Pct - 0.15) * 1.5); // concentration discount
  m = Math.max(0.6, Math.min(1.5, m));

  const valueLow = Math.round(gross * Math.max(0.6, m - 0.1));
  const valueHigh = Math.round(gross * Math.min(1.6, m + 0.1));

  const levers: Lever[] = [];
  if (top1Pct > 0.15 && topName) {
    levers.push({
      title: "Reduce client concentration",
      detail: `${topName} is ${Math.round(top1Pct * 100)}% of your revenue. Buyers discount books where one client runs over about 15%. Grow the others, or be ready to explain it.`,
      kind: "lift",
    });
  }
  if (dShare > 0 && tiers.D) {
    levers.push({
      title: "Lift or release your D tier",
      detail: `${tiers.D} client${tiers.D === 1 ? "" : "s"} sit below target. Raising or releasing them lifts realized rate, the number a buyer prices on.`,
      kind: "lift",
    });
  }
  const unpriced = clients.filter((c) => c.annual_fee == null || !c.est_hours).length;
  if (unpriced) {
    levers.push({
      title: "Fill in missing fees and hours",
      detail: `${unpriced} client${unpriced === 1 ? "" : "s"} lack a fee or hours on file. Clean numbers speed a buyer's diligence and hold the price.`,
      kind: "clean",
    });
  }
  if (target && bookRate && bookRate < target) {
    levers.push({
      title: "Close the rate gap",
      detail: `Your book earns $${Math.round(bookRate)}/hr against your $${Math.round(target)}/hr target. Closing the gap raises the multiple.`,
      kind: "lift",
    });
  }
  if (abShare >= 0.6) {
    levers.push({
      title: "Strong tier mix",
      detail: `${Math.round(abShare * 100)}% of your ranked book is A or B. That is the kind of book buyers pay up for.`,
      kind: "strength",
    });
  }

  return {
    gross_revenue: gross,
    book_hours: bookHours,
    book_rate: bookRate,
    target_rate: target,
    clients: clients.length,
    tiers,
    ab_share: abShare,
    d_share: dShare,
    concentration: { top1_pct: top1Pct, top5_pct: top5Pct, top_client: topName },
    multiple: m,
    value_low: valueLow,
    value_high: valueHigh,
    levers,
  };
}
