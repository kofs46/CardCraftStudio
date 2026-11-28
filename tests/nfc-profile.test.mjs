// Profiles: admin creation, uniqueness, permanent URLs, editing, themes, visibility, escaping.
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { createApp, tinyPng } from "./helpers/nfc-app.mjs";
import { draftFromRecord, draftToPayload, draftToView, emptyDraft, sectionHtml } from "../js/nfc/editor.mjs";

let app;
before(async () => { app = await createApp(); });

test("admin creates a customer: account, profile, card, history and audit in one transaction", async () => {
  const cu = await app.createCustomer({ full_name: "Rahim Uddin", user_id: "rahim" });
  assert.match(cu.slug, /^rahim-uddin-[a-z2-9]{4}$/);
  assert.equal(cu.response.profile_url, `http://localhost:5175/p/${cu.slug}`);
  assert.equal(cu.response.login_url, "http://localhost:5175/nfc/login");
  assert.equal(cu.response.temporary_password, undefined, "password is not echoed back");
  const r = await app.db.query(`select c.password_change_required, p.theme_id, cd.card_status,
      (select count(*) from nfc_card_status_history h where h.card_id = cd.id) as history,
      (select count(*) from nfc_audit_logs a where a.target_profile_id = p.id and a.action = 'customer.create') as audits
    from nfc_customers c join nfc_profiles p on p.customer_id = c.id join nfc_cards cd on cd.profile_id = p.id where c.id = $1`, [cu.id]);
  assert.deepEqual({ ...r.rows[0], history: Number(r.rows[0].history), audits: Number(r.rows[0].audits) },
    { password_change_required: true, theme_id: "minimal", card_status: "profile_created", history: 1, audits: 1 });
});

test("duplicate User IDs are rejected case-insensitively and nothing partial is created", async () => {
  await app.createCustomer({ user_id: "karim" });
  const before = Number((await app.db.query("select count(*) from nfc_profiles")).rows[0].count);
  const dup = await app.admin("POST", "customers", { body: { user_id: "KARIM", password: "TempPass123x", full_name: "Other Karim" } });
  assert.equal(dup.status, 409);
  assert.match(dup.body.error, /already taken/);
  assert.equal(Number((await app.db.query("select count(*) from nfc_profiles")).rows[0].count), before);
  const avail = await app.admin("GET", "user-id-available?user_id=Karim");
  assert.deepEqual(avail.body, { valid: true, available: false });
});

test("every customer gets a unique permanent URL, enforced by PostgreSQL", async () => {
  const slugs = new Set();
  for (let i = 0; i < 6; i++) slugs.add((await app.createCustomer({ full_name: "Same Name" })).slug);
  assert.equal(slugs.size, 6);
  const [first] = slugs;
  await assert.rejects(app.db.query("update nfc_profiles set public_slug = $1 where public_slug <> $1 and full_name = 'Same Name'", [first]));
  const bangla = await app.createCustomer({ full_name: "রহিম উদ্দিন" });
  assert.match(bangla.slug, /^card-[a-z2-9]{4}$/);
});

test("customer edits appear on the public profile immediately and the URL never changes", async () => {
  const cu = await app.createCustomer({ full_name: "Tanvir Hasan", theme_id: "corporate" });
  const c = await app.activeClient(cu);
  const page1 = await app.request("GET", `/p/${cu.slug}`);
  assert.match(page1.text, /nfcp--corporate/);
  assert.equal(page1.headers["cache-control"], "private, no-cache");
  const r = await c.req("PATCH", "/api/nfc/me/profile", { body: { designation: "Head of Growth", theme_id: "holographic", tagline: "New tagline" } });
  assert.equal(r.status, 200);
  assert.equal(r.body.profile.public_slug, cu.slug);
  const page2 = await app.request("GET", `/p/${cu.slug}`);
  assert.equal(page2.status, 200);
  assert.match(page2.text, /nfcp--holographic/);
  assert.match(page2.text, /Head of Growth/);
  assert.match(page2.text, /New tagline/);
  // Every theme the UI offers must also exist in the database (nfc_themes foreign key), or saving it would fail.
  const { THEME_KEYS } = await import("../js/nfc/render.mjs");
  const dbThemes = (await app.db.query("select theme_key from nfc_themes where is_active")).rows.map((r) => r.theme_key);
  assert.deepEqual([...dbThemes].sort(), [...THEME_KEYS].sort());
  for (const theme of THEME_KEYS) {
    const saved = await c.req("PATCH", "/api/nfc/me/profile", { body: { theme_id: theme } });
    assert.equal(saved.status, 200, theme);
    assert.match((await app.request("GET", `/p/${cu.slug}`)).text, new RegExp(`nfcp--${theme}`));
  }
  const slugNow = (await app.db.query("select public_slug from nfc_profiles where customer_id = $1", [cu.id])).rows[0].public_slug;
  assert.equal(slugNow, cu.slug);
  assert.equal((await c.req("PATCH", "/api/nfc/me/profile", { body: { theme_id: "neon" } })).status, 400);
});

test("collections save atomically through PATCH and the dedicated PUT endpoints", async () => {
  const cu = await app.createCustomer();
  const c = await app.activeClient(cu);
  const r = await c.req("PUT", "/api/nfc/me/social-links", { body: { social_links: [{ platform: "instagram", url: "@acme.bd" }, { platform: "x", url: "acme" }, { platform: "telegram", url: "" }] } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.social_links.map((s) => s.url), ["https://instagram.com/acme.bd", "https://x.com/acme"]);
  const s = await c.req("PUT", "/api/nfc/me/services", { body: [{ title: "Design", description: "Logos", external_url: "acme.example/design" }] });
  assert.equal(s.body.services[0].external_url, "https://acme.example/design");
  const l = await c.req("PUT", "/api/nfc/me/custom-links", { body: { custom_links: [{ title: "Portfolio", url: "https://acme.example/p", icon: "portfolio" }] } });
  assert.equal(l.body.custom_links[0].icon, "portfolio");
  assert.equal((await c.req("PUT", "/api/nfc/me/social-links", { body: { social_links: [{ platform: "myspace", url: "x" }] } })).status, 400);
  const page = await app.request("GET", `/p/${cu.slug}`);
  assert.match(page.text, /Portfolio/);
  assert.match(page.text, /instagram\.com\/acme\.bd/);
});

test("admin and customer can save the new social contacts with the same public profile URL", async () => {
  const uploaded = await app.admin("POST", "uploads", { body: { kind: "social_qr", data: await tinyPng() } });
  assert.equal(uploaded.status, 200);
  const cu = await app.createCustomer({ social_links: [
    { platform: "instagram", url: "@acme.bd", label: "Studio Instagram" },
    { platform: "viber", url: "০১৭১২৩৪৫৬৭৮" },
    { platform: "wechat", qr_image: { receipt: uploaded.body.receipt } },
    { platform: "bdjobs", url: "www.bdjobs.com/" },
    { platform: "whatsapp_business", url: "wa.me/message/ACMESAMPLE" },
  ] });
  const publicPath = "/p/" + cu.slug;
  const first = await app.request("GET", publicPath);
  assert.match(first.text, /Studio Instagram/);
  assert.match(first.text, /data-copy-value="\+8801712345678"/);
  assert.ok(first.text.includes(uploaded.body.url));
  assert.match(first.text, /href="https:\/\/www\.bdjobs\.com\/"/);
  assert.match(first.text, /href="https:\/\/wa\.me\/message\/ACMESAMPLE"/);
  assert.match(first.text, /data-track="click_whatsapp"/, "the original WhatsApp button is still present");

  const client = await app.activeClient(cu);
  const rec = (await client.req("GET", "/api/nfc/me/profile")).body;
  const draft = draftFromRecord(rec);
  const wechat = draft.social_links.find((s) => s.platform === "wechat");
  assert.equal(wechat.qr_image.url, uploaded.body.url);
  wechat.url = "studio_acme";
  const viber = draft.social_links.find((s) => s.platform === "viber");
  viber.url = "https://viber.me/8801712345678?draft=Hello";
  const business = draft.social_links.find((s) => s.platform === "whatsapp_business");
  business.url = "01712345678";
  const preview = draftToView(draft, { slug: "" });
  assert.equal(preview.socials.find((s) => s.platform === "whatsapp_business").url, "https://wa.me/8801712345678");
  const saved = await client.req("PATCH", "/api/nfc/me/profile", { body: draftToPayload(draft, draftFromRecord(rec)) });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.profile.public_slug, cu.slug);
  assert.equal(saved.body.social_links.find((s) => s.platform === "wechat").identifier, "studio_acme");
  const after = (await app.request("GET", publicPath)).text;
  assert.match(after, /data-copy-value="studio_acme"/);
  assert.match(after, /href="https:\/\/viber\.me\/8801712345678\?draft=Hello"/);
  assert.match(after, /href="https:\/\/wa\.me\/8801712345678"/);
  assert.match(after, /Studio Instagram/);

  wechat.is_visible = false;
  const hidden = await client.req("PUT", "/api/nfc/me/social-links", { body: draftToPayload(draft) });
  assert.equal(hidden.status, 200);
  const page = (await app.request("GET", publicPath)).text;
  const json = (await app.request("GET", "/api/nfc/public/" + cu.slug)).body.profile;
  assert.ok(!page.includes("studio_acme") && !page.includes(uploaded.body.url));
  assert.ok(!json.socials.some((s) => s.platform === "wechat"));
  const qrPath = uploaded.body.url.split("/nfc-profile-media/")[1];
  assert.ok(app.state.storage.has(qrPath), "turning off visibility keeps the stored QR");

  wechat.is_visible = true;
  wechat.qr_image = null;
  const removed = await client.req("PUT", "/api/nfc/me/social-links", { body: draftToPayload(draft) });
  assert.equal(removed.status, 200);
  assert.ok(!app.state.storage.has(qrPath), "the QR is deleted when removed");
});

test("social fields are present in the shared editor and invalid contact targets are rejected on save", async () => {
  const form = sectionHtml("socials", emptyDraft());
  for (const field of ["Viber number", "WeChat ID", "Upload WeChat QR", "Bdjobs or public CV link", "WhatsApp Business number"])
    assert.ok(form.includes(field), field);

  const cu = await app.createCustomer({ social_links: [{ platform: "bdjobs", url: "https://example.com/resume.pdf" }] });
  const client = await app.activeClient(cu);
  for (const [platform, url] of [
    ["viber", "https://viber.me.example.com/8801712345678"],
    ["wechat", "https://example.com/invalid-id"],
    ["bdjobs", "javascript:alert(1)"],
    ["whatsapp_business", "https://wa.me@other.example/8801712345678"],
    ["imo", "https://imo.im/"],
  ]) {
    const result = await client.req("PUT", "/api/nfc/me/social-links", { body: [{ platform, url }] });
    assert.equal(result.status, 400, platform);
  }
  assert.match((await app.request("GET", "/p/" + cu.slug)).text, /href="https:\/\/example\.com\/resume\.pdf"/);
});

test("Brilliant Number is validated, saved, and rendered as a tap-to-call contact", async () => {
  const cu = await app.createCustomer({ social_links: [{ platform: "brilliant", url: "০১৭১২৩৪৫৬৭৮" }] });
  const first = (await app.request("GET", "/p/" + cu.slug)).text;
  assert.match(first, /Brilliant Number/);
  assert.match(first, /href="tel:\+8801712345678"/);
  const client = await app.activeClient(cu);
  const rec = (await client.req("GET", "/api/nfc/me/profile")).body;
  const draft = draftFromRecord(rec);
  const brilliant = draft.social_links.find((s) => s.platform === "brilliant");
  assert.equal(brilliant.url, "+8801712345678");
  brilliant.url = "+447700900123";
  const preview = draftToView(draft, { slug: "" });
  assert.equal(preview.socials.find((s) => s.platform === "brilliant").identifier, "+447700900123");
  const saved = await client.req("PATCH", "/api/nfc/me/profile", { body: draftToPayload(draft, draftFromRecord(rec)) });
  assert.equal(saved.status, 200);
  assert.match((await app.request("GET", "/p/" + cu.slug)).text, /href="tel:\+447700900123"/);
  const bad = await client.req("PUT", "/api/nfc/me/social-links", { body: { social_links: [{ platform: "brilliant", url: "not-a-number" }] } });
  assert.equal(bad.status, 400);
});

test("portfolio and business services are clearly available in the shared editor", () => {
  const links = sectionHtml("links", emptyDraft());
  const services = sectionHtml("services", emptyDraft());
  assert.match(links, /Add portfolio \/ custom link/);
  assert.match(links, /portfolio website, project showcase/);
  assert.match(services, /Add business service/);
  assert.match(services, /service title, description, optional image/);
});

test("imo, permanent address and both visiting-card sides save and render through the profile editors", async () => {
  const front = await app.admin("POST", "uploads", { body: { data: await tinyPng() } });
  const back = await app.admin("POST", "uploads", { body: { data: await tinyPng() } });
  assert.equal(front.status, 200);
  assert.equal(back.status, 200);
  const village = "পূর্বপাড়া".normalize("NFC");
  const permanent = village + "\nRoad <10>";
  const cu = await app.createCustomer({
    address: "Office, Dhaka",
    permanent_address: permanent,
    social_links: [{ platform: "imo", url: "০১৭১২৩৪৫৬৭৮" }],
    visiting_card_front: { receipt: front.body.receipt },
    visiting_card_back: { receipt: back.body.receipt },
  });
  const pagePath = "/p/" + cu.slug;
  const publicApi = "/api/nfc/public/" + cu.slug;
  const first = (await app.request("GET", pagePath)).text;
  assert.match(first, /data-detail="imo"/);
  assert.match(first, /data-copy-value="\+8801712345678"/);
  assert.match(first, /Office, Dhaka/);
  assert.ok(!first.includes(village));
  for (const [side, image] of [["front", front], ["back", back]]) {
    assert.ok(first.includes(image.body.url));
    assert.ok(first.includes("Open visiting card " + side + " at full size"));
  }

  const client = await app.activeClient(cu);
  const base = draftFromRecord((await client.req("GET", "/api/nfc/me/profile")).body);
  assert.equal(base.permanent_address, permanent);
  assert.equal(base.images.visiting_card_front.url, front.body.url);
  assert.equal(base.images.visiting_card_back.url, back.body.url);
  assert.match(sectionHtml("contact", base), /Show permanent address on the public profile/);
  assert.match(sectionHtml("images", base), /Replace visiting card back/);
  assert.match(sectionHtml("socials", base), /id="s-imo" type="tel"/);
  const draft = structuredClone(base);
  draft.visibility_settings.permanent_address = true;
  const imo = draft.social_links.find((s) => s.platform === "imo");
  imo.url = "+44 7700 900123";
  const preview = draftToView(draft, { slug: "" });
  assert.equal(preview.permanent_address, permanent);
  assert.equal(preview.visiting_card.front, front.body.url);
  assert.equal(preview.socials.find((s) => s.platform === "imo").identifier, "+447700900123");
  const saved = await client.req("PATCH", "/api/nfc/me/profile", { body: draftToPayload(draft, base) });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.profile.public_slug, cu.slug);
  const page = (await app.request("GET", pagePath)).text;
  assert.ok(page.includes("Permanent address</strong>" + village + "<br>Road &lt;10&gt;"));
  assert.match(page, /data-copy-value="\+447700900123"/);
  assert.deepEqual((await app.request("GET", publicApi)).body.profile.visiting_card, {
    front: front.body.url, back: back.body.url,
  });

  const hidden = await app.admin("PATCH", "customers/" + cu.id, { body: {
    visibility_settings: { visiting_card: false, permanent_address: "false" },
    social_links: [{ platform: "imo", url: imo.url, is_visible: false }],
  } });
  assert.equal(hidden.status, 200);
  const hiddenPage = (await app.request("GET", pagePath)).text;
  const hiddenJson = (await app.request("GET", publicApi)).text;
  for (const text of [hiddenPage, hiddenJson]) {
    assert.ok(!text.includes(village) && !text.includes("+447700900123"));
    assert.ok(!text.includes(front.body.url) && !text.includes(back.body.url));
  }
  assert.ok(app.state.storage.has(back.body.url.split("/nfc-profile-media/")[1]));
});

test("old slugs and the immutable id redirect permanently; issued slugs are never reassigned", async () => {
  const cu = await app.createCustomer({ full_name: "Old Name" });
  const immutable = cu.response.immutable_public_id;
  const change = await app.admin("PATCH", `customers/${cu.id}`, { body: { public_slug: "new-name-2026" } });
  assert.equal(change.status, 200);
  const old = await app.request("GET", `/p/${cu.slug}`);
  assert.equal(old.status, 301);
  assert.equal(old.headers.location, "/p/new-name-2026");
  const imm = await app.request("GET", `/p/${immutable}`);
  assert.equal(imm.status, 301);
  assert.equal((await app.request("GET", "/p/NEW-NAME-2026")).headers.location, "/p/new-name-2026");
  const other = await app.createCustomer();
  const steal = await app.admin("PATCH", `customers/${other.id}`, { body: { public_slug: cu.slug } });
  assert.equal(steal.status, 409);
  const create = await app.admin("POST", "customers", { body: { user_id: "thief", password: "TempPass123x", full_name: "Thief", public_slug: cu.slug } });
  assert.equal(create.status, 409);
  // The public API follows redirects too.
  assert.equal((await app.request("GET", `/api/nfc/public/${cu.slug}`)).body.profile.slug, "new-name-2026");
});

test("deleted profiles return 410 and their URL can never be issued again", async () => {
  const cu = await app.createCustomer({ full_name: "Gone Soon" });
  assert.equal((await app.admin("DELETE", `customers/${cu.id}`, { body: { confirm_user_id: "wrong" } })).status, 400);
  assert.equal((await app.admin("DELETE", `customers/${cu.id}`, { body: { confirm_user_id: cu.userId.toUpperCase() } })).status, 200);
  const page = await app.request("GET", `/p/${cu.slug}`);
  assert.equal(page.status, 410);
  assert.match(page.text, /no longer available/);
  assert.equal((await app.request("GET", `/api/nfc/public/${cu.slug}`)).status, 410);
  const reuse = await app.admin("POST", "customers", { body: { user_id: "newperson", password: "TempPass123x", full_name: "New", public_slug: cu.slug } });
  assert.equal(reuse.status, 409);
  const audit = await app.db.query("select safe_change_summary from nfc_audit_logs where action = 'customer.delete' order by id desc limit 1");
  assert.equal(audit.rows[0].safe_change_summary.public_slug, cu.slug);
});

test("suspended profiles show an unavailable page; reactivation restores them", async () => {
  const cu = await app.createCustomer();
  await app.admin("POST", `customers/${cu.id}/suspend`);
  const page = await app.request("GET", `/p/${cu.slug}`);
  assert.equal(page.status, 404);
  assert.match(page.text, /temporarily unavailable/);
  assert.equal((await app.request("GET", `/api/nfc/public/${cu.slug}/vcf`)).status, 404);
  await app.admin("POST", `customers/${cu.id}/reactivate`);
  assert.equal((await app.request("GET", `/p/${cu.slug}`)).status, 200);
  assert.equal((await app.request("GET", "/p/does-not-exist")).status, 404);
  assert.equal((await app.request("GET", "/p/<script>")).status, 404);
});

test("visibility settings hide fields everywhere (page, JSON, vCard)", async () => {
  const cu = await app.createCustomer({ phone: "01799999999", whatsapp: "01788888888", email: "hidden@example.com" });
  const c = await app.activeClient(cu);
  await c.req("PATCH", "/api/nfc/me/profile", { body: { visibility_settings: { phone: false, email: false, qr: false, save_contact: false } } });
  const page = (await app.request("GET", `/p/${cu.slug}`)).text;
  const json = (await app.request("GET", `/api/nfc/public/${cu.slug}`)).text;
  const vcf = (await app.request("GET", `/api/nfc/public/${cu.slug}/vcf`)).text;
  for (const text of [page, json, vcf]) {
    assert.ok(!text.includes("01799999999"));
    assert.ok(!text.includes("hidden@example.com"));
  }
  assert.ok(page.includes("8801788888888"), "WhatsApp still visible");
  assert.ok(!page.includes("nfcp-qr-img"));
  assert.ok(!page.includes("Save Contact"));
});

test("user content is escaped and dangerous links are rejected", async () => {
  const cu = await app.createCustomer({ full_name: '<script>alert("x")</script>', tagline: "<img src=x onerror=alert(1)>", company_name: "A & B \"Ltd\"" });
  const page = (await app.request("GET", `/p/${cu.slug}`)).text;
  assert.ok(!page.includes("<script>alert"));
  assert.ok(!page.includes("<img src=x"));
  assert.ok(page.includes("&lt;script&gt;"));
  assert.ok(page.includes("A &amp; B &quot;Ltd&quot;"));
  const c = await app.activeClient(cu);
  for (const website of ["javascript:alert(1)", "data:text/html,hi", "https://user:pass@evil.example", "vbscript:x"])
    assert.equal((await c.req("PATCH", "/api/nfc/me/profile", { body: { website } })).status, 400, website);
  assert.equal((await c.req("PATCH", "/api/nfc/me/profile", { body: { email: "not-an-email" } })).status, 400);
  assert.equal((await c.req("PATCH", "/api/nfc/me/profile", { body: { phone: "12" } })).status, 400);
  assert.equal((await c.req("PATCH", "/api/nfc/me/profile", { body: { full_name: "" } })).status, 400);
  assert.equal((await c.req("PATCH", "/api/nfc/me/profile", { body: { biography: "x".repeat(2001) } })).status, 400);
  const ok = await c.req("PATCH", "/api/nfc/me/profile", { body: { website: "www.example.com", phone: "০১৭১১০০০০০০" } });
  assert.equal(ok.body.profile.website, "https://www.example.com/");
  assert.equal(ok.body.profile.phone, "01711000000");
});

test("admin list supports search, filters, sorting and pagination", async () => {
  await app.createCustomer({ full_name: "Zara Zaman", company_name: "Zeta Corp" });
  await app.createCustomer({ full_name: "Abdul Alim", company_name: "Alpha Ltd" });
  const search = await app.admin("GET", "customers?q=zeta");
  assert.equal(search.body.total, 1);
  assert.equal(search.body.rows[0].full_name, "Zara Zaman");
  assert.ok(search.body.rows[0].profile_url.endsWith(search.body.rows[0].public_slug));
  const asc = await app.admin("GET", "customers?sort=full_name&dir=asc&per=100");
  const names = asc.body.rows.map((r) => r.full_name.toLowerCase());
  assert.deepEqual(names, [...names].sort());
  const page1 = await app.admin("GET", "customers?per=2&pg=1");
  const page2 = await app.admin("GET", "customers?per=2&pg=2");
  assert.equal(page1.body.rows.length, 2);
  assert.notEqual(page1.body.rows[0].customer_id, page2.body.rows[0].customer_id);
  assert.ok(page1.body.total > 2);
  const awaiting = await app.admin("GET", "customers?card_status=awaiting&per=100");
  assert.equal(awaiting.body.total, page1.body.total);
  const injected = await app.admin("GET", "customers?sort=password_hash;drop table x&dir=sideways&q=%25");
  assert.equal(injected.status, 200);
});
