// Generates the PWA icons (PNG) with no dependencies: `node scripts/make-icons.js`
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(OUT, { recursive: true });

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function draw(size, { rounded, scale }) {
  const buf = Buffer.alloc(size * size * 4);
  const S = 4; // supersampling
  const c = size / 2, R = size * 0.22 * (rounded ? 1 : 0);
  // ship pointing up-right, in unit coords (-1..1)
  const rot = -Math.PI / 4;
  const ship = [[20, 0], [-12, -14], [-6, 0], [-12, 14]].map(([x, y]) => {
    const k = scale / 22;
    return [(x * Math.cos(rot) - y * Math.sin(rot)) * k + 0.04, (x * Math.sin(rot) + y * Math.cos(rot)) * k + 0.04];
  });
  const outline = ship.map(([x, y]) => [x * 1.16 + 0.003, y * 1.16 + 0.003]);
  const stars = [[-0.62, -0.5, 0.03], [0.55, 0.62, 0.025], [-0.45, 0.6, 0.02], [0.66, -0.2, 0.018], [-0.1, -0.72, 0.02]];
  const red = hex('#ff4766'), bgA = hex('#141a44'), bgB = hex('#05060f');

  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const X = px + (sx + 0.5) / S, Y = py + (sy + 0.5) / S;
      // rounded-square mask
      if (rounded) {
        const dx = Math.max(Math.abs(X - c) - (c - R), 0), dy = Math.max(Math.abs(Y - c) - (c - R), 0);
        if (dx * dx + dy * dy > R * R) continue;
      }
      const u = (X - c) / c, v = (Y - c) / c;
      const d = Math.hypot(u, v);
      let col = bgB.map((q, i) => q + (bgA[i] - q) * Math.max(0, 1 - d * 0.9));
      // glow behind ship
      const gl = Math.max(0, 1 - Math.hypot(u - 0.04, v - 0.04) / (scale * 0.95));
      col = col.map((q, i) => q + (red[i] - q) * gl * gl * 0.45);
      for (const [sx2, sy2, sr] of stars) if (Math.hypot(u - sx2, v - sy2) < sr) col = [255, 255, 255];
      if (inPoly(u, v, outline)) col = [255, 255, 255];
      if (inPoly(u, v, ship)) col = red;
      if (Math.hypot(u - ship[0][0] * 0.15 - 0.04, v - ship[0][1] * 0.15 - 0.04) < scale * 0.075 && inPoly(u, v, ship)) col = [11, 13, 28];
      r += col[0]; g += col[1]; b += col[2]; a += 255;
    }
    const n = S * S, o = (py * size + px) * 4;
    if (a === 0) { buf[o + 3] = 0; continue; }
    const cov = a / 255;
    buf[o] = r / cov; buf[o + 1] = g / cov; buf[o + 2] = b / cov; buf[o + 3] = a / n;
  }
  return png(size, buf);
}

const jobs = [
  ['icon-192.png', 192, { rounded: true, scale: 0.62 }],
  ['icon-512.png', 512, { rounded: true, scale: 0.62 }],
  ['icon-180.png', 180, { rounded: false, scale: 0.6 }],
  ['maskable-512.png', 512, { rounded: false, scale: 0.46 }],
];
for (const [name, size, opts] of jobs) {
  fs.writeFileSync(path.join(OUT, name), draw(size, opts));
  console.log('wrote', name);
}
