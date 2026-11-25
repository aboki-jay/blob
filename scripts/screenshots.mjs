// Captures the README screenshots from a demo page. Run with:
//   npm run build && node scripts/screenshots.mjs
// Uses the test harness (tests/e2e/harness.ts), so it needs no installed extension.
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import '../tests/e2e/server.mjs';
import buildHarness from '../tests/e2e/build-harness.ts';

const out = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
await buildHarness();

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 832 }, deviceScaleFactor: 2 });
await context.addInitScript({ path: out('.output/harness/harness.js') });
const page = await context.newPage();
await page.goto('http://127.0.0.1:4173/demo.html');
await page.addScriptTag({ path: out('.output/chrome-mv3/overlay.js') });
await page.evaluate(() => document.fonts.ready);

const shot = async (name) => {
  await page.waitForTimeout(250);
  await page.screenshot({ path: out(`docs/screenshots/${name}.png`) });
  console.log(name);
};
const button = (name) => page.getByRole('button', { name, exact: true });
const hero = await page.locator('#hero').boundingBox();
const overHero = [hero.x + hero.width / 2, hero.y + hero.height / 2];

await shot('01-blob-button');
await page.locator('blob-overlay .blob').click();
await shot('02-welcome');
await button('Continue as a Guest').click();
await shot('03-empty');
await button('Add a Blob').click();
await page.mouse.move(...overHero);
await shot('04-choose-target');
await page.mouse.click(...overHero);
await page.getByRole('textbox', { name: 'Comment' }).fill('Could we give this button a little more breathing room?');
await shot('05-new-comment');
await button('Post comment').click();
await shot('06-saved');
await page.locator('blob-overlay .pin').click();
await page.getByRole('textbox', { name: 'Reply' }).fill('Tried 16px of padding. Much better.');
await button('Send reply').click();
await shot('07-conversation');
await button('Back to activity').click();
await shot('08-activity');
await button('History').click();
await shot('09-history');

await browser.close();
process.exit(0);
