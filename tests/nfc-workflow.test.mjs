// NFC business workflow: public access, card status tracking, analytics, stats.
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./helpers/nfc-app.mjs";

let app;
before(async () => { app = await createApp(); });

test("public URL opens without login, with security headers and a strict CSP", async () => {
  const cu = await app.createCustomer({ full_name: "Public Person" });
  const r = await app.request("GET", `/p/${cu.slug}`, { origin: undefined });
  assert.equal(r.status, 200);
  assert.match(r.headers["content-type"], /text\/html/);
  assert.match(r.headers["content-security-policy"], /default-src 'none'.*script-src 'self'/);
  assert.equal(r.headers["x-frame-options"], "DENY");
  assert.equal(r.headers["set-cookie"], undefined);
  assert.match(r.text, /Public Person/);
  assert.ok(!/<script>/.test(r.text), "no inline scripts");
  const json = await app.request("GET", `/api/nfc/public/${cu.slug}`);
  assert.equal(json.body.profile.url, `http://localhost:5175/p/${cu.slug}`);
});

test("admin tracks card status with timestamps and history; nothing is automatic", async () => {
  const cu = await app.createCustomer();
  const card = async () => (await app.admin("GET", `customers/${cu.id}`)).body;
  let rec = await card();
  assert.equal(rec.card.card_status, "profile_created");
  assert.equal(rec.card.programmed_at, null);
  for (const status of ["ready_for_programming", "programmed", "tested", "dispatched", "delivered"]) {
    const r = await app.admin("POST", `customers/${cu.id}/card-status`, { body: { status } });
    assert.equal(r.status, 200, status);
  }
  rec = await card();
  assert.equal(rec.card.card_status, "delivered");
  for (const k of ["programmed_at", "tested_at", "dispatched_at", "delivered_at"]) assert.ok(rec.card[k], k);
  assert.deepEqual(rec.card_history.map((h) => h.new_status), ["delivered", "dispatched", "tested", "programmed", "ready_for_programming", "profile_created"]);
  assert.ok(rec.card_history.every((h) => h.changed_by.startsWith("admin:")));
  assert.equal((await app.admin("POST", `customers/${cu.id}/card-status`, { body: { status: "teleported" } })).status, 400);
  // Skipping straight to "tested" does not invent a programmed timestamp.
  const other = await app.createCustomer();
  await app.admin("POST", `customers/${other.id}/card-status`, { body: { status: "tested" } });
  const o = (await app.admin("GET", `customers/${other.id}`)).body.card;
  assert.ok(o.tested_at);
  assert.equal(o.programmed_at, null);
});

test("internal card references are unique", async () => {
  const a = await app.createCustomer({ card_reference: "NFC-001" });
  const b = await app.createCustomer();
  const r = await app.admin("POST", `customers/${b.id}/card-status`, { body: { status: "profile_created", reference: "nfc-001" } });
  assert.equal(r.status, 409);
  assert.equal((await app.admin("GET", `customers/${a.id}`)).body.card.internal_card_reference, "NFC-001");
});

test("profile views are counted privately and de-duplicated per visitor", async () => {
  const cu = await app.createCustomer();
  const view = (ip, event = "view", detail) => app.request("POST", `/api/nfc/public/${cu.slug}/view`, { ip, body: detail ? { event, detail } : { event } });
  assert.equal((await view("1.1.1.1")).body.recorded, true);
  assert.equal((await view("1.1.1.1")).body.recorded, false, "repeat view within 30 min ignored");
  assert.equal((await view("2.2.2.2")).body.recorded, true);
  await view("2.2.2.2", "click_whatsapp");
  await view("2.2.2.2", "click_social", "facebook");
  await view("2.2.2.2", "save_contact");
  assert.equal((await view("3.3.3.3", "hack")).status, 400);
  assert.equal((await app.request("POST", `/api/nfc/public/${cu.slug}/view`, { body: { event: "view" }, origin: "https://evil.example" })).status, 403);
  const cols = (await app.db.query("select column_name from information_schema.columns where table_name = 'nfc_profile_views'")).rows.map((r) => r.column_name);
  assert.ok(!cols.some((c) => /ip|agent|device/.test(c)), "no visitor identifiers stored");

  const c = await app.activeClient(cu);
  const stats = (await c.req("GET", "/api/nfc/me/analytics")).body;
  assert.equal(stats.total_views, 2);
  assert.equal(stats.events.click_whatsapp, 1);
  assert.equal(stats.social.facebook, 1);
  assert.equal(stats.daily.length, 30);
  assert.equal(stats.daily.at(-1).views, 2);
  const adminStats = (await app.admin("GET", `customers/${cu.id}/analytics`)).body;
  assert.equal(adminStats.total_views, 2);
});

test("events for suspended or unknown profiles are not recorded", async () => {
  const cu = await app.createCustomer();
  await app.admin("POST", `customers/${cu.id}/suspend`);
  const r = await app.request("POST", `/api/nfc/public/${cu.slug}/view`, { ip: "9.9.9.9", body: { event: "view" } });
  assert.equal(r.body.recorded, false);
  assert.equal((await app.request("POST", "/api/nfc/public/nobody-here/view", { ip: "9.9.9.8", body: { event: "view" } })).body.recorded, false);
});

test("admin dashboard statistics reflect customers, cards and views", async () => {
  const s = (await app.admin("GET", "analytics")).body;
  const counts = (await app.db.query("select count(*) filter (where profile_status = 'active') as active, count(*) filter (where profile_status = 'suspended') as suspended, count(*) as total from nfc_profiles")).rows[0];
  assert.equal(s.total_customers, Number(counts.total));
  assert.equal(s.active_profiles, Number(counts.active));
  assert.equal(s.suspended_profiles, Number(counts.suspended));
  assert.ok(s.cards_delivered >= 1);
  assert.ok(s.cards_tested >= 2);
  assert.ok(s.total_views >= 2);
  assert.ok(Array.isArray(s.most_viewed) && s.most_viewed[0].views >= 2);
  assert.ok(s.recent_activity.some((a) => a.action === "card.status"));
});

test("many profile edits never change the URL; admin can copy the same URL afterwards", async () => {
  const cu = await app.createCustomer();
  const c = await app.activeClient(cu);
  for (let i = 0; i < 5; i++) await c.req("PATCH", "/api/nfc/me/profile", { body: { full_name: `Renamed ${i}`, company_name: `Co ${i}` } });
  const rec = (await app.admin("GET", `customers/${cu.id}`)).body;
  assert.equal(rec.profile.public_slug, cu.slug);
  assert.equal(rec.profile_url, `http://localhost:5175/p/${cu.slug}`);
  assert.equal((await app.request("GET", `/p/${cu.slug}`)).status, 200);
});

test("unknown NFC endpoints and wrong methods fail safely", async () => {
  assert.equal((await app.request("GET", "/api/nfc/nope")).status, 404);
  assert.equal((await app.request("DELETE", "/api/nfc/auth/login", { body: {} })).status, 405);
  assert.equal((await app.admin("GET", "customers/not-a-uuid")).status, 404);
  const r = await app.request("POST", "/api/nfc/auth/login", { headers: { "content-type": "text/plain" }, body: {} });
  assert.equal(r.status, 415);
});
