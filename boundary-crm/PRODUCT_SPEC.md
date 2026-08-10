# Boundary CRM — Product Specification

*A hand-off document. Everything here describes software that is built and deployed today,
unless a section is explicitly labeled "Roadmap" or "Could be added."*

---

## 1. One-liner

**Boundary CRM is the pricing and capacity operating system for an accounting firm — the
thing that decides how every client, and every new prospect, gets priced, kept, grown, or
let go. Every year.**

It is the paid product that the free **Client Analyzer** graduates into. Live at
`boundarycrm.rdriscollcpa.com`.

---

## 2. The problem it solves

Most accounting and tax firms carry a long tail of clients they acquired opportunistically
over years: underpriced, high-maintenance, low-margin. Partners know intuitively who these
clients are but almost never act, because:

- The analysis is tedious and nobody has a clean number for "who is actually worth it."
- The hard part isn't *knowing* who to raise or fire — it's *doing* it. The emotional labor
  of a fee increase or a client breakup is real and blocks action.
- The decision, once made, rarely reaches the billing system, so it quietly doesn't happen.

Four industry forces make this urgent right now:

1. **The talent crisis.** ~75% of CPAs are near retirement, graduates are down, firms cannot
   hire. **Capacity, not demand, is the binding constraint.** Reallocating scarce hours to
   the best work is the whole game.
2. **The shift to advisory and value pricing.** Firms are trying to move from commodity
   compliance to higher-margin advisory (CAS) and from the billable hour to fixed/value
   pricing. Realized rate is the metric that bridge runs on.
3. **A succession / M&A wave.** Thousands of owners are retiring with their book *as their
   retirement asset*, and private equity is buying aggressively. A clean, high-realization,
   low-concentration book sells for a higher multiple.
4. **Tool fragmentation.** Fees live in billing/proposal tools, hours in practice management,
   return types in tax software — the data needed to price well is scattered.

Boundary makes the implicit explicit, gives the owner permission and a script to act, and
carries the decision all the way to done.

---

## 3. Who it's for

- **Primary:** solo and small-to-midsize accounting & tax firm owners (roughly 1–20 people).
- **Also:** partners and staff within those firms, via multi-user (a firm is a shared
  workspace; everyone works one book together).
- **On-ramp:** users of the free Client Analyzer, who upgrade to Boundary for the full
  workflow.

The buyer is a firm *owner* who feels the capacity squeeze and knows their book needs
re-pricing but has never had a tool that walks them through it.

---

## 4. Core concepts (the mental model)

| Concept | Meaning |
| --- | --- |
| **Client** | A firm's client: name, email, entity type, return type, annual fee, estimated hours. |
| **Realized rate** | `annual_fee ÷ est_hours` — the effective $/hr the firm earns on a client. The core health metric. |
| **Tier (A–D)** | A grade on realized rate. With a **target rate** set, grading is *absolute* (A ≥ 1.25× target, B ≥ target, C ≥ 0.6× target, else D). Without one, it falls back to percentile within the book. |
| **Risk / relationship levels** | Two optional 1–3 ratings per client. **Risk** = cost beyond the fee (late pay, messy books, scope creep). **Relationship** = value beyond the fee (referrals, tenure, growth). They bend the recommendation so it isn't one-dimensional. |
| **Decision** | The call for a client: **keep**, **raise** (with a new fee), **nudge** (small changes to fix the fit), or **fire** (part ways). |
| **Commitment** | How a client responded: **told → silent → agreed / declined**, tracked via a shareable confirm link. |
| **Wave** | A group of decisions sent together, in revenue-safe order (raises first, goodbyes last). |
| **Season** | A snapshot of one decision cycle (decisions, committed revenue, tier mix, book health), archived so the firm can start fresh next year and see trends over time. |
| **Member / Firm** | A person (by email) belongs to a firm (a shared workspace). The founding user is the **owner**; invited users are **members**. |
| **Benchmark** | A market fee range for a service (e.g. an 1120-S), used to flag underpriced clients — seeded defaults now, pooled network data as firms opt in. |
| **Valuation** | A rough practice-value estimate (a multiple of recurring revenue) that moves with realization, client mix, and concentration. |

**Guiding principle:** *nothing auto-sends, and every recommendation is explainable.* The
tool analyzes, drafts, and tracks; the human decides and sends.

---

## 5. Feature walkthrough

The app is a single-page web app with a tabbed workflow plus cross-cutting tools.

### Home (dashboard)
- **Next step** card that always points to the most useful action.
- **Needs attention** hub — the always-on worklist: clients priced below target and still
  undecided, priced below market, missing a fee or hours, or gone silent 7+ days. Each row
  jumps to the tab that resolves it. Hides when nothing is pending.
- **Stat tiles:** clients, committed revenue, **hours freed** (from goodbyes — the capacity
  headline), book revenue, needs-follow-up.
- **Tier mix** and **decisions** breakdowns.
- **Season trends** — clients, realized rate, committed revenue, and decisions across closed
  seasons, oldest to newest, with up/down deltas (is the book improving year over year?).
- **Exports:** printable summary, book CSV, and a billing-oriented **decisions CSV**.
- First-run **getting-started checklist** and an **Explore with sample clients** path so a
  brand-new firm can try the whole flow on realistic demo data before importing.

### 1. Import
- Upload a CSV; the app suggests which column feeds each field (name, entity type, return
  type, annual fee, estimated hours) with confidence badges, computed by a header heuristic
  (optionally refined by an LLM call, with a safe fallback).
- Computes realized rate and assigns tiers.
- A live **portfolio** with search, tier filter, sortable columns, and (in multi-user) a
  **Mine** filter.

### 2. Decide
- Clients sort by realized rate into small batches (3/5/8, configurable).
- A three-step flow per client: **Meet** (numbers, plain-language flags, a short read) →
  **Gut check** (one honest question that shapes but never dictates the suggestion) →
  **The call** (a suggested action *with its reason shown*, then Keep / Raise / Nudge /
  Let go). Raise prefills a fee that lifts the client toward the target rate, editable.
- The suggestion is **multi-factor**: tier + gut feel + risk + relationship. A thin-rate
  client who's low-risk and a strong referral source is correctly a *keep*; a high-pain
  keeper becomes a *nudge*; a thin, painful, unvalued client becomes a *goodbye*.

### 3. The Words
- An editable, voice-compliant draft message per decision (keep/raise/nudge/fire),
  personalized with the client name and fees. **Autosaves** as you type.
- **Learn my voice:** if the owner rewrites one message, that becomes a style sample and
  every other draft is rewritten in their voice (via Claude), still passing the house-voice
  rules.
- **Send from my email:** prepares the message + the client's confirm link, marks them
  *told*, and opens it in the owner's own email app — so it sends from their real account,
  replies come back to them, and there's no per-firm email-domain setup. Provider-agnostic
  (works whether they use Gmail, Outlook, etc.).

### 4. Rollout & 5. Tracker
- **Rollout** groups decisions into four waves in revenue-safe order (raises, keepers,
  nudges, goodbyes), each with a send date and status.
- **Tracker** shows every client's commitment state and a live **committed-revenue** total.
- **Commitment links** are real: a public, login-free confirm page tailored to the action
  where the client taps agree or decline; agreeing locks in the fee. This makes response
  tracking **provider-agnostic** — it doesn't matter what email or billing tool the firm
  uses.
- **Handoff packets** (on the Goodbyes wave): a clean, professional transition summary for
  each fired client so nobody is left adrift — the facts a receiving firm needs, editable,
  copy/print, with a reminder to share with the client's knowledge and disclose any referral
  arrangement per board rules. (Carries no private notes.)

### 6. Fear Killer & Scenario planner
- **Fear Killer:** two sliders (clients to let go, new minimum fee) show revenue let go,
  revenue from raises, net change, and hours back — "the math beats the fear."
- **Scenario planner:** model tier-wide moves (C-tier keep/raise, D-tier keep/raise/let go,
  raise below-market clients) and see the before/after impact on **revenue, hours freed,
  realized rate, and practice value.** Surfaces the non-obvious trade-off: letting go of the
  bottom tier can dip revenue while *raising* sale value, because a cleaner, higher-realization
  book earns a higher multiple.

### 7. Grow
- **Advisory candidates:** the clients worth *growing* (good tier, low risk, real
  relationship, a business that needs more than a return), each with the reason and a
  ready outreach script for a paid advisory touchpoint. Turns "raise" into "expand."
- **Price a new prospect:** enter the hours a new engagement will take → the fee that hits
  your target rate (floored at your minimum); or test a fee and see the realized rate and
  tier it would land in. **Add to book** creates the client at that fee, so every new client
  is priced through the tool and the book stays current.

### 8. Groom for sale
- Values the book as a **sellable asset**: an estimated practice-value range and multiple,
  plus the four numbers a buyer cares about (recurring revenue, realized rate vs target,
  top-client concentration, A/B share).
- **What lifts the price:** reduce concentration (a top client over ~15% gets discounted),
  lift/release the D tier, close the rate gap, clean up missing data.
- **Buyer package (sell-side data room):** a clean, printable one-page diligence document
  under the firm's name — revenue, average/median fee, realized rate, concentration
  (top 1/5/10%), revenue by service line, tier mix, value estimate — plus a metrics CSV.

### 9. Benchmarks
- Maps each client to a service band from its entity/return type and compares the fee to a
  typical market range, surfacing **underpriced** clients the realized-rate view can miss.
  Shows raise **headroom** to market low and a below/within/above table.
- **Benchmark network:** firms opt in (Settings) to share fees anonymously; the tab then
  shows a **Network benchmarks** table — the firm's average vs the pooled **median** and
  **25–75% range** per service, with the contributing-firm count. Privacy floor: only
  aggregates ever leave the server, and a service shows only above ≥2 firms and ≥5 data
  points. The value grows with adoption — this is the data moat.

### Ask (in-app AI assistant)
- A chat where the owner talks to their book in plain English, powered by Claude through a
  server-side tool-use loop (firm-scoped tools: summary, list/find clients, set a decision,
  draft a message, record a response, add a note). It can **answer and act**, never leaving
  the app, no external connector.
- **Proactive:** it opens with a "Worth your attention" list computed from the live book
  (undecided, below target, ready to grow, under market, silent, missing data) as one-tap
  prompts. It initiates rather than only waiting.
- Same guardrails: nothing auto-sends; house voice enforced.

### Settings & multi-user
- **Settings:** firm name, **target realized rate**, minimum fee, default batch size,
  **Team** management, **Seasons** (close/list), and **benchmark network** opt-in.
- **Multi-user:** the owner invites colleagues by email; they join the same firm (sharing
  the whole book) on their next sign-in. Owner vs member roles. Optional per-client
  **managed-by** tag and a **Mine** filter (shown only when a firm has more than one member).

---

## 6. Guardrails & principles (non-negotiables)

- **Nothing auto-sends.** The tool drafts and tracks; the human sends. No client is ever
  contacted automatically.
- **Explainable.** Every recommendation shows its reasoning.
- **House voice.** Generated client copy never uses em/en dashes, nor the words *honestly,
  quietly, genuinely, straightforward*. Enforced by deterministic templates plus a sanitizer.
- **Firm-scoped & private.** Every query is scoped to the signed-in firm; client data is
  never shared across firms except as privacy-floored aggregates the firm opted into.
- **Provider-agnostic.** Sending happens from the owner's own inbox; response tracking runs
  on confirm links — so it works regardless of email or billing tooling.

---

## 7. Technical architecture

- **Cloudflare Workers** (TypeScript) serve the API and auth routes.
- **Cloudflare D1** (SQLite) is the database.
- **Workers Static Assets** serve a single-file SPA (`public/index.html`) — no build step.
- **Magic-link auth:** hashed single-use tokens, httpOnly/Secure/SameSite session cookie,
  sessions in D1. **Brevo** sends the owner's sign-in email only.
- **Anthropic API (Claude):** voice drafting and the in-app assistant (tool-use loop),
  default Haiku models.
- **Deploy:** Cloudflare Workers Builds (Git-connected). Schema migrations are applied
  manually in the D1 console (they are not auto-run on deploy).
- **Client sending:** `mailto:` handoff from the owner's own inbox; response tracking via
  public confirm links.

### Data model (tables)
`firm`, `member`, `firm_invite`, `magic_link_token`, `session`, `client`, `decision`,
`wave`, `commitment`, `note`, `voice_sample`, `season`. Key client columns: fee, hours,
realized_rate, tier, risk_level, relationship_level, owner_member_id. Firm-level settings:
target_rate, min_fee, batch_size, contribute_benchmarks.

### API surface (representative)
Auth (`/api/auth/*`, `/auth/verify`, `/api/me`), clients (`/api/clients` +
create/update/delete), import (`/api/import/preview|commit`), sample data, decisions,
words (generate/save/handoff, voice), rollout/waves/commitments, handoffs, valuation,
dataroom, grow, benchmarks (incl. network), attention, scenario, seasons, team, assistant
(+ suggestions), and public commitment routes (`/c/:token`, `/api/commit/:token`).

---

## 8. How it fits into an accounting firm

### Where it sits in the stack
Boundary is not a tax package, a practice-management suite, or a billing system. It sits
*above* them as the **pricing-and-capacity brain**:

- **Tax software** (UltraTax, Lacerte, Drake, ProConnect, CCH) → return types, complexity.
- **Practice management** (Karbon, Canopy, TaxDome, Jetpack) → time/hours, workflow.
- **Billing / proposals** (Ignition, Anchor, TaxDome, QuickBooks) → fees, engagement letters.

Today, data comes in by **CSV import** (and manual entry / the Ask assistant / the new-client
pricer), and decisions go out by **CSV export** and **drafted client messages the owner
sends themselves.** The "decision has to reach the billing system to be real" bridge is
currently the billing export; a deep two-way integration with one proposal tool is the
natural next step (see Roadmap).

### Where it sits in the firm's year
- The **core decision cycle** (score → decide → roll out → track → close a season) is a
  once-or-twice-a-year ritual, naturally aligned with post-busy-season or engagement-letter
  season.
- But the product is increasingly **always-on**: new clients get priced through it as they
  arrive, the Needs-attention hub and proactive assistant surface drift year-round, and
  Season trends make the trajectory visible. This is the intended shift from "annual cleanup
  tool" to "the system the firm's pricing runs on."

### The pitch that lands
In a talent-starved profession, lead with **capacity, not cash**: "cutting your bottom tier
frees ~600 hours and you don't have to hire" beats any revenue number. The ROI story is
undeniable — one recovered client pays for the tool for years.

---

## 9. Roadmap — what could be added

### Make it live (the biggest unlock)
- **Live integrations:** QBO/Xero (actual fees billed & collected), a practice-management
  tool (real hours), tax software (return types). This turns realized rate from an estimate
  into a live number and removes the data-entry barrier — the quiet weakness today, since
  many small firms don't cleanly track per-client hours. *The connector seam already exists
  (the import adapter interface); the remaining work is a per-provider OAuth handshake, which
  needs an OAuth app, deployed credentials, and a decision on which tool first — best answered
  by asking target firms what they bill and track time in.*
- **One deep billing integration** (Ignition or TaxDome): push a raise as a draft
  proposal/engagement letter, so decisions execute instead of leaking.
- **Drift alerts over time:** with periodic per-client rate snapshots, flag a client whose
  realized rate slips below target mid-year (real-time scope-creep detection).

### Turn it into a business (deliberately not built yet)
- **Billing (Stripe):** plans, checkout, gating. The ROI pitch writes itself.
- **The upgrade funnel:** free Client Analyzer → paid Boundary, instrumented.
- **White-label / advisor mode:** consultants who coach firms running many firms' cleanups.

### Widen the moat & depth
- **Benchmark network at scale:** the opt-in infrastructure is built; the value compounds as
  firms join ("firms your size in your region charge X for a 1065; you're 30th percentile").
- **Referral / marketplace for fired clients:** a fired client is another firm's ideal
  client; the handoff packet is the seed. Requires a two-sided network and careful handling
  of consent and referral-fee ethics (AICPA permits referral fees for non-attest clients with
  disclosure; restricted for attest; varies by state).
- **Deeper AI:** the proactive assistant can grow into running a whole season conversationally
  and drafting engagement letters, not just client messages.
- **Client-facing:** a renewal engine with e-signed engagement letters; automated follow-up
  sequences for silent clients.
- **Compliance & trust:** an audit trail of decisions (who decided what, when) for
  partnerships; hardened security posture for selling into firms.

### Open questions worth validating with real firms
1. Do your target firms track per-client hours cleanly? (Determines how much rests on solid
   data vs. estimates.)
2. Which billing/practice-management tool do they live in? (Determines the first integration.)
3. What would they pay, and per what (per season, per year, per seat)?

---

## 10. Current status

- **Built and deployed**, multi-user, at `boundarycrm.rdriscollcpa.com`.
- **Not charging yet** — no billing/subscription layer (deliberate; that's the "turn it into
  a business" track).
- **Live third-party connectors are not built** — documented as a deploy-and-partner step.
- Everything else described above is live.
