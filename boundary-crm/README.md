# Boundary CRM

The paid product the [Client Analyzer](../public/index.html) graduates into.

Built so far:

- **Step 1 — Auth + shell.** Magic-link email login and the themed shell with the six
  numbered sections (Import, Decide, The Words, Rollout, Tracker, Fear Killer).
- **Step 2 — Import.** CSV upload with confidence-scored column mapping you can confirm
  or correct, realized-rate calc, and A-D tiering, written to the `client` table.
- **Step 3 — Guided modules.** Clients grouped into small batches by realized rate; a
  three-step flow per client (meet → gut-check → confirm) writing one `decision` each.
- **Step 4 — The Words.** An editable draft message per decision (keep/raise/nudge/fire)
  in a warm, plain voice, saved onto the decision.
- **Step 5 — Rollout + Tracker.** Decisions organized into send waves; commitment links
  with told/silent/agreed/declined states and a live committed-revenue total.
- **Step 6 — Fear Killer.** Two sliders over your real book: revenue let go, revenue from
  raises, net change, and hours back.

All six Phase 0 sections are now built.

Phase 1 also adds a **Home dashboard** (overview + suggested next step), **edit/add clients**
(a detail modal that re-tiers the book on any change), **notes & history** per client, and
**follow-up flags** for clients told-but-silent. Plus **Settings** (firm name shown in the
header, a minimum fee that floors raise suggestions + the Fear Killer, and a default batch
size), **portfolio search / tier-filter / column sort**, and **Seasons** — closing a season
snapshots the cycle's decisions and committed revenue, then clears them (clients and notes
stay) so you start fresh next tax season. The Home tab also has a first-run
**getting-started checklist**, a **printable summary report**, and a **CSV export** of the
book.

## Fear Killer (Step 6)

A live calculator over your imported clients, no saving involved. Two sliders:

- **Clients to let go** cuts your lowest realized-rate clients first.
- **New minimum fee** raises every kept client that sits below it up to the floor.

It shows revenue let go, revenue from raises, net change, and hours back, with a
plain-language verdict and the names of who would be let go. Runs entirely client-side
from `GET /api/clients`.

## Rollout and tracker (Step 5)

**Rollout** groups decisions into four waves in send order that keeps revenue steady:
Raises first, then Keepers, Nudges, and Goodbyes last. Each wave shows its clients and the
revenue at stake, and carries a send date and a status (draft / scheduled / sent) you set.

**Tracker** is where responses land. Each decided client has a commitment with a state
(told → silent → agreed / declined) and a shareable **commitment link**. A live committed
total sums the fees of everyone who has agreed, against the full amount on the table.

- **Commitment links are real.** `GET /c/:token` serves a public, token-authenticated
  confirm page (no login) tailored to the action, where the client taps agree or decline;
  `POST /api/commit/:token` records it and locks in the fee on agree. Owner-side,
  `POST /api/commitments` sets a state manually and `GET /api/rollout` returns waves,
  tracker rows, and totals in one call. `POST /api/waves` saves a wave's schedule.
- **Nothing auto-sends.** The link is generated for you to send; the tool never contacts a
  client on its own.

## The Words (Step 4)

Every decision gets a draft you can edit, copy, and save. Drafts are personalized with
the client name and, for raises, the old and new fee.

- **Voice is enforced.** Generated copy never contains an em or en dash, nor the words
  honestly, quietly, genuinely, or straightforward. Deterministic templates (one per
  action) are the default, so drafts always comply; when a Workers AI binding is present,
  an optional call may replace the draft and the result is still run through the same
  `sanitizeVoice` net. The prompt stays server-side.
- **Nothing auto-sends.** The tool drafts; you edit and send. Drafts **autosave** as you
  type (debounced), so nothing is lost on exit; Save is still there for an explicit save.
- **Send from my email** prepares the message + the client's confirm link, marks them
  told, and opens it in the owner's own email app (pre-addressed if an email is on file),
  so the message goes out from the owner's real account — no per-firm domain setup, and
  replies come back to them. The confirm link still drives agreed/declined, so the Tracker
  stays current. The app itself does not send client mail (Brevo is only for the owner's
  sign-in link).

Backed by `POST /api/words/generate` (`{ client_id }` → draft), `POST /api/words/save`
(`{ client_id, message }`), and `POST /api/words/handoff` (`{ client_id }` → link + mark
told), all firm-scoped.

### Learn my voice (Claude)

If the owner rewrites a message in their own words, they can tap **"Draft the rest in my
voice"**: that wording is stored as a voice sample, and every other client's message is
redrafted to match their style. Drafting uses **Claude** (`DRAFT_MODEL`, default Haiku)
via the Anthropic API, with the saved samples as few-shot style examples. The house voice
rules still run on the output (no em/en dashes; none of the banned words).

- No Anthropic key, or no samples yet → drafts use the built-in template (the "suggested
  message"), so there is zero LLM cost until the owner opts in by teaching a sample.
- Only the client's name/fee and the owner's own samples are sent to Anthropic.
- Endpoints: `GET /api/voice` (sample count + ready state) and `POST /api/voice/teach`
  (`{ client_id, message }`, saves the message and adds a voice sample).

Set it up with an `ANTHROPIC_API_KEY` secret on the Worker (from console.anthropic.com).

## Ask (in-app assistant)

An **Ask** button (bottom-right, once signed in) opens a chat where the owner talks to
their book in plain English. It runs **Claude** through a server-side tool-use loop
(`ASSISTANT_MODEL`, falls back to `DRAFT_MODEL`, default Haiku) so nobody has to leave the
app or set up an external connector. The whole thing lives behind `POST /api/assistant`
(`{ messages }`, text only), which returns `{ reply, actions, ready }`.

Claude answers by calling firm-scoped tools, never by guessing:

- `get_summary` — book size, tier mix, decisions made, committed and potential revenue,
  who is silent.
- `list_clients` — filter by tier, decided action, or response state.
- `find_client` — one client's full detail by (partial) name.
- `set_decision` — record the call for a client (keep / raise / nudge / fire). A raise
  without an explicit fee gets a suggested one, computed the same way the Decide tab does
  (lift to the book's average realized rate, floored by the firm minimum).
- `draft_message` — write and save the client-facing message for a decided client, in the
  owner's learned voice when samples exist, so it lands in The Words for review.
- `set_response` — record that a client agreed / declined / was told / went silent; an
  agree locks in the committed fee automatically.
- `add_note` — jot a private note on a client.

Every tool reads and writes only through the same firm-scoped D1 helpers the rest of the
app uses, so the assistant can never touch another firm's data. The write tools are
surfaced back to the UI as small chips ("✓ Acme, agreed, $4,000 locked in", "◆ Bwinkle,
raise to $2,100 (suggested)") and trigger a refresh of the dashboard, client list, Decide,
and The Words. Nothing here sends email or contacts a client; drafting only saves a
message for the owner to review and send.
The house voice rules (no em/en dashes; none of the banned words) are baked into the
system prompt. Without an `ANTHROPIC_API_KEY`, the assistant returns a friendly "not
switched on yet" message and makes no external calls.

## Guided decisions (Step 3)

Clients sort by realized rate (lowest first, where the raise/let-go calls usually are)
and split into fixed-size batches (3 / 5 / 8, your choice). You work a batch one client
at a time:

1. **Meet** — the numbers (fee, hours, realized rate, tier), plain-language flags, and a
   short read of where the client stands.
2. **Gut check** — one honest question (how their name landing on your phone feels). It
   only shapes the suggestion; it is never persisted or acted on by itself.
3. **The call** — a suggested action with its reason shown, then you tap Keep, Raise,
   Nudge, or Let go. Raise prefills a fee that lifts the client to your book-average rate,
   editable, with a live delta. Saving writes the `decision` and advances to the next
   client.

Decisions upsert (one per client), so re-deciding updates in place. Nothing is sent or
acted on: this only records the call. `GET /api/decisions` and `POST /api/decisions`
(`{ client_id, action, new_fee? }`) back the flow, both scoped to the firm.

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
| `/api/decisions` | GET | List the firm's decisions |
| `/api/decisions` | POST | Save one decision (`{ client_id, action, new_fee? }`) |
| `/api/words/generate` | POST | Draft a message for a decision (`{ client_id }`) |
| `/api/words/save` | POST | Save the final message (`{ client_id, message }`) |
| `/api/words/handoff` | POST | Mint the confirm link + mark told, for the owner to send (`{ client_id }`) |
| `/api/overview` | GET | Dashboard aggregates + suggested next step |
| `/api/settings` | GET/POST | Firm name, minimum fee, default batch size |
| `/api/seasons` | GET | Past closed seasons |
| `/api/seasons/close` | POST | Snapshot the cycle + clear it (`{ label }`) |
| `/api/clients/create` | POST | Add a client by hand (re-tiers the book) |
| `/api/clients/update` | POST | Edit a client's fields (re-tiers the book) |
| `/api/clients/delete` | POST | Delete a client + its decision/notes (re-tiers) |
| `/api/notes/list` | POST | A client's notes (`{ client_id }`) |
| `/api/notes/add` | POST | Append a note (`{ client_id, body }`) |
| `/api/rollout` | GET | Waves, tracker rows, and committed/potential totals |
| `/api/waves` | POST | Set a wave's send date + status (`{ type, send_date?, status }`) |
| `/api/commitments` | POST | Owner sets a client's state (`{ client_id, state }`) |
| `/api/assistant` | POST | In-app Claude assistant, tool-use (`{ messages }`) |
| `/c/:token` | GET | **Public** commitment confirm page |
| `/api/commit/:token` | POST | **Public** agree/decline (`{ response }`) |

Every route except the auth request/verify requires a valid session, and every query is
scoped to the firm behind that session.

## Stack

- **Cloudflare Workers** (`src/index.ts`) — API + magic-link verify, TypeScript.
- **Workers Static Assets** — serves `public/index.html` (the shell).
- **Cloudflare D1** — Postgres-style SQLite. Schema in `migrations/`.
- **Brevo** (optional) — sends the sign-in email. Without it, the app runs in dev mode.

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
   API response). Create a [Brevo](https://www.brevo.com) API key and verify a sender
   or domain there, then:
   ```bash
   npx wrangler secret put BREVO_API_KEY
   ```
   Set `MAIL_FROM` in `wrangler.jsonc` `vars` to a verified sender on that domain, and
   set `APP_URL` to your deployed URL so links point at production.
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
  migrations/           D1 schema (0001 auth … 0007 note; 0008 settings + season)
  src/
    index.ts            Worker router: auth, clients, import, decisions, words, rollout
    db.ts               D1 queries (firm, tokens, sessions, clients, decisions, waves, commitments)
    crypto.ts           token generation, hashing, cookie parsing
    email.ts            Brevo adapter with a dev fallback
    scoring.ts          realized rate, A-D tiering, numeric parsing
    words.ts            message templates + voice guardrail + optional LLM
    assistant.ts        in-app Claude assistant: firm-scoped tool-use loop
    rollout.ts          wave order/labels + proposed-fee logic
    commit_page.ts      public commitment confirm page (HTML)
    import/
      csv.ts            CSV parser (quotes, commas, CRLF)
      importer.ts       Importer adapter interface + SpreadsheetImporter
      mapping.ts        column-mapping heuristic + optional LLM refinement
    types.ts            Env, Firm, Client, Tier types
  public/index.html     The themed shell (login gate, six sections, import UI)
```
