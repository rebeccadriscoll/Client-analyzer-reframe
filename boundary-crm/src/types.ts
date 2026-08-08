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
  /** Resend API key. When unset, the app runs in dev mode and surfaces the
   *  sign-in link in the response instead of emailing it. Set in production. */
  RESEND_API_KEY?: string;
  /** From header for the sign-in email, e.g. "Boundary CRM <login@yourfirm.com>". */
  MAIL_FROM?: string;
  /** Public base URL used to build sign-in links. Falls back to the request origin. */
  APP_URL?: string;
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
  entity_type: string | null;
  return_type: string | null;
  annual_fee: number | null;
  est_hours: number | null;
  realized_rate: number | null;
  tier: Tier | null;
  flags: string | null;
  created_at: number;
}

export interface Firm {
  id: string;
  owner_email: string;
  name: string | null;
  created_at: number;
}
