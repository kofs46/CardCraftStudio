# CardCraft Studio BD

Bangla storefront and protected admin dashboard for UV Smart Cards (৳100), Premium NFC Cards (৳350), and Bike Key Rings (one side ৳250 / two sides ৳300).

The frontend is connected to a Node API, Supabase Auth, PostgreSQL and Storage. Deployment is prepared for Vercel. Orders, products, prices, discounts, delivery rules, categories, combos and business settings are shared across browsers. Only the saved shopping list remains in browser localStorage.

**Start here: [Backend and deployment setup](BACKEND-SETUP.md).** Configure Supabase and server environment variables before running. Opening HTML or using Live Server alone is insufficient.

**NFC digital business cards:** admin-created customer profiles at permanent `/p/<id>` URLs, five premium themes, customer self-service at `/nfc/dashboard`. See **[NFC setup & operations](NFC-SETUP.md)**. Try it without Supabase: `npm install && npm run nfc:demo`.

## Local development

1. Run `supabase/schema.sql` in Supabase SQL Editor.
2. Create the approved admin Auth user and fill `.env` using `.env.example`.
3. Run `npm start` and open `http://localhost:5175`.
4. Run `npm test` for API, authorization, pricing, uploads and concurrency tests.

On Windows PowerShell, use `npm.cmd` if `npm.ps1` is blocked. Node.js 22+ is required (24.x recommended). Run `npm install` once: the only runtime dependency is `qrcode-generator` (NFC QR codes); PGlite and jsQR are test-only.

## Pages

| Page | Purpose |
| --- | --- |
| `index.html` | Catalog, search, card flip previews and product selection |
| `order-list.html` | Saved product options and quantities |
| `order.html` | Customer address, key-ring personalization, files and submission |
| `admin.html` | Protected login, sales/status dashboard and management sidebar |
| `about.html`, `privacy.html` | Business and privacy details |

The corrected logo is `images/cardcraft-studio-bd-logo.jpeg`. Public headers retain the small sample card icon and Bengali name. Original logo artwork remains in footers, admin login and browser icons.

## Validation and limits

The server calculates prices, discounts and delivery. Repeated order UUIDs are idempotent; changed details with the same UUID are rejected. Admin sessions require an allowlisted Supabase Auth UUID. Customer artwork is private, with temporary admin download links. Mutations are committed transactionally using revision checks; file removal uses a durable cleanup queue.

Payments are not processed or verified. Completed sales exclude delivery and do not represent a bank balance. Existing browser demo orders are not silently imported. See the setup guide for required live acceptance checks, storage housekeeping, backups and current small-shop scaling limits.

Tests use a mocked Supabase API transport; SQL was also checked locally with PostgreSQL-compatible PGlite for migration, transactions, cleanup queue and permissions. Actual project integration still requires your Supabase configuration.

## Interface previews

These screenshots show an earlier UI revision, not the current sidebar dashboard:

![Homepage](docs/screenshots/homepage.png)
![Earlier admin interface](docs/screenshots/admin-panel.png)
