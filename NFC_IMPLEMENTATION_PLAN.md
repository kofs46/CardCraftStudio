# NFC Digital Business Card Platform — Implementation Plan

Status legend: `[x]` done and verified locally · `[ ]` pending · `[~]` needs your Supabase/Vercel action.

## 1. What exists today (inspection, 2026-11-11)

| Area | Finding | Consequence for NFC work |
| --- | --- | --- |
| Frontend | Plain HTML + one large `js/main.js` + `css/style.css`. Bangla UI, teal `#0f766e` brand. | Keep vanilla HTML/CSS/ES modules. No framework migration. |
| Backend | One Vercel Node function `api/handler.mjs` → `server/handler.mjs`; `/api/:route` rewrite. Zero npm runtime deps. | Add a **second** function `api/nfc.mjs` so the existing shop handler is untouched. |
| Database | Supabase via PostgREST using the server-only service-role key. Transactional logic in `security definer` RPCs. RLS on, anon/authenticated revoked. | Same pattern: every NFC write is a single PL/pgSQL RPC (`fn(p jsonb) returns jsonb`) = one transaction. |
| Admin auth | Supabase Auth email/password + `ADMIN_USER_IDS` allowlist, HttpOnly `cc_session` (SameSite=Strict). | Reused unchanged for `/admin/nfc` and `/api/admin/nfc/*`. Extracted into `server/guards.mjs`. |
| Rate limits | `shop_limit` RPC (persistent, hashed key). | Reused for login, uploads, analytics events. |
| Storage | `product-images` (public), `order-artwork` (private), 2 MB, magic-byte checks in `server/files.mjs`. | New public bucket `nfc-profile-media` (images only); reuse `decodeFile`. |
| Tests | `node --test`, Supabase REST mocked. 24 passing. | NFC tests run the **real migration SQL** in PGlite (in-process Postgres) behind a PostgREST-shaped fetch shim. |
| Git | Working folder is not a repo; `.deploy-repo/` is the GitHub clone (`kofs46/CardCraftStudio`) with identical content. | Work happens in the working folder. `.deploy-repo` is left untouched — sync it when you choose to deploy. |

## 2. Architecture

```
Browser ──/p/:slug────────────► api/nfc.mjs ─► server/nfc-platform/router.mjs ─► page.mjs (SSR, same renderer as preview)
        ──/api/nfc/*──────────►      │                                          ├► auth.mjs   (customer sessions, CSRF)
        ──/api/admin/nfc/*────►      │                                          ├► admin.mjs  (requires existing admin login)
        ──/nfc/login, /nfc/dashboard, /admin/nfc (static HTML + ES modules)     └► db.mjs ─► Supabase RPC / Storage
```

* **One renderer, three places.** `js/nfc/render.mjs` is an isomorphic ES module (pure string templates, escaping built in). The server imports it to render public profiles; the admin wizard and customer dashboard import the same file for live preview (sandboxed `iframe srcdoc`, scripts disabled).
* **Public pages are server-rendered** — full profile HTML in one response, no JS required to read it, correct Open Graph tags for WhatsApp link previews, `Cache-Control: no-cache` so saved edits appear immediately.
* **Customer auth is custom** (Supabase Auth cannot do arbitrary user IDs without fake emails): Argon2id via `node:crypto` (scrypt fallback on runtimes without it), 256-bit random session tokens, only SHA-256 token hashes stored, HttpOnly + SameSite=Lax + Secure (`__Host-` prefix on HTTPS), HMAC-derived CSRF token required on every mutation plus strict `Origin` check, generic login errors, constant-work login for unknown users, per-IP and per-user-ID rate limits.
* **Permanent URLs.** `public_slug` (`rahim-a7k2`) for the card, plus a 12-char `immutable_public_id`. Both are written to `nfc_reserved_public_ids` (primary key) so no identifier can ever be reissued — even after deletion. Old slugs and immutable IDs 301-redirect to the current slug. Deleted profiles return 410.
* **Uploads never publish early.** Upload returns an HMAC-signed, expiring receipt bound to its owner (`admin` or a specific profile). A receipt only becomes the profile image when the profile is saved. Replaced/removed files go to a durable cleanup queue.

## 3. Database (migration `supabase/migrations/20261111000000_nfc_platform.sql`)

Tables: `nfc_themes`, `nfc_customers`, `nfc_profiles`, `nfc_social_links`, `nfc_services`, `nfc_custom_links`, `nfc_cards`, `nfc_card_status_history`, `nfc_sessions`, `nfc_profile_views`, `nfc_audit_logs`, plus `nfc_reserved_public_ids` (URL permanence) and `nfc_file_cleanup` (storage deletion queue).

Controls: FKs with cascade/set-null, `unique(lower(user_id))`, check constraints on every status/format, indexes for list/search/analytics, RLS enabled on all tables with **no** policies, all privileges revoked from `anon`/`authenticated`, RPC `execute` granted only to `service_role`. Purely additive — no existing table is altered.

## 4. Checklist

### Phase 1 — Schema
- [x] Migration with tables, constraints, indexes, RLS, grants, theme seed, storage bucket
- [x] Transactional RPCs: create, list, stats, get, save, status, password, card status, delete, login lookup, sessions, public lookup, events, analytics, cleanup
- [x] Migration executes cleanly on Postgres (PGlite) in tests
- [~] Run migration in your Supabase SQL editor

### Phase 2 — Authentication
- [x] Argon2id hashing, password policy, secure generator
- [x] Session create/validate/expire (7-day absolute, 72-hour idle), revoke, logout-all
- [x] CSRF token + Origin check, login rate limiting, generic errors
- [x] Forced first-login password change; admin reset revokes sessions

### Phase 3–4 — Themes and public page
- [x] Five themes: Luxury Black & Gold, Minimal White, Corporate Blue, Holographic Premium, Modern Purple Gradient
- [x] All shared components (cover, photo, logo, contact, socials, services, portfolio, map, save contact, share, QR, footer)
- [x] SSR `/p/:id`, visibility filtering, redirects, 404/410, reduced-motion support

### Phase 5–8 — Admin and customer apps
- [x] `/admin/nfc`: stats, searchable/sortable/paginated table, all actions with confirmations
- [x] 8-step creation wizard with crop/resize, password generator, live preview, handover screen
- [x] `/nfc/login` and `/nfc/dashboard` (10 sections, unsaved-changes guard, live preview)

### Phase 9–11 — QR, vCard, card tracking, analytics
- [x] QR SVG/PNG (server-generated), vCard 3.0 with escaping and folding
- [x] Card status workflow with timestamps and history (never automatic)
- [x] Privacy-conscious analytics (no IP/UA stored, "profile views" not "taps")

### Phase 12–14 — Hardening, tests, deployment prep
- [x] CSP on NFC pages, output escaping, URL scheme allowlist, IDOR protection (customer ID always from session)
- [x] Automated tests (auth, authorization, profiles, QR, vCard, storage, workflow)
- [x] `.env.example`, `vercel.json` rewrites, setup documentation
- [~] Set `NFC_SESSION_SECRET` in Vercel, deploy with your authorization, run the live acceptance checks

## 5. Verification results (2026-11-11)

- `npm test`: **88/88 pass**: the 24 original shop tests (unchanged) plus 64 NFC tests (auth 12, authorization 11, profiles 11, QR/vCard 7, storage 8, workflow 8, routing/themes/passwords 7).
- NFC tests run the real migration in PGlite (Postgres 17 in-process). The migration also re-runs idempotently.
- Browser end-to-end in Microsoft Edge against `npm run nfc:demo`: admin login → NFC Management → 8-step wizard → handover → card status; customer login (case-insensitive) → forced password change → edit and theme change → public page updated at the same URL; image crop/upload/save; GIF rejected; no horizontal overflow at 390 px on any theme or admin list.
- Bugs found and fixed during verification: an over-specific `.nfcp a` colour rule (invisible button text in Minimal); stretched avatars in the admin overview; mobile save-bar clipping; the scrypt fallback hash had a wrong part count, so verification would have failed on Node 22. A regression test now covers it.
- `npm audit --omit=dev`: 0 vulnerabilities. One runtime dependency: `qrcode-generator@2.0.4` (MIT, no transitive deps).

## 6. Remaining manual steps (cannot be done from this machine)

1. Run the migration SQL in Supabase (SQL Editor) — creates tables and the `nfc-profile-media` bucket.
2. Add `NFC_SESSION_SECRET` to `.env` and to Vercel.
3. Copy the working folder into `.deploy-repo`, commit, push → Vercel deploys (only after you authorise).
4. Execute the acceptance checklist in `NFC-SETUP.md` against the live project.
