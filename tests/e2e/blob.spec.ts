import { fileURLToPath } from 'node:url';
import { HOST, ORIGIN } from './origin.mjs';
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
  /** The last feedback the (stand-in) relay received, or null. */
  feedbackSent(page: Page): Promise<Record<string, unknown> | null>;
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
    feedbackSent: async (page) => (await page.request.get(`${ORIGIN}/__feedback`)).json(),
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
  feedbackSent: (page) => page.evaluate(() => (globalThis as any).__blobHarness.feedback.sent.at(-1) ?? null),
};

const VIEWPORT = { width: 1280, height: 900 };

const test = base.extend<{ driver: Driver }>({
  context: async ({ browser }, use) => {
    let context: BrowserContext;
    if (HARNESS) {
      context = await browser.newContext({ viewport: VIEWPORT, baseURL: ORIGIN });
      await context.addInitScript({ path: out('harness/harness.js') });
    } else {
      context = await chromium.launchPersistentContext('', {
        channel: 'chromium',
        viewport: VIEWPORT,
        baseURL: ORIGIN,
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
  page: async ({ context, driver }, use, testInfo) => {
    void driver; // make sure the extension is ready before any page opens
    const page = await context.newPage();
    // Surface anything Blob or the fixture page throws.
    page.on('pageerror', (error) => console.log(`[page error] ${error.message}`));
    page.on('console', (message) => message.type() === 'error' && console.log(`[console] ${message.text()}`));
    await use(page);
    // When a test fails, say what Blob was showing. A failure that only happens
    // on CI cannot be looked at any other way.
    if (testInfo.status !== testInfo.expectedStatus) {
      const state = await page
        .evaluate(() => {
          const root = document.querySelector('blob-overlay')?.shadowRoot;
          const box = (el: Element | null | undefined) => {
            const r = el?.getBoundingClientRect();
            return r ? [r.x, r.y, r.width, r.height].map(Math.round).join(',') : null;
          };
          const harness = (globalThis as any).__blobHarness;
          const stored = JSON.parse(localStorage.getItem('blob-harness-storage') ?? '{}');
          const messages = Object.values((stored['blob:data']?.threads ?? {}) as Record<string, { messages: { reactions?: string[] }[] }>);
          return {
            url: location.href,
            viewport: [innerWidth, innerHeight],
            scroll: [scrollX, scrollY],
            focus: root?.activeElement ? `${root.activeElement.localName}.${root.activeElement.className}` : document.activeElement?.localName,
            alerts: [...(root?.querySelectorAll('[role=alert]') ?? [])].map((el) => el.textContent),
            card: box(root?.querySelector('.comment-tag')),
            pin: box(root?.querySelector('.pin')),
            pills: [...(root?.querySelectorAll('.tag-reaction') ?? [])].map((el) => `${el.textContent} @${box(el)}`),
            choices: box(root?.querySelector('.tag-react__choices')),
            requests: harness?.requests?.map((r: Record<string, unknown>) => [r.type, r.emoji, r.on].filter((v) => v !== undefined).join(' ')),
            storedReactions: messages.map((thread) => thread.messages.map((m) => m.reactions ?? [])),
          };
        })
        .catch((error: unknown) => `could not be read: ${String(error)}`);
      console.log(`[blob at failure] ${JSON.stringify(state)}`);
    }
  },
});

const blob = (page: Page) => page.locator('blob-overlay .blob');
const drawer = (page: Page) => page.locator('blob-overlay .drawer');
const pins = (page: Page) => page.locator('blob-overlay .pin');
/** The comment card on the page: used both to write a first comment and to read a conversation. */
const composer = (page: Page) => page.locator('blob-overlay .comment-tag');
const tag = composer;

/**
 * Waits for anything still moving inside Blob (the card sliding in, the reaction
 * choices popping open) to come to rest. Positions measured mid-movement are a
 * few pixels off, and a fast machine measures sooner than a slow one.
 */
const settled = (page: Page) =>
  page.locator('blob-overlay').evaluate((host) =>
    Promise.all(
      host
        .shadowRoot!.getAnimations()
        .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime as number))
        .map((animation) => animation.finished.catch(() => undefined)),
    ).then(() => undefined),
  );

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
  // The card stays open and now shows the saved comment.
  await expect(tag(page).locator('.tag-comment')).toContainText(text);
  await page.getByRole('button', { name: 'Close comment', exact: true }).click();
  await expect(tag(page)).toBeHidden();
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
  // The card stays open and shows the saved comment; a pin appears on the button.
  await expect(tag(page).locator('.tag-comment')).toHaveCount(1);
  await expect(tag(page)).toContainText('Could we give this button more room?');
  await expect(pins(page)).toHaveCount(1);
  expect(await pinGap(page, '#hero')).toBeLessThan(3);

  // After a reload the pin is back and opens the same conversation on the page.
  await driver.reload(page);
  await expect(pins(page)).toHaveCount(1);
  await pins(page).click();
  await expect(tag(page)).toContainText('Pinned to Button “Explore our work”');
  await expect(tag(page)).toContainText('Could we give this button more room?');
  await expect(tag(page)).toContainText('Just now');

  // Add a second comment, then reply to the first one.
  await page.getByRole('textbox', { name: 'Comment' }).fill('Looks better already.');
  await page.getByRole('textbox', { name: 'Comment' }).press('Enter');
  await expect(tag(page).locator('.tag-comment')).toHaveCount(2);
  await expect(page.getByRole('textbox', { name: 'Comment' })).toHaveValue('');
  await tag(page).locator('.tag-comment').first().hover();
  await page.getByRole('button', { name: 'Reply', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Comment' }).fill('Agreed.');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(tag(page)).toContainText('1 reply');
  await expect(tag(page).locator('.tag-replies .tag-comment')).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: 'Comment' })).toBeInViewport();

  // The same conversation, in the drawer.
  await page.keyboard.press('Escape');
  await expect(tag(page)).toBeHidden();
  await blob(page).click();
  await page.getByRole('button', { name: /Agreed\./ }).click();
  await expect(drawer(page)).toContainText('Could we give this button more room?');
  await expect(drawer(page)).toContainText('Studio — Example website');
  await expect(drawer(page).locator('.message')).toHaveCount(3);

  // Resolve: the pin goes, the conversation stays and is listed under Resolved.
  await page.getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(drawer(page)).toContainText('Resolved by you');
  await expect(pins(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to activity' }).click();
  await page.getByRole('button', { name: /^Resolved/ }).click();
  await expect(drawer(page)).toContainText('Completed conversations stay here until you reopen them.');
  await expect(drawer(page)).toContainText('Agreed.');

  // Reopen: it returns with every message.
  await page.getByRole('button', { name: /^Reopen conversation/ }).click();
  await expect(drawer(page)).toContainText('No resolved conversations');
  await expect(pins(page)).toHaveCount(1);
  const [thread] = await threads(driver, page);
  expect(thread).toMatchObject({ status: 'open', pageKey: `${ORIGIN}/`, number: 1 });
  expect(thread.messages).toHaveLength(3);
  expect(thread.messages[2].replyTo).toBe(thread.messages[0].id);
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
  const site = drawer(page).locator('.history-site > details');
  await expect(site).not.toHaveAttribute('open', '');
  await site.locator(':scope > summary').click();
  await expect(site.locator('.history-page > summary')).toHaveCount(2);
  await expect(drawer(page)).toContainText(`${HOST} · 2 conversations · Current website`);
  await expect(drawer(page)).toContainText('Pricing — Example website · /pricing.html');
  await expect(drawer(page)).toContainText('Studio — Example website · /');
  expect((await threads(driver, page)).map((t) => t.pageKey).sort()).toEqual([`${ORIGIN}/`, `${ORIGIN}/pricing.html`]);

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

test('reactions: add one from the smiley, see it stay, take it back', async ({ page, driver }) => {
  await driver.open(page);
  await continueAsGuest(page);
  await comment(page, '#hero', 'Could this be rounder?');
  await pins(page).click();
  await expect(tag(page)).toBeVisible();
  await settled(page);
  const first = tag(page).locator('.tag-comment').first();
  const chip = first.locator('.tag-reaction');
  const stored = async () => (await threads(driver, page))[0]?.messages[0]?.reactions;

  // Pointing at the comment shows the smiley beside Reply (Figma "Comment with emoji hover").
  await expect(first.getByRole('button', { name: 'Add a reaction' })).toBeHidden();
  await first.hover();
  const add = first.getByRole('button', { name: 'Add a reaction' });
  await expect(add).toBeVisible();
  await expect(first.getByRole('button', { name: 'Reply' })).toBeVisible();
  // The smiley sits to the left of Reply, 35px in from the comment's edge.
  const row = await first.evaluate((el) => {
    const box = (selector: string) => el.querySelector(selector)!.getBoundingClientRect();
    return { inset: box('.tag-react__add').left - el.getBoundingClientRect().left, order: box('.tag-react__add').right <= box('.tag-reply-btn').left };
  });
  expect(row).toEqual({ inset: 35, order: true });

  // The smiley offers a fixed set of reactions, in a pill that floats just above it.
  const rowBefore = await first.locator('.tag-comment__actions').boundingBox();
  await add.click();
  const choices = first.getByRole('group', { name: 'Reactions' });
  await expect(choices.getByRole('button')).toHaveCount(6);
  await expect(choices).toHaveText('👍❤️😂😮😢🙏');
  await expect(choices).toHaveCSS('visibility', 'visible');
  await settled(page);
  const [pill, smiley, card] = [(await choices.boundingBox())!, (await add.boundingBox())!, (await tag(page).boundingBox())!];
  expect(Math.round(smiley.y - (pill.y + pill.height))).toBe(8);
  expect(Math.round(smiley.x - pill.x)).toBe(8);
  // It sits over the card without being cut off, and takes no room in the row.
  expect(pill.y).toBeGreaterThan(card.y);
  expect(pill.x + pill.width).toBeLessThan(card.x + card.width);
  expect(await first.locator('.tag-comment__actions').boundingBox()).toEqual(rowBefore);
  const topmost = await choices.getByRole('button', { name: 'Thanks' }).evaluate((button) => {
    const box = button.getBoundingClientRect();
    const root = button.getRootNode() as ShadowRoot;
    return root.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === button;
  });
  expect(topmost).toBe(true);
  await choices.getByRole('button', { name: 'Thumbs up' }).click();
  await expect(choices).toHaveCount(0);
  await expect(chip).toHaveText('👍1');
  expect(await stored()).toEqual(['👍']);
  // The chip looks like the one in the design: grey pill, fully rounded.
  expect(await chip.evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).borderRadius])).toEqual(['rgb(233, 234, 236)', '30px']);

  // A second one; they keep a fixed order whatever order they were added in.
  await add.click();
  await choices.getByRole('button', { name: 'Heart' }).click();
  await expect(chip).toHaveCount(2);
  expect(await stored()).toEqual(['👍', '❤️']);

  // Opening the choices again marks the ones already given; clicking elsewhere puts them away.
  await add.click();
  await expect(choices.getByRole('button', { name: 'Heart' })).toHaveAttribute('aria-pressed', 'true');
  await expect(choices.getByRole('button', { name: 'Sad' })).toHaveAttribute('aria-pressed', 'false');
  await tag(page).getByRole('textbox', { name: 'Comment' }).click();
  await expect(choices).toHaveCount(0);

  // Away from the comment the reactions stay in view and Reply steps back.
  await page.mouse.move(5, 5);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await expect(tag(page)).toBeVisible();
  await expect(chip.first()).toBeVisible();
  await expect(first.getByRole('button', { name: 'Reply' })).toBeHidden();

  // They are saved: still there after a reload.
  await driver.reload(page);
  await pins(page).click();
  await expect(chip).toHaveCount(2);

  // Pressing a chip takes that reaction back. Wait for the count first: for an
  // instant after the press both pills are still on screen, and a check of one
  // pill's text fails outright when it finds two instead of waiting.
  await chip.first().click();
  await expect(chip).toHaveCount(1);
  await expect(chip).toHaveText('❤️1');
  expect(await stored()).toEqual(['❤️']);
  await chip.click();
  await expect(chip).toHaveCount(0);
  expect(await stored()).toBeUndefined();

  // A failed save says so and shows nothing that was not saved.
  await driver.failWrites(page, true);
  await first.hover();
  await add.click();
  await choices.getByRole('button', { name: 'Thanks' }).click();
  await expect(first.getByRole('alert')).toContainText('Couldn’t save that reaction');
  await expect(chip).toHaveCount(0);
  await driver.failWrites(page, false);
});

test('the page can still be scrolled while choosing where to comment',async ({ page, driver }) => {
  await driver.open(page);
  await continueAsGuest(page);
  await page.getByRole('button', { name: 'Add a Blob' }).click();
  await expect(page.locator('blob-overlay .catcher')).toBeVisible();

  // An ordinary page: the wheel scrolls the document.
  await page.evaluate(() => {
    document.body.style.minHeight = '3000px';
  });
  await page.mouse.move(300, 300);
  await page.mouse.wheel(0, 400);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
  await page.mouse.wheel(0, -400);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

  // A page that scrolls inside its own panel, as many web apps do: the wheel scrolls
  // the panel under the pointer, and nothing in it is activated.
  await page.evaluate(() => {
    document.body.style.minHeight = '';
    const panel = document.createElement('div');
    panel.id = 'panel';
    panel.style.cssText = 'position:fixed;inset:0 50% 0 0;overflow:auto;background:#fff;';
    panel.innerHTML = '<button id="panel-button" style="margin:20px">In the panel</button><div style="height:3000px"></div><p id="deep">Far down</p>';
    panel.querySelector('button')!.addEventListener('click', () => ((window as any).panelClicks = ((window as any).panelClicks ?? 0) + 1));
    document.body.append(panel);
  });
  await page.mouse.move(200, 300);
  await page.mouse.wheel(0, 500);
  await expect.poll(() => page.evaluate(() => document.getElementById('panel')!.scrollTop)).toBe(500);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  // The highlight follows what is now under the pointer, and choosing still works after scrolling.
  await page.mouse.wheel(0, 5000);
  await expect.poll(() => page.evaluate(() => Math.round(document.getElementById('deep')!.getBoundingClientRect().top))).toBeLessThan(832);
  await page.locator('#deep').scrollIntoViewIfNeeded();
  const deep = (await page.locator('#deep').boundingBox())!;
  await page.mouse.click(deep.x + 10, deep.y + deep.height / 2);
  await expect(page.getByRole('textbox', { name: 'Comment' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).panelClicks ?? 0)).toBe(0);
});

test('a failed save keeps the draft, says so, and a retry saves once',async ({ page, driver }) => {
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
  await expect(tag(page).locator('.tag-comment')).toHaveCount(1);
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

test('the Blob tab: docked to an edge, slides out, click opens, drag moves, position is remembered', async ({ page, driver }) => {
  await driver.open(page);
  const tab = blob(page);
  const width = page.viewportSize()!.width;
  const box = async () => (await tab.boundingBox())!;
  /** How far the tab pokes past the outer edge of its slot, where it is cut off. */
  const tuckedBy = async () => {
    const slot = (await page.locator('blob-overlay .edge-slot').boundingBox())!;
    const b = await box();
    return b.x + b.width - (slot.x + slot.width);
  };

  // Docked to the right edge. Once it has said hello it tucks away, still peeking.
  await expect(tab).toHaveAttribute('data-side', 'right');
  await expect(tab).not.toHaveClass(/edge-tab--out/, { timeout: 8000 });
  await expect.poll(tuckedBy).toBeGreaterThan(10);
  expect((await box()).x).toBeLessThan(width - 20);

  // It slides fully out when the pointer comes near.
  await page.mouse.move(width - 70, (await box()).y + 48);
  await expect(tab).toHaveClass(/edge-tab--out/);
  await expect.poll(tuckedBy).toBeLessThan(1);

  // Dragging moves it along the edge, and a drag is not a click.
  const out = await box();
  await page.mouse.move(out.x + out.width / 2, out.y + out.height / 2);
  await page.mouse.down();
  await page.mouse.move(out.x + out.width / 2 - 8, out.y + out.height / 2 - 250, { steps: 8 });
  await page.mouse.up();
  await expect(drawer(page)).toBeHidden();
  const moved = await box();
  expect(Math.abs(moved.y - (out.y - 250))).toBeLessThan(3);
  await expect(tab).toHaveAttribute('data-side', 'right');

  // Dragging it across the page docks it to the other edge.
  await page.mouse.move(moved.x + moved.width / 2, moved.y + moved.height / 2);
  await page.mouse.down();
  await page.mouse.move(80, moved.y + moved.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(tab).toHaveAttribute('data-side', 'left');
  await expect.poll(async () => Math.abs((await box()).x)).toBeLessThan(2);

  // The edge and height are remembered.
  await driver.reload(page);
  await expect(tab).toHaveAttribute('data-side', 'left');
  await expect.poll(async () => Math.abs((await box()).y - moved.y)).toBeLessThan(3);

  // In a small window it still fits, and keyboard focus brings it fully into view.
  await page.setViewportSize({ width: 420, height: 380 });
  await tab.focus();
  await expect(tab).toBeInViewport({ ratio: 1 });

  // Keyboard: Enter opens, Escape closes and returns focus to the tab.
  await page.keyboard.press('Enter');
  await expect(drawer(page)).toBeVisible();
  await expect(drawer(page)).toBeInViewport({ ratio: 1 });
  await page.keyboard.press('Escape');
  await expect(drawer(page)).toBeHidden();
  await expect(tab).toBeFocused();
});

test('the website card shows the site’s own icon, or its initial when there is none', async ({ page, driver }) => {
  // This page declares an icon.
  await driver.open(page, '/pricing.html');
  await continueAsGuest(page);
  await expect(drawer(page).locator('.site__tile img')).toHaveAttribute('src', `${ORIGIN}/site-icon.png`);
  await expect.poll(() => imageLoaded(page, 'blob-overlay .drawer .site__tile img')).toBe(true);
  // This one does not, and the website has no default icon either.
  await driver.open(page);
  await blob(page).click();
  await expect(drawer(page).locator('.site__tile')).toHaveText('1');
  await expect(drawer(page).locator('.site__tile img')).toHaveCount(0);
});

test('collapsed navigation: pointing at an item shows its name in a pill under the bar', async ({ page, driver }) => {
  await driver.open(page);
  await continueAsGuest(page);
  await page.getByRole('button', { name: 'Add a Blob' }).click();
  const nav = page.getByRole('navigation', { name: 'Comment tools' });
  const resolved = nav.getByRole('button', { name: 'Resolved conversations' });
  const pill = resolved.locator('.nav-tip');
  await expect(pill).toBeHidden();

  await resolved.hover();
  await expect(pill).toBeVisible();
  await expect(pill).toHaveText('Resolved');
  // As in Figma: 32px tall, 5px under the bar, centred on the item, and fully on screen.
  const [bar, item, tip] = [(await nav.boundingBox())!, (await resolved.boundingBox())!, (await pill.boundingBox())!];
  expect(Math.round(tip.height)).toBe(32);
  expect(Math.round(tip.y - (bar.y + bar.height))).toBe(5);
  expect(Math.abs(tip.x + tip.width / 2 - (item.x + item.width / 2))).toBeLessThan(1.5);
  await expect(pill).toBeInViewport({ ratio: 1 });

  // An item that cannot be used yet says so.
  const inbox = nav.getByRole('button', { name: 'Inbox unavailable for guests' });
  await inbox.hover();
  await expect(inbox.locator('.nav-tip')).toBeVisible();
  await expect(pill).toBeHidden();

  // Expanded, the names are written out, so there are no pills.
  await nav.getByRole('button', { name: 'Expand tools' }).click();
  await resolved.hover();
  await expect(nav.locator('.nav-tip')).toHaveCount(0);

  // Collapsed again, reaching an item with the keyboard shows its pill too.
  await nav.getByRole('button', { name: 'Collapse tools' }).click();
  await page.mouse.move(5, 5);
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(resolved).toBeFocused();
  await expect(pill).toBeVisible();
});

test('the Blob tab keeps clear of scrollbars', async ({ page, driver }) => {
  const slotRight = async () => {
    const box = (await page.locator('blob-overlay .edge-slot').boundingBox())!;
    return page.viewportSize()!.width - (box.x + box.width);
  };
  // A page with nothing to scroll: flush against the edge.
  await driver.open(page, '/demo.html');
  expect(await slotRight()).toBeLessThan(1);
  // A page that scrolls: room is left for the scrollbar, and the tucked part is cut off there.
  await driver.open(page, '/');
  await expect.poll(slotRight).toBeGreaterThan(8);
  expect(await page.locator('blob-overlay .edge-slot').evaluate((el) => getComputedStyle(el).clipPath)).toContain('inset');
});

test('closing the drawer: the close corner turns red when pointed at or focused', async ({ page, driver }) => {
  await driver.open(page);
  await blob(page).click();
  const close = drawer(page).getByRole('button', { name: 'Close Blob' });
  const look = () =>
    close.evaluate((button) => ({
      background: getComputedStyle(button).backgroundColor,
      cross: getComputedStyle(button.querySelector('svg path')!).stroke,
    }));
  const red = { background: 'rgb(255, 82, 82)', cross: 'rgb(255, 255, 255)' };

  // At rest it is as quiet as the rest of the header.
  expect(await look()).toEqual({ background: 'rgba(0, 0, 0, 0)', cross: 'rgb(103, 106, 121)' });
  // Pointed at: red corner, white cross (Figma "Main/welcome/close").
  await close.hover();
  await expect.poll(look).toEqual(red);
  await page.mouse.move(10, 10);
  await expect.poll(look).not.toEqual(red);
  // Reached with the keyboard: the same warning.
  await close.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await expect.poll(look).toEqual(red);

  await page.keyboard.press('Enter');
  await expect(drawer(page)).toBeHidden();
});

test('the page’s styles do not leak into Blob',async ({ page, driver }) => {
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
  await page.getByRole('textbox', { name: 'Comment' }).fill('A reply');
  await page.getByRole('button', { name: 'Add comment' }).click();
  await expect(tag(page).locator('.tag-comment')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await blob(page).click();
  await page.getByRole('button', { name: /A reply/ }).click();
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
  // A fresh install: the popup welcomes you first, wherever it is opened.
  await expect(page.getByRole('heading', { name: 'Leave a thought right where it belongs.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  await page.getByRole('button', { name: 'Continue as a Guest' }).click();
  await expect(page.getByRole('heading', { name: 'Blob can’t run on this page' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use Blob on this page' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Login' })).toBeDisabled();
  await expect(page.locator('blob-overlay')).toHaveCount(0);
});

/* ---------- The toolbar popup, with stand-ins for chrome.tabs and chrome.permissions ---------- */

/** Tells the stand-in what tab the popup was opened on and how Chrome's prompt will answer. */
const popupSetup = (page: Page, settings: Record<string, unknown>) =>
  page.addInitScript((given) => Object.assign((globalThis as any).__blobHarness, given), settings);
const popupRequests = (page: Page) => page.evaluate(() => (globalThis as any).__blobHarness.requests as { type: string }[]);
/** Nothing in the popup's card is cut off, and its three parts do not overlap. */
async function expectPopupFits(page: Page) {
  const boxes = await page.evaluate(() => {
    const rect = (selector: string) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    };
    const card = document.querySelector('.card')!;
    const hero = document.querySelector('.hero')!;
    const content = [...hero.children].map((child) => child.getBoundingClientRect()).filter((r) => r.height > 0);
    return {
      card: rect('.card')!,
      top: rect('.card__top')!,
      recent: rect('.recent'),
      heroContent: { top: Math.min(...content.map((r) => r.top)), bottom: Math.max(...content.map((r) => r.bottom)) },
      clipped: card.scrollHeight > card.clientHeight + 1,
    };
  });
  expect(boxes.clipped).toBe(false);
  expect(boxes.heroContent.top).toBeGreaterThanOrEqual(boxes.top.bottom);
  // At least 12px of air above the recent list.
  expect(boxes.heroContent.bottom).toBeLessThanOrEqual(boxes.recent ? boxes.recent.top - 11.5 : boxes.card.bottom);
}

const wise = { id: 7, url: 'https://www.wise.com/pricing?token=SECRET', title: 'Wise: The International account', favIconUrl: `${ORIGIN}/site-icon.png` };
const welcomeHeading = (page: Page) => page.getByRole('heading', { name: 'Leave a thought right where it belongs.' });
/** Opens the popup for the first time and gets past its welcome screen, leaving a freshly loaded popup. */
async function openPopupAsGuest(page: Page) {
  await page.goto('/popup.html');
  await page.getByRole('button', { name: 'Continue as a Guest' }).click();
  await expect(welcomeHeading(page)).toHaveCount(0);
  await page.reload();
}
/** True once an image has actually loaded and has something to show. */
const imageLoaded = (page: Page, selector: string) =>
  page.locator(selector).evaluate((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0);

test('popup: the first time, it welcomes you and lets you continue as a guest', async ({ page, driver }) => {
  test.skip(!HARNESS, 'Uses the stand-in for chrome.tabs and chrome.permissions.');
  await popupSetup(page, { tab: wise });
  await page.setViewportSize({ width: 450, height: 500 });
  await page.goto('/popup.html');

  // The welcome screen, and nothing that assumes a choice has been made.
  await expect(welcomeHeading(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use Blob on this page' })).toHaveCount(0);
  await expect(page.locator('.chip')).toHaveCount(0);
  // Signing in is in the design but not built: shown, and switched off.
  const signIn = page.getByRole('button', { name: 'Sign in' });
  await expect(signIn).toBeDisabled();
  await expect(signIn).toHaveAttribute('title', 'Signing in isn’t available yet');
  expect(await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight])).toEqual([450, 500]);
  // Sizes from the Figma frame "Main/welcome": 268px buttons, 12px apart, 16px under the text.
  const layout = await page.evaluate(() => {
    const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
    const [card, welcome, intro, actions] = [box('.card'), box('.welcome'), box('.welcome__intro'), box('.welcome__actions')];
    const buttons = [...document.querySelectorAll('.welcome__actions button')].map((button) => button.getBoundingClientRect());
    return {
      offCentre: Math.abs((welcome.top + welcome.bottom) / 2 - (card.top + card.bottom) / 2),
      introToActions: actions.top - intro.bottom,
      buttonWidths: buttons.map((b) => b.width),
      buttonHeights: buttons.map((b) => b.height),
      betweenButtons: buttons[1]!.top - buttons[0]!.bottom,
    };
  });
  expect(layout.offCentre).toBeLessThan(1);
  expect(layout).toMatchObject({ introToActions: 16, buttonWidths: [268, 268], buttonHeights: [36, 36], betweenButtons: 12 });

  // Continuing as a guest is remembered, and the popup becomes the usual one.
  await page.getByRole('button', { name: 'Continue as a Guest' }).click();
  await expect(page.getByRole('heading', { name: 'No Blobs on this website yet' })).toBeVisible();
  await expect(page.locator('.chip')).toContainText('Guest');
  expect(await popupRequests(page)).toContainEqual({ type: 'settings/set', settings: { onboarded: true } });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Use Blob on this page' })).toBeVisible();
  await expect(welcomeHeading(page)).toHaveCount(0);

  // The drawer on the page does not ask again.
  await driver.open(page);
  await blob(page).click();
  await expect(drawer(page).getByText('No Blobs on this website yet')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue as a Guest' })).toHaveCount(0);
});

test('popup: guest layout, recent websites, and using Blob on the page', async ({ page, driver }) => {
  test.skip(!HARNESS, 'Uses the stand-in for chrome.tabs and chrome.permissions.');
  // One saved comment, so there is a website to list.
  await driver.open(page);
  await continueAsGuest(page);
  await comment(page, '#hero', 'Saved before opening the popup');

  await popupSetup(page, { tab: wise });
  await page.setViewportSize({ width: 450, height: 500 });
  await page.goto('/popup.html');
  await expect(page.getByRole('heading', { name: 'No Blobs on this website yet' })).toBeVisible();
  await expect(page.locator('.site')).toContainText('Wise: The International account');
  await expect(page.locator('.site')).toContainText('https://www.wise.com');
  // The website's own icon, from the address Chrome supplies for the tab.
  await expect.poll(() => imageLoaded(page, '.site__tile img')).toBe(true);
  await expect(page.locator('body')).not.toContainText('SECRET');
  await expect(page.locator('.chip')).toContainText('Guest');
  // Signing in is in the design but not built: shown, and switched off.
  await expect(page.getByRole('button', { name: 'Login' })).toBeDisabled();
  // The popup is 450 x 500 and everything fits without scrolling or overlapping.
  expect(await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight])).toEqual([450, 500]);
  await expectPopupFits(page);
  // Margins from the 450 x 500 Figma frame: 10px at the sides, 8px above and below, 8px between card and footer.
  const frame = await page.evaluate(() => {
    const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
    const [card, footer] = [box('.card'), box('.footer')];
    return { left: card.left, top: card.top, right: 450 - card.right, cardHeight: card.height, gap: footer.top - card.bottom, footerHeight: footer.height, below: 500 - footer.bottom };
  });
  expect(frame).toEqual({ left: 10, top: 8, right: 10, cardHeight: 446, gap: 8, footerHeight: 30, below: 8 });
  // The message is centred in the card, and Recent websites sits 18px above the card's edge.
  const placed = await page.evaluate(() => {
    const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
    const [card, hero, recent] = [box('.card'), box('.hero'), box('.recent')];
    return { offCentre: Math.abs((hero.top + hero.bottom) / 2 - (card.top + card.bottom) / 2), recentGap: card.bottom - recent.bottom };
  });
  expect(placed.offCentre).toBeLessThan(1);
  expect(Math.round(placed.recentGap)).toBe(19); // 18px inside the card's 1px border

  // Recent websites: pointing at one shows "Open"; it links to the page that was commented on.
  const recent = page.getByRole('navigation', { name: 'Recent websites' });
  await expect(recent).toContainText(`${HOST} (1)`);
  const link = recent.getByRole('link');
  await expect(link.locator('.recent__open')).toBeHidden();
  await link.hover();
  await expect(link.locator('.recent__open')).toBeVisible();
  await expect(link).toHaveAttribute('href', `${ORIGIN}/`);

  await page.getByRole('button', { name: 'Use Blob on this page' }).click();
  await expect.poll(() => popupRequests(page)).toContainEqual({ type: 'tab/activate', tabId: 7 });
});

test('popup: "Always show" follows Chrome’s answer, and can be turned off again', async ({ page }) => {
  test.skip(!HARNESS, 'Uses the stand-in for chrome.tabs and chrome.permissions.');
  const always = page.getByRole('checkbox', { name: 'Always show on wise.com' });
  const label = page.getByText('Always show on wise.com');

  // Chrome's prompt is refused: the box stays empty and the popup says so.
  // (This tab's icon cannot be loaded, so the website's initial is shown instead.)
  await popupSetup(page, { tab: { ...wise, favIconUrl: `${ORIGIN}/no-such-icon.png` }, acceptPrompt: false });
  await openPopupAsGuest(page);
  await expect(page.locator('.site__tile')).toHaveText('W');
  await expect(page.locator('.site__tile img')).toHaveCount(0);
  await label.click();
  await expect(page.getByRole('status')).toContainText('Access wasn’t granted');
  await expect(always).not.toBeChecked();
  await expectPopupFits(page);
  expect(await popupRequests(page)).toEqual([]);

  // Accepted: ticked, Blob is put on the page, and the button now opens it.
  await popupSetup(page, { acceptPrompt: true });
  await page.reload();
  await label.click();
  await expect(always).toBeChecked();
  await expect(page.getByRole('status')).toContainText('Blob will appear whenever you visit wise.com');
  // The footer mascot keeps its colour while the message is showing.
  expect(await page.locator('.footer__brand svg path').first().evaluate((el) => getComputedStyle(el).fill)).toContain('url(');
  await expect(page.locator('.art')).toHaveCount(0);
  await expectPopupFits(page);
  await expect(page.getByRole('button', { name: 'Open Blob' })).toBeVisible();
  expect(await popupRequests(page)).toContainEqual({ type: 'tab/activate', tabId: 7 });

  // Unticking gives the access up and keeps the comments.
  await label.click();
  await expect(always).not.toBeChecked();
  await expect(page.getByRole('status')).toContainText('Blob is off for wise.com. Your comments are kept on this device.');
  expect(await popupRequests(page)).toContainEqual({ type: 'site/disable', origin: 'https://www.wise.com/*' });
});

test('popup: explains a page Chrome blocks, with nothing to press', async ({ page }) => {
  test.skip(!HARNESS, 'Uses the stand-in for chrome.tabs and chrome.permissions.');
  await popupSetup(page, { tab: { id: 3, url: 'chrome://extensions/', title: 'Extensions' } });
  // Right after installing, this is the page most people are on: the welcome still shows.
  await page.goto('/popup.html');
  await expect(welcomeHeading(page)).toBeVisible();
  await page.getByRole('button', { name: 'Continue as a Guest' }).click();
  await expect(page.getByRole('heading', { name: 'Blob can’t run on this page' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use Blob on this page' })).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
});
/* ---------- Feedback ---------- */

async function openFeedback(page: Page) {
  await blob(page).click();
  await drawer(page).getByLabel('Guest profile').click();
  await drawer(page).getByRole('button', { name: 'Feedback' }).click();
}

test('feedback: Submit sends the rating and text to the Blob project, and nothing else', async ({ page, driver }) => {
  await driver.open(page);
  await openFeedback(page);
  const submit = drawer(page).getByRole('button', { name: 'Submit' });
  const text = drawer(page).getByPlaceholder('Share your feedback');
  // Nothing chosen or written yet, so there is nothing to send.
  await expect(submit).toBeDisabled();
  await expect(drawer(page)).toContainText('Only your feedback is sent to the Blob team.');

  await drawer(page).getByRole('button', { name: 'Good' }).click();
  await text.fill('Pins are easy to place');
  await submit.click();
  await expect(drawer(page).getByRole('status')).toContainText('Thank you. Your feedback was sent.');
  await expect(text).toHaveValue('');

  const sent = (await driver.feedbackSent(page)) ?? {};
  expect(sent).toMatchObject({ rating: 'Good', text: 'Pins are easy to place' });
  // Only the rating, the text and (from the real extension) Blob's version number.
  expect(Object.keys(sent).filter((key) => key !== 'version').sort()).toEqual(['rating', 'text']);
  expect(JSON.stringify(sent)).not.toContain('127.0.0.1');
});

test('feedback: a failed send keeps what was written, and without a relay an email is offered', async ({ page, driver }) => {
  test.skip(!HARNESS, 'Uses the stand-in relay to force a failure and to switch sending off.');
  const harness = (change: string) => page.evaluate(`void (${change})`);
  const submit = drawer(page).getByRole('button', { name: 'Submit' });
  const text = drawer(page).getByPlaceholder('Share your feedback');
  const mailto = 'mailto:blob@davidokunlola.com?subject=Blob%20feedback&body=How%20I%20like%20Blob%3A%20Okay%0A%0AThe%20tab%20hides%20too%20fast';

  // The relay is failing: say so, keep the text, and offer the email route.
  await driver.open(page);
  await openFeedback(page);
  await harness('__blobHarness.feedback.fail = true');
  await drawer(page).getByRole('button', { name: 'Okay' }).click();
  await text.fill('The tab hides too fast');
  await submit.click();
  await expect(drawer(page).getByRole('alert')).toContainText('Couldn’t send it, and nothing was lost.');
  await expect(text).toHaveValue('The tab hides too fast');
  await expect(drawer(page).getByRole('link', { name: 'blob@davidokunlola.com' })).toHaveAttribute('href', mailto);
  expect(await driver.feedbackSent(page)).toBeNull();

  // It recovers: the same text goes through on the next try.
  await harness('__blobHarness.feedback.fail = false');
  await submit.click();
  await expect(drawer(page).getByRole('status')).toContainText('Thank you.');
  expect(await driver.feedbackSent(page)).toEqual({ rating: 'Okay', text: 'The tab hides too fast' });

  // No relay at all: Submit stays off and the form offers to start an email.
  await popupSetup(page, { feedback: { enabled: false, fail: false, sent: [] } });
  await driver.open(page);
  await openFeedback(page);
  await drawer(page).getByRole('button', { name: 'Okay' }).click();
  await text.fill('The tab hides too fast');
  await expect(submit).toBeDisabled();
  await expect(drawer(page)).toContainText('Blob can’t send feedback for you yet.');
  await expect(drawer(page).getByRole('link', { name: 'blob@davidokunlola.com' })).toHaveAttribute('href', mailto);
});

test('approved guest screens fit a narrow viewport', async ({ page, driver }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await driver.open(page);
  await blob(page).click();
  await expect(drawer(page).getByRole('button', { name: 'Sign in', exact: true })).toBeDisabled();
  await drawer(page).getByLabel('Guest profile').click();
  await drawer(page).getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(drawer(page)).toHaveAttribute('data-theme', 'Dark');
  await drawer(page).getByRole('button', { name: 'Feedback' }).click();
  await drawer(page).getByRole('button', { name: 'Good' }).click();
  await expect(drawer(page).getByRole('button', { name: 'Good' })).toHaveAttribute('aria-pressed', 'true');
  await expect(drawer(page).getByRole('button', { name: 'Submit' })).toBeEnabled();
  await drawer(page).getByLabel('Close feedback').click();
  await drawer(page).getByRole('button', { name: 'Continue as a Guest' }).click();
  await page.getByRole('button', { name: 'Add a Blob' }).click();
  const nav = page.getByRole('navigation', { name: 'Comment tools' });
  await nav.getByRole('button', { name: 'Expand tools' }).click();
  const box = await nav.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  await nav.getByRole('button', { name: 'Resolved conversations' }).click();
  await expect(drawer(page).getByText('No resolved conversations')).toBeVisible();
});
