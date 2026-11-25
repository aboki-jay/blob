import { fileURLToPath } from 'node:url';
import { test as base, chromium, expect, type BrowserContext, type Page, type Worker } from '@playwright/test';

/**
 * Drives Blob in a real browser on local fixture pages. Two ways to run:
 *
 * - `npm run test:e2e` loads the real, built extension into Chromium. The e2e
 *   build is identical to the release build except that it is allowed on
 *   http://127.0.0.1 from the start, because a test cannot click the browser
 *   toolbar or Chrome's permission prompt.
 * - `npm run test:e2e:harness` loads the built overlay script into an ordinary
 *   page with a stand-in for Chrome's extension APIs (see harness.ts). It
 *   covers the on-page behaviour but not Chrome's injection, permissions or
 *   chrome.storage.
 *
 * The toolbar click and the permission prompt are checked by hand either way
 * (see docs/STATUS.md).
 */

declare const chrome: any; // only used inside code that runs in the browser

const HARNESS = process.env.BLOB_E2E === 'harness';
const out = (path: string) => fileURLToPath(new URL(`../../.output/${path}`, import.meta.url));
const EXTENSION = out('chrome-mv3-e2e');

/** The few things the two ways of running do differently. */
interface Driver {
  /** Goes to a fixture page and waits for the Blob button. */
  open(page: Page, path?: string): Promise<void>;
  reload(page: Page): Promise<void>;
  /** Everything Blob has stored. */
  stored(page: Page): Promise<Record<string, any>>;
  /** Makes every storage write fail, or work again. */
  failWrites(page: Page, fail: boolean): Promise<void>;
  /** What happens when Chrome reports that site access was removed. */
  revokeSite(page: Page): Promise<void>;
}

const blobReady = (page: Page) => expect(page.locator('blob-overlay .blob')).toBeVisible();

function extensionDriver(sw: Worker): Driver {
  return {
    async open(page, path = '/') {
      await page.goto(path);
      await blobReady(page);
    },
    async reload(page) {
      await page.reload();
      await blobReady(page);
    },
    stored: () => sw.evaluate(() => chrome.storage.local.get(null)),
    failWrites: (_page, fail) =>
      sw.evaluate((failing) => {
        const g = globalThis as any;
        g.realSet ??= chrome.storage.local.set;
        chrome.storage.local.set = failing ? () => Promise.reject(new Error('QUOTA_BYTES quota exceeded')) : g.realSet;
      }, fail),
    revokeSite: () => sw.evaluate(() => chrome.storage.local.set({ 'blob:sites': [] })),
  };
}

const harnessDriver: Driver = {
  async open(page, path = '/') {
    await page.goto(path);
    // Stands in for the toolbar click or the registered script putting Blob on the page.
    await page.addScriptTag({ path: out('chrome-mv3/overlay.js') });
    await blobReady(page);
  },
  async reload(page) {
    await page.reload();
    await page.addScriptTag({ path: out('chrome-mv3/overlay.js') });
    await blobReady(page);
  },
  stored: (page) => page.evaluate(() => chrome.storage.local.get(null)),
  failWrites: (page, fail) =>
    page.evaluate((failing) => {
      (globalThis as any).__blobHarness.failWrites = failing;
    }, fail),
  revokeSite: (page) => page.evaluate(() => chrome.storage.local.set({ 'blob:sites': [] })),
};

const VIEWPORT = { width: 1280, height: 900 };

const test = base.extend<{ driver: Driver }>({
  context: async ({ browser }, use) => {
    let context: BrowserContext;
    if (HARNESS) {
      context = await browser.newContext({ viewport: VIEWPORT, baseURL: 'http://127.0.0.1:4173' });
      await context.addInitScript({ path: out('harness/harness.js') });
    } else {
      context = await chromium.launchPersistentContext('', {
        channel: 'chromium',
        viewport: VIEWPORT,
        baseURL: 'http://127.0.0.1:4173',
        args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
      });
    }
    await use(context);
    await context.close();
  },
  driver: async ({ context }, use) => {
    if (HARNESS) return use(harnessDriver);
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    // Wait until Blob has registered itself for the fixture site.
    await expect.poll(() => sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length)).toBe(1);
    await use(extensionDriver(sw));
  },
  page: async ({ context, driver }, use) => {
    void driver; // make sure the extension is ready before any page opens
    const page = await context.newPage();
    // Surface anything Blob or the fixture page throws.
    page.on('pageerror', (error) => console.log(`[page error] ${error.message}`));
    page.on('console', (message) => message.type() === 'error' && console.log(`[console] ${message.text()}`));
    await use(page);
  },
});

const blob = (page: Page) => page.locator('blob-overlay .blob');
const drawer = (page: Page) => page.locator('blob-overlay .drawer');
const pins = (page: Page) => page.locator('blob-overlay .pin');
const composer = (page: Page) => page.locator('blob-overlay .composer');

async function continueAsGuest(page: Page) {
  await blob(page).click();
  await page.getByRole('button', { name: 'Continue as a Guest' }).click();
  await expect(page.getByText('No Blobs on this website yet')).toBeVisible();
}

/** Clicks a point on the page itself, the way a person would while choosing a target. */
async function clickOnPage(page: Page, selector: string) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  const box = (await page.locator(selector).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function pick(page: Page, selector: string) {
  await page.getByRole('button', { name: 'Add a Blob' }).first().click();
  await expect(page.locator('blob-overlay .catcher')).toBeVisible();
  await clickOnPage(page, selector);
  await expect(composer(page)).toBeVisible();
}

async function comment(page: Page, selector: string, text: string) {
  if (!(await drawer(page).isVisible())) await blob(page).click();
  await pick(page, selector);
  await page.getByRole('textbox', { name: 'Comment' }).fill(text);
  await page.getByRole('button', { name: 'Post comment' }).click();
  await expect(composer(page)).toBeHidden();
}

const threads = async (driver: Driver, page: Page) =>
  Object.values(((await driver.stored(page))['blob:data']?.threads ?? {}) as Record<string, any>);

/** Distance between a pin's centre and the top-right corner of an element. */
async function pinGap(page: Page, selector: string, index = 0) {
  const pin = (await pins(page).nth(index).boundingBox())!;
  const el = (await page.locator(selector).boundingBox())!;
  return Math.hypot(pin.x + pin.width / 2 - (el.x + el.width), pin.y + pin.height / 2 - el.y);
}

test('guest journey: comment, reload, reply, resolve, reopen', async ({ page, driver }) => {
  await driver.open(page);
  await continueAsGuest(page);

  // Choosing a target highlights it and does not press the page's own button.
  await page.getByRole('button', { name: 'Add a Blob' }).click();
  const hero = (await page.locator('#hero').boundingBox())!;
  await page.mouse.move(hero.x + 10, hero.y + 10);
  await expect(page.locator('blob-overlay .outline')).toBeVisible();
  await expect(page.getByText('Click to pin your comment here')).toBeVisible();
  await page.mouse.click(hero.x + 10, hero.y + 10);
  expect(await page.evaluate(() => (window as any).heroClicks ?? 0)).toBe(0);
  await expect(page).toHaveTitle('Studio — Example website');

  // An empty or whitespace-only comment is refused.
  await expect(composer(page)).toContainText('Only you · Guest');
  await page.getByRole('button', { name: 'Post comment' }).click();
  await expect(composer(page)).toContainText('Write a comment first.');
  await page.getByRole('textbox', { name: 'Comment' }).fill('   ');
  await page.getByRole('button', { name: 'Post comment' }).click();
  await expect(composer(page)).toContainText('Write a comment first.');
  expect(await threads(driver, page)).toHaveLength(0);

  await page.getByRole('textbox', { name: 'Comment' }).fill('Could we give this button more room?');
  await expect(composer(page)).toContainText('Draft kept in this browser');
  await page.getByRole('button', { name: 'Post comment' }).click();
  await expect(page.getByText('Guest · Saved on this device')).toBeVisible();
  await expect(pins(page)).toHaveCount(1);
  expect(await pinGap(page, '#hero')).toBeLessThan(3);

  // After a reload the pin is back and opens the same conversation.
  await driver.reload(page);
  await expect(pins(page)).toHaveCount(1);
  await pins(page).click();
  await expect(drawer(page)).toContainText('Could we give this button more room?');
  await expect(drawer(page)).toContainText('Only you · Stored on this device');
  await expect(drawer(page)).toContainText('Studio — Example website');

  // Reply locally.
  await page.getByRole('textbox', { name: 'Reply' }).fill('Looks better already.');
  await page.getByRole('textbox', { name: 'Reply' }).press('Enter');
  await expect(drawer(page).locator('.message')).toHaveCount(2);
  await expect(page.getByRole('textbox', { name: 'Reply' })).toHaveValue('');
  await expect(page.getByRole('textbox', { name: 'Reply' })).toBeInViewport();

  // Resolve: the pin goes, the conversation stays and is listed under Resolved.
  await page.getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(drawer(page)).toContainText('Resolved by you');
  await expect(pins(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to activity' }).click();
  await page.getByRole('button', { name: /^Resolved/ }).click();
  await expect(drawer(page)).toContainText('Completed conversations stay here until you reopen them.');
  await expect(drawer(page)).toContainText('Looks better already.');

  // Reopen: it returns with both messages.
  await page.getByRole('button', { name: /^Reopen conversation/ }).click();
  await expect(drawer(page)).toContainText('No resolved conversations');
  await expect(pins(page)).toHaveCount(1);
  const [thread] = await threads(driver, page);
  expect(thread).toMatchObject({ status: 'open', pageKey: 'http://127.0.0.1:4173/', number: 1 });
  expect(thread.messages).toHaveLength(2);
});

test('pages on the same website stay separate, and History groups them', async ({ page, driver }) => {
  await driver.open(page);
  await continueAsGuest(page);
  await comment(page, '#hero', 'Home page comment');
  await driver.open(page, '/pricing.html');
  await expect(pins(page)).toHaveCount(0);
  await comment(page, '#buy', 'Pricing page comment');
  await expect(pins(page)).toHaveCount(1);

  await blob(page).click();
  await expect(drawer(page).getByLabel('This page')).toContainText('Pricing page comment');
  await expect(drawer(page).getByLabel('This page')).not.toContainText('Home page comment');
  await expect(drawer(page).getByLabel(/^Other pages on/)).toContainText('Home page comment');

  await page.getByRole('button', { name: 'History' }).click();
  await expect(drawer(page)).toContainText('127.0.0.1:4173 · 2 conversations · Current website');
  await expect(drawer(page)).toContainText('Pricing — Example website · /pricing.html');
  await expect(drawer(page)).toContainText('Studio — Example website · /');
  expect((await threads(driver, page)).map((t) => t.pageKey).sort()).toEqual(['http://127.0.0.1:4173/', 'http://127.0.0.1:4173/pricing.html']);

  // Back on the home page only its own pin shows.
  await driver.open(page);
  await expect(pins(page)).toHaveCount(1);
  expect(await pinGap(page, '#hero')).toBeLessThan(3);
});

test('anchoring: repeated text, moved target, removed target, reattach', async ({ page, driver }) => {
  await driver.open(page);
  await continueAsGuest(page);
  const second = '.cards section:nth-of-type(2) a';
  await comment(page, second, 'About the second card');
  await comment(page, '#hero', 'About the hero button');
  await driver.reload(page);
  await expect(pins(page)).toHaveCount(2);
  // Three links say "Learn more"; the pin is on the one that was chosen.
  expect(await pinGap(page, second, 0)).toBeLessThan(3);

  // The page moves the button: the pin follows it.
  await page.evaluate(() => document.querySelector('nav')!.append(document.querySelector('#hero')!));
  await expect.poll(() => pinGap(page, '#hero', 1)).toBeLessThan(3);

  // Scrolling keeps the pin on its element.
  await page.evaluate(() => window.scrollTo(0, 120));
  await expect.poll(() => pinGap(page, '#hero', 1)).toBeLessThan(3);
  await page.evaluate(() => window.scrollTo(0, 0));

  // The page removes the button: no pin, but the conversation is kept.
  await page.evaluate(() => document.querySelector('#hero')!.remove());
  await expect(pins(page)).toHaveCount(1);
  await blob(page).click();
  await expect(drawer(page)).toContainText('Location unavailable');
  await page.getByRole('button', { name: /About the hero button/ }).click();
  await expect(drawer(page)).toContainText('Blob can’t find the part this comment was attached to');
  await expect(drawer(page)).toContainText('About the hero button');

  // Reattach to another element. Still one conversation, same number.
  await page.getByRole('button', { name: 'Choose a new location' }).click();
  await clickOnPage(page, '#intro');
  await expect(page.getByText(/^Move this comment to/)).toBeVisible();
  await page.getByRole('button', { name: 'Save location' }).click();
  await expect(drawer(page)).toContainText('About the hero button');
  await expect(drawer(page)).not.toContainText('Location unavailable');
  await expect(pins(page)).toHaveCount(2);
  const saved = await threads(driver, page);
  expect(saved).toHaveLength(2);
  expect(saved.find((t) => t.messages[0].body === 'About the hero button')).toMatchObject({ number: 2, anchor: { tag: 'p' } });
});

test('Escape cancels choosing, and the page works normally afterwards', async ({ page, driver }) => {
  await driver.open(page);
  await continueAsGuest(page);
  await page.getByRole('button', { name: 'Add a Blob' }).click();
  await expect(page.locator('blob-overlay .catcher')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('blob-overlay .catcher')).toHaveCount(0);
  await page.locator('#hero').click();
  expect(await page.evaluate(() => (window as any).heroClicks)).toBe(1);

  // Escape also closes the composer without saving, keeping the draft.
  await blob(page).click();
  await pick(page, '#intro');
  await page.getByRole('textbox', { name: 'Comment' }).fill('Unfinished thought');
  await page.keyboard.press('Escape');
  await expect(composer(page)).toBeHidden();
  await expect(pins(page)).toHaveCount(0);
  await blob(page).click();
  await pick(page, '#intro');
  await expect(page.getByRole('textbox', { name: 'Comment' })).toHaveValue('Unfinished thought');
});

test('a failed save keeps the draft, says so, and a retry saves once', async ({ page, driver }) => {
  await driver.open(page);
  await continueAsGuest(page);
  await pick(page, '#hero');
  await page.getByRole('textbox', { name: 'Comment' }).fill('Please keep this text');

  await driver.failWrites(page, true);
  await page.getByRole('button', { name: 'Post comment' }).click();
  await expect(composer(page)).toContainText('Couldn’t save. Draft kept here.');
  await expect(page.getByRole('textbox', { name: 'Comment' })).toHaveValue('Please keep this text');
  await expect(pins(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(composer(page)).toContainText('Couldn’t save. Draft kept here.');
  expect(await threads(driver, page)).toHaveLength(0);

  await driver.failWrites(page, false);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(composer(page)).toBeHidden();
  await expect(pins(page)).toHaveCount(1);
  const saved = await threads(driver, page);
  expect(saved).toHaveLength(1);
  expect(saved[0].messages).toHaveLength(1);
});

test('nothing typed into the page is stored', async ({ page, driver }) => {
  await driver.open(page);
  await continueAsGuest(page);
  await comment(page, '#password', 'This field needs a label');
  await comment(page, 'textarea[name=notes]', 'Too small');
  const stored = JSON.stringify(await driver.stored(page));
  expect(stored).toContain('This field needs a label');
  expect(stored).not.toMatch(/hunter2|do-not-store|person@example\.com/);
  await driver.reload(page);
  await expect(pins(page)).toHaveCount(2);
});

test('single-page app navigation: no stale pins, one overlay', async ({ page, driver }) => {
  await driver.open(page, '/spa');
  await continueAsGuest(page);
  await comment(page, '#compose', 'Inbox comment');
  await expect(pins(page)).toHaveCount(1);

  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.locator('#save')).toBeVisible();
  await expect(pins(page)).toHaveCount(0);
  await expect(page.locator('blob-overlay')).toHaveCount(1);
  await comment(page, '#save', 'Settings comment');
  await expect(pins(page)).toHaveCount(1);
  expect(await pinGap(page, '#save')).toBeLessThan(3);

  await page.goBack();
  await expect(page.locator('#compose')).toBeVisible();
  await expect(pins(page)).toHaveCount(1);
  await expect.poll(() => pinGap(page, '#compose')).toBeLessThan(3);
  await expect(page.locator('blob-overlay')).toHaveCount(1);
});

test('the Blob button: click opens, drag moves, position is remembered and stays on screen', async ({ page, driver }) => {
  await driver.open(page);
  const before = (await blob(page).boundingBox())!;
  await page.mouse.move(before.x + 28, before.y + 28);
  await page.mouse.down();
  await page.mouse.move(before.x - 300, before.y - 250, { steps: 8 });
  await page.mouse.up();
  await expect(drawer(page)).toBeHidden(); // a drag is not a click
  const moved = (await blob(page).boundingBox())!;
  expect(Math.abs(moved.x - (before.x - 328))).toBeLessThan(3);
  expect(Math.abs(moved.y - (before.y - 278))).toBeLessThan(3);

  await driver.reload(page);
  await expect(blob(page)).toBeVisible();
  await expect.poll(async () => Math.abs((await blob(page).boundingBox())!.x - moved.x)).toBeLessThan(3);

  await page.setViewportSize({ width: 420, height: 380 });
  await expect(blob(page)).toBeInViewport({ ratio: 1 });

  // Keyboard: Enter opens, Escape closes and returns focus to the button.
  await blob(page).focus();
  await page.keyboard.press('Enter');
  await expect(drawer(page)).toBeVisible();
  await expect(drawer(page)).toBeInViewport({ ratio: 1 });
  await page.keyboard.press('Escape');
  await expect(drawer(page)).toBeHidden();
  await expect(blob(page)).toBeFocused();
});

test('the page’s styles do not leak into Blob', async ({ page, driver }) => {
  await driver.open(page);
  await blob(page).click();
  const title = page.locator('blob-overlay .welcome__title');
  const style = await title.evaluate((el) => {
    const s = getComputedStyle(el);
    return { font: s.fontFamily, color: s.color, transform: s.textTransform, spacing: s.letterSpacing, align: s.textAlign, border: s.borderTopStyle, size: s.fontSize };
  });
  expect(style.font).toContain('Blob Geist');
  expect(style.font).not.toContain('Comic Sans');
  expect(style).toMatchObject({ color: 'rgb(38, 39, 44)', transform: 'none', align: 'center', border: 'none', size: '20px' });
  expect(style.spacing).not.toBe('3px');
  // And Blob changes nothing about the page's own elements.
  expect(await page.locator('#intro').evaluate((el) => getComputedStyle(el).textTransform)).toBe('uppercase');
});

test('deleting asks first, then removes the conversation and its replies', async ({ page, driver }) => {
  await driver.open(page);
  await continueAsGuest(page);
  await comment(page, '#hero', 'Delete me');
  await pins(page).click();
  await page.getByRole('textbox', { name: 'Reply' }).fill('A reply');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(drawer(page).locator('.message')).toHaveCount(2);

  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(drawer(page)).toContainText('This removes the comment and its 1 reply from this device.');
  await page.getByRole('button', { name: 'Keep it' }).click();
  expect(await threads(driver, page)).toHaveLength(1);

  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Delete conversation' }).click();
  await expect(drawer(page)).toContainText('No Blobs on this website yet');
  await expect(pins(page)).toHaveCount(0);
  expect(await threads(driver, page)).toHaveLength(0);
});

test('losing site access removes Blob from the page but keeps the comments', async ({ page, driver }) => {
  await driver.open(page);
  await continueAsGuest(page);
  await comment(page, '#hero', 'Keep me');
  // What the background does when Chrome reports the permission was removed.
  await driver.revokeSite(page);
  await expect(page.locator('blob-overlay')).toHaveCount(0);
  expect(await page.evaluate(() => [...document.fonts].filter((f) => f.family.includes('Blob')).length)).toBe(0);
  expect(await threads(driver, page)).toHaveLength(1);
  // The page is fully usable again.
  await page.locator('#hero').click();
  expect(await page.evaluate(() => (window as any).heroClicks)).toBe(1);
});

test('the popup explains pages Blob cannot run on', async ({ page, context }) => {
  test.skip(HARNESS, 'Needs the real extension.');
  const id = new URL(context.serviceWorkers()[0]!.url()).host;
  await page.goto(`chrome-extension://${id}/popup.html`);
  await expect(page.getByText('Blob can’t run on this page')).toBeVisible();
  await expect(page.getByText('No comments yet')).toBeVisible();
  await expect(page.locator('blob-overlay')).toHaveCount(0);
});
