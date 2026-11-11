// Boots the NFC router against a real Postgres schema (PGlite) with an in-memory request/response pair.
import { Readable } from "node:stream";
import { createDb, supabaseFetch } from "./nfc-db.mjs";

export const ORIGIN = "http://localhost:5175";

export function setEnv() {
  process.env.SUPABASE_URL = "https://mock.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-server-key";
  process.env.ADMIN_USER_IDS = "admin-user";
  process.env.UPLOAD_SIGNING_SECRET = "0123456789abcdef".repeat(4);
  process.env.NFC_SESSION_SECRET = "fedcba9876543210".repeat(4);
  process.env.APP_ORIGIN = ORIGIN;
}

export async function createApp() {
  setEnv();
  const { setHashParamsForTests } = await import("../../server/nfc-platform/passwords.mjs");
  setHashParamsForTests({ memory: 1024, passes: 1, scryptLog: 10 });
  const db = await createDb();
  const state = {};
  globalThis.fetch = supabaseFetch(db, state);
  const { handleNfc } = await import("../../server/nfc-platform/router.mjs");

  async function request(method, path, { body, cookie, origin = ORIGIN, csrf, headers = {}, ip = "127.0.0.1" } = {}) {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, {
      url: path,
      method,
      headers: {
        "content-type": "application/json",
        ...(origin ? { origin } : {}),
        ...(cookie ? { cookie } : {}),
        ...(csrf ? { "x-csrf-token": csrf } : {}),
        ...headers,
      },
      socket: { remoteAddress: ip },
    });
    const out = {};
    let payload;
    const res = {
      statusCode: 200,
      headersSent: false,
      setHeader(k, v) { out[k.toLowerCase()] = v; },
      writeHead(status, h = {}) { this.statusCode = status; for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = v; return this; },
      end(v) { payload = v; this.headersSent = true; return this; },
    };
    await handleNfc(req, res);
    const text = payload === undefined ? "" : Buffer.isBuffer(payload) ? payload.toString("utf8") : String(payload);
    return {
      status: res.statusCode,
      headers: out,
      raw: payload,
      text,
      body: String(out["content-type"] || "").includes("json") ? JSON.parse(text) : undefined,
    };
  }

  /** A browser-like customer client that keeps its session cookie and CSRF token. */
  let ipCounter = 0;
  // Each simulated browser gets its own IP so the real per-IP login limit doesn't interfere between tests.
  function client(ip = `10.200.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`) {
    const c = { cookie: "", csrf: "" };
    c.req = async (method, path, opts = {}) => {
      const r = await request(method, path, { cookie: c.cookie, csrf: c.csrf, ip, ...opts });
      const set = r.headers["set-cookie"];
      if (set) {
        const pair = set.split(";")[0];
        c.cookie = pair.endsWith("=") ? "" : pair;
      }
      if (r.body?.csrf) c.csrf = r.body.csrf;
      return r;
    };
    c.login = (user_id, password) => c.req("POST", "/api/nfc/auth/login", { body: { user_id, password } });
    return c;
  }

  const admin = (method, path, opts = {}) => request(method, "/api/admin/nfc/" + path, { cookie: "cc_session=admin-token", ...opts });

  let counter = 0;
  /** Create a customer through the admin API and return { id, slug, userId, password }. */
  async function createCustomer(overrides = {}) {
    counter += 1;
    const body = {
      user_id: `customer${counter}`,
      password: "TempPass123x",
      full_name: `Customer ${counter}`,
      designation: "Founder",
      company_name: "Acme Ltd",
      phone: "01711000000",
      whatsapp: "01711000000",
      email: `c${counter}@example.com`,
      website: "example.com",
      theme_id: "minimal",
      social_links: [{ platform: "facebook", url: "https://facebook.com/acme" }],
      ...overrides,
    };
    const r = await admin("POST", "customers", { body });
    if (r.status !== 201) throw new Error("createCustomer failed: " + JSON.stringify(r.body));
    return { id: r.body.customer_id, slug: r.body.public_slug, userId: body.user_id, password: body.password, response: r.body };
  }

  /** Log in and complete the forced first-login password change. */
  async function activeClient(customer, newPassword = "NewSecret456y") {
    const c = client();
    await c.login(customer.userId, customer.password);
    const r = await c.req("POST", "/api/nfc/auth/change-password", { body: { current_password: customer.password, new_password: newPassword } });
    if (r.status !== 200) throw new Error("password change failed: " + JSON.stringify(r.body));
    customer.password = newPassword;
    return c;
  }

  return { db, state, request, client, admin, createCustomer, activeClient };
}

export async function tinyPng() {
  const { qrPng } = await import("../../server/nfc-platform/qr.mjs");
  return "data:image/png;base64," + qrPng("x", { scale: 1, margin: 1 }).toString("base64");
}
