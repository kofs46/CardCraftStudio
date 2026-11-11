// LOCAL DEMO ONLY — runs the full site against an in-memory Postgres (PGlite) loaded with the real
// migration, plus in-memory "Storage". Nothing touches your Supabase project. Data is lost on exit.
//   npm run nfc:demo    →  http://127.0.0.1:5199
//   Admin login: any email + password "demo-admin"   ·   Sample customer: user "demo.luxury" / "DemoPass2026"
import { createServer } from "node:http";
import { createDb, supabaseFetch } from "../tests/helpers/nfc-db.mjs";

const PORT = Number(process.env.DEMO_PORT || 5199);
const ORIGIN = `http://127.0.0.1:${PORT}`;
Object.assign(process.env, {
  SUPABASE_URL: ORIGIN, // media URLs point back at this demo server
  SUPABASE_SERVICE_ROLE_KEY: "demo-only-key",
  ADMIN_USER_IDS: "admin-user",
  UPLOAD_SIGNING_SECRET: "demo-upload-secret-".repeat(3),
  NFC_SESSION_SECRET: "demo-session-secret-".repeat(3),
  APP_ORIGIN: ORIGIN,
  PORT: String(PORT),
});

const db = await createDb();
const state = {};
const files = new Map();
const base = supabaseFetch(db, state);
const realFetch = globalThis.fetch;

globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input);
  if (url.origin !== ORIGIN) return realFetch(input, options);
  const reply = (data, status = 200) => new Response(JSON.stringify(data), { status });
  // Existing shop API needs a few extra endpoints so the main admin dashboard also works in the demo.
  if (url.pathname === "/auth/v1/token")
    return JSON.parse(options.body).password === "demo-admin" ? reply({ access_token: "admin-token", user: { id: "admin-user" } }) : reply({}, 400);
  if (url.pathname === "/rest/v1/shop_state" && options.method === "POST") {
    await db.query("insert into shop_state(id, catalog) values (true, $1) on conflict do nothing", [JSON.stringify(JSON.parse(options.body).catalog)]);
    return reply(null, 201);
  }
  if (url.pathname === "/rest/v1/shop_state") {
    const r = await db.query("select catalog from shop_state where id = true");
    return reply(r.rows);
  }
  if (url.pathname.startsWith("/rest/v1/rpc/shop_")) {
    const name = url.pathname.split("/").pop();
    const args = JSON.parse(options.body || "{}");
    if (name === "shop_snapshot") return reply((await db.query("select public.shop_snapshot() as r")).rows[0].r);
    if (name === "shop_commit") return reply((await db.query("select public.shop_commit($1,$2) as r", [args.expected, JSON.stringify(args.next_state)])).rows[0].r);
  }
  if (url.pathname === "/rest/v1/shop_file_cleanup") return reply([]);
  if (url.pathname.startsWith("/storage/v1/object/nfc-profile-media/") && options.method === "POST")
    files.set(url.pathname.split("/nfc-profile-media/")[1], { type: options.headers["Content-Type"], bytes: Buffer.from(options.body) });
  return base(input, options);
};

const { startServer } = await import("../server/local.mjs");
const { hashPassword } = await import("../server/nfc-platform/passwords.mjs");
const { rpc } = await import("../tests/helpers/nfc-db.mjs");

// Fictional sample profiles — one per theme.
const samples = [
  ["luxury", "Arif Rahman", "Managing Director", "Rahman Jewellers", "Jewellery & Luxury Goods", "Crafted elegance since 1998"],
  ["minimal", "Nadia Islam", "Product Designer", "Studio Nadia", "Design Studio", "Simple things, done beautifully"],
  ["corporate", "Tanvir Ahmed", "Head of Sales", "Delta Logistics Ltd", "Logistics", "Moving Bangladesh forward"],
  ["holographic", "Samira Chowdhury", "Creative Technologist", "Neon Pixel Lab", "Digital Agency", "Future-ready brand experiences"],
  ["purple", "Fahim Hasan", "Fitness Coach", "FitLife Dhaka", "Health & Fitness", "Stronger every day"],
  ["executive", "Imran Kabir", "Senior Partner", "Kabir & Associates", "Legal Services", "Counsel you can rely on"],
  ["emerald", "Laila Haque", "Investment Director", "Greenfield Capital", "Finance", "Growing wealth, responsibly"],
  ["rosegold", "Mehjabin Sultana", "Founder & Stylist", "Blush Bridal Studio", "Beauty & Bridal", "Every bride deserves to shine"],
  ["medical", "Dr. Rafiq Hossain", "Consultant Cardiologist", "Dhaka Heart Clinic", "MBBS, FCPS (Cardiology)", "Caring for every heartbeat"],
  ["carbon", "Shakib Alam", "Full-Stack Engineer", "ByteForge Labs", "Software Development", "Building products people love"],
  ["marble", "Ayesha Rahman", "Principal Architect", "Studio Form & Light", "Architecture & Interiors", "Spaces with soul"],
  ["sunset", "Tania Akter", "Photographer & Creator", "Golden Hour Media", "Photography", "Capturing your best moments"],
];
const hash = await hashPassword("DemoPass2026");
for (const [i, [theme, name, title, company, category, tagline]] of samples.entries()) {
  const slug = `${theme}-demo`;
  await rpc(db, "nfc_admin_create", {
    customer: { user_id: `demo.${theme}`, password_hash: hash },
    profile: {
      immutable_public_id: `demoprof${String(i + 1).padStart(4, "0")}`, public_slug: slug, full_name: name, designation: title, company_name: company,
      business_category: category, tagline, theme_id: theme,
      biography: `${name} leads ${company}. This is a fictional sample profile created for the local demo.\nTap the buttons below to try calling, WhatsApp, saving the contact or sharing.`,
      phone: "01700000000", whatsapp: "01700000000", email: `hello@${company.toLowerCase().replace(/[^a-z]/g, "")}.example`,
      website: "https://example.com/", address: "House 12, Road 5\nDhanmondi, Dhaka 1205", google_maps_url: "https://maps.google.com/?q=Dhanmondi+Dhaka",
      visibility_settings: { dock: true },
    },
    social_links: [
      { platform: "facebook", url: "https://facebook.com/example" }, { platform: "instagram", url: "https://instagram.com/example" },
      { platform: "linkedin", url: "https://linkedin.com/in/example" }, { platform: "youtube", url: "https://youtube.com/@example" },
    ],
    services: [
      { title: "Consultation", description: "One-to-one session to understand your needs." },
      { title: "Custom Orders", description: "Tailored work delivered across Bangladesh.", external_url: "https://example.com/" },
    ],
    custom_links: [{ title: "Portfolio", url: "https://example.com/portfolio", icon: "portfolio" }, { title: "Price list (PDF)", url: "https://example.com/prices.pdf", icon: "document" }],
    actor_id: "demo-seed",
  });
}

const { server } = await startServer({ port: PORT });
// Serve demo "Storage" objects (public media) from memory.
const listeners = server.listeners("request");
server.removeAllListeners("request");
server.on("request", (req, res) => {
  const m = /^\/storage\/v1\/object\/public\/nfc-profile-media\/(media\/[a-f0-9-]+\.(?:png|jpg|webp))$/.exec(req.url);
  if (m && files.has(m[1])) {
    const f = files.get(m[1]);
    res.writeHead(200, { "Content-Type": f.type, "Cache-Control": "max-age=3600" }).end(f.bytes);
    return;
  }
  for (const l of listeners) l.call(server, req, res);
});

console.log(`\nCardCraft NFC demo running at ${ORIGIN}  (in-memory data; nothing is saved)\n`);
console.log(`  Admin:     ${ORIGIN}/admin  → any email, password "demo-admin" → then ${ORIGIN}/admin/nfc`);
console.log(`  Customer:  ${ORIGIN}/nfc/login  → demo.luxury / DemoPass2026 (asked to change it)`);
for (const [i, [theme, name]] of samples.entries()) console.log(`  ${theme.padEnd(12)} ${ORIGIN}/p/${theme}-demo`);
