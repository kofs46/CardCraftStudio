// Server-side validation for every NFC input. The browser validates for convenience only.
import { randomInt } from "node:crypto";
import { ApiError } from "../supabase.mjs";
import { THEME_KEYS, SOCIAL_PLATFORMS, LINK_ICONS, VISIBILITY_KEYS } from "../../js/nfc/render.mjs";
import { parseSocialInput, socialHandleUrl, SOCIAL_INPUTS } from "../../js/nfc/social-links.mjs";

export { THEME_KEYS, SOCIAL_PLATFORMS, LINK_ICONS, VISIBILITY_KEYS };
export const CARD_STATUSES = ["profile_created", "ready_for_programming", "programmed", "tested", "dispatched", "delivered"];
export const EVENT_TYPES = ["view", "click_call", "click_whatsapp", "click_email", "click_website", "click_map",
  "click_social", "click_link", "click_service", "save_contact", "share", "qr_download"];
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TEXT_FIELDS = {
  full_name: { max: 120, label: "Full name" },
  designation: { max: 120, label: "Designation" },
  company_name: { max: 150, label: "Company name" },
  business_category: { max: 100, label: "Business category" },
  tagline: { max: 160, label: "Tagline" },
  biography: { max: 2000, label: "Biography", multiline: true },
  address: { max: 300, label: "Address", multiline: true },
};
export const CUSTOMER_FIELDS = [...Object.keys(TEXT_FIELDS), "phone", "whatsapp", "email", "website", "google_maps_url", "theme_id", "visibility_settings"];
export const ADMIN_FIELDS = [...CUSTOMER_FIELDS, "editing_enabled", "public_slug"];
export const IMAGE_FIELDS = { profile_photo: "profile_photo_path", cover_image: "cover_image_path", company_logo: "company_logo_path" };

const BIDI = /[‪-‮⁦-⁩‎‏]/g;

export function cleanText(value, { max, label, multiline = false, required = false }) {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string") throw new ApiError(`${label} must be text.`);
  let v = value.normalize("NFC").replace(/\r\n?/g, "\n").replace(BIDI, "");
  v = multiline
    ? v.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "").replace(/\n{3,}/g, "\n\n")
    : v.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s{2,}/g, " ");
  v = v.trim();
  if (required && !v) throw new ApiError(`${label} is required.`);
  if ([...v].length > max) throw new ApiError(`${label} must be at most ${max} characters.`);
  return v;
}

export function cleanUrl(value, label, { max = 500 } = {}) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") throw new ApiError(`${label}: enter a valid web address.`);
  let v = value.trim().replace(BIDI, "");
  if (!v) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(v) && !/^[^:/]+\.[^:/]+:\d+/.test(v)) throw new ApiError(`${label}: only http and https links are allowed.`);
    v = "https://" + v;
  }
  let url;
  try {
    url = new URL(v);
  } catch {
    throw new ApiError(`${label}: enter a valid web address.`);
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname.includes(".") || url.href.length > max)
    throw new ApiError(`${label}: enter a valid web address, for example https://example.com`);
  return url.href;
}

export function cleanPhone(value, label) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") throw new ApiError(`${label}: enter a valid phone number.`);
  const v = value.trim().replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d))).replace(/\s+/g, " ");
  if (!v) return "";
  const digits = v.replace(/\D/g, "");
  if (!/^\+?[\d\s().-]+$/.test(v) || digits.length < 6 || digits.length > 15 || v.length > 30)
    throw new ApiError(`${label}: enter a valid phone number, for example 01XXXXXXXXX or +8801XXXXXXXXX.`);
  return v;
}

export function cleanEmail(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") throw new ApiError("Enter a valid email address.");
  const v = value.trim().toLowerCase();
  if (!v) return "";
  if (v.length > 254 || !/^[^\s@<>()[\]\\,;:"]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(v))
    throw new ApiError("Enter a valid email address.");
  return v;
}

export function normalizeUserId(value) {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{2,31}$/.test(v) ? v : null;
}

export function requireUserId(value) {
  const v = normalizeUserId(value);
  if (!v) throw new ApiError("User ID must be 3–32 characters: letters, numbers, dot, dash or underscore, starting with a letter or number.");
  return v;
}

export function cleanSlug(value) {
  if (typeof value !== "string") throw new ApiError("Invalid profile URL.");
  const v = value.trim().toLowerCase();
  if (!/^[a-z0-9]+(-[a-z0-9]+)+$/.test(v) || v.length > 64 || v.length < 4)
    throw new ApiError("Profile URL must be lowercase letters/numbers with at least one dash, e.g. rahim-a7k2.");
  return v;
}

const SLUG_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";
const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
const randomString = (chars, n) => Array.from({ length: n }, () => chars[randomInt(chars.length)]).join("");

export function slugBase(name) {
  const base = String(name || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/g, "");
  return base || "card";
}
export const generateSlug = (name) => `${slugBase(name)}-${randomString(SLUG_CHARS, 4)}`;
export const generateImmutableId = () => randomString(ID_CHARS, 12);

export function cleanVisibility(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new ApiError("Invalid visibility settings.");
  const out = {};
  for (const key of VISIBILITY_KEYS) if (key in value) out[key] = value[key] !== false;
  return out;
}

/** Validate scalar profile fields. `allowed` restricts which keys a caller may set. */
export function cleanFields(body, allowed, { requireName = false } = {}) {
  const out = {};
  for (const key of allowed) {
    if (!(key in body)) continue;
    const value = body[key];
    if (TEXT_FIELDS[key]) out[key] = cleanText(value, { ...TEXT_FIELDS[key], required: key === "full_name" });
    else if (key === "phone" || key === "whatsapp") out[key] = cleanPhone(value, key === "phone" ? "Phone" : "WhatsApp");
    else if (key === "email") out[key] = cleanEmail(value);
    else if (key === "website") out[key] = cleanUrl(value, "Website");
    else if (key === "google_maps_url") out[key] = cleanUrl(value, "Google Maps link");
    else if (key === "theme_id") {
      if (!THEME_KEYS.includes(value)) throw new ApiError("Choose one of the five profile designs.");
      out[key] = value;
    } else if (key === "visibility_settings") out[key] = cleanVisibility(value);
    else if (key === "editing_enabled") {
      if (typeof value !== "boolean") throw new ApiError("Invalid editing setting.");
      out[key] = value;
    } else if (key === "public_slug") out[key] = cleanSlug(value);
  }
  if (requireName && !out.full_name) throw new ApiError("Full name is required.");
  return out;
}

const list = (value, label, max) => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ApiError(`Invalid ${label}.`);
  if (value.length > max) throw new ApiError(`At most ${max} ${label} are allowed.`);
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new ApiError(`Invalid ${label}.`);
    return item;
  });
};

export function cleanSocialLinks(value) {
  const seen = new Set();
  return list(value, "social links", 14).flatMap((item) => {
    if (!SOCIAL_PLATFORMS.includes(item.platform)) throw new ApiError("Unknown social platform.");
    let raw = typeof item.url === "string" ? item.url.trim() : "";
    const input = SOCIAL_INPUTS[item.platform];
    const qr = item.qr_image;
    if (qr && item.platform !== "wechat") throw new ApiError("Only WeChat supports a contact QR image.");
    if (input) {
      if (item.url != null && typeof item.url !== "string") throw new ApiError(input.error);
      if (!raw && typeof item.identifier === "string") raw = item.identifier.trim();
    }
    const target = input ? parseSocialInput(item.platform, raw)
      : { url: socialHandleUrl(item.platform, raw) || cleanUrl(raw, item.platform[0].toUpperCase() + item.platform.slice(1)) };
    if (!target) throw new ApiError(input.error);
    if (!target.url && !target.identifier && !qr) return [];
    const key = JSON.stringify([item.platform, target.url, target.identifier]);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ platform: item.platform, label: cleanText(item.label, { max: 60, label: "Social label" }),
      ...target, ...(qr ? { qr_image: qr } : {}), is_visible: item.is_visible !== false }];
  });
}

export function cleanCustomLinks(value) {
  return list(value, "links", 12).map((item) => ({
    title: cleanText(item.title, { max: 80, label: "Link title", required: true }),
    url: cleanUrl(item.url, "Link") || (() => { throw new ApiError("Each link needs a web address."); })(),
    icon: LINK_ICONS.includes(item.icon) ? item.icon : "link",
    is_visible: item.is_visible !== false,
  }));
}

/** Services keep the raw image reference; the router resolves it against upload receipts / current paths. */
export function cleanServices(value) {
  return list(value, "services", 12).map((item) => ({
    title: cleanText(item.title, { max: 100, label: "Service title", required: true }),
    description: cleanText(item.description, { max: 500, label: "Service description", multiline: true }),
    external_url: cleanUrl(item.external_url, "Service link"),
    is_visible: item.is_visible !== false,
    image: item.image ?? null,
  }));
}
