// /nfc/dashboard — the customer edits only their own profile. The server takes the identity from
// the session cookie; nothing in this file can choose which profile is edited.
import { api, setCsrf, toast, confirmDialog, copyText, passwordProblem, fmtDate, fmtNum, CARD_STATUS, SUPPORT_WHATSAPP, esc } from "./common.mjs";
import { themeOf, icon, initials } from "./render.mjs";
import { draftFromRecord, draftToPayload, draftToView, cloneDraft, isDirty, sectionHtml, bindEditor, mountPreview, validateDraft, completion } from "./editor.mjs";
import { customerAnalyticsHtml } from "./analytics-view.mjs";

const app = document.getElementById("app");
const NAV = [["overview", "Overview"], ["profile", "Edit Profile"], ["contact", "Contact Information"], ["social", "Social Media"], ["business", "Business Information"],
  ["design", "Profile Design"], ["preview", "Live Preview"], ["qr", "QR Code"], ["analytics", "Analytics"], ["account", "Account Settings"]];
const EDIT = {
  profile: [["Basic information", "identity"], ["Photos & branding", "images"]],
  contact: [["Contact information", "contact"]],
  social: [["Social media", "socials"]],
  business: [["Business services", "services"], ["Portfolio & custom links", "links"]],
  design: [["Choose your profile design", "theme"]],
};
let session, record, draft, base, section = "overview", preview;

const upload = (kind, data) => api("/api/nfc/me/upload", { method: "POST", body: { kind, data } });
const canEdit = () => session.editing_enabled && session.profile_status === "active";
const qrPath = (format, download = false) => `/api/nfc/public/${encodeURIComponent(record.profile.public_slug)}/qr?format=${format}${download ? "&download=1" : ""}`;

window.addEventListener("beforeunload", (e) => { if (draft && isDirty(draft, base)) { e.preventDefault(); e.returnValue = ""; } });
window.addEventListener("hashchange", () => { const next = location.hash.slice(1); if (NAV.some(([k]) => k === next) && next !== section) { section = next; renderContent(); } });

async function start() {
  try {
    session = await api("/api/nfc/auth/session");
  } catch {
    app.innerHTML = '<main class="nfc-auth-wall"><div class="nfc-card-box"><h1>Connection problem</h1><p>Please check your internet connection and reload.</p></div></main>';
    return;
  }
  if (!session.authenticated) return location.replace("/nfc/login");
  setCsrf(session.csrf);
  if (session.password_change_required) return forcedPasswordChange();
  await loadRecord();
  const hash = location.hash.slice(1);
  if (NAV.some(([k]) => k === hash)) section = hash;
  renderShell();
}

async function loadRecord() {
  record = await api("/api/nfc/me/profile");
  draft = draftFromRecord(record);
  base = cloneDraft(draft);
}

function forcedPasswordChange() {
  app.innerHTML = `<main class="nfc-auth-wall"><form class="nfc-card-box nfc-card-box--wide" id="first" novalidate>
    <img src="/images/cardcraft-studio-bd-logo.jpeg" alt="CardCraft Studio BD" width="64" height="64">
    <h1>Set your new password</h1><p>Welcome${session.full_name ? ", " + esc(session.full_name) : ""}! For your security, replace the temporary password before editing your profile.</p>
    <p class="nfc-problem" role="alert" hidden></p>
    <div class="nfc-field"><label for="cur">Temporary password</label><input id="cur" type="password" autocomplete="current-password" required></div>
    <div class="nfc-field"><label for="new">New password</label><input id="new" type="password" autocomplete="new-password" required minlength="10" maxlength="128" aria-describedby="new-hint"><small class="nfc-hint" id="new-hint">At least 10 characters with letters and a number.</small></div>
    <div class="nfc-field"><label for="new2">Confirm new password</label><input id="new2" type="password" autocomplete="new-password" required></div>
    <label class="nfc-check"><input type="checkbox" id="show"> Show passwords</label>
    <button class="nfc-btn nfc-btn--primary nfc-btn--block">Save new password</button>
    <button type="button" class="nfc-btn nfc-btn--text nfc-btn--block" data-logout>Log out</button></form></main>`;
  const form = app.querySelector("#first");
  const problem = form.querySelector(".nfc-problem");
  form.querySelector("#show").onchange = (e) => form.querySelectorAll("input[type=password], input[data-pw]").forEach((i) => { i.dataset.pw = "1"; i.type = e.target.checked ? "text" : "password"; });
  form.querySelector("[data-logout]").onclick = logout;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const cur = form.querySelector("#cur").value, next = form.querySelector("#new").value, again = form.querySelector("#new2").value;
    const msg = passwordProblem(next, session.user_id) || (next !== again ? "The new passwords do not match." : next === cur ? "Choose a password different from the temporary one." : "");
    if (msg) { problem.textContent = msg; problem.hidden = false; return; }
    const button = form.querySelector("button.nfc-btn--primary");
    button.disabled = true;
    try {
      await api("/api/nfc/auth/change-password", { method: "POST", body: { current_password: cur, new_password: next } });
      toast("Password updated");
      session.password_change_required = false;
      await loadRecord();
      renderShell();
    } catch (error) {
      problem.textContent = error.message;
      problem.hidden = false;
      button.disabled = false;
    }
  };
}

function renderShell() {
  const p = record.profile;
  app.innerHTML = `<div class="nfcc">
    <header class="nfcc-top"><a class="nfca-brand" href="#overview"><img src="/images/cardcraft-studio-bd-logo.jpeg" alt="" width="36" height="36"><span><strong>My Digital Card</strong><small>CardCraft Studio BD</small></span></a>
      <div class="nfcc-top__user"><span class="nfc-avatar nfc-avatar--sm">${p.profile_photo_url ? `<img src="${esc(p.profile_photo_url)}" alt="">` : esc(initials(p.full_name))}</span><span class="nfcc-top__name">${esc(p.full_name)}</span>
      <a class="nfc-btn nfc-btn--sm nfc-btn--ghost" href="${esc(record.profile_url)}" target="_blank" rel="noopener">View my profile</a><button class="nfc-btn nfc-btn--sm nfc-btn--text" data-logout>Log out</button></div></header>
    <nav class="nfcc-nav" aria-label="Dashboard sections">${NAV.map(([k, label]) => `<a href="#${k}" data-section="${k}">${label}</a>`).join("")}<a class="nfcc-nav__support" href="${SUPPORT_WHATSAPP}" target="_blank" rel="noopener">Need help? WhatsApp us</a></nav>
    <main class="nfcc-main" id="main" tabindex="-1">${!canEdit() ? `<div class="nfc-note nfc-note--warn" role="status">${icon("document")}<span>${session.profile_status !== "active" ? "Your profile is currently suspended." : "Editing has been turned off for your profile."} Please contact CardCraft Studio BD on WhatsApp if you need changes.</span></div>` : ""}<div id="content"></div></main>
    <aside class="nfcc-preview" aria-label="Live preview"><div class="nfc-preview-head"><strong>Live preview</strong><small>Unsaved changes are not public</small></div><div class="nfc-phone"><div class="nfc-phone__screen" id="side-preview"></div></div></aside>
    <div class="nfc-savebar" hidden><span>You have unsaved changes</span><button type="button" class="nfc-btn nfc-btn--ghost" data-discard>Discard</button><button type="button" class="nfc-btn nfc-btn--primary" data-save>Save changes</button></div></div>`;
  preview = mountPreview(app.querySelector("#side-preview"));
  app.querySelector("[data-logout]").onclick = logout;
  app.querySelector("[data-discard]").onclick = async () => {
    if (!(await confirmDialog({ title: "Discard changes?", message: "Your unsaved edits will be lost.", confirmLabel: "Discard", danger: true }))) return;
    draft = cloneDraft(base);
    renderContent();
  };
  app.querySelector("[data-save]").onclick = save;
  renderContent();
}

function refreshPreview() {
  const view = draftToView(draft);
  const opts = { qrSrc: qrPath("svg"), qrDownload: "" };
  preview?.render(view, opts);
  const big = app.querySelector("#big-preview");
  if (big) mountPreview(big).render(view, opts);
  const bar = app.querySelector(".nfc-savebar");
  if (bar) bar.hidden = !isDirty(draft, base);
}

function renderContent() {
  app.querySelectorAll(".nfcc-nav a[data-section]").forEach((a) => {
    const on = a.dataset.section === section;
    a.classList.toggle("is-active", on);
    on ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current");
  });
  app.querySelector(".nfcc").classList.toggle("nfcc--with-preview", Boolean(EDIT[section]));
  const box = app.querySelector("#content");
  const title = NAV.find(([k]) => k === section)[1];
  if (EDIT[section]) {
    box.innerHTML = `<h1 class="nfcc-title">${title}</h1><form id="editor" novalidate>${EDIT[section].map(([h, s]) => `<section class="nfc-panel"><h2>${h}</h2>${sectionHtml(s, draft)}</section>`).join("")}</form>`;
    bindEditor(box.querySelector("#editor"), { draft, upload, onChange: refreshPreview, disabled: !canEdit() });
  } else if (section === "overview") overview(box);
  else if (section === "preview") {
    box.innerHTML = `<h1 class="nfcc-title">Live Preview</h1><p class="nfc-hint">This is exactly how your profile looks${isDirty(draft, base) ? " with your unsaved changes. Save to publish them" : ""}. The public URL never changes.</p><div class="nfc-phone nfc-phone--center"><div class="nfc-phone__screen" id="big-preview"></div></div>`;
  } else if (section === "qr") qrSection(box);
  else if (section === "analytics") analytics(box);
  else if (section === "account") account(box);
  refreshPreview();
  document.getElementById("main")?.focus({ preventScroll: true });
}

function overview(box) {
  const p = record.profile;
  const pct = completion(base);
  box.innerHTML = `<div class="nfc-welcome"><span class="nfc-avatar nfc-avatar--lg">${p.profile_photo_url ? `<img src="${esc(p.profile_photo_url)}" alt="">` : esc(initials(p.full_name))}</span>
      <div><h1>Hello, ${esc(p.full_name.split(" ")[0])}</h1><p>Anyone who taps your NFC card or scans your QR code sees your latest saved profile.</p></div></div>
    <section class="nfc-panel"><h2>Your permanent profile URL</h2><div class="nfc-url-box"><code>${esc(record.profile_url)}</code><button class="nfc-btn nfc-btn--sm nfc-btn--primary" data-copy>Copy</button><a class="nfc-btn nfc-btn--sm nfc-btn--ghost" href="${esc(record.profile_url)}" target="_blank" rel="noopener">Open</a></div>
      <p class="nfc-hint">This link is written on your NFC card. It never changes when you edit your profile.</p></section>
    <div class="nfc-stats">
      <div class="nfc-stat"><span class="nfc-stat__label">Total profile views</span><strong class="nfc-stat__value">${fmtNum(record.views_total)}</strong></div>
      <div class="nfc-stat"><span class="nfc-stat__label">Current theme</span><strong class="nfc-stat__value nfc-stat__value--sm">${esc(themeOf(p.theme_id).name)}</strong></div>
      <div class="nfc-stat${p.profile_status === "active" ? " nfc-stat--green" : " nfc-stat--red"}"><span class="nfc-stat__label">Profile status</span><strong class="nfc-stat__value nfc-stat__value--sm">${p.profile_status === "active" ? "Active" : "Suspended"}</strong></div>
      <div class="nfc-stat"><span class="nfc-stat__label">Last updated</span><strong class="nfc-stat__value nfc-stat__value--sm">${esc(fmtDate(p.updated_at))}</strong></div>
      ${record.card_status ? `<div class="nfc-stat"><span class="nfc-stat__label">NFC card</span><strong class="nfc-stat__value nfc-stat__value--sm">${esc(CARD_STATUS[record.card_status])}</strong></div>` : ""}
    </div>
    <section class="nfc-panel"><h2>Profile completion</h2><div class="nfc-progress"><progress max="100" value="${pct}" aria-label="Profile completion">${pct}%</progress><strong>${pct}%</strong></div>
      <p class="nfc-hint">${pct < 100 ? "Add more details — a photo, cover image, bio and social links make your card stand out." : "Your profile is complete. Great job!"}</p>
      <div class="nfc-quick-links">${NAV.slice(1, 6).map(([k, label]) => `<a href="#${k}" class="nfc-btn nfc-btn--ghost nfc-btn--sm">${label}</a>`).join("")}</div></section>`;
  box.querySelector("[data-copy]").onclick = () => copyText(record.profile_url, "Profile link copied");
}

function qrSection(box) {
  box.innerHTML = `<h1 class="nfcc-title">QR Code</h1><section class="nfc-panel nfc-qr-card nfc-qr-card--wide"><img src="${qrPath("svg")}" alt="QR code for ${esc(record.profile_url)}" width="240" height="240">
    <p>Scanning this code opens <code>${esc(record.profile_url)}</code> — the same page as your NFC card. Print it on flyers, packaging or your shop counter.</p>
    <div class="nfc-btn-row nfc-btn-row--center"><a class="nfc-btn nfc-btn--primary" href="${qrPath("png", true)}" download>${icon("download")} Download PNG</a><a class="nfc-btn nfc-btn--ghost" href="${qrPath("svg", true)}" download>Download SVG</a>
    <button class="nfc-btn nfc-btn--ghost" data-share-qr>${icon("share")} Share QR</button><button class="nfc-btn nfc-btn--ghost" data-copy>${icon("copy")} Copy link</button></div></section>`;
  box.querySelector("[data-copy]").onclick = () => copyText(record.profile_url, "Profile link copied");
  box.querySelector("[data-share-qr]").onclick = async () => {
    try {
      const blob = await (await fetch(qrPath("png"))).blob();
      const file = new File([blob], `${record.profile.public_slug}-qr.png`, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: record.profile.full_name, text: record.profile_url });
      else if (navigator.share) await navigator.share({ title: record.profile.full_name, url: record.profile_url });
      else copyText(record.profile_url, "Sharing isn't supported here — link copied instead");
    } catch (error) { if (error?.name !== "AbortError") toast("Could not share the QR code.", "error"); }
  };
}

async function analytics(box) {
  box.innerHTML = '<h1 class="nfcc-title">Analytics</h1><div class="nfc-loading">Loading…</div>';
  try {
    const stats = await api("/api/nfc/me/analytics");
    box.innerHTML = '<h1 class="nfcc-title">Analytics</h1>' + customerAnalyticsHtml(stats);
  } catch (error) { box.innerHTML = `<h1 class="nfcc-title">Analytics</h1><p class="nfc-problem">${esc(error.message)}</p>`; }
}

function account(box) {
  const c = record.customer;
  box.innerHTML = `<h1 class="nfcc-title">Account Settings</h1>
    <section class="nfc-panel"><h2>Account</h2><dl class="nfc-summary nfc-summary--compact"><div><dt>User ID</dt><dd><code>${esc(c.user_id)}</code></dd></div><div><dt>Last login</dt><dd>${esc(fmtDate(c.last_login_at))}</dd></div><div><dt>Password changed</dt><dd>${esc(fmtDate(c.password_changed_at))}</dd></div></dl></section>
    <section class="nfc-panel"><h2>Change password</h2><form id="pw" class="nfc-grid" novalidate><p class="nfc-problem nfc-field--wide" role="alert" hidden></p>
      <div class="nfc-field"><label for="cur">Current password</label><input id="cur" type="password" autocomplete="current-password"></div>
      <div class="nfc-field"><label for="new">New password</label><input id="new" type="password" autocomplete="new-password" maxlength="128"><small class="nfc-hint">At least 10 characters with letters and a number.</small></div>
      <div class="nfc-field"><label for="new2">Confirm new password</label><input id="new2" type="password" autocomplete="new-password"></div>
      <div class="nfc-field nfc-field--wide"><button class="nfc-btn nfc-btn--primary">Update password</button></div></form>
      <p class="nfc-hint">Changing your password signs you out on all other devices.</p></section>
    <section class="nfc-panel"><h2>Sessions</h2><p>Signed in on a shared or lost phone? Sign out everywhere.</p><div class="nfc-btn-row"><button class="nfc-btn nfc-btn--ghost" data-logout>Log out</button><button class="nfc-btn nfc-btn--danger-ghost" data-logout-all>Log out of all devices</button></div></section>
    <section class="nfc-panel"><h2>Forgot your password or need help?</h2><p>Contact CardCraft Studio BD on WhatsApp. After verifying your identity we will send you a new temporary password.</p><a class="nfc-btn nfc-btn--ghost" href="${SUPPORT_WHATSAPP}" target="_blank" rel="noopener">${icon("whatsapp")} WhatsApp support</a></section>`;
  const form = box.querySelector("#pw");
  const problem = form.querySelector(".nfc-problem");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const cur = form.querySelector("#cur").value, next = form.querySelector("#new").value, again = form.querySelector("#new2").value;
    const msg = passwordProblem(next, c.user_id) || (next !== again ? "The new passwords do not match." : "");
    if (msg) { problem.textContent = msg; problem.hidden = false; return; }
    try {
      await api("/api/nfc/auth/change-password", { method: "POST", body: { current_password: cur, new_password: next } });
      form.reset();
      problem.hidden = true;
      toast("Password updated — other devices were signed out");
    } catch (error) { problem.textContent = error.message; problem.hidden = false; }
  };
  box.querySelector("[data-logout]").onclick = logout;
  box.querySelector("[data-logout-all]").onclick = async () => {
    if (!(await confirmDialog({ title: "Log out of all devices?", message: "You will need to log in again on every device, including this one.", confirmLabel: "Log out everywhere", danger: true }))) return;
    try { await api("/api/nfc/auth/logout-all", { method: "POST" }); location.replace("/nfc/login"); } catch (error) { toast(error.message, "error"); }
  };
}

async function save() {
  const problems = validateDraft(draft);
  if (problems.length) return toast(problems[0], "error");
  const button = app.querySelector("[data-save]");
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    record = await api("/api/nfc/me/profile", { method: "PATCH", body: draftToPayload(draft, base) });
    draft = draftFromRecord(record);
    base = cloneDraft(draft);
    toast("Saved — your public profile is updated");
    renderShell();
  } catch (error) {
    toast(error.message, "error");
    if (error.status === 401) location.replace("/nfc/login");
  } finally {
    button.disabled = false;
    button.textContent = "Save changes";
  }
}

async function logout() {
  if (draft && isDirty(draft, base) && !(await confirmDialog({ title: "Log out without saving?", message: "You have unsaved changes.", confirmLabel: "Log out", danger: true }))) return;
  try { await api("/api/nfc/auth/logout", { method: "POST" }); } catch { /* cookie is cleared server-side when reachable */ }
  draft = null;
  location.replace("/nfc/login");
}

start();
