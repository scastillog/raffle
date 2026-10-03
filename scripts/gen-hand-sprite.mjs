// Generates the HAND sprite used in frontend/intro.js.
// Run: node scripts/gen-hand-sprite.mjs  and paste the output over `const HAND = [...]`.
// Shapes are filled with bandage, then an outline is added automatically around them.
const W = 28;
const H = 33;
const PALM_TOP = 15;
// [x0, width, topRow]: index and middle full length; ring and little finger are short stumps.
const FINGERS = [
  [6, 4, 4],
  [11, 4, 1],
  [16, 4, 9],
  [21, 3, 11],
];
const THUMB = [[13, 2, 3], [14, 1, 4], [15, 1, 5], [16, 2, 6], [17, 3, 6], [18, 4, 6], [19, 5, 6], [20, 5, 6]];

const g = Array.from({ length: H }, () => Array(W).fill('.'));
const set = (x, y, c) => { if (x >= 0 && x < W && y >= 0 && y < H) g[y][x] = c; };
const fill = (x, y) => set(x, y, 'b'); // bandage, textured below

for (const [x0, w, top] of FINGERS) {
  for (let y = top; y <= PALM_TOP; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (y === top && (x === x0 || x === x0 + w - 1)) continue; // rounded tip
      fill(x, y);
    }
  }
}
for (let y = PALM_TOP; y < 27; y++) {
  const inset = y > 23 ? y - 23 : 0;
  for (let x = 6 + inset; x < 24 - inset; x++) fill(x, y);
}
for (const [y, a, b] of THUMB) for (let x = a; x <= b; x++) fill(x, y);

// Bandage texture: diagonal wraps, a shaded right edge, and a strip of tape across the palm.
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (g[y][x] !== 'b') continue;
    const edge = g[y][x + 1] !== 'b';
    g[y][x] = edge ? 'g' : (x + y) % 4 === 0 ? 'g' : 'w';
  }
}
for (let x = 8; x < 22; x++) if (g[20][x] !== '.') set(x, 20, x % 2 ? 't' : 'T');
// Wrist skin and sleeve
for (let x = 9; x < 21; x++) set(x, 27, 's');
for (let y = 28; y < 32; y++) for (let x = 8; x < 22; x++) set(x, y, y === 30 ? 'C' : 'c');

const solid = (x, y) => x >= 0 && x < W && y >= 0 && y < H && g[y][x] !== '.' && g[y][x] !== 'o';
const out = g.map((row) => [...row]);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (g[y][x] !== '.') continue;
    if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) out[y][x] = 'o';
  }
}
console.log(out.map((r) => `  '${r.join('')}',`).join('\n'));
