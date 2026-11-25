// Captures the README screenshots from a demo page. Run with:
//   npm run build && node scripts/screenshots.mjs
// Uses the test harness (tests/e2e/harness.ts), so it needs no installed extension.
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
// The browser tests or a manual QA session may already be serving the fixture.
import { HEALTH, ORIGIN } from '../tests/e2e/origin.mjs';
const demoUrl = `${ORIGIN}/demo.html`;
if (!await fetch(HEALTH).then(r => r.ok).catch(() => false)) await import('../tests/e2e/server.mjs');
import buildHarness from '../tests/e2e/build-harness.ts';

const out = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
await buildHarness();

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 832 }, deviceScaleFactor: 2 });
await context.addInitScript({ path: out('.output/harness/harness.js') });
const page = await context.newPage();
await page.goto(demoUrl);
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
await page.getByLabel('Guest profile').click();
await button('Dark').click();
await shot('10-profile-dark');
await button('Light').click();
await button('Feedback').click();
await button('Good').hover();
await shot('11-feedback');
await button('Close feedback').click();
await button('Continue as a Guest').click();
await shot('03-empty');
await button('Add a Blob').click();
await page.mouse.move(...overHero);
await shot('04-choose-target');
await page.mouse.click(...overHero);
await page.getByRole('textbox', { name: 'Comment' }).fill('Could we give this button a little more breathing room?');
await shot('05-new-comment');
await button('Post comment').click();
// The comment card stays open and shows the saved comment.
await shot('06-saved');
const comment = page.getByRole('textbox', { name: 'Comment' });
const firstComment = page.locator('blob-overlay .tag-comment').first();
await comment.fill('Agreed. The corners could match the cards below.');
await button('Add comment').click();
await firstComment.hover();
await button('Reply').first().click();
await comment.fill('Tried 16px of padding. Much better.');
await button('Send reply').click();
await firstComment.hover();
await shot('07-conversation');
// The same conversation in the drawer.
await page.keyboard.press('Escape');
await page.locator('blob-overlay .blob').click();
await page.locator('blob-overlay .activity').first().click();
await page.locator('blob-overlay .message').first().hover();
await shot('13-thread-hover');
await button('Back to activity').click();
await shot('08-activity');
await page.locator('blob-overlay .activity').first().hover();
await shot('14-activity-preview');
await button('History').click();
await shot('09-history');
await page.locator('.history-site > details > summary').click();
await page.locator('.history-page > summary').click();
await shot('12-history-expanded');

await browser.close();
process.exit(0);
