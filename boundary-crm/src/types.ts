/** Minimal shape of the Workers AI binding we use. Optional: import works
 *  without it. */
export interface AiBinding {
  run(model: string, input: unknown): Promise<unknown>;
}

export interface Env {
  /** D1 database binding (see wrangler.jsonc). */
  DB: D1Database;
  /** Static assets binding — serves the ./public shell. */
  ASSETS: Fetcher;
  /** Workers AI binding, used for optional LLM column-mapping refinement. */
  AI?: AiBinding;
  /** Brevo API key. When unset, the app runs in dev mode and surfaces the
   *  sign-in link in the response instead of emailing it. Set in production. */
  BREVO_API_KEY?: string;
  /** Sender for the sign-in email, e.g. "Boundary CRM <login@yourfirm.com>".
   *  The address must be a verified sender/domain in Brevo. */
  MAIL_FROM?: string;
  /** Anthropic API key. When set (and voice samples exist), The Words drafts
   *  messages in the owner's learned voice via Claude. */
  ANTHROPIC_API_KEY?: string;
  /** Claude model id for voice drafting. Defaults to a Haiku model. */
  DRAFT_MODEL?: string;
  /** Claude model id for the in-app assistant. Falls back to DRAFT_MODEL, then a Haiku model. */
  ASSISTANT_MODEL?: string;
  /** Public base URL used to build sign-in links. Falls back to the request origin. */
  APP_URL?: string;
}

export type MemberRole = "owner" | "member";

export interface Member {
  id: string;
  firm_id: string;
  email: string;
  role: MemberRole;
  created_at: number;
}

export interface FirmInvite {
  id: string;
  firm_id: string;
  email: string;
  role: MemberRole;
  created_at: number;
}

export type Tier = "A" | "B" | "C" | "D";

export type Action = "keep" | "raise" | "fire" | "nudge";

export interface Decision {
  id: string;
  client_id: string;
  firm_id: string;
  action: Action;
  new_fee: number | null;
  drafted_message: string | null;
  decided_at: number;
}

export type WaveType = Action;
export type WaveStatus = "draft" | "scheduled" | "sent";

export interface Wave {
  id: string;
  firm_id: string;
  type: WaveType;
  send_date: string | null;
  status: WaveStatus;
}

export interface Note {
  id: string;
  firm_id: string;
  client_id: string;
  body: string;
  created_at: number;
}

export interface VoiceSample {
  id: string;
  firm_id: string;
  action: Action | null;
  message: string;
  created_at: number;
}

export type CommitmentState = "told" | "silent" | "agreed" | "declined";

export interface Commitment {
  id: string;
  client_id: string;
  firm_id: string;
  link_token: string;
  state: CommitmentState;
  committed_fee: number | null;
  updated_at: number;
}

export interface Client {
  id: string;
  firm_id: string;
  name: string;
  email: string | null;
  entity_type: string | null;
  return_type: string | null;
  annual_fee: number | null;
  est_hours: number | null;
  realized_rate: number | null;
  tier: Tier | null;
  flags: string | null;
  /** 1 (low) .. 3 (high): cost beyond the fee (late pay, messy books, scope creep). */
  risk_level: number | null;
  /** 1 (low) .. 3 (high): value beyond the fee (referrals, tenure, growth). */
  relationship_level: number | null;
  /** Which member manages this client (shared book stays visible to all). */
  owner_member_id: string | null;
  created_at: number;
}

export interface Firm {
  id: string;
  owner_email: string;
  name: string | null;
  created_at: number;
  min_fee: number | null;
  batch_size: number | null;
  /** Target realized rate ($/hr). When set, tiers grade against it absolutely. */
  target_rate: number | null;
}

export interface Season {
  id: string;
  firm_id: string;
  label: string;
  decided: number;
  committed: number;
  potential: number;
  tiers: string | null;
  actions: string | null;
  closed_at: number;
}
