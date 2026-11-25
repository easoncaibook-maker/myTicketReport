// 生成应用图标 build/win/app.ico（纯 Node 实现，无需 GDI+）
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'build', 'win');
mkdirSync(OUT, { recursive: true });

const SIZE = 256;
const SS = 3; // 超采样倍数
const W = SIZE * SS;
const buf = new Float64Array(W * W * 4); // RGBA 0..1

function blend(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= W || y >= W || a <= 0) return;
  const i = (y * W + x) * 4;
  const sa = Math.min(a, 1);
  const da = buf[i + 3];
  const oa = sa + da * (1 - sa);
  if (oa <= 0) return;
  buf[i] = (r * sa + buf[i] * da * (1 - sa)) / oa;
  buf[i + 1] = (g * sa + buf[i + 1] * da * (1 - sa)) / oa;
  buf[i + 2] = (b * sa + buf[i + 2] * da * (1 - sa)) / oa;
  buf[i + 3] = oa;
}

function inRoundedRect(px, py, x, y, w, h, rad) {
  const cx = Math.max(x + rad, Math.min(px, x + w - rad));
  const cy = Math.max(y + rad, Math.min(py, y + h - rad));
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= rad * rad;
}

function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
  const dx = px - (ax + t * vx);
  const dy = py - (ay + t * vy);
  return Math.sqrt(dx * dx + dy * dy);
}

const S = (v) => v * SS;

// 背景：圆角矩形 + 竖向渐变
for (let y = 0; y < W; y++) {
  for (let x = 0; x < W; x++) {
    if (!inRoundedRect(x, y, S(8), S(8), S(240), S(240), S(56))) continue;
    const t = y / W;
    blend(x, y, (22 + (9 - 22) * t) / 255, (119 + (88 - 119) * t) / 255, (255 + (217 - 255) * t) / 255, 1);
  }
}

// 纸面
for (let y = 0; y < W; y++) {
  for (let x = 0; x < W; x++) {
    if (inRoundedRect(x, y, S(58), S(46), S(140), S(164), S(18))) {
      blend(x, y, 1, 1, 1, 1);
    }
  }
}

// 文档线条
const lines = [
  [S(82), S(92), S(174)],
  [S(82), S(122), S(174)],
  [S(82), S(152), S(140)],
];
for (let y = 0; y < W; y++) {
  for (let x = 0; x < W; x++) {
    for (const [x1, yy, x2] of lines) {
      if (y >= yy - S(6) && y <= yy + S(6) && x >= x1 && x <= x2) {
        blend(x, y, 0.62, 0.72, 0.88, 1);
      }
    }
  }
}

// 右下角绿色完成标记
const cx = S(186);
const cy = S(184);
const R = S(50);
for (let y = 0; y < W; y++) {
  for (let x = 0; x < W; x++) {
    const dx = x - cx;
    const dy = y - cy;
    if (dx * dx + dy * dy <= R * R) {
      blend(x, y, 82 / 255, 196 / 255, 26 / 255, 1);
    }
  }
}

// 白色对勾
const stroke = S(9);
const p1 = [S(162), S(184)];
const p2 = [S(180), S(202)];
const p3 = [S(212), S(166)];
for (let y = 0; y < W; y++) {
  for (let x = 0; x < W; x++) {
    const dx = x - cx;
    const dy = y - cy;
    if (dx * dx + dy * dy > R * R) continue;
    const d = Math.min(segDist(x, y, p1[0], p1[1], p2[0], p2[1]), segDist(x, y, p2[0], p2[1], p3[0], p3[1]));
    if (d <= stroke) blend(x, y, 1, 1, 1, 1);
  }
}

// 降采样为 256x256 RGBA
const out = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const i = ((y * SS + sy) * W + (x * SS + sx)) * 4;
        const al = buf[i + 3];
        r += buf[i] * al;
        g += buf[i + 1] * al;
        b += buf[i + 2] * al;
        a += al;
      }
    }
    const n = SS * SS;
    const o = (y * SIZE + x) * 4;
    const alpha = a / n;
    out[o] = alpha > 0 ? Math.round((r / a) * 255) : 0;
    out[o + 1] = alpha > 0 ? Math.round((g / a) * 255) : 0;
    out[o + 2] = alpha > 0 ? Math.round((b / a) * 255) : 0;
    out[o + 3] = Math.round(alpha * 255);
  }
}

// PNG 编码
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;
ihdr[9] = 6; // RGBA
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  out.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

// 封装为 ICO
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header[6] = 0; // width 256
header[7] = 0; // height 256
header[8] = 0;
header[9] = 0;
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18);

writeFileSync(path.join(OUT, 'app.png'), png);
writeFileSync(path.join(OUT, 'app.ico'), Buffer.concat([header, png]));
console.log(`icon -> ${path.join(OUT, 'app.ico')} (${png.length + 22} bytes)`);
