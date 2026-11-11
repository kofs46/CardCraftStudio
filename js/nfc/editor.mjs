// Shared profile editor (admin wizard, admin edit, customer dashboard) + live preview.
// Preview renders with the same renderProfile() used for public pages, inside a shadow root.
import { esc, icon, THEMES, SOCIAL_PLATFORMS, SOCIAL_NAMES, LINK_ICONS, VISIBILITY_KEYS, VISIBILITY_DEFAULTS, toView, renderProfile, fontHref } from "./render.mjs";
import { processImage, toast } from "./common.mjs";

const SCALARS = ["full_name", "designation", "company_name", "business_category", "tagline", "biography",
  "phone", "whatsapp", "email", "website", "address", "google_maps_url", "theme_id"];
const IMAGE_KEYS = ["profile_photo", "cover_image", "company_logo"];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ------------------------------------------------------------------ draft model
export function emptyDraft() {
  return {
    ...Object.fromEntries(SCALARS.map((k) => [k, ""])),
    theme_id: "luxury",
    public_slug: "",
    visibility_settings: Object.fromEntries(VISIBILITY_KEYS.map((k) => [k, true])), // new profiles: everything on, incl. sticky bar
    images: { profile_photo: null, cover_image: null, company_logo: null },
    social_links: SOCIAL_PLATFORMS.map((platform) => ({ platform, url: "", is_visible: true })),
    services: [],
    custom_links: [],
  };
}

export function draftFromRecord(rec) {
  const p = rec.profile;
  const d = emptyDraft();
  for (const k of SCALARS) d[k] = p[k] ?? "";
  d.public_slug = p.public_slug || "";
  d.visibility_settings = { ...VISIBILITY_DEFAULTS, ...(p.visibility_settings || {}) };
  const img = (path, url) => (path ? { path, url } : null);
  d.images = {
    profile_photo: img(p.profile_photo_path, p.profile_photo_url),
    cover_image: img(p.cover_image_path, p.cover_image_url),
    company_logo: img(p.company_logo_path, p.company_logo_url),
  };
  d.social_links = SOCIAL_PLATFORMS.map((platform) => {
    const s = rec.social_links.find((x) => x.platform === platform);
    return { platform, url: s?.url || "", is_visible: s ? s.is_visible !== false : true };
  });
  d.services = rec.services.map((s) => ({ title: s.title, description: s.description || "", external_url: s.external_url || "", is_visible: s.is_visible !== false, image: img(s.image_path, s.image_url) }));
  d.custom_links = rec.custom_links.map((l) => ({ title: l.title, url: l.url, icon: l.icon || "link", is_visible: l.is_visible !== false }));
  return d;
}
export const cloneDraft = (d) => structuredClone(d);

const imgRef = (img) => (!img ? null : img.receipt ? { receipt: img.receipt } : { path: img.path });
const socialsOut = (d) => d.social_links.filter((s) => s.url.trim()).map((s) => ({ platform: s.platform, url: s.url.trim(), is_visible: s.is_visible }));
const servicesOut = (d) => d.services.map((s) => ({ title: s.title, description: s.description, external_url: s.external_url, is_visible: s.is_visible, image: imgRef(s.image) }));
const linksOut = (d) => d.custom_links.map((l) => ({ title: l.title, url: l.url, icon: l.icon, is_visible: l.is_visible }));

/** API payload. With `base`, only changed keys are sent. */
export function draftToPayload(d, base = null) {
  const out = {};
  for (const k of SCALARS) if (!base || d[k] !== base[k]) out[k] = d[k];
  if (!base || !same(d.visibility_settings, base.visibility_settings)) out.visibility_settings = d.visibility_settings;
  for (const k of IMAGE_KEYS) if (base ? !same(d.images[k], base.images[k]) : d.images[k]) out[k] = imgRef(d.images[k]);
  if (!base || !same(socialsOut(d), socialsOut(base))) out.social_links = socialsOut(d);
  if (!base || !same(servicesOut(d), servicesOut(base))) out.services = servicesOut(d);
  if (!base || !same(linksOut(d), linksOut(base))) out.custom_links = linksOut(d);
  return out;
}
export const isDirty = (d, base) => Object.keys(draftToPayload(d, base)).length > 0;

// Mirror the server's link normalisation so the preview shows what will be saved.
const HANDLE = { facebook: "https://facebook.com/", instagram: "https://instagram.com/", linkedin: "https://linkedin.com/in/", youtube: "https://youtube.com/@", tiktok: "https://www.tiktok.com/@", x: "https://x.com/", telegram: "https://t.me/" };
const asUrl = (v) => { v = String(v || "").trim(); return !v ? "" : /^https?:\/\//i.test(v) ? v : /^[a-z][a-z0-9+.-]*:/i.test(v) && !/^[^:/]+\.[^:/]+:\d/.test(v) ? "" : "https://" + v; };
const socialUrl = (platform, v) => { const raw = String(v || "").trim(); const h = /^@?([A-Za-z0-9_][A-Za-z0-9_.]{0,59})$/.exec(raw); return h && (raw.startsWith("@") || !raw.includes(".")) ? HANDLE[platform] + h[1] : asUrl(raw); };

export function draftToView(d, { slug = d.public_slug } = {}) {
  return toView({
    profile: {
      ...d, public_slug: slug, website: asUrl(d.website), google_maps_url: asUrl(d.google_maps_url),
      profile_photo_url: d.images.profile_photo?.url || "", cover_image_url: d.images.cover_image?.url || "", company_logo_url: d.images.company_logo?.url || "",
    },
    social_links: d.social_links.map((s) => ({ ...s, url: socialUrl(s.platform, s.url) })),
    services: d.services.map((s) => ({ ...s, external_url: asUrl(s.external_url), image_url: s.image?.url || "" })),
    custom_links: d.custom_links.map((l) => ({ ...l, url: asUrl(l.url) })),
  }, { profileUrl: (s) => `${location.origin}/p/${s}` });
}

export function completion(d) {
  const checks = [d.full_name, d.designation, d.company_name, d.tagline, d.biography, d.phone, d.whatsapp, d.email,
    d.website, d.address, d.images.profile_photo, d.images.cover_image, d.social_links.some((s) => s.url), d.services.length || d.custom_links.length];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

// ------------------------------------------------------------------ live preview (shadow DOM)
let fontsLoaded = false;
export function loadThemeFonts() {
  if (fontsLoaded) return;
  fontsLoaded = true;
  for (const t of THEMES) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = fontHref(t.key);
    document.head.appendChild(link);
  }
}
let previewSheet;
export function mountPreview(host) {
  loadThemeFonts();
  const root = host.shadowRoot || host.attachShadow({ mode: "open" });
  root.innerHTML = '<link rel="stylesheet" href="/css/nfc-themes.css?v=1"><div class="screen"></div>';
  if (!previewSheet && "adoptedStyleSheets" in Document.prototype) {
    previewSheet = new CSSStyleSheet();
    previewSheet.replaceSync(":host{display:block;height:100%} .screen{height:100%;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin} .nfcp{min-height:100%;max-width:none}");
  }
  if (previewSheet) root.adoptedStyleSheets = [previewSheet];
  const screen = root.querySelector(".screen");
  return { render: (view, opts = {}) => { screen.innerHTML = renderProfile(view, { ...opts, mode: "preview" }); } };
}

// ------------------------------------------------------------------ form sections
const counter = (key, max) => `<small class="nfc-count" data-count="${key}" data-max="${max}"></small>`;
function field(label, key, value, o = {}) {
  const attrs = `data-f="${key}" id="f-${key}" ${o.max ? `maxlength="${o.max}"` : ""} ${o.required ? "required" : ""} ${o.placeholder ? `placeholder="${esc(o.placeholder)}"` : ""} ${o.inputmode ? `inputmode="${o.inputmode}"` : ""} ${o.autocomplete ? `autocomplete="${o.autocomplete}"` : 'autocomplete="off"'} ${o.list ? `list="${o.list}"` : ""}`;
  return `<div class="nfc-field${o.wide ? " nfc-field--wide" : ""}"><label for="f-${key}">${esc(label)}${o.required ? ' <b class="nfc-req" aria-hidden="true">*</b>' : ""}</label>
    ${o.multiline ? `<textarea ${attrs} rows="${o.rows || 3}">${esc(value)}</textarea>` : `<input type="${o.type || "text"}" ${attrs} value="${esc(value)}">`}
    ${o.hint ? `<small class="nfc-hint">${esc(o.hint)}</small>` : ""}${o.max && o.multiline ? counter(key, o.max) : ""}${o.extra || ""}</div>`;
}
const toggle = (label, attr, checked) =>
  `<label class="nfc-switch"><input type="checkbox" ${attr} ${checked ? "checked" : ""}><span class="nfc-switch__track" aria-hidden="true"></span><span>${esc(label)}</span></label>`;
const CATEGORIES = ["Business Services", "Real Estate", "Retail & E-commerce", "Restaurant & Food", "Health & Fitness", "Medical & Healthcare", "Education", "Technology", "Design & Creative", "Fashion & Beauty", "Logistics", "Travel & Tourism", "Finance & Insurance", "Legal", "Construction", "Photography", "Freelancer"];

const SECTIONS = {
  identity: (d) => `<div class="nfc-grid">
    ${field("Full name", "full_name", d.full_name, { required: true, max: 120, autocomplete: "name" })}
    ${field("Designation", "designation", d.designation, { max: 120, placeholder: "e.g. Managing Director" })}
    ${field("Company name", "company_name", d.company_name, { max: 150, autocomplete: "organization" })}
    ${field("Business category", "business_category", d.business_category, { max: 100, list: "nfc-categories" })}
    ${field("Business tagline", "tagline", d.tagline, { max: 160, wide: true, placeholder: "One short line that describes you" })}
    ${field("Professional biography", "biography", d.biography, { max: 2000, multiline: true, rows: 5, wide: true })}
    <datalist id="nfc-categories">${CATEGORIES.map((c) => `<option value="${esc(c)}">`).join("")}</datalist></div>`,

  contact: (d) => {
    const vis = (k) => toggle("Show on profile", `data-vis="${k}"`, d.visibility_settings[k] !== false);
    return `<div class="nfc-grid">
    ${field("Phone number", "phone", d.phone, { type: "tel", inputmode: "tel", max: 30, placeholder: "01XXXXXXXXX", autocomplete: "tel", extra: vis("phone") })}
    ${field("WhatsApp number", "whatsapp", d.whatsapp, { type: "tel", inputmode: "tel", max: 30, placeholder: "01XXXXXXXXX", extra: `<div class="nfc-field__row">${vis("whatsapp")}<button type="button" class="nfc-link-btn" data-copy-phone>Same as phone</button></div>` })}
    ${field("Email address", "email", d.email, { type: "email", inputmode: "email", max: 254, autocomplete: "email", extra: vis("email") })}
    ${field("Website", "website", d.website, { type: "url", inputmode: "url", max: 500, placeholder: "https://", extra: vis("website") })}
    ${field("Business address", "address", d.address, { multiline: true, rows: 2, max: 300, wide: true, extra: vis("address") })}
    ${field("Google Maps link", "google_maps_url", d.google_maps_url, { type: "url", inputmode: "url", max: 500, wide: true, placeholder: "https://maps.app.goo.gl/…", hint: "In Google Maps: Share → Copy link.", extra: vis("map") })}
    </div><fieldset class="nfc-fieldset"><legend>Profile features</legend><div class="nfc-switches">
    ${toggle("QR code section", 'data-vis="qr"', d.visibility_settings.qr !== false)}
    ${toggle("Save Contact button", 'data-vis="save_contact"', d.visibility_settings.save_contact !== false)}
    ${toggle("Share button", 'data-vis="share"', d.visibility_settings.share !== false)}
    ${toggle("Sticky contact bar (Call · WhatsApp · Save stay visible while scrolling)", 'data-vis="dock"', d.visibility_settings.dock === true)}</div></fieldset>`;
  },

  images: (d) => `<div class="nfc-images">${["profile_photo", "cover_image", "company_logo"].map((k) => {
    const label = { profile_photo: "Profile photo", cover_image: "Cover image", company_logo: "Company logo" }[k];
    const hint = { profile_photo: "Square crop, 640×640", cover_image: "Wide crop, 1200×500", company_logo: "Transparent PNG works best" }[k];
    const img = d.images[k];
    return `<div class="nfc-image-tile nfc-image-tile--${k}"><div class="nfc-image-tile__preview">${img?.url ? `<img src="${esc(img.url)}" alt="${label} preview">` : `<span>${icon(k === "company_logo" ? "shop" : k === "cover_image" ? "portfolio" : "save")}</span>`}</div>
      <div><strong>${label}</strong><small>${hint}</small><div class="nfc-image-tile__actions">
      <label class="nfc-btn nfc-btn--sm nfc-btn--ghost"><input type="file" accept="image/png,image/jpeg,image/webp" data-img="${k}" hidden>${img ? "Replace" : "Upload"}</label>
      ${img ? `<button type="button" class="nfc-btn nfc-btn--sm nfc-btn--text" data-img-remove="${k}">Remove</button>` : ""}</div></div></div>`;
  }).join("")}</div><p class="nfc-hint">Images are resized and compressed on this device before upload (max 2 MB). They become public only after you save.</p>`,

  socials: (d) => `<div class="nfc-socials-edit">${d.social_links.map((s, i) => `<div class="nfc-social-row">
    <span class="nfc-social-row__ico nfc-brand--${s.platform}">${icon(s.platform)}</span>
    <label class="nfc-sr" for="s-${s.platform}">${SOCIAL_NAMES[s.platform]} link</label>
    <input id="s-${s.platform}" data-list="social_links" data-i="${i}" data-k="url" value="${esc(s.url)}" placeholder="${SOCIAL_NAMES[s.platform]} link or @username" maxlength="500" autocomplete="off">
    ${toggle("Visible", `data-list="social_links" data-i="${i}" data-k="is_visible"`, s.is_visible)}</div>`).join("")}</div>`,

  links: (d) => `<div class="nfc-list">${d.custom_links.map((l, i) => `<div class="nfc-list-item">
    <div class="nfc-grid">
      <div class="nfc-field"><label>Title</label><input data-list="custom_links" data-i="${i}" data-k="title" value="${esc(l.title)}" maxlength="80" placeholder="e.g. Portfolio"></div>
      <div class="nfc-field"><label>Link</label><input data-list="custom_links" data-i="${i}" data-k="url" value="${esc(l.url)}" maxlength="500" placeholder="https://" inputmode="url"></div>
      <div class="nfc-field"><label>Icon</label><select data-list="custom_links" data-i="${i}" data-k="icon">${LINK_ICONS.map((ic) => `<option value="${ic}" ${ic === l.icon ? "selected" : ""}>${ic[0].toUpperCase() + ic.slice(1)}</option>`).join("")}</select></div>
    </div>${itemTools("custom_links", i, d.custom_links.length, l.is_visible)}</div>`).join("") || '<p class="nfc-empty">No portfolio or custom links yet.</p>'}
    ${d.custom_links.length < 12 ? '<button type="button" class="nfc-btn nfc-btn--ghost nfc-btn--sm" data-add="custom_links">+ Add link</button>' : ""}</div>`,

  services: (d) => `<div class="nfc-list">${d.services.map((s, i) => `<div class="nfc-list-item">
    <div class="nfc-service-edit"><div class="nfc-service-edit__img">${s.image?.url ? `<img src="${esc(s.image.url)}" alt="">` : icon("portfolio")}
      <label class="nfc-link-btn"><input type="file" accept="image/png,image/jpeg,image/webp" data-svc-img="${i}" hidden>${s.image ? "Change" : "Add image"}</label>
      ${s.image ? `<button type="button" class="nfc-link-btn" data-svc-img-remove="${i}">Remove</button>` : ""}</div>
    <div class="nfc-grid">
      <div class="nfc-field"><label>Service title</label><input data-list="services" data-i="${i}" data-k="title" value="${esc(s.title)}" maxlength="100"></div>
      <div class="nfc-field"><label>Link (optional)</label><input data-list="services" data-i="${i}" data-k="external_url" value="${esc(s.external_url)}" maxlength="500" placeholder="https://" inputmode="url"></div>
      <div class="nfc-field nfc-field--wide"><label>Description</label><textarea data-list="services" data-i="${i}" data-k="description" maxlength="500" rows="2">${esc(s.description)}</textarea></div>
    </div></div>${itemTools("services", i, d.services.length, s.is_visible)}</div>`).join("") || '<p class="nfc-empty">No services yet.</p>'}
    ${d.services.length < 12 ? '<button type="button" class="nfc-btn nfc-btn--ghost nfc-btn--sm" data-add="services">+ Add service</button>' : ""}</div>`,

  theme: (d) => `<div class="nfc-themes" role="radiogroup" aria-label="Profile design">${THEMES.map((t) => `<label class="nfc-theme-card${d.theme_id === t.key ? " is-selected" : ""}">
    <input type="radio" name="theme_id" value="${t.key}" ${d.theme_id === t.key ? "checked" : ""} class="nfc-sr">
    <div class="nfc-theme-card__mini" data-mini="${t.key}"></div>
    <span class="nfc-theme-card__name">${esc(t.name)}</span><small>${esc(t.blurb)}</small></label>`).join("")}</div>`,
};

function itemTools(list, i, n, visible) {
  return `<div class="nfc-item-tools">${toggle("Visible", `data-list="${list}" data-i="${i}" data-k="is_visible"`, visible)}
    <span class="nfc-item-tools__btns"><button type="button" class="nfc-icon-btn" data-move="${list}" data-i="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
    <button type="button" class="nfc-icon-btn" data-move="${list}" data-i="${i}" data-dir="1" ${i === n - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
    <button type="button" class="nfc-icon-btn nfc-icon-btn--danger" data-remove="${list}" data-i="${i}" aria-label="Remove">✕</button></span></div>`;
}

export const sectionHtml = (name, draft) => `<div data-section="${name}">${SECTIONS[name](draft)}</div>`;

function renderMinis(root, draft) {
  root.querySelectorAll("[data-mini]").forEach((host) => {
    const view = draftToView({ ...draft, theme_id: host.dataset.mini });
    mountPreview(host).render(view, { qrSrc: "", qrDownload: "" });
  });
}
function updateCounters(root) {
  root.querySelectorAll("[data-count]").forEach((el) => {
    const input = root.querySelector(`[data-f="${el.dataset.count}"]`);
    if (input) el.textContent = `${[...input.value].length} / ${el.dataset.max}`;
  });
}

/**
 * Wire an editor area. `ctx` = { draft, onChange(), upload(kind, dataUrl) → {receipt,url}, disabled }
 * Sections are re-rendered only on structural changes so typing never loses focus.
 */
export function bindEditor(root, ctx) {
  const rerender = (name) => {
    const el = root.querySelector(`[data-section="${name}"]`);
    if (!el) return;
    el.innerHTML = SECTIONS[name](ctx.draft);
    if (name === "theme") renderMinis(root, ctx.draft);
    updateCounters(root);
  };
  const changed = () => { updateCounters(root); ctx.onChange?.(); };
  root.querySelectorAll("[data-section]").forEach((el) => el.dataset.section === "theme" && renderMinis(root, ctx.draft));
  updateCounters(root);
  if (ctx.disabled) root.querySelectorAll("input,textarea,select,button").forEach((el) => (el.disabled = true));

  root.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.f) { ctx.draft[t.dataset.f] = t.value; return changed(); }
    if (t.dataset.list && t.type !== "checkbox") { ctx.draft[t.dataset.list][t.dataset.i][t.dataset.k] = t.value; return changed(); }
  });
  root.addEventListener("change", async (e) => {
    const t = e.target;
    if (t.dataset.vis) { ctx.draft.visibility_settings[t.dataset.vis] = t.checked; return changed(); }
    if (t.dataset.list && t.type === "checkbox") { ctx.draft[t.dataset.list][t.dataset.i][t.dataset.k] = t.checked; return changed(); }
    if (t.dataset.list && t.tagName === "SELECT") { ctx.draft[t.dataset.list][t.dataset.i][t.dataset.k] = t.value; return changed(); }
    if (t.name === "theme_id") {
      ctx.draft.theme_id = t.value;
      root.querySelectorAll(".nfc-theme-card").forEach((c) => c.classList.toggle("is-selected", c.querySelector("input").checked));
      return changed();
    }
    const kind = t.dataset.img ? t.dataset.img : t.dataset.svcImg !== undefined ? "service" : null;
    if (!kind || !t.files?.[0]) return;
    const file = t.files[0];
    t.value = "";
    const tile = t.closest(".nfc-image-tile, .nfc-service-edit");
    tile?.classList.add("is-busy");
    try {
      const dataUrl = await processImage(file, kind);
      if (!dataUrl) return;
      const result = await ctx.upload(kind, dataUrl);
      const image = { receipt: result.receipt, url: result.url };
      if (kind === "service") { ctx.draft.services[t.dataset.svcImg].image = image; rerender("services"); }
      else { ctx.draft.images[kind] = image; rerender("images"); }
      toast("Image ready — save to publish it");
      changed();
    } catch (error) {
      toast(error.message, "error");
    } finally {
      tile?.classList.remove("is-busy");
    }
  });
  root.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.imgRemove) { ctx.draft.images[b.dataset.imgRemove] = null; rerender("images"); return changed(); }
    if (b.dataset.svcImgRemove !== undefined) { ctx.draft.services[b.dataset.svcImgRemove].image = null; rerender("services"); return changed(); }
    if (b.hasAttribute("data-copy-phone")) { ctx.draft.whatsapp = ctx.draft.phone; rerender("contact"); return changed(); }
    if (b.dataset.add) {
      const list = b.dataset.add;
      ctx.draft[list].push(list === "services" ? { title: "", description: "", external_url: "", is_visible: true, image: null } : { title: "", url: "", icon: "link", is_visible: true });
      rerender(list);
      root.querySelector(`[data-section="${list}"] .nfc-list-item:last-of-type input`)?.focus();
      return changed();
    }
    if (b.dataset.move) {
      const arr = ctx.draft[b.dataset.move], i = Number(b.dataset.i), j = i + Number(b.dataset.dir);
      if (j < 0 || j >= arr.length) return;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      rerender(b.dataset.move);
      return changed();
    }
    if (b.dataset.remove) { ctx.draft[b.dataset.remove].splice(Number(b.dataset.i), 1); rerender(b.dataset.remove); return changed(); }
  });
  return { rerender };
}

/** Light client-side checks before submit; the server re-validates everything. */
export function validateDraft(d) {
  const problems = [];
  if (!d.full_name.trim()) problems.push("Full name is required.");
  if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) problems.push("Email address looks invalid.");
  for (const [k, label] of [["phone", "Phone"], ["whatsapp", "WhatsApp"]])
    if (d[k] && d[k].replace(/\D/g, "").length < 6) problems.push(`${label} number looks too short.`);
  if (d.services.some((s) => !s.title.trim())) problems.push("Every service needs a title.");
  if (d.custom_links.some((l) => !l.title.trim() || !l.url.trim())) problems.push("Every link needs a title and a web address.");
  return problems;
}
