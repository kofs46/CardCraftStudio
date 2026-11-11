// Password hashing with node:crypto only (no native add-ons).
// Primary: Argon2id (RFC 9106 second recommended profile: m=64 MiB, t=3, p=1).
// Fallback on runtimes without crypto.argon2 (Node < 24.7): scrypt N=2^17, r=8, p=1 (OWASP).
// The algorithm and parameters are stored in each hash, so verification never guesses.
import * as crypto from "node:crypto";
import { promisify } from "node:util";
import { ApiError } from "../supabase.mjs";

const scrypt = promisify(crypto.scrypt);
const argon2 = typeof crypto.argon2 === "function" ? promisify(crypto.argon2) : null;

let params = { memory: 65536, passes: 3, parallelism: 1, scryptLog: 17 };
/** Tests only: lower the work factor so suites run quickly. Never called by application code. */
export function setHashParamsForTests(next) {
  params = { ...params, ...next };
}

const b64 = (buf) => buf.toString("base64").replace(/=+$/, "");
const unb64 = (s) => Buffer.from(s, "base64");

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  if (argon2) {
    const { memory, passes, parallelism } = params;
    const tag = await argon2("argon2id", { message: password, nonce: salt, parallelism, tagLength: 32, memory, passes });
    return `$argon2id$v=19$m=${memory},t=${passes},p=${parallelism}$${b64(salt)}$${b64(tag)}`;
  }
  const N = 2 ** params.scryptLog;
  const key = await scrypt(password, salt, 32, { N, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  return `$scrypt$ln=${params.scryptLog},r=8,p=1$${b64(salt)}$${b64(key)}`;
}

export async function verifyPassword(password, stored) {
  if (typeof password !== "string" || typeof stored !== "string") return false;
  const parts = stored.split("$");
  try {
    if (parts[1] === "argon2id" && parts.length === 6) {
      if (!argon2) throw new ApiError("Password service unavailable on this runtime.", 503);
      const m = /^m=(\d+),t=(\d+),p=(\d+)$/.exec(parts[3]);
      if (!m) return false;
      const [memory, passes, parallelism] = m.slice(1).map(Number);
      if (memory > 262144 || passes > 10 || parallelism > 4) return false;
      const expected = unb64(parts[5]);
      const actual = await argon2("argon2id", { message: password, nonce: unb64(parts[4]), parallelism, tagLength: expected.length, memory, passes });
      return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
    }
    if (parts[1] === "scrypt" && parts.length === 5) {
      const m = /^ln=(\d+),r=(\d+),p=(\d+)$/.exec(parts[2]);
      if (!m) return false;
      const [ln, r, p] = m.slice(1).map(Number);
      if (ln > 20 || r > 16 || p > 4) return false;
      const expected = unb64(parts[4]);
      const actual = await scrypt(password, unb64(parts[3]), expected.length, { N: 2 ** ln, r, p, maxmem: 512 * 1024 * 1024 });
      return crypto.timingSafeEqual(actual, expected);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    return false;
  }
  return false;
}

// Used when the User ID does not exist so response time does not reveal which IDs are real.
let dummy;
export async function burnPasswordCheck(password) {
  dummy ??= await hashPassword(crypto.randomBytes(18).toString("base64"));
  await verifyPassword(String(password || ""), dummy);
}

const COMMON = new Set(["password1", "password123", "12345678910", "qwerty12345", "cardcraft123", "letmein123", "welcome123", "admin12345", "bangladesh1"]);

/** Returns an error message, or "" when the password is acceptable. */
export function passwordProblem(password, userId = "") {
  if (typeof password !== "string") return "Enter a password.";
  if (password.length < 10) return "Password must be at least 10 characters.";
  if (password.length > 128) return "Password must be at most 128 characters.";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "Use letters and at least one number.";
  if (/^(.)\1+$/.test(password) || COMMON.has(password.toLowerCase())) return "This password is too easy to guess.";
  if (userId && password.toLowerCase().includes(userId.toLowerCase())) return "Password must not contain the User ID.";
  return "";
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
/** Server-side generator (also available in the browser via crypto.getRandomValues). */
export function generatePassword(length = 14) {
  for (;;) {
    let out = "";
    for (let i = 0; i < length; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
    if (!passwordProblem(out) && /[A-Z]/.test(out) && /[a-z]/.test(out)) return out;
  }
}
