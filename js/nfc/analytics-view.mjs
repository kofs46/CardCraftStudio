// Customer-level analytics rendering (used by the admin customer page and the customer dashboard).
import { esc, fmtDate, fmtNum } from "./common.mjs";
import { SOCIAL_NAMES } from "./render.mjs";

const EVENT_LABELS = {
  view: "Profile view", click_call: "Call button", click_whatsapp: "WhatsApp button", click_email: "Email button",
  click_website: "Website button", click_map: "Google Maps", click_social: "Social link", click_link: "Portfolio / custom link",
  click_service: "Service link", save_contact: "Save Contact", share: "Share", qr_download: "QR download",
};
const CONTACT_EVENTS = ["click_call", "click_whatsapp", "click_email", "click_website", "click_map"];

export function statTile(label, value, hint = "", tone = "") {
  return `<div class="nfc-stat${tone ? " nfc-stat--" + tone : ""}"><span class="nfc-stat__label">${esc(label)}</span><strong class="nfc-stat__value">${esc(value)}</strong>${hint ? `<small>${esc(hint)}</small>` : ""}</div>`;
}

/** 30-day bar chart as inline SVG (presentation attributes only — CSP-safe). */
export function dailyChart(daily = []) {
  if (!daily.length) return "";
  const max = Math.max(1, ...daily.map((d) => d.views));
  const w = 600, h = 140, gap = 4, bw = (w - gap * (daily.length - 1)) / daily.length;
  const bars = daily.map((d, i) => {
    const bh = Math.max(d.views ? 4 : 1, Math.round((d.views / max) * (h - 20)));
    return `<rect x="${(i * (bw + gap)).toFixed(1)}" y="${h - bh}" width="${bw.toFixed(1)}" height="${bh}" rx="3" class="nfc-chart__bar${d.views ? "" : " is-zero"}"><title>${esc(d.day)}: ${d.views} view${d.views === 1 ? "" : "s"}</title></rect>`;
  }).join("");
  const total = daily.reduce((s, d) => s + d.views, 0);
  return `<figure class="nfc-chart"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Profile views over the last 30 days: ${total} total">${bars}</svg>
    <figcaption><span>${esc(daily[0].day)}</span><span>Last 30 days · ${fmtNum(total)} views</span><span>${esc(daily.at(-1).day)}</span></figcaption></figure>`;
}

export function customerAnalyticsHtml(stats) {
  if (!stats || stats.total_views === undefined) return '<p class="nfc-empty">No analytics yet.</p>';
  const ev = stats.events || {};
  const contact = CONTACT_EVENTS.reduce((s, k) => s + (ev[k] || 0), 0);
  const social = ev.click_social || 0;
  const rows = Object.entries(ev).filter(([k]) => k !== "view").sort((a, b) => b[1] - a[1]);
  const socials = Object.entries(stats.social || {}).sort((a, b) => b[1] - a[1]);
  return `<div class="nfc-stats">
      ${statTile("Total profile views", fmtNum(stats.total_views), "All time")}
      ${statTile("Views · 7 days", fmtNum(stats.views_7d))}
      ${statTile("Views · 30 days", fmtNum(stats.views_30d))}
      ${statTile("Contact button clicks", fmtNum(contact), "Call, WhatsApp, email, website, maps")}
      ${statTile("Social link clicks", fmtNum(social))}
      ${statTile("Contacts saved", fmtNum(ev.save_contact || 0))}
    </div>
    <section class="nfc-panel"><h3>Profile views</h3>${dailyChart(stats.daily)}
      <p class="nfc-hint">A view is counted when someone opens the profile — by tapping the NFC card, scanning the QR code or opening a shared link. Repeat visits by the same visitor within 30 minutes count once. No personal data (IP address or device) is stored.</p></section>
    <div class="nfc-two">
      <section class="nfc-panel"><h3>Button clicks</h3>${rows.length ? `<ul class="nfc-bars">${rows.map(([k, n]) => `<li><span>${esc(EVENT_LABELS[k] || k)}</span><strong>${fmtNum(n)}</strong></li>`).join("")}</ul>` : '<p class="nfc-empty">No clicks yet.</p>'}</section>
      <section class="nfc-panel"><h3>Social links</h3>${socials.length ? `<ul class="nfc-bars">${socials.map(([k, n]) => `<li><span>${esc(SOCIAL_NAMES[k] || k)}</span><strong>${fmtNum(n)}</strong></li>`).join("")}</ul>` : '<p class="nfc-empty">No social clicks yet.</p>'}</section>
    </div>
    <section class="nfc-panel"><h3>Recent activity</h3>${stats.recent?.length ? `<ul class="nfc-timeline">${stats.recent.map((r) => `<li><span>${esc(EVENT_LABELS[r.event_type] || r.event_type)}${r.event_detail ? ` · ${esc(SOCIAL_NAMES[r.event_detail] || r.event_detail)}` : ""}</span><time>${esc(fmtDate(r.created_at))}</time></li>`).join("")}</ul>` : '<p class="nfc-empty">No activity yet.</p>'}</section>`;
}
