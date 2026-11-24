// One-off: renders icon.svg to the PNG sizes the manifest and iOS need.
// Run: node tests/make-icons.mjs   (PNGs are committed; this is not part of any build)
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const svg = await readFile(root + 'icon.svg', 'utf8');
const sizes = { 'icon-180.png': 180, 'icon-192.png': 192, 'icon-512.png': 512, 'icon-maskable-512.png': 512 };

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, size] of Object.entries(sizes)) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
  await page.screenshot({ path: root + file, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', file);
}
await browser.close();
