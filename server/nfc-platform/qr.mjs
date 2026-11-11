// QR codes for a profile URL. Encoding: qrcode-generator (MIT). Output: SVG text or a PNG built
// with node:zlib — no image libraries required. Only the public URL is ever encoded.
import qrcode from "qrcode-generator";
import { deflateSync } from "node:zlib";

export function qrMatrix(text, ecc = "M") {
  const qr = qrcode(0, ecc);
  qr.addData(text, "Byte");
  qr.make();
  const size = qr.getModuleCount();
  return { size, dark: (r, c) => qr.isDark(r, c) };
}

export function qrSvg(text, { margin = 4, dark = "#000000", light = "#ffffff" } = {}) {
  const { size, dark: isDark } = qrMatrix(text);
  const full = size + margin * 2;
  let d = "";
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++) if (isDark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" width="${full * 8}" height="${full * 8}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="100%" height="100%" fill="${light}"/><path fill="${dark}" d="${d}"/></svg>`;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** 8-bit greyscale PNG, `scale` pixels per module, `margin` modules of quiet zone. */
export function qrPng(text, { scale = 12, margin = 4 } = {}) {
  const { size, dark } = qrMatrix(text);
  const px = (size + margin * 2) * scale;
  const raw = Buffer.alloc((px + 1) * px, 255);
  for (let y = 0; y < px; y++) {
    raw[y * (px + 1)] = 0; // filter: none
    const r = Math.floor(y / scale) - margin;
    for (let x = 0; x < px; x++) {
      const c = Math.floor(x / scale) - margin;
      if (r >= 0 && c >= 0 && r < size && c < size && dark(r, c)) raw[y * (px + 1) + 1 + x] = 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(px, 0);
  ihdr.writeUInt32BE(px, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
