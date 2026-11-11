// Profiles: admin creation, uniqueness, permanent URLs, editing, themes, visibility, escaping.
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./helpers/nfc-app.mjs";

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
  for (const theme of ["luxury", "minimal", "purple"]) {
    await c.req("PATCH", "/api/nfc/me/profile", { body: { theme_id: theme } });
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
