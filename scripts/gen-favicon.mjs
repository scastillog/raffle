// Generates frontend/favicon.ico: a pixel-art bandaged left hand with a heart, matching the intro.
// Run: node scripts/gen-favicon.mjs [previewDir]
// Drawn on a 16x16 grid and stored at 16, 32 and 48 px (nearest-neighbour, so pixels stay crisp).
// No dependencies: PNG and ICO files are encoded by hand.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 16;
const COLORS = {
  G: [0x0b, 0x4a, 0x36, 255], // background, brand green
  o: [0x05, 0x1f, 0x16, 255], // outline
  w: [0xfb, 0xf7, 0xec, 255], // bandage
  g: [0xcf, 0xc6, 0xb0, 255], // bandage shade
  r: [0xe0, 0x45, 0x3a, 255], // heart
  y: [0xf0, 0xb4, 0x29, 255], // sparkle
};

// Shapes in right-hand coordinates (thumb on the left); mirrored below into a left hand.
// [x0, width, topRow]: index and middle full, ring and little finger short (as in the intro).
const FINGERS = [[4, 2, 3], [7, 2, 1], [10, 2, 5], [13, 1, 7]];
const PALM = { top: 8, bottom: 12, x0: 4, x1: 13 };
const THUMB = [[7, 1, 2], [8, 2, 3], [9, 3, 3]]; // [row, fromX, toX]
const HEART = ['.r.r.', 'rrrrr', '.rrr.', '..r..'];

const grid = Array.from({ length: SIZE }, () => Array(SIZE).fill('G'));
const mx = (x) => SIZE - 1 - x;
const hand = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
const fill = (x, y) => { hand[y][mx(x)] = true; };

for (const [x0, w, top] of FINGERS) for (let y = top; y < PALM.top; y++) for (let x = x0; x < x0 + w; x++) fill(x, y);
for (let y = PALM.top; y <= PALM.bottom; y++) for (let x = PALM.x0; x <= PALM.x1; x++) fill(x, y);
for (let x = PALM.x0 + 1; x <= PALM.x1 - 1; x++) fill(x, PALM.bottom + 1);
for (const [y, a, b] of THUMB) for (let x = a; x <= b; x++) fill(x, y);

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    if (hand[y][x]) {
      grid[y][x] = hand[y][x + 1] ? 'w' : 'g'; // shade the right edge of each shape
    } else if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => hand[y + dy]?.[x + dx])) {
      grid[y][x] = 'o';
    }
  }
}
// Heart centred on the palm (left-hand coordinates).
HEART.forEach((row, dy) => [...row].forEach((c, dx) => { if (c !== '.') grid[9 + dy][4 + dx] = c; }));
grid[2][2] = 'y';
grid[1][2] = grid[3][2] = grid[2][1] = grid[2][3] = 'y';

// Rounded corners: clear the outermost corner pixels.
for (const [x, y] of [[0, 0], [1, 0], [0, 1], [15, 0], [14, 0], [15, 1], [0, 15], [1, 15], [0, 14], [15, 15], [14, 15], [15, 14]]) {
  grid[y][x] = '.';
}

function rgba(scale) {
  const n = SIZE * scale;
  const buf = Buffer.alloc(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const c = COLORS[grid[Math.floor(y / scale)][Math.floor(x / scale)]] ?? [0, 0, 0, 0];
      buf.set(c, (y * n + x) * 4);
    }
  }
  return { n, buf };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, i) => {
  let c = i;
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
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png({ n, buf }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0);
  ihdr.writeUInt32BE(n, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  const raw = Buffer.alloc(n * (n * 4 + 1));
  for (let y = 0; y < n; y++) buf.copy(raw, y * (n * 4 + 1) + 1, y * n * 4, (y + 1) * n * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
// ICO container with PNG-encoded images (supported by all current browsers).
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ n, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(n >= 256 ? 0 : n, e);
    header.writeUInt8(n >= 256 ? 0 : n, e + 1);
    header.writeUInt16LE(1, e + 4); // planes
    header.writeUInt16LE(32, e + 6); // bits per pixel
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((im) => im.data)]);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const images = [1, 2, 3].map((s) => {
  const img = rgba(s);
  return { n: img.n, data: png(img) };
});
writeFileSync(join(root, 'frontend', 'favicon.ico'), ico(images));
console.log(grid.map((r) => r.join('')).join('\n'));
if (process.argv[2]) writeFileSync(join(process.argv[2], 'favicon-preview.png'), png(rgba(16)));
