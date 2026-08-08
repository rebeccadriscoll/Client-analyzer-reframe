import type { Env } from "./types";
import { parseCookies } from "./crypto";
import {
  getOrCreateFirm,
  createMagicToken,
  consumeMagicToken,
  createSession,
  getFirmBySession,
  deleteSession,
} from "./db";
import { sendMagicLink } from "./email";

const SESSION_COOKIE = "bcrm_session";
const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // seconds

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    try {
      if (pathname === "/api/auth/request" && request.method === "POST") {
        return await handleAuthRequest(request, env, url);
      }
      if (pathname === "/auth/verify" && request.method === "GET") {
        return await handleVerify(env, url);
      }
      if (pathname === "/api/me" && request.method === "GET") {
        return await handleMe(request, env);
      }
      if (pathname === "/api/auth/logout" && request.method === "POST") {
        return await handleLogout(request, env);
      }
      // Any other /api/* path is a real 404, not the HTML shell.
      if (pathname.startsWith("/api/")) {
        return json({ error: "not_found" }, 404);
      }
    } catch (err) {
      console.error("boundary-crm error:", err);
      return json({ error: "server_error" }, 500);
    }

    // Everything else is served by the static assets binding (the shell).
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

/** POST /api/auth/request { email } — issue and send a magic link. */
async function handleAuthRequest(request: Request, env: Env, url: URL): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const email =
    body && typeof body === "object" && typeof (body as { email?: unknown }).email === "string"
      ? (body as { email: string }).email.trim()
      : "";
  if (!isValidEmail(email)) return json({ error: "invalid_email" }, 400);

  const firm = await getOrCreateFirm(env, email);
  const rawToken = await createMagicToken(env, firm.id);
  const base = (env.APP_URL || url.origin).replace(/\/$/, "");
  const link = `${base}/auth/verify?token=${rawToken}`;
  const result = await sendMagicLink(env, firm.owner_email, link);

  // Response shape is identical whether or not the firm already existed, so it
  // never reveals which emails have accounts. devLink is only ever set in dev.
  return json({ ok: true, emailSent: result.sent, devLink: result.devLink ?? null });
}

/** GET /auth/verify?token=... — consume the token, start a session, redirect home. */
async function handleVerify(env: Env, url: URL): Promise<Response> {
  const base = (env.APP_URL || url.origin).replace(/\/$/, "");
  const token = url.searchParams.get("token");
  if (!token) return redirect(`${base}/?auth=invalid`);

  const firmId = await consumeMagicToken(env, token);
  if (!firmId) return redirect(`${base}/?auth=invalid`);

  const session = await createSession(env, firmId);
  const headers = new Headers({ Location: `${base}/` });
  headers.append("Set-Cookie", sessionCookie(session, SESSION_MAX_AGE));
  return new Response(null, { status: 302, headers });
}

/** GET /api/me — who is signed in for this session. */
async function handleMe(request: Request, env: Env): Promise<Response> {
  const cookies = parseCookies(request.headers.get("Cookie"));
  const firm = await getFirmBySession(env, cookies[SESSION_COOKIE]);
  if (!firm) return json({ authenticated: false }, 401);
  return json({ authenticated: true, firm: { email: firm.owner_email, name: firm.name } });
}

/** POST /api/auth/logout — revoke the session and clear the cookie. */
async function handleLogout(request: Request, env: Env): Promise<Response> {
  const cookies = parseCookies(request.headers.get("Cookie"));
  await deleteSession(env, cookies[SESSION_COOKIE]);
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append("Set-Cookie", sessionCookie("", 0));
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

// ---- helpers ----

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}

function sessionCookie(value: string, maxAge: number): string {
  return [
    `${SESSION_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ].join("; ");
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
