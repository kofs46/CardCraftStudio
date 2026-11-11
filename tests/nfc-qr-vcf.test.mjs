// QR codes decode to the profile URL; vCards are valid; contact/share controls render correctly.
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import jsQR from "jsqr";
import { createApp } from "./helpers/nfc-app.mjs";
import { qrMatrix } from "../server/nfc-platform/qr.mjs";
import { buildVcard, fold } from "../server/nfc-platform/vcard.mjs";
import { waHref, telHref, safeHttp, mailHref } from "../js/nfc/render.mjs";

let app, cu;
before(async () => {
  app = await createApp();
  cu = await app.createCustomer({ full_name: "Nadia Islam", phone: "01711-223344", whatsapp: "01711223344", email: "nadia@example.com", website: "https://nadia.example", address: "House 1, Road 2\nDhaka" });
});

/** Decode our 8-bit greyscale PNG (filter 0) into RGBA and read it with jsQR. */
function decodePng(buf) {
  assert.deepEqual([...buf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  let pos = 8, width, height;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
    if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const v = raw[y * (width + 1) + 1 + x];
      rgba.set([v, v, v, 255], (y * width + x) * 4);
    }
  return jsQR(rgba, width, height)?.data;
}

test("QR PNG decodes to exactly the permanent public URL", async () => {
  const r = await app.request("GET", `/api/nfc/public/${cu.slug}/qr?format=png&download=1`);
  assert.equal(r.status, 200);
  assert.equal(r.headers["content-type"], "image/png");
  assert.match(r.headers["content-disposition"], new RegExp(`${cu.slug}-qr\\.png`));
  assert.equal(decodePng(r.raw), `http://localhost:5175/p/${cu.slug}`);
});

test("QR SVG is valid and encodes the same URL; admin QR works for any status", async () => {
  const svg = await app.request("GET", `/api/nfc/public/${cu.slug}/qr?format=svg`);
  assert.match(svg.headers["content-type"], /image\/svg\+xml/);
  assert.match(svg.text, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.equal(decodeURI(svg.headers["x-qr-content"]), `http://localhost:5175/p/${cu.slug}`);
  const { size, dark } = qrMatrix(`http://localhost:5175/p/${cu.slug}`);
  const scale = 6, px = (size + 8) * scale, rgba = new Uint8ClampedArray(px * px * 4).fill(255);
  for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
    const r = Math.floor(y / scale) - 4, c = Math.floor(x / scale) - 4;
    if (r >= 0 && c >= 0 && r < size && c < size && dark(r, c)) rgba.set([0, 0, 0, 255], (y * px + x) * 4);
  }
  assert.equal(jsQR(rgba, px, px).data, `http://localhost:5175/p/${cu.slug}`);
  await app.admin("POST", `customers/${cu.id}/suspend`);
  assert.equal((await app.request("GET", `/api/nfc/public/${cu.slug}/qr`)).status, 404);
  const adminQr = await app.admin("GET", `customers/${cu.id}/qr?format=png`);
  assert.equal(decodePng(adminQr.raw), `http://localhost:5175/p/${cu.slug}`);
  await app.admin("POST", `customers/${cu.id}/reactivate`);
});

test("QR never contains credentials", async () => {
  const r = await app.request("GET", `/api/nfc/public/${cu.slug}/qr?format=png`);
  const content = decodePng(r.raw);
  assert.ok(!content.includes(cu.userId));
  assert.ok(!content.includes(cu.password));
});

test("vCard downloads with correct headers, CRLF line endings and escaping", async () => {
  const r = await app.request("GET", `/api/nfc/public/${cu.slug}/vcf`);
  assert.equal(r.status, 200);
  assert.equal(r.headers["content-type"], "text/vcard; charset=utf-8");
  assert.match(r.headers["content-disposition"], new RegExp(`attachment; filename="${cu.slug}\\.vcf"`));
  const text = r.text;
  assert.ok(text.startsWith("BEGIN:VCARD\r\nVERSION:3.0\r\n"));
  assert.ok(text.endsWith("END:VCARD\r\n"));
  assert.ok(!/[^\r]\n/.test(text), "only CRLF line breaks");
  assert.match(text, /\r\nN:Islam;Nadia;;;\r\n/);
  assert.match(text, /\r\nFN:Nadia Islam\r\n/);
  assert.match(text, /\r\nTEL;TYPE=CELL,VOICE:01711223344\r\n/);
  assert.match(text, /\r\nEMAIL;TYPE=INTERNET:nadia@example\.com\r\n/);
  assert.match(text, /\r\nADR;TYPE=WORK:;;House 1\\, Road 2\\nDhaka;;;;\r\n/);
  assert.match(text, new RegExp(`URL:http://localhost:5175/p/${cu.slug}`));
});

test("vCard escapes special characters and folds long UTF-8 lines at 75 octets", () => {
  const v = buildVcard({ name: "রহিম উদ্দিন", company: "A; B, C\\D", designation: "", phone: "", whatsapp: "", email: "", website: "", url: "", address: "", tagline: "অ".repeat(60) });
  assert.match(v, /ORG:A\\; B\\, C\\\\D\r\n/);
  for (const line of v.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75, line);
  const unfolded = v.replace(/\r\n /g, "");
  assert.ok(unfolded.includes("NOTE:" + "অ".repeat(60)));
  assert.equal(fold("short"), "short");
});

test("public page wires call, WhatsApp, email, website, save contact, share and QR", async () => {
  const page = (await app.request("GET", `/p/${cu.slug}`)).text;
  assert.match(page, /href="tel:01711223344"/);
  assert.match(page, /href="https:\/\/wa\.me\/8801711223344"/);
  assert.match(page, /href="mailto:nadia@example\.com"/);
  assert.match(page, /href="https:\/\/nadia\.example\/"/);
  assert.match(page, new RegExp(`href="/api/nfc/public/${cu.slug}/vcf" download="${cu.slug}\\.vcf"`));
  assert.match(page, /data-share/);
  assert.match(page, /data-copy/);
  assert.match(page, new RegExp(`src="/api/nfc/public/${cu.slug}/qr\\?format=svg"`));
  assert.match(page, /<script type="module" src="\/js\/nfc\/profile-page\.mjs/);
  assert.match(page, /property="og:url" content="http:\/\/localhost:5175\/p\//);
  assert.match(page, /CardCraft Studio BD/);
});

test("link helpers only produce safe schemes and correct WhatsApp numbers", () => {
  assert.equal(waHref("01711-223344"), "https://wa.me/8801711223344");
  assert.equal(waHref("+880 1711 223344"), "https://wa.me/8801711223344");
  assert.equal(waHref("00447700900123"), "https://wa.me/447700900123");
  assert.equal(waHref("12"), "");
  assert.equal(telHref("+880 1711-223344"), "tel:+8801711223344");
  assert.equal(safeHttp("javascript:alert(1)"), "");
  assert.equal(safeHttp("https://a.example/x"), "https://a.example/x");
  assert.equal(mailHref("bad"), "");
});
