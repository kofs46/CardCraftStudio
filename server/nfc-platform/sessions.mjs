// Customer sessions: 256-bit random token in an HttpOnly cookie; only its SHA-256 is stored.
// CSRF: every mutation must send X-CSRF-Token = HMAC(secret, token hash) in addition to the Origin check.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ApiError } from "../supabase.mjs";
import { cookie } from "../guards.mjs";
import { call, nfcConfig } from "./config.mjs";

export const SESSION_TTL = 7 * 24 * 3600; // absolute lifetime
export const SESSION_IDLE = 72 * 3600; // revoked if unused this long

export const cookieName = () => (nfcConfig().secure ? "__Host-nfc_session" : "nfc_session");
export const hashToken = (token) => createHash("sha256").update(token).digest("hex");
export const csrfFor = (tokenHash) =>
  createHmac("sha256", nfcConfig().sessionSecret).update("nfc-csrf:" + tokenHash).digest("base64url");

function setCookie(res, value, maxAge) {
  res.setHeader(
    "Set-Cookie",
    `${cookieName()}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${nfcConfig().secure ? "; Secure" : ""}`,
  );
}
export const clearSessionCookie = (res) => setCookie(res, "", 0);

export async function createSession(res, customerId) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  await call("nfc_session_create", { customer_id: customerId, token_hash: tokenHash, ttl_seconds: SESSION_TTL });
  setCookie(res, token, SESSION_TTL);
  return { csrf: csrfFor(tokenHash) };
}

export async function currentSession(req) {
  const token = cookie(req, cookieName());
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const tokenHash = hashToken(token);
  const session = await call("nfc_session_get", { token_hash: tokenHash, idle_seconds: SESSION_IDLE });
  return session ? { ...session, tokenHash, csrf: csrfFor(tokenHash) } : null;
}

export function checkCsrf(req, session) {
  const given = String(req.headers["x-csrf-token"] || "");
  const expected = session.csrf;
  if (given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected)))
    throw new ApiError("Security check failed. Reload the page and try again.", 403);
}

/**
 * Resolve the signed-in customer. The customer/profile identity always comes from the session,
 * never from the request body or URL, which prevents insecure direct object references.
 */
export async function requireCustomer(req, { mutation = false, allowPasswordChange = false } = {}) {
  const session = await currentSession(req);
  if (!session) throw new ApiError("Please log in.", 401);
  if (mutation) checkCsrf(req, session);
  if (session.status !== "active") throw Object.assign(new ApiError("This account is suspended. Please contact CardCraft Studio BD.", 403), { code: "suspended" });
  if (session.password_change_required && !allowPasswordChange)
    throw Object.assign(new ApiError("Please set a new password first.", 403), { code: "password_change_required" });
  return session;
}
