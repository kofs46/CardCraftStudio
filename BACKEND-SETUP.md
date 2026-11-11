# CardCraft Studio BD backend setup

The site now requires its Node API and a configured Supabase project. Opening HTML directly or using VS Code Live Server alone does **not** run the backend. Existing demo orders in browser localStorage are not imported into the live database.

## 1. Create the Supabase database

Create your Supabase project. In its SQL Editor, run `supabase/schema.sql` once. This creates the catalog, orders, persistent rate limits, a durable artwork deletion queue, service-only transactional RPC functions, and two Storage buckets:

- `product-images`: public product pictures, max 2 MB each.
- `order-artwork`: private customer designs and portraits, max 2 MB each.

No anonymous or ordinary authenticated user can read/write the shop tables or execute the shop RPC functions. Only the API's server-side service-role key can do so. Do not add public Storage policies to `order-artwork`.

The first catalog API request initializes the three current products and your business contacts. Later restarts/deployments preserve edits and existing orders. The API uses optimistic revision checks plus a PostgreSQL transaction lock to prevent concurrent edits from silently overwriting each other. Orders also have a unique request UUID.

## 2. Create the admin account

In Supabase Authentication → Users, create an email/password user. Copy that user's UUID. Add it to `ADMIN_USER_IDS`. A valid Supabase user who is absent from that list cannot access admin operations. Multiple authorized UUIDs may be comma-separated. Do not use an email address in place of the UUID.

Use Supabase's admin tools to reset the password or disable an account. There is no public admin-registration endpoint. The app verifies the session with Supabase on every admin request. Sessions use an HttpOnly, SameSite=Strict cookie, last at most about one hour, and require a fresh login after expiry. HTTPS deployments also set Secure. Logging out clears this app's cookie; account-wide session revocation is managed in Supabase Auth.

## 3. Local setup

Install Node.js 22 or later. Copy `.env.example` to `.env` and fill in:

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | Your project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | The project's **legacy service_role JWT**, server only |
| `ADMIN_USER_IDS` | Approved Auth user UUID(s) |
| `UPLOAD_SIGNING_SECRET` | At least 32 random characters; generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `APP_ORIGIN` | `http://localhost:5175` locally; exact deployed HTTPS origin in production |
| `PORT` | Optional; defaults to 5175 |

Never put the service-role key or upload secret in HTML, browser JavaScript, a `VITE_`/`NEXT_PUBLIC_` variable, GitHub, or screenshots. This implementation uses the service-role JWT in both the API key and Authorization headers; use the specified legacy key rather than substituting a new-format secret key without adapting the REST client.

Run `npm start` (PowerShell: `npm.cmd start` if script execution is disabled). Open `http://localhost:5175` and `/admin.html`. Run `npm install` once (one small runtime dependency, `qrcode-generator`, for NFC QR codes); there is no build step. Run `npm test` / `npm.cmd test` for the automated suite.

## 4. Deploy to Vercel

Import the GitHub repository into Vercel. Use **Other** framework preset, leave the build command unset, and use the repository root as the output directory. Node functions are in `api/`; `vercel.json` maps `/api/*` to the handler. Set Node.js 22 or 24 in Vercel project settings.

Add the same five required environment variables in Vercel. Set `APP_ORIGIN` to the exact final domain, e.g. `https://your-project.vercel.app`, without any path. Redeploy after changing environment variables. If using a custom domain, make that the canonical origin and redirect the alternative domain. Cross-origin mutations fail intentionally. Set a separate exact `APP_ORIGIN` for a preview deployment if you intend to test forms there.

Local files, backups, the old SQLite backend and `.env` must not be deployed. The live implementation does not write to Vercel's filesystem. Database and file persistence are entirely in Supabase.

## Behavior and acceptance checks

1. Open the homepage: the current catalog, pricing, contacts and delivery rules load from the API.
2. Sign in with the approved admin. Verify that an incognito unauthenticated request to `/api/admin` returns 401.
3. Change a product's description, front/back images and prices. Reload another browser and check that the changes appear.
4. Place UV, NFC, and one-/two-side key-ring orders. Include both key-ring options in one order and test a private portrait upload. Verify customer details, variant prices, discounts and delivery.
5. In admin, open order details and download artwork. Change order status and check dashboard totals: completed sales exclude delivery, and pending/processing/printing totals exclude cancelled orders.
6. Retry a submission with the same request UUID and same details: it returns the existing order. Reusing the UUID for different details returns 409. The API ignores browser-supplied prices/totals and rejects hidden products.
7. Remove retained artwork. References are removed transactionally; storage deletion is queued durably and attempted after writes. A temporary Storage outage leaves deletion queued for a subsequent successful mutation. Previously issued private download URLs can remain valid for their ten-minute lifetime.
8. Sign out and confirm admin access is blocked. Customer orders are not available from the public catalog endpoint.

## Operational limits

NFC orders now collect the requested display name, business/contact details and optional social links. Design PDF/images are optional. Admin order details retain these instructions; automatic NFC encoding and hosted scan profiles are not implemented by this form.

New orders use short random `CC-XXXXXXXXXXXX` tracking codes. `track.html` accepts these and earlier UUID-based codes. The rate-limited `/api/track` endpoint returns only order ID, current status and placement date; it does not expose contact details or artwork. Existing database tables require no additional migration for these fields. Admin status cards use labeled colors and refresh every 30 seconds on visible dashboard/order pages when no search/status input is active. Customer order confirmation no longer waits for artwork cleanup; cleanup remains queued and is attempted after subsequent admin mutations.

- Order placement is **not payment processing**. Orders are saved as unpaid; the site does not verify bKash/Nagad or charge a card. Completed-order sales are sales totals, not bank balances or verified cash receipts.
- Uploads are sent separately, at most 2 MB per file, avoiding one large base64 order request. Files are signature checked and restricted to PNG/JPEG/WebP/PDF. This is type validation, not antivirus scanning.
- Customer upload receipts expire after 24 hours. Abandoned uploads and superseded product photos need periodic Storage review/cleanup; never delete artwork still referenced by a retained order. Automatic age-based deletion is not enabled.
- The current admin snapshot loads the complete order history to maintain accurate totals. A growing shop should add paginated order listing and database-side aggregates before history becomes large enough to approach Vercel response/time limits. This is a small-shop implementation, not an unbounded high-volume service.
- Configure Supabase backups suitable for your plan, verify restores, and monitor Vercel errors and Storage use. No backup/monitoring account has been provisioned by this code change.
- The automated tests use a mocked Supabase transport. Actual SQL migration, RLS permissions, Auth and Storage integration must be checked against your own project using the acceptance steps above before accepting real orders.

Reference documentation: [Supabase Auth user verification](https://supabase.com/docs/reference/javascript/auth-getuser), [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys), [Vercel function limits](https://vercel.com/docs/functions/limitations).
