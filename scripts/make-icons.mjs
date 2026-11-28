// Renders the toolbar icons from the mascot SVG. Run with: node scripts/make-icons.mjs
// Uses the Chromium that Playwright installs, so there is no image library to add.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const svg = await readFile(new URL('../assets/icons/mascot.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
await mkdir(new URL('../public/icon/', import.meta.url), { recursive: true });

for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  await writeFile(new URL(`../public/icon/${size}.png`, import.meta.url), png);
  console.log(`icon/${size}.png`);
}
await browser.close();
