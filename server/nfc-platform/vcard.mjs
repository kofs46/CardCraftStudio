// vCard 3.0 (RFC 2426): widest support across Android Contacts and iOS Contacts.
// Escapes \ ; , and newlines, uses CRLF, and folds lines at 75 octets without splitting UTF-8 characters.

const esc = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");

export function fold(line) {
  if (Buffer.byteLength(line) <= 75) return line;
  const out = [];
  let cur = "";
  let len = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (len + n > 75) {
      out.push(cur);
      cur = " ";
      len = 1;
    }
    cur += ch;
    len += n;
  }
  out.push(cur);
  return out.join("\r\n");
}

const telValue = (v) => String(v).replace(/[^\d+]/g, "");

/** `view` is the already visibility-filtered public view (see js/nfc/render.mjs toView). */
export function buildVcard(view) {
  const parts = view.name.trim().split(/\s+/);
  const family = parts.length > 1 ? parts.pop() : "";
  const given = parts.join(" ");
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${esc(family)};${esc(given)};;;`,
    `FN:${esc(view.name)}`,
  ];
  if (view.company) lines.push(`ORG:${esc(view.company)}`);
  if (view.designation) lines.push(`TITLE:${esc(view.designation)}`);
  if (view.phone) lines.push(`TEL;TYPE=CELL,VOICE:${telValue(view.phone)}`);
  if (view.whatsapp && telValue(view.whatsapp) !== telValue(view.phone || "")) lines.push(`TEL;TYPE=CELL:${telValue(view.whatsapp)}`);
  if (view.email) lines.push(`EMAIL;TYPE=INTERNET:${esc(view.email)}`);
  if (view.website) lines.push(`URL:${esc(view.website)}`);
  if (view.url) lines.push(`URL:${esc(view.url)}`);
  if (view.address) lines.push(`ADR;TYPE=WORK:;;${esc(view.address)};;;;`);
  if (view.tagline) lines.push(`NOTE:${esc(view.tagline)}`);
  lines.push("END:VCARD");
  return lines.map(fold).join("\r\n") + "\r\n";
}
