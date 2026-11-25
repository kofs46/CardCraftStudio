export const SOCIAL_NAMES = {
  facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn", youtube: "YouTube", tiktok: "TikTok", x: "X", telegram: "Telegram",
  viber: "Viber", wechat: "WeChat", bdjobs: "Bdjobs", whatsapp_business: "WhatsApp Business",
};
export const SOCIAL_PLATFORMS = Object.keys(SOCIAL_NAMES);

export const SOCIAL_INPUTS = {
  viber: {
    label: "Viber number or business chat link",
    placeholder: "e.g. +8801XXXXXXXXX or viber.me/…",
    error: "Viber needs a phone number with country code or a viber.me business chat link.",
  },
  wechat: {
    label: "WeChat ID",
    placeholder: "e.g. rahim_bd",
    error: "Enter a WeChat ID using letters, numbers, hyphens or underscores.",
  },
  bdjobs: {
    label: "Bdjobs or public CV link",
    placeholder: "https://…",
    hint: "Use a link visitors can open without signing in. You can share a public CV link if your Bdjobs profile is private.",
    error: "Bdjobs needs a valid HTTPS link to a profile or CV.",
  },
  whatsapp_business: {
    label: "WhatsApp Business number or short link",
    placeholder: "e.g. 01XXXXXXXXX or wa.me/message/…",
    error: "WhatsApp Business needs a phone number with country code or a WhatsApp chat link.",
  },
};

const HANDLE_BASE = {
  facebook: "https://facebook.com/", instagram: "https://instagram.com/", linkedin: "https://linkedin.com/in/",
  youtube: "https://youtube.com/@", tiktok: "https://www.tiktok.com/@", x: "https://x.com/", telegram: "https://t.me/",
};

export function socialHandleUrl(platform, value) {
  const base = HANDLE_BASE[platform];
  const handle = /^@?([A-Za-z0-9_][A-Za-z0-9_.]{0,59})$/.exec(value);
  return base && handle && (value.startsWith("@") || !value.includes(".")) ? base + handle[1] : "";
}

/** wa.me uses an international number without a leading plus. */
export function waNumber(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (/^01\d{9}$/.test(digits)) digits = "88" + digits;
  return /^\d{8,15}$/.test(digits) ? digits : "";
}

function internationalNumber(value) {
  const phone = value.replace(/[০-৯]/g, (digit) => String("০১২৩৪৫৬৭৮৯".indexOf(digit)));
  if (!/^\+?[\d\s().-]+$/.test(phone)) return "";
  const digits = waNumber(phone);
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : "";
}

function httpsAddress(value) {
  if (/[\u0000-\u001f\u007f\\]/.test(value) || /^(?!https:\/\/)(?:[a-z][a-z0-9+.-]*:|\/)/i.test(value)) return null;
  try {
    const url = new URL(/^https:\/\//i.test(value) ? value : `https://${value}`);
    return url.hostname.includes(".") && !url.username && !url.password && !url.port && url.href.length <= 500 ? url : null;
  } catch {
    return null;
  }
}

/** Parse the contact input the same way in the editor preview and the API. */
export function parseSocialInput(platform, value) {
  const raw = value.trim();
  if (!raw) return { url: "", identifier: "" };
  if (platform === "wechat") {
    return /^[a-z0-9][a-z0-9_-]{0,31}$/i.test(raw) ? { url: "", identifier: raw } : null;
  }

  if (platform === "viber" || platform === "whatsapp_business") {
    const number = internationalNumber(raw);
    if (number) return platform === "viber"
      ? { url: "", identifier: `+${number}` }
      : { url: `https://wa.me/${number}`, identifier: "" };
  }

  const url = httpsAddress(raw);
  if (!url) return null;
  if (platform === "viber" && (url.hostname !== "viber.me" || !/^\/[1-9]\d{7,14}\/?$/.test(url.pathname))) return null;
  if (platform === "whatsapp_business") {
    const shortLink = url.hostname === "wa.me" && /^\/(?:[1-9]\d{7,14}|message\/[a-z0-9_-]+)\/?$/i.test(url.pathname);
    const apiLink = url.hostname === "api.whatsapp.com" && /^\/send\/?$/.test(url.pathname)
      && /^[1-9]\d{7,14}$/.test(url.searchParams.get("phone") || "");
    if (!shortLink && !apiLink) return null;
  }
  return { url: url.href, identifier: "" };
}
