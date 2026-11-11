import { ApiError, config, sb } from "../supabase.mjs";

export const BUCKET = "nfc-profile-media";

/** NFC routes need the existing shop configuration plus a dedicated session secret. Fails closed. */
export function nfcConfig() {
  const c = config();
  const secret = process.env.NFC_SESSION_SECRET || "";
  if (secret.length < 32)
    throw new ApiError("NFC setup incomplete. Configure NFC_SESSION_SECRET.", 503);
  return { ...c, sessionSecret: secret, secure: c.origin.startsWith("https:") };
}

export const mediaUrl = (path) =>
  path ? `${config().url}/storage/v1/object/public/${BUCKET}/${path}` : "";

export const profileUrl = (slug) => `${config().origin}/p/${slug}`;

/** Call an NFC RPC. Every NFC function takes a single jsonb argument named p. */
export const call = (name, p = {}) =>
  sb("/rest/v1/rpc/" + name, { method: "POST", body: { p } });
