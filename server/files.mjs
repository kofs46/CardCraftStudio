import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { config, sb, ApiError } from "./supabase.mjs";
const mimeExt = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/pdf": "pdf",
};
export function decodeFile(data, allowPdf = true) {
  const match =
    /^data:(image\/(?:png|jpeg|webp)|application\/pdf);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      data || "",
    );
  if (!match || (!allowPdf && match[1] === "application/pdf"))
    throw new ApiError(
      "Choose PNG, JPEG, WebP" + (allowPdf ? " or PDF." : "."),
    );
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 2 * 1024 * 1024)
    throw new ApiError("Each file must be at most 2 MB.");
  const type = match[1];
  const valid =
    type === "image/png"
      ? bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : type === "image/jpeg"
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : type === "image/webp"
          ? bytes.toString("ascii", 0, 4) === "RIFF" &&
            bytes.toString("ascii", 8, 12) === "WEBP"
          : bytes.toString("ascii", 0, 5) === "%PDF-";
  if (!valid) throw new ApiError("File contents do not match the file type.");
  return { bytes, type, extension: mimeExt[type] };
}
const signature = (payload) =>
  createHmac("sha256", config().secret).update(payload).digest("base64url");
export function receipt(file) {
  const payload = Buffer.from(JSON.stringify(file)).toString("base64url");
  return payload + "." + signature(payload);
}
export function verifyFile(file, imageOnly = false) {
  if (!file) return null;
  const [payload, sig, ...extra] = String(file.receipt || "").split(".");
  const expected = signature(payload || "");
  if (
    extra.length ||
    !sig ||
    sig.length !== expected.length ||
    !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  )
    throw new ApiError("Invalid file reference. Please upload again.");
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url"));
  } catch {
    throw new ApiError("Invalid file reference.");
  }
  if (
    !/^uploads\/[a-f0-9-]+\.(png|jpg|webp|pdf)$/.test(data.path) ||
    data.expires < Date.now() ||
    (imageOnly && data.type === "application/pdf")
  )
    throw new ApiError("File expired or invalid. Upload again.");
  return {
    name: String(file.name || "artwork").slice(0, 150),
    path: data.path,
    type: data.type,
  };
}
export async function upload(data, publicImage = false) {
  const file = decodeFile(data, !publicImage),
    path = `uploads/${randomUUID()}.${file.extension}`,
    bucket = publicImage ? "product-images" : "order-artwork";
  await sb(`/storage/v1/object/${bucket}/${path}`, {
    method: "POST",
    body: file.bytes,
    raw: true,
    headers: { "Content-Type": file.type, "x-upsert": "false" },
  });
  if (publicImage)
    return {
      url: `${config().url}/storage/v1/object/public/${bucket}/${path}`,
    };
  return {
    receipt: receipt({
      path,
      type: file.type,
      expires: Date.now() + 24 * 3600000,
    }),
  };
}
export async function signedFile(file) {
  if (!file?.path) return null;
  const result = await sb(
    "/storage/v1/object/sign/order-artwork/" + file.path,
    { method: "POST", body: { expiresIn: 600 } },
  );
  return {
    name: file.name,
    data: config().url + "/storage/v1" + result.signedURL,
    downloadUrl: config().url + "/storage/v1" + result.signedURL +
      (result.signedURL.includes('?') ? '&' : '?') + 'download=' + encodeURIComponent(file.name || 'artwork'),
  };
}
