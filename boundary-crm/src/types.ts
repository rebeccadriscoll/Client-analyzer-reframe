export interface Env {
  /** D1 database binding (see wrangler.jsonc). */
  DB: D1Database;
  /** Static assets binding — serves the ./public shell. */
  ASSETS: Fetcher;
  /** Resend API key. When unset, the app runs in dev mode and surfaces the
   *  sign-in link in the response instead of emailing it. Set in production. */
  RESEND_API_KEY?: string;
  /** From header for the sign-in email, e.g. "Boundary CRM <login@yourfirm.com>". */
  MAIL_FROM?: string;
  /** Public base URL used to build sign-in links. Falls back to the request origin. */
  APP_URL?: string;
}

export interface Firm {
  id: string;
  owner_email: string;
  name: string | null;
  created_at: number;
}
