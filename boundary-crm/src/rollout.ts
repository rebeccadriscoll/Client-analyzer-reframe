import type { Client, Decision, WaveType } from "./types";

/** Send order: revenue up first, goodbyes last. */
export const WAVE_ORDER: WaveType[] = ["raise", "keep", "nudge", "fire"];

export const WAVE_META: Record<WaveType, { label: string; blurb: string }> = {
  raise: { label: "Raises", blurb: "Send first. Revenue up before anything else changes." },
  keep: { label: "Keepers", blurb: "Reassure your best clients that nothing changes." },
  nudge: { label: "Nudges", blurb: "Ask for the small changes that fix the fit." },
  fire: { label: "Goodbyes", blurb: "Part ways with care, and send these last." },
};

/**
 * The fee locked in if this client agrees: the new fee for a raise, the current
 * fee for a keep or nudge, and nothing for a goodbye.
 */
export function proposedFee(client: Client, decision: Decision): number {
  if (decision.action === "raise") return decision.new_fee ?? client.annual_fee ?? 0;
  if (decision.action === "fire") return 0;
  return client.annual_fee ?? 0;
}
