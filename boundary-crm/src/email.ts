import type { Env } from "./types";

export interface MagicEmailResult {
  /** True when the link was dispatched to an email provider. */
  sent: boolean;
  /** Present only in dev mode (no provider configured), so login is testable. */
  devLink?: string;
}

/** Low-level Brevo send. Throws on a non-OK response. */
async function brevoSend(env: Env, to: string, subject: string, text: string, html: string): Promise<void> {
  const sender = parseSender(env.MAIL_FROM || "Boundary CRM <login@example.com>");
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": env.BREVO_API_KEY!,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender,
      to: [{ email: to }],
      subject,
      textContent: text,
      htmlContent: html,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Brevo send failed (${res.status}): ${detail}`);
  }
}

/**
 * Send the sign-in link. With BREVO_API_KEY set, it emails via Brevo.
 * Without it, the app is in dev mode: the link is logged and returned so a
 * developer can sign in without wiring up mail. Do not deploy to production
 * without configuring a provider — see the README.
 */
export async function sendMagicLink(env: Env, email: string, link: string): Promise<MagicEmailResult> {
  if (!env.BREVO_API_KEY) {
    console.warn(`[boundary-crm] DEV MODE: no BREVO_API_KEY. Magic link for ${email}: ${link}`);
    return { sent: false, devLink: link };
  }
  await brevoSend(
    env,
    email,
    "Your Boundary CRM sign-in link",
    `Sign in to Boundary CRM:\n\n${link}\n\n` +
      `This link expires in 15 minutes and can be used once. ` +
      `If you did not request it, you can ignore this email.`,
    magicEmailHtml(link)
  );
  return { sent: true };
}

/** Parse a "Name <email>" string into Brevo's sender shape. */
function parseSender(from: string): { name: string; email: string } {
  const m = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1] || "Boundary CRM", email: m[2].trim() };
  return { name: "Boundary CRM", email: from.trim() };
}

function magicEmailHtml(link: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;background:#FAF3E7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1F3A3D;">
    <div style="max-width:480px;margin:0 auto;padding:40px 24px;">
      <div style="font-size:20px;font-weight:700;color:#C44536;margin-bottom:8px;">Boundary CRM</div>
      <p style="font-size:16px;line-height:1.5;">Tap the button to sign in. This link expires in 15 minutes and works once.</p>
      <p style="margin:28px 0;">
        <a href="${link}" style="display:inline-block;background:#F47A6A;color:#ffffff;text-decoration:none;font-weight:600;padding:14px 24px;border-radius:12px;">Sign in to Boundary CRM</a>
      </p>
      <p style="font-size:13px;color:#6B6B6B;line-height:1.5;">If the button does not work, paste this link into your browser:<br><span style="color:#C44536;word-break:break-all;">${link}</span></p>
      <p style="font-size:13px;color:#6B6B6B;">If you did not request this, you can ignore this email.</p>
    </div>
  </body>
</html>`;
}
