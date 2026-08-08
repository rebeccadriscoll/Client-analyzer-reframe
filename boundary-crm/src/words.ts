import type { Env, Client, Decision, Action } from "./types";

/** Voice guardrail: never appear in generated client-facing copy. */
const BANNED_WORDS = ["honestly", "quietly", "genuinely", "straightforward"];

/**
 * Enforce the house voice on any generated copy: no em/en dashes, and none of
 * the banned words. Templates already comply; this is the safety net that also
 * cleans up any optional LLM output.
 */
export function sanitizeVoice(text: string): string {
  let t = text.replace(/[—–]/g, ", ");
  for (const w of BANNED_WORDS) {
    t = t.replace(new RegExp("\\b" + w + "\\b", "gi"), "");
  }
  // Tidy artifacts from the substitutions above.
  t = t
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ ,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/\s+\./g, ".")
    .replace(/[ \t]+\n/g, "\n");
  return t.trim();
}

function money(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

/** Deterministic, voice-compliant drafts per action. */
export function templateWords(client: Client, action: Action, newFee: number | null): string {
  const name = client.name;
  const sign = "\n\nBest,\n";

  switch (action) {
    case "keep":
      return (
        `Hi ${name},\n\n` +
        `A quick note to say I am glad to keep working with you. Things are in good shape ` +
        `on my end, and I do not see any change to your fee for the coming year. If anything ` +
        `shifts on your side, tell me and we will sort it out.\n\n` +
        `Thank you for being a pleasure to work with.` +
        sign
      );

    case "raise": {
      const from = client.annual_fee != null ? ` (up from ${money(client.annual_fee)})` : "";
      const to = newFee != null ? ` to ${money(newFee)}` : " for the year ahead";
      return (
        `Hi ${name},\n\n` +
        `I have been reviewing my rates for the year ahead. The work your account takes has ` +
        `grown, and to keep giving it the attention it deserves I am adjusting your annual fee` +
        `${to}${from}.\n\n` +
        `The scope of what I do for you stays the same. I am happy to walk through the details ` +
        `on a quick call if that helps.\n\n` +
        `Thank you for understanding.` +
        sign
      );
    }

    case "nudge":
      return (
        `Hi ${name},\n\n` +
        `I would like us to keep working together, and I think a couple of small changes would ` +
        `help it run more smoothly. A few things on my end have been taking longer than they ` +
        `should, and getting your information a little earlier would let me do my best work for ` +
        `you.\n\n` +
        `Can we set up a short call to line things up for the year ahead?` +
        sign
      );

    case "fire":
      return (
        `Hi ${name},\n\n` +
        `I have been thinking about how best to serve my clients, and I have decided to step ` +
        `back from some of the work I take on. That means I will not be able to continue as your ` +
        `accountant past this year.\n\n` +
        `I want to give you plenty of time to find the right fit, and I am glad to share your ` +
        `records and help with a smooth handoff. You have been good to work with, and I wish you ` +
        `well.` +
        sign
      );
  }
}

function voicePrompt(client: Client, decision: Decision): string {
  return (
    `Write a short, warm, plain email from an accountant to a client named "${client.name}".\n` +
    `The message is a "${decision.action}" message` +
    (decision.action === "raise" && decision.new_fee != null ? ` with a new annual fee of ${money(decision.new_fee)}` : "") +
    `.\n` +
    `Hard rules: no em dashes anywhere. Do not use the words honestly, quietly, genuinely, or ` +
    `straightforward. Keep it under 120 words, end with "Best,". Return only the message text.`
  );
}

/**
 * Generate a draft. Templates are the default (always voice-compliant); when a
 * Workers AI binding is present, an optional single call may replace the draft,
 * and the result is still run through sanitizeVoice. Any failure falls back to
 * the template. The prompt stays server-side.
 */
export async function generateWords(env: Env, client: Client, decision: Decision): Promise<string> {
  const base = templateWords(client, decision.action, decision.new_fee);
  if (!env.AI) return sanitizeVoice(base);

  try {
    const out = (await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [{ role: "user", content: voicePrompt(client, decision) }],
    })) as { response?: string };
    const text = (out?.response ?? "").trim();
    if (text.length > 20) return sanitizeVoice(text);
  } catch {
    /* fall back to template */
  }
  return sanitizeVoice(base);
}
