// Shared request guards used by the shop API and the NFC platform API.
import { createHash } from "node:crypto";
import { ApiError, config, sb, rpc } from "./supabase.mjs";

export function cookie(req, name) {
  const prefix = name + "=";
  return String(req.headers.cookie || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(prefix))
    ?.slice(prefix.length);
}

/** Existing admin login: Supabase Auth access token in cc_session + ADMIN_USER_IDS allowlist. */
export async function admin(req) {
  const token = cookie(req, "cc_session");
  if (!token) throw new ApiError("Please sign in.", 401);
  let user;
  try {
    user = await sb("/auth/v1/user", {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new ApiError("Session expired. Please sign in.", 401);
  }
  if (!config().admins.includes(user.id))
    throw new ApiError("Admin access required.", 403);
  return user;
}

export function clientIp(req) {
  // Vercel overwrites x-vercel-forwarded-for; local use the socket address.
  return process.env.VERCEL
    ? req.headers["x-vercel-forwarded-for"] || "unknown"
    : req.socket?.remoteAddress || "local";
}

/** Persistent rate limit keyed by a SHA-256 of kind + subject (IP by default). */
export async function limit(req, kind, max, seconds, subject = clientIp(req)) {
  const key = createHash("sha256")
    .update(kind + ":" + subject)
    .digest("hex");
  if (
    !(await rpc("shop_limit", {
      rate_key: key,
      max_hits: max,
      window_seconds: seconds,
    }))
  )
    throw new ApiError("Too many requests. Try again later.", 429);
}
