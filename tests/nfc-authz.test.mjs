// Authorization and isolation: customers only touch their own profile; admin endpoints are admin-only.
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { createApp, tinyPng } from "./helpers/nfc-app.mjs";

let app, A, B, ca, cb;
before(async () => {
  app = await createApp();
  A = await app.createCustomer({ full_name: "Alice Akter" });
  B = await app.createCustomer({ full_name: "Bashir Bhuiyan" });
  ca = await app.activeClient(A);
  cb = await app.activeClient(B);
});

const publicName = async (slug) => (await app.request("GET", `/api/nfc/public/${slug}`)).body.profile.name;

test("customer A cannot edit customer B — client-supplied IDs are ignored", async () => {
  const r = await ca.req("PATCH", "/api/nfc/me/profile", { body: { customer_id: B.id, profile_id: B.id, full_name: "Changed By A" } });
  assert.equal(r.status, 200);
  assert.equal(await publicName(A.slug), "Changed By A");
  assert.equal(await publicName(B.slug), "Bashir Bhuiyan");
});

test("customer A's session cannot read B's private record", async () => {
  const me = await ca.req("GET", "/api/nfc/me/profile");
  assert.equal(me.body.profile.public_slug, A.slug);
  assert.ok(!JSON.stringify(me.body).includes(B.slug));
  assert.ok(!JSON.stringify(me.body).includes("password_hash"));
  // Admin endpoints with a customer session are refused.
  assert.equal((await ca.req("GET", `/api/admin/nfc/customers/${B.id}`)).status, 401);
});

test("customers cannot access admin endpoints; non-allowlisted Supabase users get 403", async () => {
  for (const [method, path] of [["GET", "customers"], ["POST", "customers"], ["GET", "analytics"], ["POST", `customers/${B.id}/suspend`], ["DELETE", `customers/${B.id}`], ["POST", "uploads"]]) {
    assert.equal((await app.request(method, "/api/admin/nfc/" + path, { cookie: ca.cookie, csrf: ca.csrf, body: method === "GET" ? undefined : {} })).status, 401, path);
    assert.equal((await app.request(method, "/api/admin/nfc/" + path, { cookie: "cc_session=other-token", body: method === "GET" ? undefined : {} })).status, 403, path);
  }
});

test("public visitors cannot edit profiles", async () => {
  for (const [method, path] of [["PATCH", "me/profile"], ["PUT", "me/social-links"], ["PUT", "me/services"], ["POST", "me/upload"], ["GET", "me/profile"], ["GET", "me/analytics"]])
    assert.equal((await app.request(method, "/api/nfc/" + path, { body: method === "GET" ? undefined : {} })).status, 401, path);
});

test("mutations without the CSRF token are rejected even with a valid session cookie", async () => {
  const r = await app.request("PATCH", "/api/nfc/me/profile", { cookie: ca.cookie, body: { tagline: "csrf" } });
  assert.equal(r.status, 403);
  const forged = await app.request("PATCH", "/api/nfc/me/profile", { cookie: ca.cookie, csrf: cb.csrf, body: { tagline: "csrf" } });
  assert.equal(forged.status, 403);
});

test("customers cannot change admin-controlled settings", async () => {
  await ca.req("PATCH", "/api/nfc/me/profile", { body: { editing_enabled: false, public_slug: "hijack-slug", profile_status: "active", tagline: "ok" } });
  const row = (await app.db.query("select public_slug, editing_enabled from nfc_profiles where customer_id = $1", [A.id])).rows[0];
  assert.equal(row.public_slug, A.slug);
  assert.equal(row.editing_enabled, true);
});

test("disabled editing blocks customer saves and uploads but not the admin", async () => {
  await app.admin("PATCH", `customers/${B.id}`, { body: { editing_enabled: false } });
  const save = await cb.req("PATCH", "/api/nfc/me/profile", { body: { tagline: "blocked" } });
  assert.equal(save.status, 403);
  const up = await cb.req("POST", "/api/nfc/me/upload", { body: { kind: "profile_photo", data: await tinyPng() } });
  assert.equal(up.status, 403);
  assert.equal((await cb.req("GET", "/api/nfc/me/profile")).status, 200, "can still view");
  assert.equal((await app.admin("PATCH", `customers/${B.id}`, { body: { tagline: "admin edit" } })).status, 200);
  await app.admin("PATCH", `customers/${B.id}`, { body: { editing_enabled: true } });
});

test("suspended customers cannot modify profiles (API and database layer)", async () => {
  const C = await app.createCustomer();
  const cc = await app.activeClient(C);
  await app.admin("POST", `customers/${C.id}/suspend`);
  assert.equal((await cc.req("PATCH", "/api/nfc/me/profile", { body: { tagline: "x" } })).status, 401);
  const direct = (await app.db.query("select public.nfc_save_profile($1::jsonb) as r", [JSON.stringify({ customer_id: C.id, actor_type: "customer", actor_id: C.id, fields: { tagline: "x" } })])).rows[0].r;
  assert.equal(direct.error, "suspended");
});

test("upload receipts are bound to their owner (no cross-customer or admin-receipt reuse)", async () => {
  const fromA = await ca.req("POST", "/api/nfc/me/upload", { body: { kind: "profile_photo", data: await tinyPng() } });
  assert.equal(fromA.status, 200);
  const steal = await cb.req("PATCH", "/api/nfc/me/profile", { body: { profile_photo: { receipt: fromA.body.receipt } } });
  assert.equal(steal.status, 400);
  const adminUp = await app.admin("POST", "uploads", { body: { kind: "profile_photo", data: await tinyPng() } });
  assert.equal((await cb.req("PATCH", "/api/nfc/me/profile", { body: { profile_photo: { receipt: adminUp.body.receipt } } })).status, 400);
  const tampered = fromA.body.receipt.replace(/^./, (ch) => (ch === "e" ? "f" : "e"));
  assert.equal((await ca.req("PATCH", "/api/nfc/me/profile", { body: { profile_photo: { receipt: tampered } } })).status, 400);
  // A's own receipt works for A.
  assert.equal((await ca.req("PATCH", "/api/nfc/me/profile", { body: { profile_photo: { receipt: fromA.body.receipt } } })).status, 200);
  // B cannot point at A's stored file path either.
  const aPath = (await app.db.query("select profile_photo_path from nfc_profiles where customer_id = $1", [A.id])).rows[0].profile_photo_path;
  assert.equal((await cb.req("PATCH", "/api/nfc/me/profile", { body: { profile_photo: { path: aPath } } })).status, 400);
});

test("public profile responses never expose credentials or internal identifiers", async () => {
  const json = await app.request("GET", `/api/nfc/public/${A.slug}`);
  const page = await app.request("GET", `/p/${A.slug}`);
  for (const text of [json.text, page.text]) {
    assert.ok(!text.includes(A.id));
    assert.ok(!text.includes(A.userId));
    assert.ok(!/password|token_hash|customer_id|argon2|scrypt/i.test(text));
  }
});

test("database privileges: anon/authenticated roles have no access to NFC tables or functions", async () => {
  const r = await app.db.query(`select
    bool_or(has_table_privilege('anon', 'public.' || t, 'select')) as anon_tables,
    bool_or(has_table_privilege('authenticated', 'public.' || t, 'select')) as auth_tables
    from unnest(array['nfc_customers','nfc_profiles','nfc_sessions','nfc_audit_logs','nfc_profile_views']) t`);
  assert.equal(r.rows[0].anon_tables, false);
  assert.equal(r.rows[0].auth_tables, false);
  const f = await app.db.query(`select bool_or(has_function_privilege('anon', p.oid, 'execute')) as anon_exec
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'nfc\\_%'`);
  assert.equal(f.rows[0].anon_exec, false);
  const rls = await app.db.query("select bool_and(relrowsecurity) as on from pg_class where relname like 'nfc\\_%' and relkind = 'r'");
  assert.equal(rls.rows[0].on, true);
});
