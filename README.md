# CraftCard Studio BD

A Bangla card-printing website with a storefront, front/back card previews, order form, and admin demo interface.

## Run the demo

Open `index.html` in your browser, or open this folder in VS Code and use Live Server. No install or build step is needed. Use the same browser and origin for the storefront, orders, and admin pages.

| Page | Interface |
| --- | --- |
| `index.html` | Homepage, product catalog, search, and flipping card previews |
| `order-list.html` | Saved order list, quantities, removal, and checkout |
| `order.html` | Quantities, artwork selection, delivery, and demo order submission |
| `admin.html` | Product images, prices, orders, customers, and business settings |
| `about.html` | About the business |
| `privacy.html` | Privacy information |

On the admin page, select **Enter admin preview**. This is a browser-only demo: products, orders, artwork, and settings are stored in localStorage. It has no protected admin login, shared database, payment processing, or live order service. Use fictional customer details. Browser storage is separate for each browser/origin; clearing site data resets it.

## UI / UX screenshots

Screenshots of an earlier interface revision, before the current catalog and cart update. The admin screenshot shows the clean demo dashboard with no customer data. The current product lineup is listed below.

### Homepage — `index.html`

![Homepage UI with Bangla navigation, hero, service details and order actions](docs/screenshots/homepage.png)

### Admin panel — `admin.html`

![Admin dashboard UI with management navigation, statistics, filters and order table](docs/screenshots/admin-panel.png)

## Current catalog

| Product | Price |
| --- | --- |
| UV Smart Card | ৳100 |
| Premium NFC Card | ৳350 |
| Bike Key Ring | One side ৳250 / two sides ৳300 |

Bike Key Ring is one product with two print options in its details popup. At checkout it requires the bike brand, bike number in English, owner name in English, and phone number. The two-side option also supports an optional PNG/JPEG/WebP back photo up to 2 MB. Admin can edit both prices, descriptions, and front/back images, and view the personalization and photo in order details.

The product images are replaceable demo assets. The retired identity, driving, vaccination, and student-card products and their unused images are no longer included in the current catalog.

## Repository scope

This repository includes the current static frontend and the assets it uses. Local databases, orders, account data, backups, editor settings, unused earlier backend code, and unused images are excluded. Google Fonts loads externally when available; local fallback fonts remain usable offline.

Replace sample contact details, business information, and policy copy before using this as a live business website. Real authentication, order storage, secure artwork handling, and payment services require backend integration.


## Order list

Use **অর্ডার করুন** on a product to add it to the order list. For Bike Key Ring, choose the print side in its details popup and select **অর্ডারে যোগ করুন**. The header's **অর্ডার করুন** button shows the saved item count and opens `order-list.html`, where quantities can be changed and products removed. Continue to the address/details form to confirm the demo order. Both key-ring variants can be included, with separate personalization and an optional back photo for the two-side option. Storage and successful-order clearing behavior are preserved. The old `cart.html` URL redirects to the order list.


## Business logo

The supplied CraftCard Studio BD logo is used in the public header, footer, admin interface and browser icon. Its original artwork is preserved in `images/craftcard-studio-bd-logo.png`.
