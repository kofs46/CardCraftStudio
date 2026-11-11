// /nfc/login — customer sign-in with User ID + password. No registration, OTP or email verification.
import { api } from "./common.mjs";

const form = document.getElementById("login");
const error = document.getElementById("login-error");
const pw = document.getElementById("password");
const toggle = document.getElementById("toggle-pw");

api("/api/nfc/auth/session").then((s) => { if (s?.authenticated) location.replace("/nfc/dashboard"); }).catch(() => {});

toggle.addEventListener("click", () => {
  const show = pw.type === "password";
  pw.type = show ? "text" : "password";
  toggle.setAttribute("aria-pressed", String(show));
  toggle.textContent = show ? "Hide" : "Show";
  pw.focus();
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  error.hidden = true;
  const button = form.querySelector("button[type=submit]");
  const userId = form.user_id.value.trim();
  if (!userId || !pw.value) {
    error.textContent = "Enter your User ID and password.";
    error.hidden = false;
    return;
  }
  button.disabled = true;
  button.textContent = "Signing in…";
  try {
    await api("/api/nfc/auth/login", { method: "POST", body: { user_id: userId, password: pw.value } });
    location.replace("/nfc/dashboard");
  } catch (err) {
    error.textContent = err.status === 429 ? "Too many attempts. Please wait 15 minutes and try again." : err.message;
    error.hidden = false;
    pw.value = "";
    pw.focus();
    button.disabled = false;
    button.textContent = "Log in";
  }
});
