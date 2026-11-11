// Isomorphic NFC profile renderer — imported by the server (public /p/:id pages) and by the
// browser (admin wizard + customer dashboard live preview), so preview and public page are identical.
// Pure string templates. Every dynamic value passes through esc(); every href through a scheme allowlist.

export const THEMES = [
  { key: "luxury", name: "Luxury Black & Gold", blurb: "Black, metallic gold, elegant serif", color: "#0b0b0c",
    fonts: "family=Playfair+Display:ital,wght@0,600;0,700;1,500&family=Inter:wght@400;500;600" },
  { key: "minimal", name: "Minimal White", blurb: "Clean, spacious, soft shadows", color: "#ffffff",
    fonts: "family=Inter:wght@400;500;600;700" },
  { key: "corporate", name: "Corporate Blue", blurb: "Navy gradients, structured sections", color: "#0b1f4b",
    fonts: "family=Montserrat:wght@600;700;800&family=Inter:wght@400;500;600" },
  { key: "holographic", name: "Holographic Premium", blurb: "Iridescent glass, glowing edges", color: "#07061a",
    fonts: "family=Space+Grotesk:wght@400;500;600;700" },
  { key: "purple", name: "Modern Purple Gradient", blurb: "App-style cards, colourful actions", color: "#6d28d9",
    fonts: "family=Plus+Jakarta+Sans:wght@400;500;600;700;800" },
  { key: "executive", name: "Executive Black", blurb: "Editorial layout, platinum accents · CEOs, lawyers, consultants", color: "#0f0f10",
    fonts: "family=DM+Serif+Display&family=Inter:wght@400;500;600" },
  { key: "emerald", name: "Emerald Prestige", blurb: "Deep emerald & champagne gold · finance, real estate", color: "#04241c",
    fonts: "family=Cormorant+Garamond:wght@500;600;700&family=Manrope:wght@400;500;600" },
  { key: "rosegold", name: "Rose Gold Elegance", blurb: "Blush, rose gold, arch portrait · beauty, fashion, boutiques", color: "#fbf6f3",
    fonts: "family=Marcellus&family=Jost:wght@400;500;600" },
  { key: "medical", name: "Clinical Trust", blurb: "Calm teal, clear credentials · doctors, clinics, pharma", color: "#0f766e",
    fonts: "family=Manrope:wght@400;500;600;700;800" },
  { key: "carbon", name: "Carbon Tech", blurb: "Carbon weave, neon lime, code accents · tech & startups", color: "#0b0d10",
    fonts: "family=Sora:wght@400;600;700&family=JetBrains+Mono:wght@500" },
  { key: "marble", name: "Marble Luxe", blurb: "White marble, Bodoni, gold lines · architects, premium brands", color: "#f7f6f3",
    fonts: "family=Bodoni+Moda:wght@500;700&family=Inter:wght@400;500;600" },
  { key: "sunset", name: "Creative Sunset", blurb: "Vivid gradient, glass cards · creators, photographers", color: "#c2185b",
    fonts: "family=Outfit:wght@400;500;600;700" },
];
export const THEME_KEYS = THEMES.map((t) => t.key);
export const SOCIAL_PLATFORMS = ["facebook", "instagram", "linkedin", "youtube", "tiktok", "x", "telegram"];
export const SOCIAL_NAMES = { facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn", youtube: "YouTube", tiktok: "TikTok", x: "X", telegram: "Telegram" };
export const LINK_ICONS = ["link", "portfolio", "document", "video", "shop", "calendar"];
export const VISIBILITY_KEYS = ["phone", "whatsapp", "email", "website", "address", "map", "qr", "save_contact", "share", "dock"];
/** Defaults for profiles that never saved a setting. The sticky contact bar is opt-in for existing profiles. */
export const VISIBILITY_DEFAULTS = { ...Object.fromEntries(VISIBILITY_KEYS.map((k) => [k, true])), dock: false };

export const themeOf = (key) => THEMES.find((t) => t.key === key) || THEMES[1];
export const fontHref = (key) =>
  `https://fonts.googleapis.com/css2?${themeOf(key).fonts}&family=Hind+Siliguri:wght@400;500;600&display=swap`;

export const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function safeHttp(url) {
  const v = String(url || "").trim();
  if (!/^https?:\/\//i.test(v)) return "";
  try {
    const u = new URL(v);
    return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password ? u.href : "";
  } catch {
    return "";
  }
}
export const telHref = (phone) => {
  const v = String(phone || "").replace(/[^\d+]/g, "");
  return /^\+?\d{6,15}$/.test(v) ? "tel:" + v : "";
};
/** wa.me needs the international number without "+". Bangladeshi local numbers (01XXXXXXXXX) get 880. */
export const waNumber = (phone) => {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (/^01\d{9}$/.test(d)) d = "88" + d;
  return /^\d{8,15}$/.test(d) ? d : "";
};
export const waHref = (phone) => (waNumber(phone) ? "https://wa.me/" + waNumber(phone) : "");
export const mailHref = (email) =>
  /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()]+\.[^\s@<>()]+$/.test(String(email || "")) ? "mailto:" + email : "";
const hostOf = (url) => { try { return new URL(url).host.replace(/^www\./, ""); } catch { return url; } };
export const initials = (name) =>
  String(name || "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]).join("").toUpperCase() || "•";

/**
 * Normalise a stored record ({profile, social_links, services, custom_links}) into the display view.
 * Visibility settings are applied here — hidden fields never reach the HTML.
 */
export function toView(record, { mediaUrl = () => "", profileUrl = () => "" } = {}) {
  const p = record.profile || {};
  const vis = { ...VISIBILITY_DEFAULTS, ...(p.visibility_settings || {}) };
  const img = (urlKey, pathKey) => p[urlKey] ?? mediaUrl(p[pathKey]) ?? "";
  return {
    slug: p.public_slug || "",
    url: p.public_slug ? profileUrl(p.public_slug) : "",
    theme: THEME_KEYS.includes(p.theme_id) ? p.theme_id : "minimal",
    name: p.full_name || "",
    designation: p.designation || "",
    company: p.company_name || "",
    category: p.business_category || "",
    bio: p.biography || "",
    tagline: p.tagline || "",
    photo: img("profile_photo_url", "profile_photo_path"),
    cover: img("cover_image_url", "cover_image_path"),
    logo: img("company_logo_url", "company_logo_path"),
    phone: vis.phone ? p.phone || "" : "",
    whatsapp: vis.whatsapp ? p.whatsapp || "" : "",
    email: vis.email ? p.email || "" : "",
    website: vis.website ? p.website || "" : "",
    address: vis.address ? p.address || "" : "",
    map: vis.map ? p.google_maps_url || "" : "",
    socials: (record.social_links || []).filter((s) => s.is_visible !== false && s.url)
      .map((s) => ({ platform: s.platform, label: s.label || SOCIAL_NAMES[s.platform] || s.platform, url: s.url })),
    services: (record.services || []).filter((s) => s.is_visible !== false && s.title)
      .map((s) => ({ title: s.title, description: s.description || "", url: s.external_url || "", image: s.image_url ?? mediaUrl(s.image_path) ?? "" })),
    links: (record.custom_links || []).filter((l) => l.is_visible !== false && l.title && l.url)
      .map((l) => ({ title: l.title, url: l.url, icon: LINK_ICONS.includes(l.icon) ? l.icon : "link" })),
    show: { qr: vis.qr, save_contact: vis.save_contact, share: vis.share, dock: vis.dock },
  };
}

// Stroke icons (24×24). Generic glyphs drawn for this project; brand marks are simplified outlines.
const P = {
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  whatsapp: '<path d="M3.5 20.5l1.3-4.2A8.5 8.5 0 1 1 8 19.4z"/><path d="M9 8.6c.2-.5.5-.6.8-.6h.5c.2 0 .4.1.5.4l.7 1.6c.1.2 0 .5-.1.7l-.5.6c.6 1.2 1.6 2.1 2.8 2.7l.6-.6c.2-.2.4-.2.7-.1l1.6.7c.3.1.4.3.4.5v.5c0 .4-.2.7-.6.9-.7.3-1.6.3-2.6-.1a8.6 8.6 0 0 1-4.6-4.6c-.4-1-.4-1.9-.2-2.6z"/>',
  email: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>',
  website: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  map: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  save: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  facebook: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
  instagram: '<rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37zM17.5 6.5h.01"/>',
  linkedin: '<path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6zM2 9h4v12H2z"/><circle cx="4" cy="4" r="2"/>',
  youtube: '<path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"/><path d="m9.75 15.02 5.75-3.27-5.75-3.27z"/>',
  tiktok: '<path d="M15 3v11.2a3.8 3.8 0 1 1-3.8-3.8"/><path d="M15 3c.4 2.7 2.3 4.6 5 4.8"/>',
  x: '<path d="M4 4l11.7 16H20L8.3 4z"/><path d="M20 4l-6.6 7.3M4 20l6.6-7.3"/>',
  telegram: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  portfolio: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  document: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
  video: '<rect x="2" y="5" width="15" height="14" rx="2"/><path d="m23 7-6 5 6 5z"/>',
  shop: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
};
export const icon = (name, cls = "nfcp-svg") =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name] || P.link}</svg>`;

const ext = 'target="_blank" rel="noopener noreferrer nofollow"';
const lines = (text) => esc(text).replace(/\n/g, "<br>");

/**
 * @param view   output of toView()
 * @param opts   mode: "public" | "preview"; qrSrc/qrDownload: QR image URLs (optional); vcfHref; home
 */
export function renderProfile(view, opts = {}) {
  const mode = opts.mode === "preview" ? "preview" : "public";
  const t = themeOf(view.theme).key;
  const tel = telHref(view.phone), wa = waHref(view.whatsapp), mail = mailHref(view.email);
  const web = safeHttp(view.website), map = safeHttp(view.map);
  const quick = [
    tel && ["call", "Call", tel, "phone", "click_call", ""],
    wa && ["whatsapp", "WhatsApp", wa, "whatsapp", "click_whatsapp", ext],
    mail && ["email", "Email", mail, "email", "click_email", ""],
    web && ["web", "Website", web, "website", "click_website", ext],
  ].filter(Boolean);
  const contacts = [
    tel && ["Phone", view.phone, tel, "phone", "click_call", ""],
    wa && ["WhatsApp", view.whatsapp, wa, "whatsapp", "click_whatsapp", ext],
    mail && ["Email", view.email, mail, "email", "click_email", ""],
    web && ["Website", hostOf(web), web, "website", "click_website", ext],
  ].filter(Boolean);
  const socials = view.socials.map((s) => ({ ...s, href: safeHttp(s.url) })).filter((s) => s.href && SOCIAL_PLATFORMS.includes(s.platform));
  const services = view.services.map((s) => ({ ...s, href: safeHttp(s.url), img: safeHttp(s.image) }));
  const links = view.links.map((l) => ({ ...l, href: safeHttp(l.url) })).filter((l) => l.href);
  const photo = safeHttp(view.photo), cover = safeHttp(view.cover), logo = safeHttp(view.logo);
  const vcf = opts.vcfHref || (view.slug ? `/api/nfc/public/${encodeURIComponent(view.slug)}/vcf` : mode === "preview" ? "#" : "");
  const qrSrc = opts.qrSrc ?? (view.slug ? `/api/nfc/public/${encodeURIComponent(view.slug)}/qr?format=svg` : "");
  const qrDownload = opts.qrDownload ?? (view.slug ? `/api/nfc/public/${encodeURIComponent(view.slug)}/qr?format=png&download=1` : "");
  const home = opts.home || "/homepage";
  const role = [view.designation && `<span>${esc(view.designation)}</span>`, view.company && `<span class="nfcp-company">${esc(view.company)}</span>`]
    .filter(Boolean).join('<span class="nfcp-sep" aria-hidden="true">·</span>');

  return `<article class="nfcp nfcp--${t}${mode === "preview" ? " nfcp--preview" : ""}" data-slug="${esc(view.slug)}" data-url="${esc(view.url)}" data-name="${esc(view.name)}">
<header class="nfcp-hero">
<div class="nfcp-cover">${cover ? `<img class="nfcp-cover-img" src="${esc(cover)}" alt="" decoding="async">` : ""}</div>
<div class="nfcp-id">
<div class="nfcp-avatar">${photo ? `<img src="${esc(photo)}" alt="${esc(view.name)}" width="160" height="160" decoding="async">` : `<span class="nfcp-initials" aria-hidden="true">${esc(initials(view.name))}</span>`}</div>
${logo ? `<img class="nfcp-logo" src="${esc(logo)}" alt="${esc(view.company || "Company")} logo" width="56" height="56" decoding="async">` : ""}
<h1 class="nfcp-name">${esc(view.name)}</h1>
${role ? `<p class="nfcp-role">${role}</p>` : ""}
${view.category ? `<p class="nfcp-category">${esc(view.category)}</p>` : ""}
${view.tagline ? `<p class="nfcp-tagline">${esc(view.tagline)}</p>` : ""}
</div>
</header>
${quick.length ? `<nav class="nfcp-quick" aria-label="Quick contact">${quick.map(([k, label, href, ic, track, attrs]) =>
    `<a class="nfcp-quick-btn nfcp-quick-btn--${k}" href="${esc(href)}" ${attrs} data-track="${track}"><span class="nfcp-ico">${icon(ic)}</span><span>${label}</span></a>`).join("")}</nav>` : ""}
${view.show.save_contact || view.show.share ? `<div class="nfcp-cta">${view.show.save_contact && vcf ? `<a class="nfcp-btn nfcp-btn--primary" href="${esc(vcf)}" download="${esc(view.slug || "contact")}.vcf" data-track="save_contact">${icon("save")}<span>Save Contact</span></a>` : ""}${view.show.share ? `<button type="button" class="nfcp-btn nfcp-btn--ghost" data-share>${icon("share")}<span>Share</span></button>` : ""}</div>` : ""}
<div class="nfcp-body">
${view.bio ? `<section class="nfcp-card nfcp-about"><h2 class="nfcp-h">About</h2><p class="nfcp-bio">${lines(view.bio)}</p></section>` : ""}
${contacts.length ? `<section class="nfcp-card"><h2 class="nfcp-h">Contact</h2><ul class="nfcp-rows">${contacts.map(([label, value, href, ic, track, attrs]) =>
    `<li><a class="nfcp-row" href="${esc(href)}" ${attrs} data-track="${track}"><span class="nfcp-row-ico">${icon(ic)}</span><span class="nfcp-row-text"><small>${label}</small><strong>${esc(value).replace(/([@.])/g, "$1<wbr>")}</strong></span><span class="nfcp-row-go">${icon("chevron")}</span></a></li>`).join("")}</ul></section>` : ""}
${socials.length ? `<section class="nfcp-card"><h2 class="nfcp-h">Social Media</h2><div class="nfcp-socials">${socials.map((s) =>
    `<a class="nfcp-social nfcp-social--${s.platform}" href="${esc(s.href)}" ${ext} data-track="click_social" data-detail="${s.platform}"><span class="nfcp-ico">${icon(s.platform)}</span><span class="nfcp-social-label">${esc(s.label)}</span></a>`).join("")}</div></section>` : ""}
${services.length ? `<section class="nfcp-card"><h2 class="nfcp-h">Services</h2><div class="nfcp-services">${services.map((s) =>
    `<div class="nfcp-service${s.img ? "" : " nfcp-service--noimg"}">${s.img ? `<img src="${esc(s.img)}" alt="" width="72" height="72" loading="lazy" decoding="async">` : ""}<div><h3>${esc(s.title)}</h3>${s.description ? `<p>${lines(s.description)}</p>` : ""}${s.href ? `<a class="nfcp-link-inline" href="${esc(s.href)}" ${ext} data-track="click_service">Learn more ${icon("chevron")}</a>` : ""}</div></div>`).join("")}</div></section>` : ""}
${links.length ? `<section class="nfcp-card"><h2 class="nfcp-h">Portfolio &amp; Links</h2><ul class="nfcp-rows">${links.map((l) =>
    `<li><a class="nfcp-row" href="${esc(l.href)}" ${ext} data-track="click_link"><span class="nfcp-row-ico">${icon(l.icon)}</span><span class="nfcp-row-text"><strong>${esc(l.title)}</strong><small class="nfcp-row-sub">${esc(hostOf(l.href))}</small></span><span class="nfcp-row-go">${icon("chevron")}</span></a></li>`).join("")}</ul></section>` : ""}
${view.address || map ? `<section class="nfcp-card nfcp-location"><h2 class="nfcp-h">Location</h2>${view.address ? `<p class="nfcp-address">${icon("map", "nfcp-svg nfcp-inline-ico")}<span>${lines(view.address)}</span></p>` : ""}${map ? `<a class="nfcp-btn nfcp-btn--outline" href="${esc(map)}" ${ext} data-track="click_map">${icon("map")}<span>Open in Google Maps</span></a>` : ""}</section>` : ""}
${view.show.qr ? `<section class="nfcp-card nfcp-qr"><h2 class="nfcp-h">Scan to Connect</h2>${qrSrc ? `<img class="nfcp-qr-img" src="${esc(qrSrc)}" alt="QR code for this profile" width="180" height="180" loading="lazy">` : `<div class="nfcp-qr-img nfcp-qr-placeholder">${icon("qr")}<small>QR code is generated after the profile is created</small></div>`}<div class="nfcp-qr-actions">${qrDownload ? `<a class="nfcp-btn nfcp-btn--outline" href="${esc(qrDownload)}" download="${esc(view.slug || "profile")}-qr.png" data-track="qr_download">${icon("download")}<span>Download QR</span></a>` : ""}${view.url ? `<button type="button" class="nfcp-btn nfcp-btn--outline" data-copy>${icon("copy")}<span>Copy Link</span></button>` : ""}</div></section>` : ""}
</div>
<footer class="nfcp-footer"><a href="${esc(home)}">Digital card by <strong>CardCraft Studio BD</strong></a></footer>
${view.show.dock && (tel || wa || (view.show.save_contact && vcf)) ? `<nav class="nfcp-dock" aria-label="Contact shortcuts">${tel ? `<a href="${esc(tel)}" data-track="click_call">${icon("phone")}<span>Call</span></a>` : ""}${wa ? `<a href="${esc(wa)}" ${ext} data-track="click_whatsapp">${icon("whatsapp")}<span>WhatsApp</span></a>` : ""}${view.show.save_contact && vcf ? `<a class="is-primary" href="${esc(vcf)}" download="${esc(view.slug || "contact")}.vcf" data-track="save_contact">${icon("save")}<span>Save</span></a>` : ""}</nav>` : ""}
<div class="nfcp-toast" role="status" aria-live="polite" hidden></div>
</article>`;
}

/** Full standalone document used for sandboxed iframe previews (scripts disabled inside). */
export function previewDocument(view, opts = {}) {
  const t = themeOf(view.theme);
  const base = opts.base || "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${esc(fontHref(t.key))}"><link rel="stylesheet" href="${esc(base)}/css/nfc-themes.css?v=1"></head>
<body class="nfcp-page nfcp-page--${t.key} nfcp-page--embed">${renderProfile(view, { ...opts, mode: "preview" })}</body></html>`;
}
