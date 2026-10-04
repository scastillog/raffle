// Generates frontend/og-image.png, the 1200x630 preview card shown when the link is shared
// (WhatsApp, Facebook, Telegram...). Reuses the pixel-art hand and heart from frontend/intro.js.
// Run: node scripts/gen-og-image.mjs   (needs Playwright with Chromium: npx playwright install chromium)
// Edit the texts below if the prize or price change, then re-run and deploy.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const TEXT = {
  kicker: 'RIFA SOLIDARIA',
  prizeLabel: 'PREMIO',
  prize: '$1.000.000',
  details: ['Boleto $25.000 · 2 números', 'Juega con la Lotería de Boyacá'],
  cause: '♥ Ayúdanos a recuperar una mano',
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const intro = readFileSync(join(root, 'frontend', 'intro.js'), 'utf8');
const grab = (name) => {
  const m = intro.match(new RegExp(`const ${name} = (\\[[\\s\\S]*?\\]|\\{[\\s\\S]*?\\});`));
  if (!m) throw new Error(`${name} not found in intro.js`);
  return Function(`return ${m[1]}`)();
};
const sprites = { hand: grab('HAND'), heart: grab('HEART_BIG'), palette: grab('PALETTE') };

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=block" rel="stylesheet">
<style>
  * { margin: 0; box-sizing: border-box; }
  body { width: 1200px; height: 630px; background: #0a2a1f; color: #f2e8cd; overflow: hidden; position: relative; }
  body::after { content: ""; position: absolute; inset: 0;
    background: repeating-linear-gradient(to bottom, rgba(0,0,0,.16) 0 3px, transparent 3px 6px); }
  canvas { position: absolute; inset: 0; image-rendering: pixelated; }
  .text { position: absolute; left: 600px; top: 92px; width: 560px; }
  .kicker { font: 26px/1.4 "Press Start 2P"; color: #a8d5b9; letter-spacing: 2px; }
  .label { font: 22px/1 "Press Start 2P"; color: #f2e8cd; margin-top: 38px; }
  .prize { font: 52px/1.2 "Press Start 2P"; color: #f0b429; text-shadow: 5px 5px 0 #2a1a10; margin-top: 14px; }
  .details { font: 44px/1.15 "VT323"; margin-top: 30px; }
  .cause { display: inline-block; font: 40px/1 "VT323"; color: #0a2a1f; background: #f0b429;
    padding: 10px 16px 12px; margin-top: 34px; box-shadow: 6px 6px 0 #2a1a10; }
</style></head><body>
<canvas id="art" width="1200" height="630"></canvas>
<div class="text">
  <div class="kicker">${TEXT.kicker}</div>
  <div class="label">${TEXT.prizeLabel}</div>
  <div class="prize">${TEXT.prize}</div>
  <div class="details">${TEXT.details.join('<br>')}</div>
  <div class="cause">${TEXT.cause}</div>
</div>
<script>
  const { hand, heart, palette } = ${JSON.stringify(sprites)};
  const ctx = document.getElementById('art').getContext('2d');
  const P = 13; // size of one art pixel
  const draw = (rows, ox, oy, colors = palette) => rows.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === '.') return;
    ctx.fillStyle = colors[c];
    ctx.fillRect(ox + x * P, oy + y * P, P, P);
  }));
  // Stars
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 70; i++) {
    ctx.fillStyle = rnd() > 0.75 ? '#f0b429' : '#2f5e4c';
    ctx.fillRect(Math.floor(rnd() * 150) * 8, Math.floor(rnd() * 78) * 8, 6, 6);
  }
  const handX = 110, handY = 165;
  draw(hand, handX, handY);
  draw(heart, handX + (hand[0].length * P) / 2 - (heart[0].length * P) / 2 - P, handY - heart.length * P - P);
  // Healing sparkles
  const plus = (x, y, c) => { ctx.fillStyle = c; for (const [dx, dy] of [[0,0],[-1,0],[1,0],[0,-1],[0,1]]) ctx.fillRect(x + dx * 8, y + dy * 8, 8, 8); };
  plus(118, 120, '#f0b429'); plus(472, 210, '#a8d5b9'); plus(500, 410, '#f0b429'); plus(86, 380, '#a8d5b9');
</script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: join(root, 'frontend', 'og-image.png') });
await browser.close();
console.log('Wrote frontend/og-image.png');
