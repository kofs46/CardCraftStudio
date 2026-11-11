// Server-rendered public profile page (/p/:id). Works without JavaScript; the small module script
// only adds share / copy / analytics. Strict CSP: no inline scripts or styles.
import { esc, fontHref, renderProfile, themeOf } from "../../js/nfc/render.mjs";

export const PAGE_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data: https:",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "script-src 'self'",
  "connect-src 'self'",
].join("; ");

export function profilePage(view, { origin }) {
  const theme = themeOf(view.theme);
  const title = view.company ? `${view.name} · ${view.company}` : view.name;
  const description = [view.designation, view.company, view.tagline].filter(Boolean).join(" — ") || `${view.name} — digital business card`;
  const image = view.photo || view.logo || `${origin}/images/cardcraft-studio-bd-logo.jpeg`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description.slice(0, 200))}">
<link rel="canonical" href="${esc(view.url)}">
<meta property="og:type" content="profile">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description.slice(0, 200))}">
<meta property="og:url" content="${esc(view.url)}">
<meta property="og:image" content="${esc(image)}">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="${esc(theme.color)}">
<meta name="robots" content="noindex">
<link rel="icon" type="image/jpeg" href="/images/cardcraft-studio-bd-logo.jpeg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${esc(fontHref(theme.key))}">
<link rel="stylesheet" href="/css/nfc-themes.css?v=1">
</head>
<body class="nfcp-page nfcp-page--${theme.key}">
<main id="main">${renderProfile(view, { mode: "public" })}</main>
<script type="module" src="/js/nfc/profile-page.mjs?v=1"></script>
</body>
</html>`;
}

export function statusPage(title, message) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · CardCraft Studio BD</title>
<meta name="robots" content="noindex">
<link rel="icon" type="image/jpeg" href="/images/cardcraft-studio-bd-logo.jpeg">
<link rel="stylesheet" href="/css/nfc-themes.css?v=1">
</head>
<body class="nfcp-page nfcp-status-page">
<main class="nfcp-status">
<img src="/images/cardcraft-studio-bd-logo.jpeg" alt="CardCraft Studio BD" width="84" height="84">
<h1>${esc(title)}</h1>
<p>${esc(message)}</p>
<a href="/homepage">Visit CardCraft Studio BD</a>
</main>
</body>
</html>`;
}
