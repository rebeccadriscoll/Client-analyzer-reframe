# Boundary CRM

The paid product the [Client Analyzer](../public/index.html) graduates into.

Built so far:

- **Step 1 — Auth + shell.** Magic-link email login and the themed shell with the six
  numbered sections (Import, Decide, The Words, Rollout, Tracker, Fear Killer).
- **Step 2 — Import.** CSV upload with confidence-scored column mapping you can confirm
  or correct, realized-rate calc, and A-D tiering, written to the `client` table.

Decisions, The Words, rollout, tracker, and the Fear Killer arrive in later steps.

Cloudflare-native by design: a single Worker serves the static shell (`public/`) and
handles the API and auth routes, with **D1** for data. This matches the Client Analyzer's
existing Cloudflare hosting and keeps everything on one platform.

## Import (Step 2)

Upload a CSV and the app suggests which column feeds each client field (name, entity
type, return type, annual fee, estimated hours), with a confidence badge on each guess.
You confirm or adjust the mapping, see a live preview with realized rate, then import.

- **Mapping** is a header-name heuristic (synonyms + token overlap), so it works
  instantly with no external dependency and is fully explainable. If a Workers AI binding
  is present, an optional single LLM call refines only the low-confidence guesses; any
  failure falls back to the heuristic, so import never depends on the model.
- **Realized rate** = `annual_fee / est_hours` (null when hours are missing/zero).
- **Tier** is assigned by realized-rate percentile within the imported set: A = top 20%,
  B = next 30%, C = next 30%, D = bottom 20%. Rows with no name are skipped; rows with no
  fee/hours import but stay unranked.
- **Adapter seam:** the importer is an `Importer` interface (`src/import/importer.ts`).
  Phase 0 ships only `SpreadsheetImporter`; QBO/TaxDome connectors implement the same
  interface later without touching mapping, tiering, or the write path.

### API

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/auth/request` | POST | Issue + send a magic link |
| `/auth/verify` | GET | Consume the link, start a session |
| `/api/me` | GET | Who is signed in |
| `/api/auth/logout` | POST | Revoke the session |
| `/api/clients` | GET | List the firm's clients + tier breakdown |
| `/api/import/preview` | POST | Parse a CSV, return headers + mapping suggestions |
| `/api/import/commit` | POST | Write clients (`{ csv, mapping, replace? }`) |

Every route except the auth request/verify requires a valid session, and every query is
scoped to the firm behind that session.

## Stack

- **Cloudflare Workers** (`src/index.ts`) — API + magic-link verify, TypeScript.
- **Workers Static Assets** — serves `public/index.html` (the shell).
- **Cloudflare D1** — Postgres-style SQLite. Schema in `migrations/`.
- **Resend** (optional) — sends the sign-in email. Without it, the app runs in dev mode.

No frontend build step: the shell is a single static HTML file, matching the analyzer's
approach and the "smallest number of moving parts" goal in the handoff.

## First-time setup

```bash
cd boundary-crm
npm install

# 1. Create the D1 database, then paste the returned database_id into wrangler.jsonc
npm run db:create

# 2. Apply the schema locally
npm run db:migrate:local

# 3. Run it
npm run dev
```

Open the local URL wrangler prints. Enter any email and click **Send my sign-in link**.
Because no mail provider is configured in dev, the sign-in link is returned in the
response and shown on the "Check your email" screen (and logged to the Worker console).
Click it to sign in.

## Going to production

1. Paste the real `database_id` from `npm run db:create` into `wrangler.jsonc`.
2. Apply migrations to the remote database:
   ```bash
   npm run db:migrate:remote
   ```
3. **Configure email** (required in production, or sign-in links are exposed in the
   API response). Create a [Resend](https://resend.com) API key for a verified sending
   domain, then:
   ```bash
   npx wrangler secret put RESEND_API_KEY
   ```
   Set `MAIL_FROM` in `wrangler.jsonc` `vars` to a sender on that domain, and set
   `APP_URL` to your deployed URL so links point at production.
4. Deploy:
   ```bash
   npm run deploy
   ```

## Security notes (Phase 0 guardrails)

- Magic-link and session tokens are stored **hashed** (SHA-256); the raw values never
  touch the database. The session token lives only in an httpOnly, Secure, SameSite=Lax
  cookie.
- Magic links are **single-use** and expire after 15 minutes. Redemption is atomic, so a
  link cannot be used twice even under a race.
- `/api/auth/request` returns the **same response** whether or not the email has an
  account, so it never reveals who has one.
- Every data query is scoped to the firm resolved from the session cookie. Client data
  (added in later steps) is never returned without a valid session.
- **Nothing auto-sends.** No client is contacted, raised, or dropped by the app. Later
  steps draft messages that the owner must confirm and send.

## Project layout

```
boundary-crm/
  wrangler.jsonc        Worker + assets + D1 + AI config
  migrations/           D1 schema (0001 auth: firm/token/session; 0002 client)
  src/
    index.ts            Worker router: auth + /api/clients + /api/import/*
    db.ts               D1 queries (firm, tokens, sessions, clients)
    crypto.ts           token generation, hashing, cookie parsing
    email.ts            Resend adapter with a dev fallback
    scoring.ts          realized rate, A-D tiering, numeric parsing
    import/
      csv.ts            CSV parser (quotes, commas, CRLF)
      importer.ts       Importer adapter interface + SpreadsheetImporter
      mapping.ts        column-mapping heuristic + optional LLM refinement
    types.ts            Env, Firm, Client, Tier types
  public/index.html     The themed shell (login gate, six sections, import UI)
```
