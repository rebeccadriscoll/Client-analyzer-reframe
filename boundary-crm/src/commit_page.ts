import type { Client, Decision, Commitment } from "./types";
import { proposedFee } from "./rollout";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function money(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

interface Copy {
  eyebrow: string;
  headline: string;
  body: string;
  agree: string;
  decline: string | null; // null hides the decline button (goodbyes)
}

function copyFor(client: Client, decision: Decision, fee: number): Copy {
  const name = client.name;
  switch (decision.action) {
    case "raise":
      return {
        eyebrow: "A note about your fee",
        headline: "Confirming your fee for the year ahead",
        body: `Thank you for your business. For the coming year, the proposed annual fee for ${name} is ${money(fee)}. The work stays the same. If this looks right, tap agree. If you would rather talk it through, let your accountant know.`,
        agree: `Agree to ${money(fee)}`,
        decline: "I'd like to talk first",
      };
    case "keep":
      return {
        eyebrow: "A quick confirmation",
        headline: "Nothing changes for the year ahead",
        body: `Glad to keep working with you. Your annual fee stays at ${money(fee)}. Tap agree to confirm, or let your accountant know if anything has changed on your side.`,
        agree: `Confirm ${money(fee)}`,
        decline: "Something has changed",
      };
    case "nudge":
      return {
        eyebrow: "A quick confirmation",
        headline: "A few small changes for the year ahead",
        body: `Looking forward to continuing together. Your annual fee stays at ${money(fee)}, with a couple of small changes to how we work that your accountant will walk through. Tap agree to keep going.`,
        agree: "Agree to continue",
        decline: "I'd like to talk first",
      };
    case "fire":
      return {
        eyebrow: "A note for the year ahead",
        headline: "A change to your accounting",
        body: `Your accountant is stepping back from some of their work and will not be continuing your account past this year. They want to give you time to find the right fit and will help with a smooth handoff. Tap below to acknowledge.`,
        agree: "Got it",
        decline: null,
      };
  }
}

/** Full standalone HTML for the public confirm page. ctx null renders a 404 page. */
export function renderCommitPage(
  ctx: { commitment: Commitment; client: Client; decision: Decision } | null,
  token: string
): string {
  if (!ctx) return notFoundPage();

  const fee = proposedFee(ctx.client, ctx.decision);
  const copy = copyFor(ctx.client, ctx.decision, fee);
  const done = ctx.commitment.state === "agreed" || ctx.commitment.state === "declined";
  const doneMsg =
    ctx.commitment.state === "agreed"
      ? "Thank you. Your response has been recorded as agreed."
      : ctx.commitment.state === "declined"
        ? "Thank you. Your accountant will follow up with you."
        : "";

  const declineBtn = copy.decline
    ? `<button class="btn ghost" id="declineBtn">${esc(copy.decline)}</button>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Boundary CRM</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22 viewBox%3D%220 0 64 64%22%3E%3Crect width%3D%2264%22 height%3D%2264%22 rx%3D%2214%22 fill%3D%22%23F47A6A%22%2F%3E%3C%2Fsvg%3E">
<style>
  :root { --coral:#F47A6A; --coral-deep:#C44536; --navy:#1F3A3D; --cream:#FAF3E7; --gray:#6B6B6B; --teal:#2D6A6B; --gray-light:#D4CFC4; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; background:var(--cream); color:var(--navy); line-height:1.6;
    display:flex; align-items:center; justify-content:center; min-height:100vh; padding:24px; }
  .card { background:white; max-width:440px; width:100%; border-radius:22px; padding:34px 30px; box-shadow:0 12px 40px rgba(31,58,61,0.16); }
  .mark { width:44px; height:44px; background:var(--coral); border-radius:12px; display:flex; align-items:center; justify-content:center;
    color:white; font-weight:800; font-style:italic; font-size:22px; font-family:Georgia,serif; margin-bottom:22px; }
  .eyebrow { font-size:12px; font-weight:700; letter-spacing:1px; text-transform:uppercase; color:var(--coral-deep); margin-bottom:10px; }
  h1 { font-size:24px; font-weight:700; margin-bottom:14px; letter-spacing:-0.01em; }
  p.body { font-size:15px; color:var(--navy); margin-bottom:26px; }
  .btn { display:block; width:100%; text-align:center; padding:15px 20px; font-size:16px; font-weight:600; border:none; border-radius:12px; cursor:pointer;
    font-family:inherit; margin-bottom:12px; transition:all 0.15s; }
  .btn.primary { background:var(--coral); color:white; }
  .btn.primary:hover { background:var(--coral-deep); }
  .btn.ghost { background:white; color:var(--gray); border:1.5px solid var(--gray-light); }
  .btn.ghost:hover { border-color:var(--navy); color:var(--navy); }
  .done { display:${done ? "block" : "none"}; font-size:15px; font-weight:600; color:var(--teal); background:rgba(45,106,107,0.1);
    padding:14px 16px; border-radius:12px; margin-bottom:8px; }
  .actions { display:${done ? "none" : "block"}; }
  .foot { font-size:12px; color:var(--gray); margin-top:18px; text-align:center; }
</style>
</head>
<body>
  <div class="card">
    <div class="mark">B</div>
    <div class="eyebrow">${esc(copy.eyebrow)}</div>
    <h1>${esc(copy.headline)}</h1>
    <p class="body">${esc(copy.body)}</p>
    <div class="done" id="doneMsg">${esc(doneMsg)}</div>
    <div class="actions" id="actions">
      <button class="btn primary" id="agreeBtn">${esc(copy.agree)}</button>
      ${declineBtn}
    </div>
    <div class="foot">Sent securely through Boundary CRM</div>
  </div>
<script>
  var token = ${JSON.stringify(token)};
  async function respond(kind, btn) {
    var actions = document.getElementById('actions');
    actions.querySelectorAll('button').forEach(function(b){ b.disabled = true; });
    if (btn) btn.textContent = 'Sending...';
    try {
      var res = await fetch('/api/commit/' + encodeURIComponent(token), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ response: kind })
      });
      if (!res.ok) throw new Error('failed');
      var msg = document.getElementById('doneMsg');
      msg.textContent = kind === 'agreed'
        ? 'Thank you. Your response has been recorded as agreed.'
        : 'Thank you. Your accountant will follow up with you.';
      msg.style.display = 'block';
      actions.style.display = 'none';
    } catch (e) {
      actions.querySelectorAll('button').forEach(function(b){ b.disabled = false; });
      if (btn) btn.textContent = kind === 'agreed' ? 'Try again' : btn.textContent;
    }
  }
  document.getElementById('agreeBtn').addEventListener('click', function(){ respond('agreed', this); });
  var d = document.getElementById('declineBtn');
  if (d) d.addEventListener('click', function(){ respond('declined', this); });
</script>
</body>
</html>`;
}

function notFoundPage(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Boundary CRM</title>
<style>
  body { font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; background:#FAF3E7; color:#1F3A3D;
    display:flex; align-items:center; justify-content:center; min-height:100vh; padding:24px; text-align:center; }
  .card { background:white; max-width:400px; border-radius:22px; padding:34px; box-shadow:0 12px 40px rgba(31,58,61,0.16); }
  h1 { font-size:22px; margin-bottom:10px; }
  p { color:#6B6B6B; }
</style></head>
<body><div class="card"><h1>This link is not valid</h1><p>The confirmation link may have expired or been mistyped. Please check with your accountant.</p></div></body></html>`;
}
