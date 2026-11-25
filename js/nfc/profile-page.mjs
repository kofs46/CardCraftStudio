// Public profile enhancements: share, copy link, privacy-conscious analytics. The page is fully
// usable without this script (server-rendered links work on their own).
const card = document.querySelector(".nfcp");
const slug = card?.dataset.slug;
const url = card?.dataset.url || location.href;
const toastEl = card?.querySelector(".nfcp-toast");
let toastTimer;

function toast(text) {
  if (!toastEl) return;
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 2400);
}

function track(event, detail) {
  if (!slug) return;
  try {
    fetch(`/api/nfc/public/${encodeURIComponent(slug)}/view`, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(detail ? { event, detail } : { event }),
    }).catch(() => {});
  } catch { /* analytics must never break the page */ }
}

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    window.prompt("Copy this text", text);
  }
}

const copyLink = () => copyText(url, "Link copied");

if (card) {
  // Counted as a "profile view" — it may come from an NFC tap, a QR scan or a shared link.
  track("view");
  card.querySelectorAll("[data-copy-value]").forEach((button) => { button.hidden = false; });
  card.addEventListener("click", async (event) => {
    const share = event.target.closest("[data-share]");
    const copy = event.target.closest("[data-copy]");
    const copyValue = event.target.closest("[data-copy-value]");
    const tracked = event.target.closest("[data-track]");
    if (tracked) track(tracked.dataset.track, tracked.dataset.detail);
    if (copy) return copyLink();
    if (copyValue) return copyText(copyValue.dataset.copyValue, "Copied");
    if (!share) return;
    track("share");
    const data = { title: card.dataset.name || document.title, text: `${card.dataset.name} — digital business card`, url };
    if (navigator.share) {
      try { await navigator.share(data); } catch (error) { if (error?.name !== "AbortError") copyLink(); }
    } else copyLink();
  });
}
