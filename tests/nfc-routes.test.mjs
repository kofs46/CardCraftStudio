// Routing, deployment config, fail-closed behaviour and the five theme renderers.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer } from "../server/local.mjs";
import { THEMES, renderProfile, toView } from "../js/nfc/render.mjs";

test("local server serves NFC pages and ES modules; existing routes still work", async () => {
  const { server, url } = await startServer({ port: 0 });
  try {
    for (const page of ["/admin/nfc", "/nfc/login", "/nfc/dashboard", "/homepage", "/admin", "/order", "/tracking"]) {
      const r = await fetch(url + page);
      assert.equal(r.status, 200, page);
      assert.match(r.headers.get("content-type"), /text\/html/);
    }
    for (const mod of ["render", "admin", "dashboard", "login", "editor", "common", "profile-page", "analytics-view"]) {
      const r = await fetch(`${url}/js/nfc/${mod}.mjs`);
      assert.equal(r.status, 200, mod);
      assert.equal(r.headers.get("content-type"), "text/javascript");
    }
    for (const path of ["/server/nfc-platform/router.mjs", "/supabase/migrations/20261111000000_nfc_platform.sql", "/scripts/nfc-demo.mjs", "/tests/nfc-auth.test.mjs"])
      assert.equal((await fetch(url + path)).status, 404, path);
    // Without backend configuration the NFC API fails closed.
    const api = await fetch(url + "/api/nfc/auth/session");
    assert.equal(api.status, 503);
    const page = await fetch(url + "/p/someone-ab12");
    assert.ok([500, 503].includes(page.status));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("vercel.json routes NFC paths to the new function without touching existing routes", () => {
  const cfg = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const find = (source) => cfg.rewrites.find((r) => r.source === source)?.destination;
  assert.equal(find("/api/nfc/:path*"), "/api/nfc?scope=nfc&path=:path*");
  assert.equal(find("/api/admin/nfc/:path*"), "/api/nfc?scope=admin&path=:path*");
  assert.equal(find("/p/:id"), "/api/nfc?page=:id");
  assert.equal(find("/admin/nfc"), "/admin-nfc.html");
  assert.equal(find("/nfc/login"), "/nfc-login.html");
  assert.equal(find("/nfc/dashboard"), "/nfc-dashboard.html");
  assert.equal(find("/api/:route"), "/api/handler?route=:route");
  assert.ok(cfg.rewrites.findIndex((r) => r.source === "/api/admin/nfc/:path*") < cfg.rewrites.findIndex((r) => r.source === "/api/:route"));
  assert.ok(cfg.functions["api/nfc.mjs"]);
  assert.ok(cfg.functions["api/handler.mjs"]);
  const ignore = fs.readFileSync(new URL("../.vercelignore", import.meta.url), "utf8");
  for (const p of ["tests", "scripts"]) assert.match(ignore, new RegExp(`^${p}\r?$`, "m"));
});

test("router resolves both original and Vercel-rewritten URLs", async () => {
  const { resolveRoute } = await import("../server/nfc-platform/router.mjs");
  assert.deepEqual(pick(resolveRoute({ url: "/api/admin/nfc/customers/abc" })), { kind: "admin", path: "customers/abc" });
  assert.deepEqual(pick(resolveRoute({ url: "/api/nfc?scope=admin&path=customers/abc" })), { kind: "admin", path: "customers/abc" });
  assert.deepEqual(pick(resolveRoute({ url: "/api/nfc", query: { scope: "nfc", path: ["auth", "login"] } })), { kind: "nfc", path: "auth/login" });
  assert.deepEqual(pick(resolveRoute({ url: "/api/nfc?page=rahim-a7k2" })), { kind: "page", id: "rahim-a7k2" });
  assert.deepEqual(pick(resolveRoute({ url: "/p/rahim-a7k2" })), { kind: "page", id: "rahim-a7k2" });
});
const pick = ({ kind, path, id }) => (id ? { kind, id } : { kind, path });

test("NFC routes fail closed without NFC_SESSION_SECRET even when the shop is configured", async () => {
  Object.assign(process.env, { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k", ADMIN_USER_IDS: "a", UPLOAD_SIGNING_SECRET: "s".repeat(40), APP_ORIGIN: "http://localhost:5175" });
  delete process.env.NFC_SESSION_SECRET;
  const { nfcConfig } = await import("../server/nfc-platform/config.mjs");
  assert.throws(() => nfcConfig(), /NFC_SESSION_SECRET/);
  process.env.NFC_SESSION_SECRET = "short";
  assert.throws(() => nfcConfig(), /NFC_SESSION_SECRET/);
  process.env.NFC_SESSION_SECRET = "z".repeat(40);
  process.env.APP_ORIGIN = "https://cardcraftstudiobd.vercel.app";
  const { cookieName } = await import("../server/nfc-platform/sessions.mjs");
  assert.equal(cookieName(), "__Host-nfc_session", "HTTPS uses the __Host- prefix (Secure, Path=/, no Domain)");
});

const sample = {
  profile: {
    public_slug: "demo-ab12", full_name: "Demo Person", designation: "Founder", company_name: "Demo Co", business_category: "Design",
    tagline: "Tagline", biography: "Bio line 1\nline 2", phone: "01711000000", whatsapp: "01711000000", email: "d@example.com",
    website: "https://demo.example", address: "Dhaka", google_maps_url: "https://maps.google.com/?q=Dhaka", profile_photo_url: "https://cdn.example/p.webp",
    cover_image_url: "https://cdn.example/c.webp", company_logo_url: "https://cdn.example/l.webp",
  },
  social_links: [{ platform: "facebook", url: "https://facebook.com/demo" }, { platform: "linkedin", url: "https://linkedin.com/in/demo", is_visible: false }],
  services: [{ title: "Service", description: "Desc", external_url: "https://demo.example/s", image_url: "https://cdn.example/s.webp" }],
  custom_links: [{ title: "Portfolio", url: "https://demo.example/p", icon: "portfolio" }],
};

test("all twelve themes render every shared component with the same markup", () => {
  assert.deepEqual(THEMES.map((t) => t.key), ["luxury", "minimal", "corporate", "holographic", "purple",
    "executive", "emerald", "rosegold", "medical", "carbon", "marble", "sunset"]);
  assert.equal(new Set(THEMES.map((t) => t.name)).size, THEMES.length, "unique theme names");
  const css = fs.readFileSync(new URL("../css/nfc-themes.css", import.meta.url), "utf8");
  for (const t of THEMES) {
    const html = renderProfile(toView({ ...sample, profile: { ...sample.profile, theme_id: t.key } }, { profileUrl: (s) => "https://x/p/" + s }));
    assert.match(html, new RegExp(`class="nfcp nfcp--${t.key}"`));
    for (const part of ["nfcp-cover-img", "nfcp-avatar", "nfcp-logo", "nfcp-name", "nfcp-role", "nfcp-category", "nfcp-tagline", "nfcp-quick", "Save Contact", "data-share",
      "About", "Contact", "Social Media", "Services", "Portfolio &amp; Links", "Location", "Open in Google Maps", "nfcp-qr-img", "CardCraft Studio BD"])
      assert.ok(html.includes(part), `${t.key} missing ${part}`);
    assert.ok(!html.includes("linkedin.com/in/demo"), "hidden social link not rendered");
    assert.ok(css.includes(`.nfcp--${t.key} {`), `CSS for ${t.key}`);
  }
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("sticky contact bar: opt-in for existing profiles, shows Call/WhatsApp/Save when enabled", () => {
  const off = renderProfile(toView(sample, { profileUrl: (s) => "https://x/p/" + s }));
  assert.ok(!off.includes("nfcp-dock"), "absent by default for profiles without the setting");
  const on = renderProfile(toView({ ...sample, profile: { ...sample.profile, visibility_settings: { dock: true } } }, { profileUrl: (s) => "https://x/p/" + s }));
  const dock = on.slice(on.indexOf('<nav class="nfcp-dock"'));
  assert.match(dock, /href="tel:01711000000"/);
  assert.match(dock, /href="https:\/\/wa\.me\/8801711000000"/);
  assert.match(dock, /class="is-primary" href="\/api\/nfc\/public\/demo-ab12\/vcf"/);
  const noSave = renderProfile(toView({ ...sample, profile: { ...sample.profile, phone: "", whatsapp: "", visibility_settings: { dock: true, save_contact: false } } }));
  assert.ok(!noSave.includes("nfcp-dock"), "no empty bar when there is nothing to show");
  const css = fs.readFileSync(new URL("../css/nfc-themes.css", import.meta.url), "utf8");
  assert.match(css, /\.nfcp-dock \{\s*position: sticky;/);
  assert.match(css, /overflow: clip/);
});

test("empty sections are omitted and preview mode is inert", () => {
  const html = renderProfile(toView({ profile: { full_name: "Only Name", theme_id: "minimal" }, social_links: [], services: [], custom_links: [] }), { mode: "preview" });
  assert.match(html, /nfcp--preview/);
  for (const part of ["nfcp-quick", "Social Media", "Services", "Location", "nfcp-cover-img"]) assert.ok(!html.includes(part), part);
  assert.match(html, /nfcp-qr-placeholder/);
  assert.match(html, /aria-hidden="true">ON</);
});

test("password verification supports the scrypt fallback format and rejects tampering", async () => {
  const { scryptSync, randomBytes } = await import("node:crypto");
  const { verifyPassword, hashPassword, passwordProblem, generatePassword } = await import("../server/nfc-platform/passwords.mjs");
  const salt = randomBytes(16);
  const key = scryptSync("Fallback123pw", salt, 32, { N: 2 ** 10, r: 8, p: 1 });
  const b64 = (b) => b.toString("base64").replace(/=+$/, "");
  const stored = ["", "scrypt", "ln=10,r=8,p=1", b64(salt), b64(key)].join("$");
  assert.equal(await verifyPassword("Fallback123pw", stored), true);
  assert.equal(await verifyPassword("fallback123pw", stored), false);
  assert.equal(await verifyPassword("Fallback123pw", stored.replace("ln=10", "ln=30")), false, "absurd cost refused");
  assert.equal(await verifyPassword("x", "plaintext"), false);
  const h = await hashPassword("Primary123pw");
  assert.equal(await verifyPassword("Primary123pw", h), true);
  assert.equal(await verifyPassword("Primary123pw", h.slice(0, -2) + (h.endsWith("AA") ? "BB" : "AA")), false);
  for (let i = 0; i < 20; i++) assert.equal(passwordProblem(generatePassword()), "");
});
