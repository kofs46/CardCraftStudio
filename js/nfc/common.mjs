// Shared browser helpers for the NFC admin module, customer dashboard and login page.
export { esc } from "./render.mjs";
import { esc } from "./render.mjs";

let csrf = "";
export const setCsrf = (token) => { csrf = token || ""; };

/** JSON API call. Mutations always send a JSON body and the CSRF header (customer routes). */
export async function api(path, { method = "GET", body } = {}) {
  const mutation = method !== "GET";
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      ...(mutation ? { "Content-Type": "application/json" } : {}),
      ...(mutation && csrf ? { "X-CSRF-Token": csrf } : {}),
    },
    body: mutation ? JSON.stringify(body ?? {}) : undefined,
  });
  const type = res.headers.get("content-type") || "";
  const data = type.includes("json") ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const error = new Error(data?.error || `Request failed (${res.status}).`);
    error.status = res.status;
    error.code = data?.code;
    throw error;
  }
  return data;
}

// ------------------------------------------------------------------ feedback
let toastHost;
export function toast(message, type = "success") {
  toastHost ??= Object.assign(document.body.appendChild(document.createElement("div")), { className: "nfc-toasts" });
  toastHost.setAttribute("role", "status");
  toastHost.setAttribute("aria-live", "polite");
  const el = document.createElement("div");
  el.className = `nfc-toast nfc-toast--${type}`;
  el.textContent = message;
  toastHost.appendChild(el);
  setTimeout(() => el.classList.add("is-leaving"), 3200);
  setTimeout(() => el.remove(), 3600);
}

/** Accessible confirmation dialog. With `expect`, the user must type that exact text (case-insensitive). */
export function confirmDialog({ title, message, confirmLabel = "Confirm", danger = false, expect = "" }) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "nfc-dialog";
    dialog.innerHTML = `<form method="dialog" class="nfc-dialog__body">
      <h2>${esc(title)}</h2><p>${esc(message)}</p>
      ${expect ? `<label class="nfc-field"><span>Type <strong>${esc(expect)}</strong> to confirm</span><input name="confirm" autocomplete="off" required></label>` : ""}
      <div class="nfc-dialog__actions"><button type="button" value="cancel" class="nfc-btn nfc-btn--ghost" data-cancel>Cancel</button>
      <button value="ok" class="nfc-btn ${danger ? "nfc-btn--danger" : "nfc-btn--primary"}" data-ok ${expect ? "disabled" : ""}>${esc(confirmLabel)}</button></div></form>`;
    document.body.appendChild(dialog);
    const input = dialog.querySelector("input");
    const ok = dialog.querySelector("[data-ok]");
    input?.addEventListener("input", () => { ok.disabled = input.value.trim().toLowerCase() !== expect.toLowerCase(); });
    dialog.querySelector("[data-cancel]").onclick = () => dialog.close("cancel");
    dialog.addEventListener("close", () => {
      const yes = dialog.returnValue === "ok";
      dialog.remove();
      resolve(yes ? (input ? input.value.trim() : true) : false);
    });
    dialog.showModal();
    (input || ok).focus();
  });
}

export async function copyText(text, label = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    window.prompt("Copy this:", text);
  }
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
/** Cryptographically random temporary password (no ambiguous characters). */
export function generatePassword(length = 14) {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint32Array(length));
    const out = Array.from(bytes, (n) => ALPHABET[n % ALPHABET.length]).join("");
    if (/[A-Z]/.test(out) && /[a-z]/.test(out) && /\d/.test(out)) return out;
  }
}
export function passwordProblem(password, userId = "") {
  if (!password || password.length < 10) return "At least 10 characters.";
  if (password.length > 128) return "At most 128 characters.";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "Use letters and at least one number.";
  if (userId && password.toLowerCase().includes(userId.toLowerCase())) return "Must not contain the User ID.";
  return "";
}

export const debounce = (fn, ms = 250) => {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};
export const fmtDate = (iso, withTime = true) =>
  iso ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", ...(withTime ? { timeStyle: "short" } : {}), timeZone: "Asia/Dhaka" }).format(new Date(iso)) : "—";
export const fmtNum = (n) => new Intl.NumberFormat("en-US").format(Number(n) || 0);

export const CARD_STATUS = {
  profile_created: "Profile Created",
  ready_for_programming: "Ready for NFC Programming",
  programmed: "NFC Programmed",
  tested: "NFC Tested",
  dispatched: "Dispatched",
  delivered: "Delivered",
};
export const SUPPORT_WHATSAPP = "https://wa.me/8801983469936";

// ------------------------------------------------------------------ images: crop, resize, compress (in the browser)
export const IMAGE_SPECS = {
  profile_photo: { label: "Profile photo", w: 640, h: 640, crop: true },
  cover_image: { label: "Cover image", w: 1200, h: 500, crop: true },
  company_logo: { label: "Company logo", max: 512, crop: false, alpha: true },
  service: { label: "Service image", w: 600, h: 600, crop: true },
};
const MAX_UPLOAD = 1.9 * 1024 * 1024;

function cropDialog(bitmap, aspect, title) {
  return new Promise((resolve) => {
    const vw = Math.min(320, window.innerWidth - 64);
    const vh = Math.round(vw / aspect);
    const dialog = document.createElement("dialog");
    dialog.className = "nfc-dialog nfc-crop";
    dialog.innerHTML = `<div class="nfc-dialog__body"><h2>${esc(title)}</h2><p class="nfc-muted">Drag to position, use the slider to zoom.</p>
      <div class="nfc-crop__frame" tabindex="0" aria-label="Crop area. Use arrow keys to move the image."><canvas width="${vw}" height="${vh}"></canvas></div>
      <label class="nfc-field"><span>Zoom</span><input type="range" min="1" max="4" step="0.01" value="1"></label>
      <div class="nfc-dialog__actions"><button type="button" class="nfc-btn nfc-btn--ghost" data-cancel>Cancel</button><button type="button" class="nfc-btn nfc-btn--primary" data-ok>Apply</button></div></div>`;
    document.body.appendChild(dialog);
    const canvas = dialog.querySelector("canvas");
    const ctx = canvas.getContext("2d");
    const zoomInput = dialog.querySelector('input[type="range"]');
    const frame = dialog.querySelector(".nfc-crop__frame");
    const base = Math.max(vw / bitmap.width, vh / bitmap.height);
    let zoom = 1, ox = 0, oy = 0;
    const scale = () => base * zoom;
    const clamp = () => {
      const s = scale();
      ox = Math.min(0, Math.max(vw - bitmap.width * s, ox));
      oy = Math.min(0, Math.max(vh - bitmap.height * s, oy));
    };
    const draw = () => {
      clamp();
      ctx.clearRect(0, 0, vw, vh);
      ctx.drawImage(bitmap, ox, oy, bitmap.width * scale(), bitmap.height * scale());
    };
    ox = (vw - bitmap.width * base) / 2;
    oy = (vh - bitmap.height * base) / 2;
    draw();
    zoomInput.oninput = () => {
      const before = scale();
      zoom = Number(zoomInput.value);
      const cx = vw / 2, cy = vh / 2;
      ox = cx - ((cx - ox) * scale()) / before;
      oy = cy - ((cy - oy) * scale()) / before;
      draw();
    };
    let drag = null;
    canvas.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, ox, oy }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener("pointermove", (e) => { if (!drag) return; ox = drag.ox + e.clientX - drag.x; oy = drag.oy + e.clientY - drag.y; draw(); });
    canvas.addEventListener("pointerup", () => { drag = null; });
    frame.addEventListener("keydown", (e) => {
      const d = { ArrowLeft: [8, 0], ArrowRight: [-8, 0], ArrowUp: [0, 8], ArrowDown: [0, -8] }[e.key];
      if (d) { e.preventDefault(); ox += d[0]; oy += d[1]; draw(); }
    });
    const finish = (rect) => { dialog.close(); dialog.remove(); resolve(rect); };
    dialog.querySelector("[data-cancel]").onclick = () => finish(null);
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); finish(null); });
    dialog.querySelector("[data-ok]").onclick = () => { const s = scale(); finish({ sx: -ox / s, sy: -oy / s, sw: vw / s, sh: vh / s }); };
    dialog.showModal();
    frame.focus();
  });
}

const toBlob = (canvas, type, quality) => new Promise((r) => canvas.toBlob(r, type, quality));
const toDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

/** Validate, optionally crop, resize and compress an image file. Returns a data URL ready for upload, or null if cancelled. */
export async function processImage(file, kind) {
  const spec = IMAGE_SPECS[kind];
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Choose a PNG, JPEG or WebP image.");
  if (file.size > 20 * 1024 * 1024) throw new Error("This image is larger than 20 MB. Choose a smaller one.");
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error("This image could not be read."); }
  let sx = 0, sy = 0, sw = bitmap.width, sh = bitmap.height, w, h;
  if (spec.crop) {
    const rect = await cropDialog(bitmap, spec.w / spec.h, `Adjust ${spec.label.toLowerCase()}`);
    if (!rect) return null;
    ({ sx, sy, sw, sh } = rect);
    w = Math.min(spec.w, Math.round(sw)); h = Math.round(w * spec.h / spec.w);
  } else {
    const r = Math.min(1, spec.max / Math.max(sw, sh));
    w = Math.round(sw * r); h = Math.round(sh * r);
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, w); canvas.height = Math.max(1, h);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  for (const quality of [0.86, 0.78, 0.68, 0.56]) {
    let blob = await toBlob(canvas, "image/webp", quality);
    if (!blob || blob.type !== "image/webp") blob = await toBlob(canvas, spec.alpha ? "image/png" : "image/jpeg", quality);
    if (blob && blob.size <= MAX_UPLOAD) return toDataUrl(blob);
  }
  throw new Error("Could not compress this image under 2 MB. Try a smaller image.");
}
