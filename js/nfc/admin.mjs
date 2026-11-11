// /admin/nfc — NFC Management module. Uses the existing admin login (cc_session cookie); every
// request is re-authorised by the server, this file only renders.
import { api, toast, confirmDialog, copyText, generatePassword, passwordProblem, debounce, fmtDate, fmtNum, CARD_STATUS, esc } from "./common.mjs";
import { THEMES, themeOf, icon, initials } from "./render.mjs";
import { emptyDraft, draftFromRecord, draftToPayload, draftToView, cloneDraft, isDirty, sectionHtml, bindEditor, mountPreview, validateDraft } from "./editor.mjs";
import { customerAnalyticsHtml, statTile } from "./analytics-view.mjs";

const A = "/api/admin/nfc/";
const app = document.getElementById("app");
const listState = { q: "", profile_status: "", card_status: "", sort: "created_at", dir: "desc", pg: 1 };
let dirtyCheck = null; // returns true when the current screen has unsaved changes
let wizard = null;

const upload = (kind, data) => api(A + "uploads", { method: "POST", body: { kind, data } });
const badge = (text, tone) => `<span class="nfc-badge nfc-badge--${tone}">${esc(text)}</span>`;
const statusBadge = (s) => badge(s === "active" ? "Active" : "Suspended", s === "active" ? "green" : "red");
const cardBadge = (s) => badge(CARD_STATUS[s] || s, { profile_created: "grey", ready_for_programming: "amber", programmed: "blue", tested: "indigo", dispatched: "purple", delivered: "green" }[s] || "grey");
const qrUrl = (id, format = "svg", download = false) => `${A}customers/${id}/qr?format=${format}${download ? "&download=1" : ""}`;
const avatar = (url, name, size = "") => `<span class="nfc-avatar ${size}">${url ? `<img src="${esc(url)}" alt="">` : esc(initials(name))}</span>`;

// ------------------------------------------------------------------ navigation
function go(query, push = true) {
  if (dirtyCheck?.() && !window.confirm("You have unsaved changes. Leave this page and discard them?")) return;
  dirtyCheck = null;
  const url = new URL(location.href);
  url.search = new URLSearchParams(query).toString();
  if (push) history.pushState(null, "", url.pathname + url.search);
  route();
}
window.addEventListener("popstate", () => { dirtyCheck = null; route(); });
window.addEventListener("beforeunload", (e) => { if (dirtyCheck?.()) { e.preventDefault(); e.returnValue = ""; } });
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-nav]");
  if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  go(Object.fromEntries(new URL(a.href, location.href).searchParams));
});

const NAV = [["overview", "Overview", "qr"], ["customers", "Customers", "save"], ["create", "Create NFC Customer", "save"], ["analytics", "Analytics", "website"]];
function shell(active, title, subtitle, content, actions = "") {
  app.innerHTML = `<div class="nfca">
  <aside class="nfca-side"><a class="nfca-brand" href="/admin?view=dashboard"><img src="/images/cardcraft-studio-bd-logo.jpeg" alt="" width="40" height="40"><span><strong>CardCraft Studio BD</strong><small>NFC Management</small></span></a>
    <nav class="nfca-nav" aria-label="NFC management">${NAV.map(([v, label]) => `<a data-nav href="?view=${v}" class="${active === v ? "is-active" : ""}" ${active === v ? 'aria-current="page"' : ""}>${label}</a>`).join("")}</nav>
    <div class="nfca-side__foot"><a href="/admin?view=dashboard">← Main admin dashboard</a><a href="/homepage" target="_blank" rel="noopener">View website</a></div></aside>
  <main class="nfca-main" id="main" tabindex="-1"><header class="nfca-top"><div><h1>${title}</h1>${subtitle ? `<p>${subtitle}</p>` : ""}</div><div class="nfca-top__actions">${actions}</div></header>
  <div class="nfca-content">${content}</div></main></div>`;
}
const loading = (active, title) => shell(active, title, "", '<div class="nfc-loading" role="status">Loading…</div>');

async function route() {
  const q = new URLSearchParams(location.search);
  const view = q.get("view") || "overview";
  try {
    if (view === "customers") await customersView();
    else if (view === "create") createView();
    else if (view === "customer" && q.get("id")) await customerView(q.get("id"), q.get("tab") || "overview");
    else if (view === "analytics") await analyticsView();
    else await overviewView();
    document.getElementById("main")?.focus({ preventScroll: true });
  } catch (error) {
    if (error.status === 401 || error.status === 403) return signInRequired(error.status);
    shell(view, "Something went wrong", "", `<div class="nfc-panel"><p>${esc(error.message)}</p><button class="nfc-btn nfc-btn--primary" data-retry>Retry</button></div>`);
    app.querySelector("[data-retry]").onclick = route;
  }
}

function signInRequired(status) {
  app.innerHTML = `<main class="nfc-auth-wall"><div class="nfc-card-box"><img src="/images/cardcraft-studio-bd-logo.jpeg" alt="CardCraft Studio BD" width="72" height="72">
    <h1>${status === 403 ? "Admin access required" : "Please sign in"}</h1><p>NFC Management uses the main admin login.</p>
    <a class="nfc-btn nfc-btn--primary" href="/admin">Go to admin login</a></div></main>`;
}

// ------------------------------------------------------------------ overview
async function overviewView() {
  loading("overview", "NFC Management");
  const s = await api(A + "analytics");
  const tiles = [
    ["Total NFC customers", s.total_customers], ["Active profiles", s.active_profiles, "", "green"], ["Suspended profiles", s.suspended_profiles, "", s.suspended_profiles ? "red" : ""],
    ["Awaiting NFC programming", s.awaiting_programming, "Created or ready to program", s.awaiting_programming ? "amber" : ""], ["NFC cards programmed", s.cards_programmed],
    ["NFC cards tested", s.cards_tested], ["NFC cards delivered", s.cards_delivered, "", "green"], ["Total profile views", fmtNum(s.total_views), `${fmtNum(s.views_30d)} in last 30 days`],
    ["Recent profile updates", s.updates_7d, "Profiles updated in 7 days"],
  ];
  shell("overview", "NFC Management", "Create customer profiles, program cards and track delivery.",
    `<div class="nfc-stats">${tiles.map(([l, v, h, t]) => statTile(l, fmtNum(v), h, t)).join("")}</div>
    <div class="nfc-two">
      <section class="nfc-panel"><div class="nfc-panel__head"><h2>Recent profile updates</h2><a data-nav href="?view=customers&sort=updated_at">View all</a></div>
        ${s.recent_updates.length ? `<ul class="nfc-people">${s.recent_updates.map((r) => `<li><a data-nav href="?view=customer&id=${r.customer_id}">${avatar("", r.full_name, "nfc-avatar--sm")}<span><strong>${esc(r.full_name)}</strong><small>/p/${esc(r.public_slug)}</small></span><time>${esc(fmtDate(r.updated_at))}</time>${r.last_actor === "customer" ? badge("by customer", "blue") : ""}</a></li>`).join("")}</ul>` : '<p class="nfc-empty">No customers yet. <a data-nav href="?view=create">Create the first one.</a></p>'}</section>
      <section class="nfc-panel"><div class="nfc-panel__head"><h2>Most viewed profiles</h2></div>
        ${s.most_viewed.length ? `<ol class="nfc-people nfc-people--ranked">${s.most_viewed.map((r) => `<li><a data-nav href="?view=customer&id=${r.customer_id}"><span><strong>${esc(r.full_name)}</strong><small>/p/${esc(r.public_slug)}</small></span><b>${fmtNum(r.views)} views</b></a></li>`).join("")}</ol>` : '<p class="nfc-empty">No profile views yet.</p>'}</section>
    </div>
    <section class="nfc-panel"><div class="nfc-panel__head"><h2>Recent activity</h2></div>${activityList(s.recent_activity)}</section>`,
    '<a data-nav href="?view=create" class="nfc-btn nfc-btn--primary">+ Create NFC Customer</a>');
}

const ACTIONS = {
  "customer.create": "Customer created", "customer.delete": "Customer deleted", "profile.update": "Profile updated", "profile.suspend": "Profile suspended",
  "profile.reactivate": "Profile reactivated", "password.reset": "Password reset by admin", "password.change": "Password changed by customer",
  "card.status": "Card status changed", "auth.login": "Customer logged in",
};
function activityList(items = []) {
  if (!items.length) return '<p class="nfc-empty">No activity yet.</p>';
  return `<ul class="nfc-timeline">${items.map((a) => {
    const s = a.safe_change_summary || {};
    const extra = a.action === "card.status" ? `${CARD_STATUS[s.from] || s.from} → ${CARD_STATUS[s.to] || s.to}`
      : a.action === "profile.update" ? [...(s.fields || []), ...(s.collections || [])].map((f) => f.replace(/_/g, " ")).join(", ")
      : a.action === "customer.delete" ? `User ID ${s.user_id}` : "";
    return `<li><span><strong>${esc(ACTIONS[a.action] || a.action)}</strong>${a.full_name ? ` · ${esc(a.full_name)}` : ""}${extra ? `<small>${esc(extra)}</small>` : ""}</span><span class="nfc-timeline__meta">${badge(a.actor_type, a.actor_type === "admin" ? "grey" : "blue")}<time>${esc(fmtDate(a.created_at))}</time></span></li>`;
  }).join("")}</ul>`;
}

// ------------------------------------------------------------------ customers table
async function customersView() {
  const q = new URLSearchParams(location.search);
  for (const k of ["sort", "card_status", "profile_status"]) if (q.get(k)) listState[k] = q.get(k);
  shell("customers", "Customers", "Search, filter and manage NFC customer profiles.",
    `<div class="nfc-toolbar">
      <label class="nfc-search"><span class="nfc-sr">Search customers</span><input type="search" id="q" placeholder="Search name, User ID, company, phone or URL" value="${esc(listState.q)}"></label>
      <label><span class="nfc-sr">Profile status</span><select id="ps"><option value="">All profiles</option><option value="active">Active</option><option value="suspended">Suspended</option></select></label>
      <label><span class="nfc-sr">Card status</span><select id="cs"><option value="">All card statuses</option><option value="awaiting">Awaiting programming</option>${Object.entries(CARD_STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
    </div><div id="table" aria-live="polite"><div class="nfc-loading">Loading…</div></div>`,
    '<a data-nav href="?view=create" class="nfc-btn nfc-btn--primary">+ Create NFC Customer</a>');
  app.querySelector("#ps").value = listState.profile_status;
  app.querySelector("#cs").value = listState.card_status;
  app.querySelector("#q").addEventListener("input", debounce((e) => { listState.q = e.target.value; listState.pg = 1; loadTable(); }, 300));
  app.querySelector("#ps").onchange = (e) => { listState.profile_status = e.target.value; listState.pg = 1; loadTable(); };
  app.querySelector("#cs").onchange = (e) => { listState.card_status = e.target.value; listState.pg = 1; loadTable(); };
  await loadTable();
}

async function loadTable() {
  const box = app.querySelector("#table");
  if (!box) return;
  const data = await api(A + "customers?" + new URLSearchParams({ ...listState, per: 15 }));
  const pages = Math.max(1, Math.ceil(data.total / data.per));
  const th = (key, label) => {
    const on = listState.sort === key;
    return `<th scope="col" aria-sort="${on ? (listState.dir === "asc" ? "ascending" : "descending") : "none"}"><button class="nfc-sort${on ? " is-on" : ""}" data-sort="${key}">${label}${on ? (listState.dir === "asc" ? " ↑" : " ↓") : ""}</button></th>`;
  };
  box.innerHTML = data.rows.length ? `<div class="nfc-table-wrap"><table class="nfc-table">
    <thead><tr>${th("full_name", "Customer")}${th("user_id", "User ID")}${th("company_name", "Company")}${th("theme_id", "Theme")}<th scope="col">Public URL</th>${th("profile_status", "Profile")}${th("card_status", "NFC card")}${th("created_at", "Created")}<th scope="col"><span class="nfc-sr">Actions</span></th></tr></thead>
    <tbody>${data.rows.map((r) => `<tr>
      <td data-label="Customer"><a data-nav href="?view=customer&id=${r.customer_id}" class="nfc-person">${avatar(r.photo_url, r.full_name, "nfc-avatar--sm")}<strong>${esc(r.full_name)}</strong></a></td>
      <td data-label="User ID"><code>${esc(r.user_id)}</code></td>
      <td data-label="Company">${esc(r.company_name || "—")}</td>
      <td data-label="Theme">${esc(themeOf(r.theme_id).name)}</td>
      <td data-label="URL"><span class="nfc-url-cell"><a href="${esc(r.profile_url)}" target="_blank" rel="noopener">/p/${esc(r.public_slug)}</a><button class="nfc-icon-btn" data-copy="${esc(r.profile_url)}" aria-label="Copy URL for ${esc(r.full_name)}">${icon("copy")}</button></span></td>
      <td data-label="Profile">${statusBadge(r.profile_status)}</td>
      <td data-label="NFC card">${cardBadge(r.card_status)}</td>
      <td data-label="Created">${esc(fmtDate(r.created_at, false))}</td>
      <td class="nfc-actions-cell"><details class="nfc-menu"><summary class="nfc-btn nfc-btn--sm nfc-btn--ghost">Actions</summary><div class="nfc-menu__list">
        <a data-nav href="?view=customer&id=${r.customer_id}">View customer</a>
        <a data-nav href="?view=customer&id=${r.customer_id}&tab=edit">Edit profile</a>
        <a href="${esc(r.profile_url)}" target="_blank" rel="noopener">Preview public profile</a>
        <button data-copy="${esc(r.profile_url)}">Copy profile URL</button>
        <a href="${qrUrl(r.customer_id, "png", true)}" download>Download QR (PNG)</a>
        <a data-nav href="?view=customer&id=${r.customer_id}&tab=card">Update card status</a>
        <a data-nav href="?view=customer&id=${r.customer_id}&tab=security">Reset password</a>
        ${r.profile_status === "active" ? `<button data-suspend="${r.customer_id}" data-name="${esc(r.full_name)}">Suspend profile</button>` : `<button data-reactivate="${r.customer_id}" data-name="${esc(r.full_name)}">Reactivate profile</button>`}
        <button class="is-danger" data-delete="${r.customer_id}" data-user="${esc(r.user_id)}" data-name="${esc(r.full_name)}">Delete profile</button>
      </div></details></td></tr>`).join("")}</tbody></table></div>
    <nav class="nfc-pager" aria-label="Pagination"><span>${fmtNum(data.total)} customer${data.total === 1 ? "" : "s"}</span>
      <button class="nfc-btn nfc-btn--sm nfc-btn--ghost" data-page="-1" ${data.page <= 1 ? "disabled" : ""}>Previous</button><span>Page ${data.page} of ${pages}</span>
      <button class="nfc-btn nfc-btn--sm nfc-btn--ghost" data-page="1" ${data.page >= pages ? "disabled" : ""}>Next</button></nav>`
    : `<div class="nfc-panel nfc-empty-state"><h2>No customers found</h2><p>${listState.q || listState.card_status || listState.profile_status ? "Try a different search or filter." : "Create the first NFC customer to get started."}</p><a data-nav href="?view=create" class="nfc-btn nfc-btn--primary">+ Create NFC Customer</a></div>`;
  box.onclick = async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.sort) { listState.dir = listState.sort === b.dataset.sort && listState.dir === "desc" ? "asc" : "desc"; listState.sort = b.dataset.sort; return loadTable(); }
    if (b.dataset.page) { listState.pg += Number(b.dataset.page); return loadTable(); }
    if (b.dataset.copy) return copyText(b.dataset.copy, "Profile URL copied");
    if (b.dataset.suspend) { if (await setStatus(b.dataset.suspend, b.dataset.name, true)) loadTable(); return; }
    if (b.dataset.reactivate) { if (await setStatus(b.dataset.reactivate, b.dataset.name, false)) loadTable(); return; }
    if (b.dataset.delete) { if (await deleteCustomer(b.dataset.delete, b.dataset.user, b.dataset.name)) loadTable(); }
  };
}

async function setStatus(id, name, suspend) {
  const ok = await confirmDialog(suspend
    ? { title: `Suspend ${name}?`, message: "The public profile will show “temporarily unavailable”, the customer is logged out and cannot log in or edit until reactivated. The URL is kept.", confirmLabel: "Suspend profile", danger: true }
    : { title: `Reactivate ${name}?`, message: "The public profile becomes visible again and the customer can log in.", confirmLabel: "Reactivate" });
  if (!ok) return false;
  try {
    await api(`${A}customers/${id}/${suspend ? "suspend" : "reactivate"}`, { method: "POST" });
    toast(suspend ? "Profile suspended" : "Profile reactivated");
    return true;
  } catch (error) { toast(error.message, "error"); return false; }
}

async function deleteCustomer(id, userId, name) {
  const typed = await confirmDialog({
    title: `Delete ${name}?`,
    message: "This permanently deletes the customer account, profile, images and analytics. The card URL will show “no longer available” and will never be given to anyone else. This cannot be undone.",
    confirmLabel: "Delete permanently", danger: true, expect: userId,
  });
  if (!typed) return false;
  try {
    await api(`${A}customers/${id}`, { method: "DELETE", body: { confirm_user_id: typed } });
    toast("Customer deleted");
    return true;
  } catch (error) { toast(error.message, "error"); return false; }
}

// ------------------------------------------------------------------ creation wizard
const STEPS = [
  { title: "Basic information", sections: ["identity"] },
  { title: "Contact information", sections: ["contact"] },
  { title: "Social media & links", sections: ["socials", "links", "services"] },
  { title: "Images & branding", sections: ["images"] },
  { title: "Profile theme", sections: ["theme"] },
  { title: "Login credentials" },
  { title: "Live preview" },
  { title: "Create profile" },
];
const SECTION_TITLES = { socials: "Social media", links: "Portfolio & custom links", services: "Business services" };

function createView() {
  wizard ??= { step: 0, visited: 0, draft: emptyDraft(), user_id: "", password: generatePassword(), card_reference: "", userIdOk: null, result: null };
  dirtyCheck = () => !!wizard && !wizard.result && Boolean(wizard.draft.full_name || wizard.user_id);
  if (wizard.result) return handoverView();
  const w = wizard;
  const step = STEPS[w.step];
  const preview = w.step <= 6;
  shell("create", "Create NFC Customer", `Step ${w.step + 1} of ${STEPS.length} · ${step.title}`,
    `<ol class="nfc-stepper">${STEPS.map((s, i) => `<li class="${i === w.step ? "is-current" : i <= w.visited ? "is-done" : ""}"><button type="button" data-step="${i}" ${i > w.visited ? "disabled" : ""} ${i === w.step ? 'aria-current="step"' : ""}><span>${i + 1}</span><em>${s.title}</em></button></li>`).join("")}</ol>
    <div class="nfc-editor-layout${preview ? "" : " nfc-editor-layout--single"}">
      <form class="nfc-panel nfc-wizard-body" id="wiz" novalidate>${wizardBody()}
        <div class="nfc-wizard-nav"><button type="button" class="nfc-btn nfc-btn--ghost" data-back ${w.step === 0 ? "disabled" : ""}>Back</button>
        ${w.step < STEPS.length - 1 ? '<button type="submit" class="nfc-btn nfc-btn--primary">Continue</button>' : `<button type="submit" class="nfc-btn nfc-btn--primary nfc-btn--lg" ${w.creating ? "disabled" : ""}>${w.creating ? "Creating…" : "Create customer profile"}</button>`}</div></form>
      ${preview ? `<aside class="nfc-preview-col"><div class="nfc-preview-head"><strong>Live preview</strong><small>${esc(themeOf(w.draft.theme_id).name)}</small></div><div class="nfc-phone"><div class="nfc-phone__screen" id="preview"></div></div></aside>` : ""}
    </div>`,
    '<button type="button" class="nfc-btn nfc-btn--ghost" data-reset>Start over</button>');

  const form = app.querySelector("#wiz");
  const pv = preview ? mountPreview(app.querySelector("#preview")) : null;
  const refresh = () => {
    pv?.render(draftToView(w.draft, { slug: "" }), { qrSrc: "", qrDownload: "" });
    const label = app.querySelector(".nfc-preview-head small");
    if (label) label.textContent = themeOf(w.draft.theme_id).name;
  };
  refresh();
  if (step.sections) bindEditor(form, { draft: w.draft, upload, onChange: refresh });
  if (w.step === 5) bindCredentials(form);
  if (w.step === 6) form.addEventListener("click", (e) => {
    const t = e.target.closest("[data-theme]");
    if (!t) return;
    w.draft.theme_id = t.dataset.theme;
    form.querySelectorAll("[data-theme]").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.theme === w.draft.theme_id)));
    refresh();
  });
  app.querySelector("[data-back]").onclick = () => { w.step--; createView(); };
  app.querySelector("[data-reset]").onclick = async () => {
    if (await confirmDialog({ title: "Start over?", message: "All information entered in this wizard will be cleared.", confirmLabel: "Clear wizard", danger: true })) { wizard = null; createView(); }
  };
  app.querySelector(".nfc-stepper").onclick = (e) => { const b = e.target.closest("[data-step]"); if (b && !b.disabled) { w.step = Number(b.dataset.step); createView(); } };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const problem = await stepProblem(w.step);
    if (problem) return showProblem(form, problem);
    if (w.step < STEPS.length - 1) { w.step++; w.visited = Math.max(w.visited, w.step); createView(); window.scrollTo({ top: 0 }); return; }
    await submitWizard();
  };
}

function wizardBody() {
  const w = wizard;
  const step = STEPS[w.step];
  const head = `<div class="nfc-problem" role="alert" hidden></div>`;
  if (step.sections) return head + step.sections.map((s) => `${SECTION_TITLES[s] && step.sections.length > 1 ? `<h3 class="nfc-subhead">${SECTION_TITLES[s]}</h3>` : ""}${sectionHtml(s, w.draft)}`).join("");
  if (w.step === 5) return `${head}<div class="nfc-grid">
    <div class="nfc-field"><label for="uid">Customer User ID <b class="nfc-req">*</b></label><input id="uid" value="${esc(w.user_id)}" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="32" placeholder="e.g. rahim.uddin" required><small class="nfc-hint" id="uid-status">3–32 characters: letters, numbers, dot, dash, underscore. Not case-sensitive.</small></div>
    <div class="nfc-field"><label for="pw">Temporary password <b class="nfc-req">*</b></label><div class="nfc-input-group"><input id="pw" type="text" value="${esc(w.password)}" autocomplete="new-password" spellcheck="false" maxlength="128"><button type="button" class="nfc-btn nfc-btn--ghost nfc-btn--sm" data-gen>Generate</button><button type="button" class="nfc-btn nfc-btn--ghost nfc-btn--sm" data-copy-pw>Copy</button></div><small class="nfc-hint" id="pw-status">The customer must change it at first login. It is stored only as a secure hash.</small></div>
    <div class="nfc-field"><label for="ref">Internal card reference (optional)</label><input id="ref" value="${esc(w.card_reference)}" maxlength="60" placeholder="e.g. NFC-2026-014"><small class="nfc-hint">For your own tracking — never written to the card.</small></div>
    </div><div class="nfc-note">${icon("link")}<span>The permanent profile URL is generated automatically when you create the profile, for example <code>${esc(location.origin)}/p/${esc((w.draft.full_name || "name").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "card")}-x7k2</code>.</span></div>`;
  if (w.step === 6) return `${head}<p>Review the profile exactly as visitors will see it. Compare designs below — your selection is saved with the profile.</p>
    <div class="nfc-theme-chips" role="group" aria-label="Compare themes">${THEMES.map((t) => `<button type="button" class="nfc-chip" data-theme="${t.key}" aria-pressed="${t.key === w.draft.theme_id}">${esc(t.name)}</button>`).join("")}</div>
    <div class="nfc-checklist">${checklist(w.draft).map(([ok, text]) => `<p class="${ok ? "is-ok" : "is-missing"}">${ok ? "✓" : "○"} ${esc(text)}</p>`).join("")}</div>`;
  const d = w.draft;
  return `${head}<dl class="nfc-summary">
    <div><dt>Customer</dt><dd>${esc(d.full_name)}${d.designation ? ` · ${esc(d.designation)}` : ""}</dd></div>
    <div><dt>Company</dt><dd>${esc(d.company_name || "—")}</dd></div>
    <div><dt>Theme</dt><dd>${esc(themeOf(d.theme_id).name)}</dd></div>
    <div><dt>User ID</dt><dd><code>${esc(w.user_id)}</code></dd></div>
    <div><dt>Contact</dt><dd>${[d.phone && "Phone", d.whatsapp && "WhatsApp", d.email && "Email", d.website && "Website"].filter(Boolean).join(", ") || "—"}</dd></div>
    <div><dt>Social & links</dt><dd>${d.social_links.filter((s) => s.url).length} social · ${d.custom_links.length} links · ${d.services.length} services</dd></div>
    <div><dt>Images</dt><dd>${["profile_photo", "cover_image", "company_logo"].filter((k) => d.images[k]).length} of 3 uploaded</dd></div></dl>
    <p class="nfc-hint">Creating the profile hashes the password, creates the account and profile, generates the permanent URL and QR code, and records an audit entry — all in one transaction.</p>`;
}

const checklist = (d) => [
  [d.full_name, "Name"], [d.images.profile_photo, "Profile photo"], [d.phone || d.whatsapp || d.email, "At least one contact method"],
  [d.tagline || d.biography, "Tagline or biography"], [d.social_links.some((s) => s.url), "Social media"], [d.images.cover_image, "Cover image"],
];

function bindCredentials(form) {
  const w = wizard;
  const uid = form.querySelector("#uid"), pw = form.querySelector("#pw");
  const uidStatus = form.querySelector("#uid-status"), pwStatus = form.querySelector("#pw-status");
  const checkUid = debounce(async () => {
    const value = uid.value.trim().toLowerCase();
    w.userIdOk = null;
    if (!value) return;
    try {
      const r = await api(A + "user-id-available?user_id=" + encodeURIComponent(value));
      w.userIdOk = r.valid && r.available;
      uidStatus.textContent = !r.valid ? "Use 3–32 letters, numbers, dot, dash or underscore." : r.available ? "✓ Available" : "✕ Already taken — choose another.";
      uidStatus.className = "nfc-hint " + (w.userIdOk ? "is-ok" : "is-bad");
    } catch { /* checked again on submit */ }
  }, 350);
  uid.addEventListener("input", () => { w.user_id = uid.value; checkUid(); });
  const checkPw = () => {
    const problem = passwordProblem(pw.value, uid.value);
    pwStatus.textContent = problem || "✓ Strong enough. The customer must change it at first login.";
    pwStatus.className = "nfc-hint " + (problem ? "is-bad" : "is-ok");
  };
  pw.addEventListener("input", () => { w.password = pw.value; checkPw(); });
  form.querySelector("[data-gen]").onclick = () => { pw.value = w.password = generatePassword(); checkPw(); };
  form.querySelector("[data-copy-pw]").onclick = () => copyText(pw.value, "Password copied");
  form.querySelector("#ref").addEventListener("input", (e) => { w.card_reference = e.target.value; });
  if (w.user_id) checkUid();
  checkPw();
}

async function stepProblem(step) {
  const w = wizard, d = w.draft;
  const problems = validateDraft(d);
  if (step === 0) return problems.find((p) => /Full name/.test(p)) || "";
  if (step === 1) return problems.find((p) => /Email|Phone|WhatsApp/.test(p)) || "";
  if (step === 2) return problems.find((p) => /service|link/i.test(p)) || "";
  if (step === 5 || step === 7) {
    if (!/^[a-z0-9][a-z0-9._-]{2,31}$/i.test(w.user_id.trim())) return "Enter a valid User ID (3–32 letters, numbers, dot, dash or underscore).";
    const pwProblem = passwordProblem(w.password, w.user_id);
    if (pwProblem) return "Temporary password: " + pwProblem;
    const r = await api(A + "user-id-available?user_id=" + encodeURIComponent(w.user_id.trim().toLowerCase()));
    if (!r.available) return "This User ID is already taken.";
  }
  if (step === 7) return problems[0] || "";
  return "";
}
function showProblem(form, text) {
  const el = form.querySelector(".nfc-problem");
  el.textContent = text;
  el.hidden = false;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
}

async function submitWizard() {
  const w = wizard;
  w.creating = true;
  createView();
  try {
    const result = await api(A + "customers", {
      method: "POST",
      body: { ...draftToPayload(w.draft), user_id: w.user_id.trim(), password: w.password, card_reference: w.card_reference.trim() },
    });
    w.result = { ...result, full_name: w.draft.full_name, password: w.password };
    w.password = "";
    dirtyCheck = null;
    handoverView();
  } catch (error) {
    w.creating = false;
    createView();
    showProblem(app.querySelector("#wiz"), error.message);
  }
}

function handoverView() {
  const r = wizard.result;
  const details = `CardCraft Studio BD — Digital Card Login\nProfile: ${r.profile_url}\nLogin: ${r.login_url}\nUser ID: ${r.user_id}\nTemporary password: ${r.password}\nYou will be asked to set a new password when you first log in.`;
  shell("create", "Customer created", "Hand over the card and the login details below.",
    `<div class="nfc-handover">
      <section class="nfc-panel nfc-handover__main"><div class="nfc-success">${icon("save")}<div><h2>${esc(r.full_name)} is ready</h2><p>Next: write the public URL to the NFC card, test it, then deliver.</p></div></div>
        <dl class="nfc-summary">
          <div><dt>Customer name</dt><dd>${esc(r.full_name)}</dd></div>
          <div><dt>User ID</dt><dd><code>${esc(r.user_id)}</code></dd></div>
          <div><dt>Temporary password</dt><dd><code class="nfc-secret">${esc(r.password)}</code> <button class="nfc-link-btn" data-copy-text="${esc(r.password)}">Copy</button></dd></div>
          <div><dt>Public profile URL</dt><dd><a href="${esc(r.profile_url)}" target="_blank" rel="noopener">${esc(r.profile_url)}</a></dd></div>
          <div><dt>Customer login URL</dt><dd><a href="${esc(r.login_url)}" target="_blank" rel="noopener">${esc(r.login_url)}</a></dd></div>
        </dl>
        <div class="nfc-btn-row">
          <button class="nfc-btn nfc-btn--primary" data-copy-text="${esc(r.profile_url)}" data-label="Public URL copied">${icon("copy")} Copy Public URL</button>
          <a class="nfc-btn nfc-btn--ghost" href="${esc(r.profile_url)}" target="_blank" rel="noopener">${icon("website")} Open Profile</a>
          <a class="nfc-btn nfc-btn--ghost" href="${qrUrl(r.customer_id, "png", true)}" download>${icon("download")} Download QR</a>
          <button class="nfc-btn nfc-btn--ghost" data-copy-text="${esc(details)}" data-label="Login details copied">${icon("copy")} Copy Customer Login Details</button>
          <button class="nfc-btn nfc-btn--ghost" data-ready>Mark ready for NFC programming</button>
          <a class="nfc-btn nfc-btn--ghost" data-nav href="?view=customer&id=${r.customer_id}">View customer</a>
          <button class="nfc-btn nfc-btn--text" data-done>Return to Dashboard</button>
        </div>
        <div class="nfc-note nfc-note--warn">${icon("document")}<span>The temporary password is shown <strong>only now</strong> — it is stored only as a secure hash. Write <strong>only the public URL</strong> to the NFC card (as a URL/URI record), never the login details. Share credentials privately with the customer.</span></div>
      </section>
      <aside class="nfc-panel nfc-qr-card"><h2>Profile QR code</h2><img src="${qrUrl(r.customer_id)}" alt="QR code for ${esc(r.profile_url)}" width="220" height="220"><p><code>/p/${esc(r.public_slug)}</code></p>
        <div class="nfc-btn-row nfc-btn-row--center"><a class="nfc-btn nfc-btn--sm nfc-btn--ghost" href="${qrUrl(r.customer_id, "png", true)}" download>PNG</a><a class="nfc-btn nfc-btn--sm nfc-btn--ghost" href="${qrUrl(r.customer_id, "svg", true)}" download>SVG</a></div></aside>
    </div>`);
  app.querySelector(".nfc-handover").onclick = async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.copyText) return copyText(b.dataset.copyText, b.dataset.label || "Copied");
    if (b.hasAttribute("data-ready")) {
      try { await api(`${A}customers/${r.customer_id}/card-status`, { method: "POST", body: { status: "ready_for_programming" } }); toast("Marked ready for NFC programming"); b.disabled = true; }
      catch (error) { toast(error.message, "error"); }
    }
    if (b.hasAttribute("data-done")) { wizard = null; go({ view: "overview" }); }
  };
}

// ------------------------------------------------------------------ customer detail
const TABS = [["overview", "Overview"], ["edit", "Edit profile"], ["card", "NFC card"], ["security", "Access & security"], ["analytics", "Analytics"], ["activity", "Activity"]];

async function customerView(id, tab) {
  loading("customers", "Customer");
  const rec = await api(A + "customers/" + id);
  const p = rec.profile, c = rec.customer;
  const header = `<div class="nfc-cust-head">${avatar(p.profile_photo_url, p.full_name, "nfc-avatar--lg")}<div><h2>${esc(p.full_name)}</h2><p>${esc([p.designation, p.company_name].filter(Boolean).join(" · ") || "—")}</p>
    <div class="nfc-badges">${statusBadge(p.profile_status)}${cardBadge(rec.card?.card_status || "profile_created")}${p.editing_enabled ? badge("Customer editing on", "grey") : badge("Customer editing off", "amber")}${c.password_change_required ? badge("Temporary password", "amber") : ""}</div></div></div>
    <nav class="nfc-tabs" aria-label="Customer sections">${TABS.map(([k, label]) => `<a data-nav href="?view=customer&id=${id}&tab=${k}" class="${tab === k ? "is-active" : ""}" ${tab === k ? 'aria-current="page"' : ""}>${label}</a>`).join("")}</nav>`;
  shell("customers", esc(p.full_name), `User ID <code>${esc(c.user_id)}</code>`, header + '<div id="tab"></div>',
    `<a class="nfc-btn nfc-btn--ghost" href="${esc(rec.profile_url)}" target="_blank" rel="noopener">Preview profile</a><button class="nfc-btn nfc-btn--primary" data-copy-url>Copy profile URL</button>`);
  app.querySelector("[data-copy-url]").onclick = () => copyText(rec.profile_url, "Profile URL copied");
  const box = app.querySelector("#tab");
  const reload = () => customerView(id, tab);
  if (tab === "edit") return editTab(box, rec, id);
  if (tab === "card") return cardTab(box, rec, id, reload);
  if (tab === "security") return securityTab(box, rec, id, reload);
  if (tab === "analytics") { box.innerHTML = customerAnalyticsHtml(await api(`${A}customers/${id}/analytics`)); return; }
  if (tab === "activity") { box.innerHTML = `<section class="nfc-panel">${activityList(rec.audit.map((a) => ({ ...a, full_name: "" })))}</section>`; return; }
  box.innerHTML = `<div class="nfc-two">
    <section class="nfc-panel"><h3>Permanent public URL</h3><div class="nfc-url-box"><code>${esc(rec.profile_url)}</code><button class="nfc-btn nfc-btn--sm nfc-btn--primary" data-copy="${esc(rec.profile_url)}">Copy</button><a class="nfc-btn nfc-btn--sm nfc-btn--ghost" href="${esc(rec.profile_url)}" target="_blank" rel="noopener">Open</a></div>
      <p class="nfc-hint">This URL never changes — profile edits appear here immediately, so the card never needs rewriting.</p>
      <h3>Program the NFC card</h3><ol class="nfc-steps-list"><li>Copy the URL above.</li><li>Open your NFC writing app (e.g. NFC Tools) → Write → Add a record → <strong>URL/URI</strong>.</li><li>Paste the URL and write it to the card. Do not add credentials.</li><li>Tap the card with a phone to test, then update the status in the <a data-nav href="?view=customer&id=${id}&tab=card">NFC card</a> tab.</li></ol>
      <dl class="nfc-summary nfc-summary--compact"><div><dt>Theme</dt><dd>${esc(themeOf(p.theme_id).name)}</dd></div><div><dt>Profile views</dt><dd>${fmtNum(rec.views_total)}</dd></div><div><dt>Created</dt><dd>${esc(fmtDate(p.created_at))}</dd></div><div><dt>Last updated</dt><dd>${esc(fmtDate(p.updated_at))}</dd></div><div><dt>Last login</dt><dd>${esc(fmtDate(c.last_login_at))}</dd></div></dl></section>
    <aside class="nfc-panel nfc-qr-card"><h3>QR code</h3><img src="${qrUrl(id)}" alt="QR code for the profile URL" width="220" height="220">
      <div class="nfc-btn-row nfc-btn-row--center"><a class="nfc-btn nfc-btn--sm nfc-btn--ghost" href="${qrUrl(id, "png", true)}" download>Download PNG</a><a class="nfc-btn nfc-btn--sm nfc-btn--ghost" href="${qrUrl(id, "svg", true)}" download>Download SVG</a><button class="nfc-btn nfc-btn--sm nfc-btn--ghost" data-copy="${esc(rec.profile_url)}">Copy URL</button></div></aside></div>`;
  box.onclick = (e) => { const b = e.target.closest("[data-copy]"); if (b) copyText(b.dataset.copy, "Profile URL copied"); };
}

function editTab(box, rec, id) {
  let draft = draftFromRecord(rec);
  let base = cloneDraft(draft);
  box.innerHTML = `<div class="nfc-editor-layout"><form class="nfc-editor" id="editor" novalidate>
      <section class="nfc-panel"><h3>Basic information</h3>${sectionHtml("identity", draft)}</section>
      <section class="nfc-panel"><h3>Images & branding</h3>${sectionHtml("images", draft)}</section>
      <section class="nfc-panel"><h3>Contact information</h3>${sectionHtml("contact", draft)}</section>
      <section class="nfc-panel"><h3>Social media</h3>${sectionHtml("socials", draft)}</section>
      <section class="nfc-panel"><h3>Business services</h3>${sectionHtml("services", draft)}</section>
      <section class="nfc-panel"><h3>Portfolio & custom links</h3>${sectionHtml("links", draft)}</section>
      <section class="nfc-panel"><h3>Profile theme</h3>${sectionHtml("theme", draft)}</section>
    </form><aside class="nfc-preview-col"><div class="nfc-preview-head"><strong>Live preview</strong><small>Unsaved changes are not public</small></div><div class="nfc-phone"><div class="nfc-phone__screen" id="preview"></div></div></aside></div>
    <div class="nfc-savebar" hidden><span>Unsaved changes</span><button type="button" class="nfc-btn nfc-btn--ghost" data-discard>Discard</button><button type="button" class="nfc-btn nfc-btn--primary" data-save>Save changes</button></div>`;
  const pv = mountPreview(box.querySelector("#preview"));
  const bar = box.querySelector(".nfc-savebar");
  const opts = { qrSrc: qrUrl(id), qrDownload: "" };
  const refresh = () => { pv.render(draftToView(draft), opts); bar.hidden = !isDirty(draft, base); };
  bindEditor(box.querySelector("#editor"), { draft, upload, onChange: refresh });
  dirtyCheck = () => isDirty(draft, base);
  refresh();
  box.querySelector("[data-discard]").onclick = () => { dirtyCheck = null; customerView(id, "edit"); };
  box.querySelector("[data-save]").onclick = async (e) => {
    const problems = validateDraft(draft);
    if (problems.length) return toast(problems[0], "error");
    e.target.disabled = true;
    e.target.textContent = "Saving…";
    try {
      await api(A + "customers/" + id, { method: "PATCH", body: draftToPayload(draft, base) });
      toast("Profile saved — live on the public URL");
      dirtyCheck = null;
      customerView(id, "edit");
    } catch (error) {
      toast(error.message, "error");
      e.target.disabled = false;
      e.target.textContent = "Save changes";
    }
  };
}

function cardTab(box, rec, id, reload) {
  const card = rec.card || { card_status: "profile_created" };
  const keys = Object.keys(CARD_STATUS);
  const current = keys.indexOf(card.card_status);
  const stamp = { programmed: card.programmed_at, tested: card.tested_at, dispatched: card.dispatched_at, delivered: card.delivered_at };
  box.innerHTML = `<section class="nfc-panel"><h3>Card status</h3>
    <ol class="nfc-pipeline">${keys.map((k, i) => `<li class="${i < current ? "is-done" : i === current ? "is-current" : ""}"><span class="nfc-pipeline__dot">${i < current ? "✓" : i + 1}</span><strong>${CARD_STATUS[k]}</strong><small>${stamp[k] ? esc(fmtDate(stamp[k])) : i === current ? "Current" : ""}</small>
      ${i !== current ? `<button class="nfc-btn nfc-btn--sm ${i === current + 1 ? "nfc-btn--primary" : "nfc-btn--ghost"}" data-status="${k}">${i < current ? "Revert to this" : "Mark as " + CARD_STATUS[k]}</button>` : ""}</li>`).join("")}</ol>
    <p class="nfc-hint">Statuses are only changed by you. The system never assumes a card was programmed or tested.</p></section>
    <div class="nfc-two"><section class="nfc-panel"><h3>Internal card reference</h3><form id="ref" class="nfc-input-group"><label class="nfc-sr" for="ref-in">Card reference</label><input id="ref-in" maxlength="60" value="${esc(card.internal_card_reference || "")}" placeholder="e.g. NFC-2026-014"><button class="nfc-btn nfc-btn--ghost">Save</button></form></section>
    <section class="nfc-panel"><h3>Status history</h3>${rec.card_history.length ? `<ul class="nfc-timeline">${rec.card_history.map((h) => `<li><span><strong>${esc(CARD_STATUS[h.new_status] || h.new_status)}</strong>${h.previous_status ? `<small>from ${esc(CARD_STATUS[h.previous_status] || h.previous_status)}</small>` : ""}</span><time>${esc(fmtDate(h.created_at))}</time></li>`).join("")}</ul>` : '<p class="nfc-empty">No history.</p>'}</section></div>`;
  const send = async (body, message) => {
    try { await api(`${A}customers/${id}/card-status`, { method: "POST", body }); toast(message); reload(); }
    catch (error) { toast(error.message, "error"); }
  };
  box.onclick = async (e) => {
    const b = e.target.closest("[data-status]");
    if (!b) return;
    const s = b.dataset.status;
    const physical = { programmed: "Confirm you have written the profile URL to this physical NFC card.", tested: "Confirm you tapped the card with a phone and the correct profile opened.", delivered: "Confirm the card was delivered to the customer." }[s];
    if (physical && !(await confirmDialog({ title: `Mark as ${CARD_STATUS[s]}?`, message: physical, confirmLabel: "Yes, confirm" }))) return;
    send({ status: s }, `Card marked as ${CARD_STATUS[s]}`);
  };
  box.querySelector("#ref").onsubmit = (e) => { e.preventDefault(); send({ status: card.card_status, reference: box.querySelector("#ref-in").value }, "Card reference saved"); };
}

function securityTab(box, rec, id, reload) {
  const p = rec.profile, c = rec.customer;
  box.innerHTML = `<div class="nfc-two">
    <section class="nfc-panel"><h3>Reset password</h3><p>Use when the customer asks on WhatsApp. Verify their identity first. All their sessions are signed out and they must choose a new password at next login.</p>
      <form id="reset" class="nfc-field"><label for="newpw">New temporary password</label><div class="nfc-input-group"><input id="newpw" value="${esc(generatePassword())}" maxlength="128" spellcheck="false" autocomplete="new-password"><button type="button" class="nfc-btn nfc-btn--ghost nfc-btn--sm" data-gen>Generate</button></div>
      <button class="nfc-btn nfc-btn--primary">Reset password</button></form><div id="reset-result"></div></section>
    <section class="nfc-panel"><h3>Customer editing</h3><p>When off, the customer can still log in and view analytics but cannot change the profile.</p>
      <label class="nfc-switch"><input type="checkbox" id="editing" ${p.editing_enabled ? "checked" : ""}><span class="nfc-switch__track" aria-hidden="true"></span><span>Allow customer to edit their profile</span></label>
      <h3>Profile status</h3><p>${p.profile_status === "active" ? "The profile is public." : "The profile is suspended: the public page shows “temporarily unavailable” and the customer cannot log in."}</p>
      ${p.profile_status === "active" ? '<button class="nfc-btn nfc-btn--danger-ghost" data-suspend>Suspend profile</button>' : '<button class="nfc-btn nfc-btn--primary" data-reactivate>Reactivate profile</button>'}</section></div>
    <div class="nfc-two"><section class="nfc-panel"><h3>Change public URL <small class="nfc-muted">(advanced)</small></h3>
      <p>Only if absolutely necessary. The old URL keeps working — it permanently redirects to the new one and is never given to anyone else.</p>
      <form id="slug" class="nfc-input-group"><span class="nfc-prefix">/p/</span><label class="nfc-sr" for="slug-in">Profile URL</label><input id="slug-in" value="${esc(p.public_slug)}" maxlength="64" pattern="[a-z0-9]+(-[a-z0-9]+)+" spellcheck="false"><button class="nfc-btn nfc-btn--ghost">Change URL</button></form></section>
    <section class="nfc-panel nfc-panel--danger"><h3>Delete profile</h3><p>Permanently deletes the account, profile, images and analytics. The URL will never be reassigned.</p><button class="nfc-btn nfc-btn--danger" data-delete>Delete profile…</button></section></div>`;
  const pwInput = box.querySelector("#newpw");
  box.querySelector("[data-gen]").onclick = () => { pwInput.value = generatePassword(); };
  box.querySelector("#reset").onsubmit = async (e) => {
    e.preventDefault();
    const problem = passwordProblem(pwInput.value, c.user_id);
    if (problem) return toast(problem, "error");
    if (!(await confirmDialog({ title: "Reset password?", message: `${p.full_name} will be signed out everywhere and must log in with the new temporary password.`, confirmLabel: "Reset password" }))) return;
    try {
      const r = await api(`${A}customers/${id}/reset-password`, { method: "POST", body: { password: pwInput.value } });
      const text = `CardCraft Studio BD — new temporary password\nLogin: ${r.login_url}\nUser ID: ${r.user_id}\nTemporary password: ${r.temporary_password}\nPlease set a new password after logging in.`;
      box.querySelector("#reset-result").innerHTML = `<div class="nfc-note nfc-note--ok"><span>New temporary password: <code class="nfc-secret">${esc(r.temporary_password)}</code><br><small>Shown only now. Send it privately to the customer.</small></span><button class="nfc-btn nfc-btn--sm nfc-btn--ghost" data-copy-reset>Copy login details</button></div>`;
      box.querySelector("[data-copy-reset]").onclick = () => copyText(text, "Login details copied");
      toast("Password reset — all sessions signed out");
    } catch (error) { toast(error.message, "error"); }
  };
  box.querySelector("#editing").onchange = async (e) => {
    try { await api(A + "customers/" + id, { method: "PATCH", body: { editing_enabled: e.target.checked } }); toast(e.target.checked ? "Customer editing enabled" : "Customer editing disabled"); }
    catch (error) { e.target.checked = !e.target.checked; toast(error.message, "error"); }
  };
  box.querySelector("#slug").onsubmit = async (e) => {
    e.preventDefault();
    const slug = box.querySelector("#slug-in").value.trim().toLowerCase();
    if (slug === p.public_slug) return;
    if (!(await confirmDialog({ title: "Change the public URL?", message: `New URL: ${location.origin}/p/${slug}. The old URL will redirect permanently. Printed QR codes and written NFC cards keep working.`, confirmLabel: "Change URL", danger: true }))) return;
    try { await api(A + "customers/" + id, { method: "PATCH", body: { public_slug: slug } }); toast("Public URL changed"); reload(); }
    catch (error) { toast(error.message, "error"); }
  };
  box.querySelector("[data-suspend]")?.addEventListener("click", async () => { if (await setStatus(id, p.full_name, true)) reload(); });
  box.querySelector("[data-reactivate]")?.addEventListener("click", async () => { if (await setStatus(id, p.full_name, false)) reload(); });
  box.querySelector("[data-delete]").onclick = async () => { if (await deleteCustomer(id, c.user_id, p.full_name)) { dirtyCheck = null; go({ view: "customers" }); } };
}

// ------------------------------------------------------------------ analytics
async function analyticsView() {
  loading("analytics", "Analytics");
  const s = await api(A + "analytics");
  shell("analytics", "Analytics", "Profile views include NFC taps, QR scans and shared links — they are not labelled as taps.",
    `<div class="nfc-stats">${[["Total profiles", s.total_customers], ["Active profiles", s.active_profiles, "", "green"], ["Total profile views", s.total_views], ["Views · 30 days", s.views_30d],
      ["Contact & link clicks · 30 days", s.contact_actions_30d], ["Delivered NFC cards", s.cards_delivered, "", "green"], ["Dispatched", s.cards_dispatched], ["Awaiting programming", s.awaiting_programming, "", s.awaiting_programming ? "amber" : ""]]
      .map(([l, v, h, t]) => statTile(l, fmtNum(v), h, t)).join("")}</div>
    <div class="nfc-two"><section class="nfc-panel"><h2>Most viewed profiles</h2>${s.most_viewed.length ? `<table class="nfc-table nfc-table--simple"><thead><tr><th>Profile</th><th>Views</th></tr></thead><tbody>${s.most_viewed.map((r) => `<tr><td><a data-nav href="?view=customer&id=${r.customer_id}">${esc(r.full_name)}</a></td><td>${fmtNum(r.views)}</td></tr>`).join("")}</tbody></table>` : '<p class="nfc-empty">No views yet.</p>'}</section>
    <section class="nfc-panel"><h2>Recent updates</h2>${s.recent_updates.length ? `<table class="nfc-table nfc-table--simple"><thead><tr><th>Profile</th><th>Updated</th></tr></thead><tbody>${s.recent_updates.map((r) => `<tr><td><a data-nav href="?view=customer&id=${r.customer_id}">${esc(r.full_name)}</a></td><td>${esc(fmtDate(r.updated_at))}</td></tr>`).join("")}</tbody></table>` : '<p class="nfc-empty">No updates yet.</p>'}</section></div>
    <p class="nfc-hint">Privacy: no IP addresses, device details or personal data of visitors are stored. Repeat views by the same visitor within 30 minutes are counted once using a short-lived hashed key.</p>`);
}

route();
