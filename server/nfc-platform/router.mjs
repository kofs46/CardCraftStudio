// NFC platform API + public profile pages. Mounted by api/nfc.mjs (Vercel) and server/local.mjs.
//   /p/:id                    public profile page (SSR)
//   /api/nfc/...              public, customer auth and customer self-service
//   /api/admin/nfc/...        admin only (existing admin login)
import { randomUUID } from "node:crypto";
import { ApiError } from "../supabase.mjs";
import { admin as requireAdmin, clientIp, limit } from "../guards.mjs";
import { call, mediaUrl, nfcConfig, profileUrl } from "./config.mjs";
import * as v from "./validate.mjs";
import { burnPasswordCheck, generatePassword, hashPassword, passwordProblem, verifyPassword } from "./passwords.mjs";
import { clearSessionCookie, createSession, currentSession, requireCustomer } from "./sessions.mjs";
import { processCleanup, resolveImage, uploadImage } from "./uploads.mjs";
import { qrPng, qrSvg } from "./qr.mjs";
import { buildVcard } from "./vcard.mjs";
import { PAGE_CSP, profilePage, statusPage } from "./page.mjs";
import { THEMES, toView } from "../../js/nfc/render.mjs";

const MAX_BODY = 3_000_000;
const PUBLIC_ID = /^[A-Za-z0-9-]{3,64}$/;

async function readJson(req) {
  if (req.body !== undefined) {
    const raw = typeof req.body === "string" ? req.body : Buffer.isBuffer(req.body) ? req.body.toString() : JSON.stringify(req.body);
    if (Buffer.byteLength(raw) > MAX_BODY) throw new ApiError("Request too large.", 413);
    try { return JSON.parse(raw || "{}"); } catch { throw new ApiError("Invalid JSON."); }
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new ApiError("Request too large.", 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch { throw new ApiError("Invalid JSON."); }
}

/** Works for the original URL (local server, Vercel req.url) and for rewritten ?scope=&path=&page= URLs. */
export function resolveRoute(req) {
  const url = new URL(req.url, "http://localhost");
  const q = (k) => {
    const value = req.query?.[k] ?? url.searchParams.get(k);
    return Array.isArray(value) ? value.join("/") : value;
  };
  let m;
  if ((m = /^\/p\/([^/]+)\/?$/.exec(url.pathname))) return { kind: "page", id: decodeURIComponent(m[1]), url };
  if ((m = /^\/api\/admin\/nfc\/(.+?)\/?$/.exec(url.pathname))) return { kind: "admin", path: m[1], url };
  if ((m = /^\/api\/nfc\/(.+?)\/?$/.exec(url.pathname))) return { kind: "nfc", path: m[1], url };
  if (q("page")) return { kind: "page", id: q("page"), url };
  if (q("path")) return { kind: q("scope") === "admin" ? "admin" : "nfc", path: q("path"), url };
  return { kind: "none", url };
}

const sendJson = (res, body, status = 200) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
};

// ------------------------------------------------------------------ shared helpers
function decorate(data) {
  const p = data.profile;
  return {
    ...data,
    profile: {
      ...p,
      profile_photo_url: mediaUrl(p.profile_photo_path),
      cover_image_url: mediaUrl(p.cover_image_path),
      company_logo_url: mediaUrl(p.company_logo_path),
    },
    social_links: data.social_links.map((s) => s.qr_image_path ? { ...s, qr_image_url: mediaUrl(s.qr_image_path) } : s),
    services: data.services.map((s) => ({ ...s, image_url: mediaUrl(s.image_path) })),
    profile_url: profileUrl(p.public_slug),
    login_url: nfcConfig().origin + "/nfc/login",
  };
}

/** The owner's own view: no internal ids, no admin history/audit. */
function forCustomer(data) {
  const d = decorate(data);
  const { id, immutable_public_id, ...profile } = d.profile;
  return {
    profile,
    social_links: d.social_links.map(({ id, ...s }) => s),
    services: d.services.map(({ id, ...s }) => s),
    custom_links: d.custom_links.map(({ id, ...l }) => l),
    customer: { user_id: d.customer.user_id, status: d.customer.status, last_login_at: d.customer.last_login_at, password_changed_at: d.customer.password_changed_at },
    card_status: d.card?.card_status || null,
    views_total: d.views_total,
    profile_url: d.profile_url,
    themes: THEMES.map(({ key, name, blurb }) => ({ key, name, blurb })),
  };
}

async function loadRecord(customerId) {
  if (!v.UUID.test(customerId)) throw new ApiError("Customer not found.", 404);
  const data = await call("nfc_get_profile", { customer_id: customerId });
  if (!data) throw new ApiError("Customer not found.", 404);
  return data;
}

const SAVE_ERRORS = {
  editing_disabled: ["Editing has been turned off for this profile. Please contact CardCraft Studio BD.", 403],
  suspended: ["This profile is suspended. Please contact CardCraft Studio BD.", 403],
  public_id_taken: ["That profile URL is already in use or was used before. Choose another.", 409],
  not_found: ["Customer not found.", 404],
};

function resolveSocialLinks(input, current, owner) {
  const paths = current.map((link) => link.qr_image_path).filter(Boolean);
  return v.cleanSocialLinks(input).map(({ qr_image, ...link }) => ({
    ...link, ...(qr_image ? { qr_image_path: resolveImage(qr_image, paths, owner) } : {}),
  }));
}

async function saveProfile({ customerId, body, actor, actorId, owner, allowed }) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError("Invalid request.");
  const current = await loadRecord(customerId);
  const fields = v.cleanFields(body, allowed);
  for (const [key, column] of Object.entries(v.IMAGE_FIELDS)) {
    const resolved = resolveImage(body[key], [current.profile[column]].filter(Boolean), owner);
    if (resolved !== undefined) fields[column] = resolved;
  }
  const p = { customer_id: customerId, actor_type: actor, actor_id: actorId, fields };
  if ("social_links" in body) p.social_links = resolveSocialLinks(body.social_links, current.social_links, owner);
  if ("custom_links" in body) p.custom_links = v.cleanCustomLinks(body.custom_links);
  if ("services" in body) {
    const paths = current.services.map((s) => s.image_path).filter(Boolean);
    p.services = v.cleanServices(body.services).map(({ image, ...s }) => ({ ...s, image_path: resolveImage(image, paths, owner) ?? null }));
  }
  if (!Object.keys(fields).length && !["social_links", "custom_links", "services"].some((k) => k in p))
    throw new ApiError("Nothing to save.");
  const result = await call("nfc_save_profile", p);
  if (result?.error) {
    const [message, status] = SAVE_ERRORS[result.error] || ["Could not save the profile.", 400];
    throw new ApiError(message, status);
  }
  await processCleanup();
  return result;
}

async function lookupPublic(id) {
  if (!PUBLIC_ID.test(id)) return null;
  let data = await call("nfc_public_get", { public_id: id.toLowerCase() });
  // Old slug / immutable id: follow one internal redirect so QR + vCard work for any issued identifier.
  if (data?.redirect) data = { ...(await call("nfc_public_get", { public_id: data.redirect })), redirected: data.redirect };
  return data;
}

function publicOrThrow(data) {
  if (!data) throw new ApiError("Profile not found.", 404);
  if (data.gone) throw new ApiError("This profile is no longer available.", 410);
  if (data.unavailable || !data.profile) throw new ApiError("This profile is not available right now.", 404);
  return toView(data, { mediaUrl, profileUrl });
}

function sendQr(res, slug, format, download) {
  const target = profileUrl(slug);
  const png = format === "png";
  res.statusCode = 200;
  res.setHeader("Content-Type", png ? "image/png" : "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.setHeader("X-QR-Content", encodeURI(target));
  if (download) res.setHeader("Content-Disposition", `attachment; filename="${slug}-qr.${png ? "png" : "svg"}"`);
  res.end(png ? qrPng(target) : qrSvg(target));
}

// ------------------------------------------------------------------ public page
async function renderPage(req, res, id) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Security-Policy", PAGE_CSP);
  res.setHeader("Cache-Control", "private, no-cache");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  const page = (status, title, message) => { res.statusCode = status; res.end(statusPage(title, message)); };
  if (!["GET", "HEAD"].includes(req.method)) return page(405, "Not allowed", "This address only supports viewing.");
  if (!PUBLIC_ID.test(id)) return page(404, "Profile not found", "Please check the link or tap the card again.");
  if (/[A-Z]/.test(id)) { res.writeHead(301, { Location: "/p/" + id.toLowerCase() }).end(); return; }
  try {
    const data = await call("nfc_public_get", { public_id: id });
    if (!data) return page(404, "Profile not found", "Please check the link or tap the card again.");
    if (data.gone) return page(410, "Profile no longer available", "This digital card has been removed by its owner.");
    if (data.redirect) { res.writeHead(301, { Location: "/p/" + data.redirect }).end(); return; }
    if (data.unavailable) return page(404, "Profile unavailable", "This digital card is temporarily unavailable.");
    const view = toView(data, { mediaUrl, profileUrl });
    res.statusCode = 200;
    res.end(req.method === "HEAD" ? undefined : profilePage(view, { origin: nfcConfig().origin }));
  } catch (error) {
    console.error("NFC page failure", { message: error.message });
    page(error.status === 503 ? 503 : 500, "Temporarily unavailable", "Please try again in a moment.");
  }
}

// ------------------------------------------------------------------ route table
const routes = [];
const on = (method, kind, pattern, fn) => routes.push({ method, kind, pattern, fn });

// Public
on("GET", "nfc", /^public\/([^/]+)$/, async ({ res, params }) => {
  const view = publicOrThrow(await lookupPublic(params[0]));
  sendJson(res, { profile: view });
});
on("GET", "nfc", /^public\/([^/]+)\/vcf$/, async ({ res, params }) => {
  const view = publicOrThrow(await lookupPublic(params[0]));
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/vcard; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Disposition", `attachment; filename="${view.slug}.vcf"`);
  res.end(buildVcard(view));
});
on("GET", "nfc", /^public\/([^/]+)\/qr$/, async ({ res, params, url }) => {
  const view = publicOrThrow(await lookupPublic(params[0]));
  sendQr(res, view.slug, url.searchParams.get("format"), url.searchParams.get("download") === "1");
});
on("POST", "nfc", /^public\/([^/]+)\/view$/, async ({ req, res, params, body }) => {
  const slug = params[0].toLowerCase();
  const event = v.EVENT_TYPES.includes(body.event) ? body.event : null;
  const detail = typeof body.detail === "string" && /^[a-z0-9_-]{1,30}$/.test(body.detail) ? body.detail : null;
  if (!event || !PUBLIC_ID.test(slug)) throw new ApiError("Invalid event.");
  // Privacy-conscious: no IP or user agent is stored. Hashed, expiring rate-limit keys de-duplicate
  // repeat views (one per visitor per profile per 30 minutes) and cap click spam.
  const ip = clientIp(req);
  try {
    await limit(req, "nfc-event-ip", 300, 3600, ip);
    if (event === "view") await limit(req, "nfc-view", 1, 1800, ip + ":" + slug);
    else await limit(req, "nfc-click", 60, 3600, ip + ":" + slug);
  } catch (error) {
    if (error.status === 429) return sendJson(res, { recorded: false });
    throw error;
  }
  sendJson(res, await call("nfc_record_event", { public_slug: slug, event_type: event, event_detail: event === "click_social" ? detail : null }));
});

// Customer authentication
on("POST", "nfc", /^auth\/login$/, async ({ req, res, body }) => {
  await limit(req, "nfc-login-ip", 20, 900);
  const generic = () => new ApiError("Incorrect User ID or password.", 401);
  const password = typeof body.password === "string" && body.password.length <= 128 ? body.password : null;
  const userId = v.normalizeUserId(body.user_id);
  if (userId) await limit(req, "nfc-login-user", 10, 900, userId);
  const row = userId && password ? await call("nfc_login_lookup", { user_id: userId }) : null;
  if (!row) {
    await burnPasswordCheck(password);
    throw generic();
  }
  if (!(await verifyPassword(password, row.password_hash))) throw generic();
  if (row.status !== "active")
    throw Object.assign(new ApiError("This account is suspended. Please contact CardCraft Studio BD on WhatsApp.", 403), { code: "suspended" });
  const { csrf } = await createSession(res, row.customer_id);
  sendJson(res, { ok: true, csrf, password_change_required: row.password_change_required });
});
on("POST", "nfc", /^auth\/logout$/, async ({ req, res }) => {
  const session = await currentSession(req);
  if (session) await call("nfc_session_revoke", { token_hash: session.tokenHash });
  clearSessionCookie(res);
  sendJson(res, { ok: true });
});
on("GET", "nfc", /^auth\/session$/, async ({ req, res }) => {
  const s = await currentSession(req);
  if (!s || s.status !== "active") return sendJson(res, { authenticated: false });
  sendJson(res, {
    authenticated: true,
    csrf: s.csrf,
    user_id: s.user_id,
    full_name: s.full_name,
    profile_url: profileUrl(s.public_slug),
    password_change_required: s.password_change_required,
    editing_enabled: s.editing_enabled,
    profile_status: s.profile_status,
    expires_at: s.expires_at,
  });
});
on("POST", "nfc", /^auth\/change-password$/, async ({ req, res, body }) => {
  const s = await requireCustomer(req, { mutation: true, allowPasswordChange: true });
  await limit(req, "nfc-password-change", 10, 900, s.customer_id);
  const row = await call("nfc_login_lookup", { user_id: s.user_id });
  if (!row || typeof body.current_password !== "string" || body.current_password.length > 128 || !(await verifyPassword(body.current_password, row.password_hash)))
    throw new ApiError("Current password is incorrect.", 400);
  const problem = passwordProblem(body.new_password, s.user_id);
  if (problem) throw new ApiError(problem);
  if (body.new_password === body.current_password) throw new ApiError("Choose a password different from the current one.");
  await call("nfc_set_password", {
    customer_id: s.customer_id, password_hash: await hashPassword(body.new_password), change_required: false,
    actor_type: "customer", actor_id: s.customer_id, keep_session_id: s.session_id,
  });
  sendJson(res, { ok: true });
});
on("POST", "nfc", /^auth\/logout-all$/, async ({ req, res }) => {
  const s = await requireCustomer(req, { mutation: true, allowPasswordChange: true });
  await call("nfc_session_revoke", { customer_id: s.customer_id });
  clearSessionCookie(res);
  sendJson(res, { ok: true });
});

// Customer self-service — identity always from the session.
on("GET", "nfc", /^me\/profile$/, async ({ req, res }) => {
  const s = await requireCustomer(req);
  sendJson(res, forCustomer(await loadRecord(s.customer_id)));
});
const customerSave = (pick) => async ({ req, res, body }) => {
  const s = await requireCustomer(req, { mutation: true });
  await limit(req, "nfc-save", 120, 3600, s.customer_id);
  await saveProfile({ customerId: s.customer_id, body: pick(body), actor: "customer", actorId: s.customer_id, owner: "p:" + s.profile_id, allowed: v.CUSTOMER_FIELDS });
  sendJson(res, forCustomer(await loadRecord(s.customer_id)));
};
const collection = (key) => (body) => ({ [key]: Array.isArray(body) ? body : body?.[key] ?? body?.items });
on("PATCH", "nfc", /^me\/profile$/, customerSave((body) => body));
on("PUT", "nfc", /^me\/social-links$/, customerSave(collection("social_links")));
on("PUT", "nfc", /^me\/services$/, customerSave(collection("services")));
on("PUT", "nfc", /^me\/custom-links$/, customerSave(collection("custom_links")));
on("POST", "nfc", /^me\/upload$/, async ({ req, res, body }) => {
  const s = await requireCustomer(req, { mutation: true });
  if (!s.editing_enabled || s.profile_status !== "active")
    throw new ApiError("Editing has been turned off for this profile. Please contact CardCraft Studio BD.", 403);
  await limit(req, "nfc-upload-customer", 40, 3600, s.customer_id);
  sendJson(res, await uploadImage(body.data, "p:" + s.profile_id));
});
on("GET", "nfc", /^me\/analytics$/, async ({ req, res }) => {
  const s = await requireCustomer(req);
  sendJson(res, await call("nfc_profile_stats", { customer_id: s.customer_id }));
});

// Admin
const SORTS = ["created_at", "updated_at", "full_name", "user_id", "company_name", "theme_id", "card_status", "profile_status", "views"];
on("GET", "admin", /^customers$/, async ({ res, url }) => {
  const q = (k) => url.searchParams.get(k) || "";
  const per = Math.min(Math.max(parseInt(q("per"), 10) || 20, 1), 100);
  const pg = Math.max(parseInt(q("pg"), 10) || 1, 1);
  const status = ["active", "suspended"].includes(q("profile_status")) ? q("profile_status") : "";
  const card = [...v.CARD_STATUSES, "awaiting"].includes(q("card_status")) ? q("card_status") : "";
  const result = await call("nfc_admin_list", {
    q: q("q").slice(0, 100), profile_status: status, card_status: card,
    sort: SORTS.includes(q("sort")) ? q("sort") : "created_at", dir: q("dir") === "asc" ? "asc" : "desc",
    limit: per, offset: (pg - 1) * per,
  });
  sendJson(res, {
    total: result.total, page: pg, per,
    rows: result.rows.map((r) => ({ ...r, profile_url: profileUrl(r.public_slug), photo_url: mediaUrl(r.profile_photo_path) })),
  });
});
on("POST", "admin", /^customers$/, async ({ res, body, user }) => {
  const userId = v.requireUserId(body.user_id);
  const problem = passwordProblem(body.password, userId);
  if (problem) throw new ApiError(problem);
  const fields = v.cleanFields(body, v.ADMIN_FIELDS.filter((k) => k !== "public_slug"), { requireName: true });
  for (const [key, column] of Object.entries(v.IMAGE_FIELDS)) {
    const resolved = resolveImage(body[key], [], "admin");
    if (resolved) fields[column] = resolved;
  }
  const payload = {
    customer: { user_id: userId, password_hash: await hashPassword(body.password) },
    social_links: resolveSocialLinks(body.social_links, [], "admin"),
    custom_links: v.cleanCustomLinks(body.custom_links),
    services: v.cleanServices(body.services).map(({ image, ...s }) => ({ ...s, image_path: resolveImage(image, [], "admin") ?? null })),
    card_reference: body.card_reference ? v.cleanText(body.card_reference, { max: 60, label: "Card reference" }) : "",
    actor_id: user.id,
  };
  const customSlug = body.public_slug ? v.cleanSlug(body.public_slug) : null;
  for (let attempt = 0; attempt < 6; attempt++) {
    payload.profile = { ...fields, public_slug: customSlug || v.generateSlug(fields.full_name), immutable_public_id: v.generateImmutableId() };
    const result = await call("nfc_admin_create", payload);
    if (result?.error === "user_id_taken") throw new ApiError("This User ID is already taken. Choose another.", 409);
    if (result?.error === "card_reference_taken") throw new ApiError("This card reference is already used.", 409);
    if (result?.error === "public_id_taken") {
      if (customSlug) throw new ApiError("That profile URL is already in use or was used before. Choose another.", 409);
      continue;
    }
    if (result?.error || !result?.customer_id) throw new ApiError("Could not create the customer.", 400);
    return sendJson(res, {
      ...result,
      user_id: userId,
      profile_url: profileUrl(result.public_slug),
      login_url: nfcConfig().origin + "/nfc/login",
    }, 201);
  }
  throw new ApiError("Could not generate a unique profile URL. Please retry.", 409);
});
on("GET", "admin", /^customers\/([^/]+)$/, async ({ res, params }) => sendJson(res, decorate(await loadRecord(params[0]))));
on("PATCH", "admin", /^customers\/([^/]+)$/, async ({ res, params, body, user }) => {
  await saveProfile({ customerId: params[0], body, actor: "admin", actorId: user.id, owner: "admin", allowed: v.ADMIN_FIELDS });
  sendJson(res, decorate(await loadRecord(params[0])));
});
on("POST", "admin", /^customers\/([^/]+)\/reset-password$/, async ({ res, params, body, user }) => {
  const record = await loadRecord(params[0]);
  const password = body.password ? body.password : generatePassword();
  const problem = passwordProblem(password, record.customer.user_id);
  if (problem) throw new ApiError(problem);
  await call("nfc_set_password", {
    customer_id: params[0], password_hash: await hashPassword(password), change_required: true, actor_type: "admin", actor_id: user.id,
  });
  // The temporary password is returned only in this response and is never stored in plain text.
  sendJson(res, { ok: true, user_id: record.customer.user_id, temporary_password: password, login_url: nfcConfig().origin + "/nfc/login" });
});
for (const [action, status] of [["suspend", "suspended"], ["reactivate", "active"]])
  on("POST", "admin", new RegExp(`^customers\\/([^/]+)\\/${action}$`), async ({ res, params, user }) => {
    if (!v.UUID.test(params[0])) throw new ApiError("Customer not found.", 404);
    const result = await call("nfc_set_status", { customer_id: params[0], status, actor_id: user.id });
    if (result?.error) throw new ApiError("Customer not found.", 404);
    sendJson(res, result);
  });
on("DELETE", "admin", /^customers\/([^/]+)$/, async ({ res, params, body, user }) => {
  const record = await loadRecord(params[0]);
  if (String(body.confirm_user_id || "").trim().toLowerCase() !== record.customer.user_id)
    throw new ApiError("Type the customer's User ID to confirm deletion.");
  const result = await call("nfc_delete_customer", { customer_id: params[0], actor_id: user.id });
  if (result?.error) throw new ApiError("Customer not found.", 404);
  await processCleanup();
  sendJson(res, { ok: true });
});
on("POST", "admin", /^customers\/([^/]+)\/card-status$/, async ({ res, params, body, user }) => {
  if (!v.UUID.test(params[0])) throw new ApiError("Customer not found.", 404);
  if (!v.CARD_STATUSES.includes(body.status)) throw new ApiError("Invalid card status.");
  const p = { customer_id: params[0], status: body.status, actor_id: user.id };
  if ("reference" in body) p.reference = v.cleanText(body.reference, { max: 60, label: "Card reference" });
  const result = await call("nfc_set_card_status", p);
  if (result?.error === "card_reference_taken") throw new ApiError("This card reference is already used.", 409);
  if (result?.error) throw new ApiError("Customer not found.", 404);
  sendJson(res, result);
});
on("GET", "admin", /^customers\/([^/]+)\/qr$/, async ({ res, params, url }) => {
  const record = await loadRecord(params[0]);
  sendQr(res, record.profile.public_slug, url.searchParams.get("format"), url.searchParams.get("download") === "1");
});
on("GET", "admin", /^customers\/([^/]+)\/analytics$/, async ({ res, params }) => {
  if (!v.UUID.test(params[0])) throw new ApiError("Customer not found.", 404);
  sendJson(res, (await call("nfc_profile_stats", { customer_id: params[0] })) || {});
});
on("GET", "admin", /^analytics$/, async ({ res }) => sendJson(res, await call("nfc_admin_stats", {})));
on("POST", "admin", /^uploads$/, async ({ req, res, body }) => {
  await limit(req, "nfc-upload-admin", 300, 3600);
  sendJson(res, await uploadImage(body.data, "admin"));
});
on("GET", "admin", /^user-id-available$/, async ({ res, url }) => {
  const userId = v.normalizeUserId(url.searchParams.get("user_id") || "");
  if (!userId) return sendJson(res, { valid: false, available: false });
  sendJson(res, { valid: true, ...(await call("nfc_check_user_id", { user_id: userId })) });
});

// ------------------------------------------------------------------ entry point
export async function handleNfc(req, res) {
  const route = resolveRoute(req);
  if (route.kind === "page") return renderPage(req, res, route.id);
  const trace = randomUUID();
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  try {
    const config = nfcConfig();
    if (route.kind === "none") throw new ApiError("Endpoint not found.", 404);
    const candidates = routes.filter((r) => r.kind === route.kind && r.pattern.test(route.path));
    if (!candidates.length) throw new ApiError("Endpoint not found.", 404);
    const match = candidates.find((r) => r.method === req.method);
    if (!match) throw new ApiError("Method not allowed.", 405);
    const params = match.pattern.exec(route.path).slice(1).map(decodeURIComponent);
    let body = {};
    if (req.method !== "GET") {
      // CSRF layer 1 (all mutations): browser-enforced Origin must be this site. Layer 2 for customers: X-CSRF-Token.
      if (req.headers.origin !== config.origin) throw new ApiError("Same-origin request required.", 403);
      if (!String(req.headers["content-type"] || "").startsWith("application/json")) throw new ApiError("JSON required.", 415);
    }
    const user = route.kind === "admin" ? await requireAdmin(req) : null;
    if (req.method !== "GET") {
      body = await readJson(req);
      if (!body || typeof body !== "object") throw new ApiError("Invalid request.");
    }
    await match.fn({ req, res, url: route.url, params, body, user });
  } catch (error) {
    if (!error.status) console.error("NFC API failure", { trace, message: error.message });
    if (res.headersSent) return res.end();
    sendJson(res, {
      error: error.status ? error.message : "Unexpected server error. Please retry.",
      ...(error.code ? { code: error.code } : {}),
      reference: trace,
    }, error.status || 500);
  }
}
