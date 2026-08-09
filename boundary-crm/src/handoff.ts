import type { Client } from "./types";
import { sanitizeVoice } from "./words";

export interface HandoffFact {
  label: string;
  value: string;
}

export interface HandoffPacket {
  client_id: string;
  client_name: string;
  firm_name: string;
  facts: HandoffFact[];
  narrative: string;
  /** Full plain-text packet, ready to copy. */
  text: string;
}

function money(n: number | null | undefined): string {
  if (n == null) return "Not on file";
  return "$" + Math.round(n).toLocaleString("en-US");
}

function firstName(full: string): string {
  const t = full.trim().split(/\s+/)[0];
  return t || full;
}

/**
 * A professional transition summary for a client the firm is parting ways with.
 * Deterministic and voice-compliant (no em dashes, none of the banned words); the
 * owner edits it before sharing. It carries only the facts a receiving firm needs,
 * never the firm's private notes.
 */
export function buildHandoffPacket(firmName: string, client: Client): HandoffPacket {
  const name = client.name;
  const first = firstName(name);
  const entity = client.entity_type && client.entity_type.trim() !== "" ? client.entity_type.trim() : null;
  const returns = client.return_type && client.return_type.trim() !== "" ? client.return_type.trim() : null;

  const facts: HandoffFact[] = [
    { label: "Business type", value: entity ?? "Not on file" },
    { label: "Return(s) prepared", value: returns ?? "Not on file" },
    { label: "Current annual fee", value: money(client.annual_fee) },
    { label: "Engagement", value: "Annual" },
  ];

  const entityWord = entity ? `${entity} ` : "";
  const returnsPhrase = returns ? `, covering ${returns} preparation` : "";
  const narrative = sanitizeVoice(
    `${name} is a client whose ${entityWord}work we have handled on an annual basis${returnsPhrase}. ` +
      `We are transitioning this relationship so ${first} continues to receive attentive, timely service. ` +
      `Prior filings and records are available to support a clean handoff, and we are glad to answer ` +
      `questions from the receiving firm to make the change easy for everyone.`
  );

  const factBlock = facts.map((f) => `- ${f.label}: ${f.value}`).join("\n");
  const text =
    `Client transition summary\n` +
    `Prepared by ${firmName}\n\n` +
    `Client: ${name}\n${factBlock}\n\n` +
    `${narrative}\n\n` +
    `${firmName}`;

  return { client_id: client.id, client_name: name, firm_name: firmName, facts, narrative, text };
}
