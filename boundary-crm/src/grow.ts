import type { Client, Decision } from "./types";
import { sanitizeVoice } from "./words";

export interface GrowCandidate {
  client_id: string;
  name: string;
  tier: string | null;
  entity_type: string | null;
  return_type: string | null;
  annual_fee: number | null;
  score: number;
  reason: string;
  script: string;
}

/** Does this look like a business (better advisory fit than a plain individual)? */
function isBusiness(client: Client): boolean {
  const hay = `${client.entity_type ?? ""} ${client.return_type ?? ""}`.toLowerCase();
  return /(s-?corp|c-?corp|corp|llc|partnership|1120|1065|business)/.test(hay);
}

function growScript(client: Client, business: boolean): string {
  const name = client.name;
  const work = client.return_type && client.return_type.trim() !== "" ? client.return_type.trim() : "annual work";
  const topic = business ? "cash flow and tax planning" : "tax planning and the year ahead";
  return sanitizeVoice(
    `Hi ${name},\n\n` +
      `I have enjoyed handling your ${work}, and I think there is room to do more than the once-a-year return. ` +
      `A lot of value gets left on the table when we only talk at filing time. I would like to offer a paid ` +
      `advisory touchpoint: a quarterly check-in on ${topic}, priced as its own small engagement, so you can ` +
      `plan ahead instead of finding out after the fact.\n\n` +
      `If that sounds useful, I will put together the details and a fee. No pressure either way.\n\n` +
      `Best,\n`
  );
}

/**
 * Surface the clients worth *growing* (advisory/CAS upsell), not just cutting.
 * A good candidate is one you are keeping: solid tier, low pain, a real
 * relationship, and ideally a business that needs more than compliance.
 */
export function adviseGrow(clients: Client[], decisions: Decision[]): GrowCandidate[] {
  const fired = new Set(decisions.filter((d) => d.action === "fire").map((d) => d.client_id));

  const scored: GrowCandidate[] = [];
  for (const c of clients) {
    if (fired.has(c.id)) continue;
    let score = 0;
    const reasons: string[] = [];

    if (c.tier === "A") {
      score += 2;
      reasons.push("top tier and priced well");
    } else if (c.tier === "B") {
      score += 1;
      reasons.push("solid and fairly priced");
    }
    if ((c.relationship_level ?? 0) >= 3) {
      score += 2;
      reasons.push("a strong relationship");
    } else if ((c.relationship_level ?? 0) >= 2) {
      score += 1;
      reasons.push("a good relationship");
    }
    if (c.risk_level === 1) {
      score += 1;
      reasons.push("reliable and low maintenance");
    }
    const business = isBusiness(c);
    if (business) {
      score += 1;
      reasons.push("a business that may need more than a return");
    }

    if (score >= 3) {
      const joined = reasons.join(", ");
      const reason = joined ? joined.charAt(0).toUpperCase() + joined.slice(1) + "." : "A good fit to grow.";
      scored.push({
        client_id: c.id,
        name: c.name,
        tier: c.tier,
        entity_type: c.entity_type,
        return_type: c.return_type,
        annual_fee: c.annual_fee,
        score,
        reason,
        script: growScript(c, business),
      });
    }
  }

  scored.sort((a, b) => b.score - a.score || (b.annual_fee ?? 0) - (a.annual_fee ?? 0));
  return scored.slice(0, 12);
}
