#!/usr/bin/env node
// Genera los iconos PNG de la PWA sin dependencias (zlib + CRC32 propios).
// Uso: node scripts/generate-icons.mjs   (ya se incluyen generados en apps/web/public/icons)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'public', 'icons');
mkdirSync(out, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const png = (size, pixel) => {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x / size, y / size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
};

const lerp = (a, b, t) => Math.round(a + (b - a) * t);
const inRound = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

/** Icono: fondo violeta con degradado + calendario blanco con marca de verificacion. `pad` reduce el glifo (maskable). */
const icon = (rounded, pad) => (u, v) => {
  const bgOk = rounded ? inRound(u, v, 0, 0, 1, 1, 0.22) : true;
  if (!bgOk) return [0, 0, 0, 0];
  let col = [lerp(124, 168, v), lerp(58, 85, v), lerp(237, 247, v), 255]; // violeta -> orquidea
  // coordenadas del glifo en [0,1]
  const g = (u - 0.5) / (1 - pad * 2) + 0.5;
  const h = (v - 0.5) / (1 - pad * 2) + 0.5;
  const body = inRound(g, h, 0.2, 0.26, 0.8, 0.8, 0.07);
  const header = inRound(g, h, 0.2, 0.26, 0.8, 0.42, 0.07) && h < 0.43;
  const ring = inRound(g, h, 0.32, 0.18, 0.39, 0.34, 0.035) || inRound(g, h, 0.61, 0.18, 0.68, 0.34, 0.035);
  if (ring) return [255, 255, 255, 255];
  if (header) return [233, 222, 255, 255];
  if (body) {
    // marca de verificacion violeta
    const d = (px, py, qx, qy, w) => {
      const dx = qx - px, dy = qy - py, t = Math.max(0, Math.min(1, ((g - px) * dx + (h - py) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(g - (px + t * dx), h - (py + t * dy)) < w;
    };
    if (d(0.34, 0.62, 0.46, 0.72, 0.028) || d(0.46, 0.72, 0.68, 0.5, 0.028)) return [124, 58, 237, 255];
    return [255, 255, 255, 255];
  }
  return col;
};

const files = [
  ['icon-192.png', 192, icon(true, 0.14)],
  ['icon-512.png', 512, icon(true, 0.14)],
  ['maskable-512.png', 512, icon(false, 0.26)],
  ['apple-touch-icon.png', 180, icon(false, 0.16)],
];
for (const [name, size, fn] of files) {
  writeFileSync(join(out, name), png(size, fn));
  console.log('✔', name);
}
