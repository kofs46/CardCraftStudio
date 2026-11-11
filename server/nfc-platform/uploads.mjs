// Profile images: validated (type, magic bytes, 2 MB), stored under an unguessable path, and returned
// with a signed receipt bound to its owner. A receipt is only turned into a profile image on save,
// so uploads are never published early and one customer cannot attach another customer's upload.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { ApiError, sb } from "../supabase.mjs";
import { decodeFile } from "../files.mjs";
import { BUCKET, call, mediaUrl, nfcConfig } from "./config.mjs";

const RECEIPT_TTL = 24 * 3600 * 1000;
const PATH = /^media\/[a-f0-9-]{36}\.(png|jpg|webp)$/;

const sign = (payload) => createHmac("sha256", nfcConfig().sessionSecret).update("nfc-upload:" + payload).digest("base64url");

/** Read width/height from PNG / JPEG / WebP headers to reject decompression bombs. */
export function imageSize({ bytes, type }) {
  try {
    if (type === "image/png") return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
    if (type === "image/webp") {
      const chunk = bytes.toString("ascii", 12, 16);
      if (chunk === "VP8X") return { w: 1 + bytes.readUIntLE(24, 3), h: 1 + bytes.readUIntLE(27, 3) };
      if (chunk === "VP8 ") return { w: bytes.readUInt16LE(26) & 0x3fff, h: bytes.readUInt16LE(28) & 0x3fff };
      if (chunk === "VP8L") { const b = bytes.readUInt32LE(21); return { w: 1 + (b & 0x3fff), h: 1 + ((b >> 14) & 0x3fff) }; }
    }
    if (type === "image/jpeg") {
      let i = 2;
      while (i < bytes.length - 9) {
        if (bytes[i] !== 0xff) { i++; continue; }
        const marker = bytes[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
          return { h: bytes.readUInt16BE(i + 5), w: bytes.readUInt16BE(i + 7) };
        i += 2 + bytes.readUInt16BE(i + 2);
      }
    }
  } catch { /* fall through */ }
  return null;
}

export async function uploadImage(data, owner) {
  const file = decodeFile(data, false);
  const size = imageSize(file);
  if (!size || !size.w || !size.h || size.w > 6000 || size.h > 6000 || size.w * size.h > 24e6)
    throw new ApiError("Image dimensions are not supported. Use an image up to 6000×6000 pixels.");
  const path = `media/${randomUUID()}.${file.extension}`;
  await sb(`/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    body: file.bytes,
    raw: true,
    headers: { "Content-Type": file.type, "x-upsert": "false", "cache-control": "max-age=31536000" },
  });
  const payload = Buffer.from(JSON.stringify({ path, owner, exp: Date.now() + RECEIPT_TTL })).toString("base64url");
  return { receipt: payload + "." + sign(payload), url: mediaUrl(path), width: size.w, height: size.h };
}

export function readReceipt(receipt, owner) {
  const [payload, sig, ...rest] = String(receipt || "").split(".");
  const expected = sign(payload || "");
  if (rest.length || !sig || sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
    throw new ApiError("Invalid image reference. Please upload the image again.");
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url"));
  } catch {
    throw new ApiError("Invalid image reference.");
  }
  if (data.owner !== owner || !PATH.test(data.path) || data.exp < Date.now())
    throw new ApiError("Image upload expired or belongs to another account. Please upload it again.");
  return data.path;
}

/**
 * undefined → field untouched · null → remove · {receipt} → newly uploaded image (owner checked)
 * {path} → keep an image this profile already uses (must be in `current`).
 */
export function resolveImage(value, current, owner) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value === "object" && typeof value.receipt === "string") return readReceipt(value.receipt, owner);
  if (typeof value === "object" && typeof value.path === "string" && current.includes(value.path)) return value.path;
  throw new ApiError("Invalid image reference. Please upload the image again.");
}

/** Best-effort deletion of media that is no longer referenced. A failure stays queued for next time. */
export async function processCleanup() {
  try {
    const paths = await call("nfc_cleanup_claim", { limit: 25 });
    if (!paths?.length) return;
    await sb(`/storage/v1/object/${BUCKET}`, { method: "DELETE", body: { prefixes: paths } });
    await call("nfc_cleanup_done", { paths });
  } catch (error) {
    console.error("NFC media cleanup pending", { message: error.message });
  }
}
