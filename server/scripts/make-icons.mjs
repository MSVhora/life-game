// Generates the PNG app icons without any dependency: node scripts/make-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

function crc32(buf) {
  let c, crc = ~0;
  for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x / size, y / size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// Distance from point to segment, for the check mark.
function seg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
const BG = [79, 70, 229], FG = [255, 255, 255];
function icon(pad, rounded) {
  return (u, v) => {
    // Rounded square background (or full bleed for maskable).
    let inside = true;
    if (rounded) {
      const r = 0.22, cx = Math.min(Math.max(u, r), 1 - r), cy = Math.min(Math.max(v, r), 1 - r);
      inside = Math.hypot(u - cx, v - cy) <= r;
    }
    if (!inside) return [0, 0, 0, 0];
    const s = (x) => pad + x * (1 - 2 * pad);
    const d = Math.min(seg(u, v, s(0.26), s(0.54), s(0.43), s(0.71)), seg(u, v, s(0.43), s(0.71), s(0.76), s(0.3)));
    const ring = Math.abs(Math.hypot(u - 0.5, v - 0.5) - (0.5 - pad) * 0.92);
    return d < 0.045 || ring < 0.018 ? [...FG, 255] : [...BG, 255];
  };
}
mkdirSync(new URL('../public/icons/', import.meta.url), { recursive: true });
for (const [name, size, pad, rounded] of [['icon-192.png', 192, 0.1, true], ['icon-512.png', 512, 0.1, true], ['maskable-512.png', 512, 0.22, false]]) {
  writeFileSync(new URL(`../public/icons/${name}`, import.meta.url), png(size, icon(pad, rounded)));
}
console.log('icons written');
