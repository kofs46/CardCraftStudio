# NFC Digital Business Cards — Setup & Operations

This guide covers the NFC digital card platform added to CardCraft Studio BD: one-time setup, deployment, the daily card workflow, and live acceptance checks. The existing shop (catalog, orders, uploads, pricing, main admin) is unchanged. Its own setup stays in [BACKEND-SETUP.md](BACKEND-SETUP.md).

## What was added

| Address | Who | Purpose |
| --- | --- | --- |
| `/admin/nfc` | Admin (existing admin login) | NFC Management: stats, customers, 8-step creation wizard, card tracking, analytics |
| `/p/<id>` | Anyone, no login | Public digital profile written on the NFC card (e.g. `/p/rahim-a7k2`) |
| `/nfc/login` | Customer | Log in with User ID + password from you |
| `/nfc/dashboard` | Customer | Edit own profile, design, QR code, analytics, password |

The main admin sidebar has a new **NFC কার্ড ম্যানেজমেন্ট** link.

## 1. Supabase (one time)

1. Open Supabase → **SQL Editor** → New query.
2. Paste the whole of `supabase/migrations/20261111000000_nfc_platform.sql` and run it.
   - It only **adds** `nfc_*` tables, functions and the `nfc-profile-media` storage bucket. It does not read, alter or delete any existing `shop_*` table, order or file.
   - It is safe to run again; existing NFC data is kept.
3. Then run `supabase/migrations/20261112000000_nfc_more_themes.sql` the same way. It adds the seven extra premium themes. **Run it before deploying code that offers those themes**; otherwise saving one of them fails.
4. Run `supabase/migrations/20261125152314_nfc_more_contact_platforms.sql` for Viber, WeChat, Bdjobs and WhatsApp Business.
5. Run `supabase/migrations/20261126074113_nfc_imo_address_visiting_card.sql` for imo, Permanent Address and Visiting Card before deploying the corresponding code. On projects with the previous migrations in place, run only the new migration.
6. Check: **Table Editor** shows `nfc_customers`, `nfc_profiles`, and so on, and `nfc_themes` has 12 rows. **Storage** shows the public bucket `nfc-profile-media` (2 MB, PNG/JPEG/WebP only).
7. Do **not** add any policies to the NFC tables or to `nfc-profile-media`. Browsers never access them directly; only the server (with the service-role key) does.

> Run this against your real project only when you are ready. The migration is additive, but take a database backup first if your plan offers one.

## 2. Environment variables

There is one new variable. Everything else is reused from the shop.

| Variable | Status | Value |
| --- | --- | --- |
| `NFC_SESSION_SECRET` | **New, required** | 64 random hex characters, different from `UPLOAD_SIGNING_SECRET`. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_USER_IDS`, `UPLOAD_SIGNING_SECRET` | Existing | Unchanged |
| `APP_ORIGIN` | Existing | Must be the exact live origin, e.g. `https://cardcraftstudiobd.vercel.app`. Profile URLs and QR codes are built from it. |

Add `NFC_SESSION_SECRET` to `.env` locally and to Vercel → Project → Settings → Environment Variables (Production). Without it, the NFC pages return "setup incomplete" and the shop keeps working normally.

Never put secrets in HTML, browser JavaScript, GitHub or screenshots.

## 3. Try it locally

**Demo mode (no Supabase needed):**

```
npm install
npm run nfc:demo
```

Open `http://127.0.0.1:5199`. Data lives only in memory and disappears when you stop it.

- Admin: `/admin` → any email, password `demo-admin` → **NFC কার্ড ম্যানেজমেন্ট**
- Customer: `/nfc/login` → `demo.luxury` / `DemoPass2026` (you'll be asked to change it)
- Twelve sample profiles, one per theme, are printed in the terminal (e.g. `/p/executive-demo`).

## Themes

| Theme | Best for |
| --- | --- |
| Luxury Black & Gold | Jewellery, luxury goods, premium services |
| Minimal White | Designers, freelancers, anyone who wants clean and simple |
| Corporate Blue | Companies, sales teams, logistics |
| Holographic Premium | Agencies, events, futuristic brands |
| Modern Purple Gradient | Coaches, small businesses, app-style look |
| Executive Black | CEOs, lawyers, consultants (editorial layout, numbered sections) |
| Emerald Prestige | Finance, banking, real estate |
| Rose Gold Elegance | Beauty, bridal, fashion, boutiques (arch portrait) |
| Clinical Trust | Doctors, clinics, pharma (the category shows as a ✓ credential, e.g. "MBBS, FCPS") |
| Carbon Tech | Developers, IT companies, startups |
| Marble Luxe | Architects, interior designers, premium brands |
| Creative Sunset | Photographers, creators, influencers |

**Sticky contact bar:** an optional bar that keeps **Call · WhatsApp · Save** at the bottom of the screen while visitors scroll. It works with every theme. It is on by default for new customers, off for existing ones, and can be switched under *Contact information → Profile features*.

**Against your real Supabase:** add `NFC_SESSION_SECRET` to `.env`, run the migration (step 1), then `npm start` and open `http://localhost:5175/admin/nfc`.

**Automated tests:** `npm test`. There are 88 tests. The NFC tests run the real migration SQL inside an in-process PostgreSQL (PGlite).

## 4. Deploy to Vercel (only when you decide to)

1. Node.js: in Vercel → Settings → General, choose **Node.js 24.x**. Passwords then use Argon2id; Node 22 falls back to scrypt automatically. Don't switch back to Node 22 after customers exist, because Argon2id hashes need Node 24.7+.
2. Copy the project into `.deploy-repo` (your GitHub clone). Leave out `node_modules`, `.env`, `data`, `backups` and `.deploy-repo` itself. Commit and push. Vercel installs `qrcode-generator` from `package.json` and deploys `api/nfc.mjs` as a second function.
3. Add `NFC_SESSION_SECRET` in Vercel **before** that deploy, or redeploy after adding it.
4. Run the live acceptance checks below.

## 5. Daily workflow: a new NFC order from WhatsApp

1. Open `/admin/nfc` → **Create NFC Customer**.
2. Fill in the eight steps: basic info, contact, social media and links, images, theme, credentials, preview, create.
   - The User ID is not case-sensitive and must be unique. The wizard checks this live.
   - **Generate** creates a strong temporary password.
3. The handover screen shows the public URL, the login URL, the temporary password (**only this once**) and the QR code.
4. **Copy Public URL.** In an NFC writing app (e.g. NFC Tools), choose Write → Add record → **URL/URI**, paste, and write it to the card. Write only the URL, never the login details.
5. Tap the card with a phone and check the profile opens.
6. In the customer's **NFC card** tab, mark *NFC Programmed*, then *NFC Tested*, then *Dispatched* and *Delivered* as they happen. The system never marks these automatically.
7. Send the customer their login details privately. **Copy Customer Login Details** gives you a ready-to-send message.

Later edits by you or the customer appear on the same URL immediately. The card never needs rewriting.

Under **Social Media**, add a Viber number or business chat link, a WeChat ID or contact QR image, a public Bdjobs or CV link, and a WhatsApp Business number or short link. A Viber number can be copied into Viber's contact search. WhatsApp Business opens a chat using its own number or link. The individual **Visible** switches control which options appear on the public profile.

Add an **imo number** under **Social Media**. Visitors can copy the number and search for it in imo. **Permanent address** is in **Contact Information** and appears on the public profile only when its visibility switch is on. Under **Images & branding** (called **Photos & branding** in the customer dashboard), upload either or both sides of a **Visiting card**. Visitors can open each saved, visible side at full size.

### Forgot password (customer asks on WhatsApp)

Verify it's really them → customer → **Access & security** → **Reset password**. Their sessions are signed out, and they must set a new password at next login.

### Other admin actions

- **Suspend / Reactivate.** While suspended, the public page shows "temporarily unavailable" and the customer can't log in.
- **Customer editing on/off.** When off, the customer can view the dashboard but not change anything.
- **Change public URL (advanced).** The old URL keeps working as a permanent redirect.
- **Delete.** You must type the User ID to confirm. The URL then shows "no longer available" and is **never** given to another customer.

## 6. Live acceptance checklist

Run these on the deployed site after setup. Mark each as you go.

1. Log in at `/admin` → open **NFC কার্ড ম্যানেজমেন্ট**.
2. Create a test customer with all eight steps, including a photo upload. The handover screen appears.
3. Open the public URL in a private window on a phone: it loads without login, in the chosen theme.
4. Test Call, WhatsApp, Email, Website, **Save Contact** (opens your phone's contacts) and **Share**.
5. Download the QR PNG and scan it with a phone camera. The same profile opens.
6. Write the URL to a real NFC card, then tap it. Mark Programmed and Tested.
7. Log in at `/nfc/login` with the test User ID in UPPERCASE and the temporary password. You're forced to set a new password.
8. Change the tagline and the theme, then save. Reload the public URL: the changes show and the URL is the same.
9. Try a wrong password five times. You get a generic error, and after repeated attempts, "too many attempts".
10. Suspend the test customer. The public page shows unavailable and login is refused. Reactivate.
11. Reset the password. The old session is logged out and the new temporary password works.
12. Delete the test customer. Its URL shows "no longer available".
13. Confirm the existing shop still works: homepage, an order, the main admin dashboard and order downloads.
14. Unauthenticated check: open `/api/admin/nfc/customers` in a private window. It should return 401.

## 7. Security summary

- Passwords are stored as Argon2id hashes (scrypt fallback). Temporary passwords are shown only at creation or reset.
- The session cookie is HttpOnly, `SameSite=Lax`, and `Secure` with the `__Host-` prefix on HTTPS. Sessions last 7 days and end after 72 hours idle. Only a SHA-256 hash of each token is stored.
- Every customer change needs a CSRF token plus a same-origin check. Admin changes need the existing admin login plus a same-origin check.
- Login has generic errors and the same timing for unknown users, and is rate limited per IP and per User ID.
- The customer's identity always comes from the session, never from the request, so one customer cannot edit another.
- Uploads are checked for type, contents and dimensions, limited to 2 MB, and stored under random names. An upload only becomes public when the profile is saved, and each one is bound to its owner.
- Public pages escape all user content, allow only http/https/tel/mailto links, and use a strict Content-Security-Policy.
- Database: RLS is on for all NFC tables, `anon`/`authenticated` have no access, and every write is one transaction. Admin and customer changes are written to `nfc_audit_logs`.
- Analytics store only the event type and time: no IP address, device or visitor identity. A "profile view" can come from an NFC tap, a QR scan or a shared link, so views are not labelled as taps.

## 8. Known limits

- If an image is uploaded but the profile is never saved, the file stays in storage. Replaced and deleted images are cleaned up automatically. Review the bucket occasionally.
- Images are resized and compressed in the browser before upload. The server checks them but does not re-encode them or scan for viruses.
- Fonts load from Google Fonts, the same as the rest of the site.
- Supabase backups and monitoring depend on your plan; this code does not set them up.
