import type { Env, Client, Decision, Action, VoiceSample } from "./types";

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

/**
 * Generate a draft. The default is the deterministic, always-compliant template
 * (this is the "suggested message"). Once the owner has taught their voice (one
 * or more saved samples) and an Anthropic key is set, Claude redrafts in their
 * voice instead. Output always runs through sanitizeVoice, and any failure falls
 * back to the template. The prompt stays server-side.
 */
export async function generateWords(
  env: Env,
  client: Client,
  decision: Decision,
  samples: VoiceSample[] = []
): Promise<string> {
  if (env.ANTHROPIC_API_KEY && samples.length > 0) {
    try {
      const text = await draftWithClaude(env, client, decision, samples);
      if (text.trim().length > 20) return sanitizeVoice(text.trim());
    } catch {
      /* fall back to template */
    }
  }
  return sanitizeVoice(templateWords(client, decision.action, decision.new_fee));
}

/** What we are asking Claude to write, per action. */
function draftAsk(client: Client, decision: Decision): string {
  const name = client.name;
  switch (decision.action) {
    case "raise":
      return (
        `a fee-increase email to ${name}` +
        (decision.new_fee != null ? `, setting their new annual fee at ${money(decision.new_fee)}` : "") +
        `. The scope of work stays the same.`
      );
    case "keep":
      return `a warm note to ${name} that nothing changes and you are glad to keep working together.`;
    case "nudge":
      return `an email to ${name} proposing a couple of small changes so the working relationship runs more smoothly, while staying on.`;
    case "fire":
      return `a kind note to ${name} that you are stepping back and will not continue past this year, offering a smooth handoff.`;
  }
}

/** Draft in the owner's voice using Claude, with their samples as style examples. */
async function draftWithClaude(
  env: Env,
  client: Client,
  decision: Decision,
  samples: VoiceSample[]
): Promise<string> {
  const model = env.DRAFT_MODEL || "claude-haiku-4-5-20251001";
  const system =
    "You draft short, warm, plain client emails on behalf of an accountant. " +
    "Match the accountant's own writing voice, shown in the examples the user gives you: their greeting, " +
    "rhythm, warmth, and sign-off. Hard rules you must never break: no em dashes or en dashes anywhere; " +
    "never use the words honestly, quietly, genuinely, or straightforward. Keep it under 130 words. " +
    "Return only the message text, with no preamble or explanation.";

  const examples = samples
    .map((s, i) => `Example ${i + 1} of how I write:\n${s.message}`)
    .join("\n\n");
  const userContent = `${examples}\n\nNow, in my voice, write ${draftAsk(client, decision)}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      system,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Anthropic draft failed (${res.status}): ${detail}`);
  }
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  return (data.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
}
