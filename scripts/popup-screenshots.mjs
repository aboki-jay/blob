// Captures the toolbar popup for the README and for comparing with Figma. Run with:
//   npm run build && node scripts/popup-screenshots.mjs
// The popup is opened as an ordinary page with stand-ins for Chrome's extension
// APIs (tests/e2e/harness.ts), on sample data, so no installed extension is needed.
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import buildHarness from '../tests/e2e/build-harness.ts';
import { HEALTH, ORIGIN } from '../tests/e2e/origin.mjs';

const out = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
await buildHarness();
if (!(await fetch(HEALTH).then((r) => r.ok).catch(() => false))) await import('../tests/e2e/server.mjs');

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 2 });
await context.addInitScript({ path: out('.output/harness/harness.js') });
const page = await context.newPage();

// Sample saved comments on four websites, so "Recent websites" has something to show.
await page.goto(`${ORIGIN}/demo.html`);
await page.evaluate(() => {
  const origins = ['https://ls.agentic.com', 'https://wise.io', 'https://meet.google.com', 'https://linear.app'];
  const threads = {};
  const pages = {};
  origins.forEach((origin, n) => {
    pages[`${origin}/`] = { key: `${origin}/`, origin, url: `${origin}/`, title: '', label: '/' };
    for (let i = 0; i <= n % 2; i++) {
      const id = `sample-thread-${n}-${i}`;
      const at = new Date(Date.now() - n * 60000 - i * 1000).toISOString();
      threads[id] = {
        id,
        pageKey: `${origin}/`,
        origin,
        number: i + 1,
        status: 'open',
        anchor: { selector: 'a', tag: 'a', label: 'Link', offset: { x: 1, y: 0 } },
        messages: [{ id: `${id}-message`, body: 'Sample comment', createdAt: at }],
        createdAt: at,
        updatedAt: at,
      };
    }
  });
  localStorage.setItem('blob-harness-storage', JSON.stringify({ 'blob:data': { version: 1, threads, pages } }));
});

await page.goto(`${ORIGIN}/popup.html`);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);
await page.screenshot({ path: out('docs/screenshots/15-popup.png') });
console.log('15-popup');

await page.getByText('Always show on wise.com').click();
await page.getByRole('navigation', { name: 'Recent websites' }).getByRole('link').first().hover();
await page.waitForTimeout(300);
await page.screenshot({ path: out('docs/screenshots/16-popup-always-show.png') });
console.log('16-popup-always-show');

await browser.close();
process.exit(0);
