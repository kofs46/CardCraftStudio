// Customer authentication: login, sessions, password change/reset, revocation, rate limits.
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createApp } from "./helpers/nfc-app.mjs";

let app;
before(async () => { app = await createApp(); });

test("valid login is case-insensitive and sets a hardened HttpOnly cookie plus CSRF token", async () => {
  const cu = await app.createCustomer({ user_id: "rahim.uddin" });
  const c = app.client();
  const r = await c.login("RAHIM.Uddin", cu.password);
  assert.equal(r.status, 200);
  assert.equal(r.body.password_change_required, true);
  assert.match(r.body.csrf, /^[A-Za-z0-9_-]{43}$/);
  const cookie = r.headers["set-cookie"];
  assert.match(cookie, /^nfc_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=604800$/);
  // Only the SHA-256 hash of the token is stored.
  const token = cookie.split(";")[0].split("=")[1];
  const rows = (await app.db.query("select token_hash from nfc_sessions")).rows.map((x) => x.token_hash);
  assert.ok(rows.includes(createHash("sha256").update(token).digest("hex")));
  assert.ok(!rows.includes(token));
});

test("passwords are stored only as Argon2id/scrypt hashes", async () => {
  const cu = await app.createCustomer({ password: "PlainSecret99" });
  const row = (await app.db.query("select password_hash from nfc_customers where id = $1", [cu.id])).rows[0];
  assert.match(row.password_hash, /^\$(argon2id|scrypt)\$/);
  assert.ok(!row.password_hash.includes("PlainSecret99"));
});

test("invalid user ID, invalid password and malformed input return the same generic error", async () => {
  const cu = await app.createCustomer();
  const c = app.client();
  const results = [
    await c.login("no-such-user", "Whatever123"),
    await c.login(cu.userId, "WrongPassword1"),
    await c.login("x", "Whatever123"),
    await c.login(cu.userId, "a".repeat(500)),
  ];
  for (const r of results) {
    assert.equal(r.status, 401);
    assert.equal(r.body.error, "Incorrect User ID or password.");
    assert.equal(r.headers["set-cookie"], undefined);
  }
});

test("first login forces a password change before any profile access", async () => {
  const cu = await app.createCustomer();
  const c = app.client();
  await c.login(cu.userId, cu.password);
  const blocked = await c.req("GET", "/api/nfc/me/profile");
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, "password_change_required");
  const session = await c.req("GET", "/api/nfc/auth/session");
  assert.equal(session.body.password_change_required, true);

  const weak = await c.req("POST", "/api/nfc/auth/change-password", { body: { current_password: cu.password, new_password: "short" } });
  assert.equal(weak.status, 400);
  const wrongCurrent = await c.req("POST", "/api/nfc/auth/change-password", { body: { current_password: "Nope12345678", new_password: "GoodPassw0rd!" } });
  assert.equal(wrongCurrent.status, 400);
  const containsId = await c.req("POST", "/api/nfc/auth/change-password", { body: { current_password: cu.password, new_password: cu.userId + "12345" } });
  assert.equal(containsId.status, 400);
  const noCsrf = await app.request("POST", "/api/nfc/auth/change-password", { cookie: c.cookie, body: { current_password: cu.password, new_password: "GoodPassw0rd!" } });
  assert.equal(noCsrf.status, 403);

  const ok = await c.req("POST", "/api/nfc/auth/change-password", { body: { current_password: cu.password, new_password: "GoodPassw0rd!" } });
  assert.equal(ok.status, 200);
  assert.equal((await c.req("GET", "/api/nfc/me/profile")).status, 200);
  // Old password no longer works; new one does and no change is required.
  assert.equal((await app.client().login(cu.userId, cu.password)).status, 401);
  const again = await app.client().login(cu.userId, "GoodPassw0rd!");
  assert.equal(again.status, 200);
  assert.equal(again.body.password_change_required, false);
});

test("changing the password signs out other sessions but keeps the current one", async () => {
  const cu = await app.createCustomer();
  const c1 = await app.activeClient(cu);
  const c2 = app.client();
  await c2.login(cu.userId, cu.password);
  assert.equal((await c2.req("GET", "/api/nfc/me/profile")).status, 200);
  await c1.req("POST", "/api/nfc/auth/change-password", { body: { current_password: cu.password, new_password: "Another123pw" } });
  assert.equal((await c1.req("GET", "/api/nfc/me/profile")).status, 200);
  assert.equal((await c2.req("GET", "/api/nfc/me/profile")).status, 401);
});

test("suspended accounts cannot log in and existing sessions are revoked", async () => {
  const cu = await app.createCustomer();
  const c = await app.activeClient(cu);
  assert.equal((await app.admin("POST", `customers/${cu.id}/suspend`)).status, 200);
  assert.equal((await c.req("GET", "/api/nfc/me/profile")).status, 401);
  const login = await app.client().login(cu.userId, cu.password);
  assert.equal(login.status, 403);
  assert.equal(login.body.code, "suspended");
  assert.equal(login.headers["set-cookie"], undefined);
  await app.admin("POST", `customers/${cu.id}/reactivate`);
  assert.equal((await app.client().login(cu.userId, cu.password)).status, 200);
});

test("expired and idle sessions are rejected", async () => {
  const cu = await app.createCustomer();
  const c = await app.activeClient(cu);
  await app.db.query("update nfc_sessions set expires_at = now() - interval '1 minute' where customer_id = $1", [cu.id]);
  assert.equal((await c.req("GET", "/api/nfc/me/profile")).status, 401);
  assert.equal((await c.req("GET", "/api/nfc/auth/session")).body.authenticated, false);

  const c2 = app.client();
  await c2.login(cu.userId, cu.password);
  await app.db.query("update nfc_sessions set last_used_at = now() - interval '73 hours' where customer_id = $1 and revoked_at is null and expires_at > now()", [cu.id]);
  assert.equal((await c2.req("GET", "/api/nfc/me/profile")).status, 401);
});

test("logout revokes the session token server-side; logout-all revokes every device", async () => {
  const cu = await app.createCustomer();
  const c = await app.activeClient(cu);
  const stolen = c.cookie;
  const out = await c.req("POST", "/api/nfc/auth/logout");
  assert.equal(out.status, 200);
  assert.match(out.headers["set-cookie"], /Max-Age=0/);
  assert.equal((await app.request("GET", "/api/nfc/me/profile", { cookie: stolen })).status, 401);

  const a = app.client(), b = app.client();
  await a.login(cu.userId, cu.password);
  await b.login(cu.userId, cu.password);
  assert.equal((await a.req("POST", "/api/nfc/auth/logout-all")).status, 200);
  assert.equal((await b.req("GET", "/api/nfc/me/profile")).status, 401);
  assert.equal((await a.req("GET", "/api/nfc/me/profile")).status, 401);
});

test("admin password reset returns a one-time temporary password, revokes sessions and forces a change", async () => {
  const cu = await app.createCustomer();
  const c = await app.activeClient(cu);
  const reset = await app.admin("POST", `customers/${cu.id}/reset-password`, { body: {} });
  assert.equal(reset.status, 200);
  const temp = reset.body.temporary_password;
  assert.ok(temp.length >= 10);
  assert.equal((await c.req("GET", "/api/nfc/me/profile")).status, 401);
  assert.equal((await app.client().login(cu.userId, cu.password)).status, 401);
  const fresh = await app.client().login(cu.userId, temp);
  assert.equal(fresh.status, 200);
  assert.equal(fresh.body.password_change_required, true);
  const stored = (await app.db.query("select password_hash from nfc_customers where id = $1", [cu.id])).rows[0].password_hash;
  assert.ok(!stored.includes(temp));
  // Admin-chosen weak passwords are refused.
  assert.equal((await app.admin("POST", `customers/${cu.id}/reset-password`, { body: { password: "123" } })).status, 400);
});

test("login is rate limited", async () => {
  app.state.limited = true;
  try {
    const r = await app.client().login("anyone", "Whatever123");
    assert.equal(r.status, 429);
  } finally {
    app.state.limited = false;
  }
});

test("real per-user rate limit blocks brute force after 10 attempts", async () => {
  const cu = await app.createCustomer();
  let last;
  for (let i = 0; i < 11; i++) last = await app.client(`10.0.0.${i}`).login(cu.userId, "WrongPassword" + i);
  assert.equal(last.status, 429);
});

test("customer mutations require same-origin requests", async () => {
  const cu = await app.createCustomer();
  const c = await app.activeClient(cu);
  const r = await c.req("PATCH", "/api/nfc/me/profile", { body: { tagline: "x" }, origin: "https://evil.example" });
  assert.equal(r.status, 403);
  const login = await app.request("POST", "/api/nfc/auth/login", { body: { user_id: cu.userId, password: cu.password }, origin: "https://evil.example" });
  assert.equal(login.status, 403);
});
