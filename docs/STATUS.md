# Status

Last updated: 25 November 2026

Milestone 1 implements local guest comments. The production build and browser harness have been exercised locally. The next design check is a walkthrough of the unpacked extension in Chrome, including the toolbar and permission prompt.

## Approved design review

The [Approved for Implementation page](https://www.figma.com/design/Fcy1Fpb2zNZALUhRbNjkUC/Blob?node-id=297-6696) is the visual reference for all six sections. Review Welcome and Empty state, Bottom navigation, Comment tags, Feedback, History and Activity using the production build. New demo captures in `docs/screenshots/` show the guest flows, profile appearance menu, feedback hover state and expanded History. Captures use the production overlay in headless Chromium with stand-in extension APIs.

Account examples use local guest data. Feedback supports rating and text entry; Submit is disabled pending a delivery service. Per-message reactions and signed-in examples remain outside the implemented guest flows. Manual Chrome visual sign-off is pending.

## What works

- Toolbar popup, rebuilt from the Figma "Chrome popup" guest frame (800 x 600): the current website, a Guest chip, "Use Blob on this page", an "Always show on ..." tick box that asks Chrome for access to that one website and gives it up again when unticked, and "Recent websites" with a count each. Pointing at a recent website widens it and shows "Open". Pages Chrome blocks get an explanation and nothing to press. "Login" is shown switched off, because signing in is not built.
- Blob tab (48 × 96) docked to the left or right edge: tucked at rest, slides out when the pointer comes near or it has focus, tells a click from a drag, and remembers its edge and height. It keeps clear of scrollbars: it sits inside a scrollbar that belongs to the page's own scrolling area or floats over the content, and its tucked part is cut off rather than drawn over the scrollbar.
- Comment tag on the page, from the Figma "Comment tags" section: clicking a pin opens a card beside the element with "Pinned to …", the comments (name, time, text), replies grouped under the comment they answer with an "N replies" bar that expands and collapses, and an "Add a comment" bar. The same card is used to write the first comment, and it stays open after posting. Resolve is in the card's header. Reactions from the design are not built.
- Injected drawer with Welcome ("Continue as a Guest"), Activity for the current website, History (Websites and Resolved) and a conversation view.
- Add a Blob: choose an element (mouse, or Tab then Enter), write a comment, see a numbered pin. Escape cancels.
- Replies, resolve, reopen, delete with confirmation.
- Saving, saved and failed states. A failed save keeps the text and offers Try again without duplicating.
- Drafts are kept in the browser until posted.
- Pins follow their element; a missing or ambiguous element shows "Location unavailable" and can be reattached.
- Single-page app navigation, and removal from the page when site access is taken away.

## What was verified, and how

| Check | Result |
| --- | --- |
| Local real-extension run during the approved design pass | Chromium loaded the extension. Six tests passed. Seven were marked failed because closing the browser context exceeded Playwright's 45-second teardown timeout. This run did not establish a clean real-extension pass. |
| `npm run typecheck` | Passes. |
| `npm test` | 54 unit tests pass: page identity and URL sanitising, storage (reload persistence, failed writes, duplicate-safe retry, concurrent updates, schema versions), request validation and permissions, anchoring (repeated text, moved target, removed target, private fields). |
| `npm run build` | Production build succeeds. |
| `npm run check:manifest` | Generated manifest asks only for `activeTab`, `scripting`, `storage`, with optional per-site access. No `host_permissions`, `content_scripts` or `web_accessible_resources`. |
| `npm run test:e2e:harness` | 12 browser tests pass, 1 skipped (the popup test, which needs the real extension). These run the real built overlay script in headless Chromium on the fixture pages, with stand-in extension APIs. Covered: the guest journey through reload, reply, resolve and reopen; separate pages on one website; History grouping; repeated text, moved and removed targets, reattach; Escape; failed save and retry; nothing typed into the page being stored; single-page app navigation; docked tab movement and keyboard use; guest profile, feedback and navigation at 360px; host-page style conflicts; delete confirmation; removal when site access is lost. |
| `npm run test:e2e` on CI | First run (pull request 1): the real built extension in Chromium, 11 of 12 passed, including the popup test. The one failure was a pin-order assumption: Chrome's storage returns saved items in alphabetical key order, not saving order. Pins are now ordered by number, and the harness mimics Chrome's ordering so this class of mistake fails locally too. The rerun after that fix should be checked on the pull request. |
| Visual comparison with Figma | Screenshots in `docs/screenshots/` were compared by eye with the welcome, empty, composer, conversation and History frames. |

## Not verified

- Loading the unpacked extension in Chrome and using it by hand.
- The toolbar popup against a real tab, including injection through `activeTab`.
- Chrome's permission prompt: granting, refusing, and revoking from Chrome's settings.
- Persistence across a full browser restart (unit-tested against a fake storage area only).
- Fonts and styles when the overlay runs in Chrome's isolated extension world rather than the page's own.
- `npm run dev`.
- Screen readers. Labels, focus order and focus rings were built in and partly exercised by the tests, but no assistive technology was used.

## Five-minute manual walkthrough

1. `npm install`, then `npm run build`.
2. In Chrome open `chrome://extensions`, turn on Developer mode, click **Load unpacked**, choose `.output/chrome-mv3`. Pin Blob to the toolbar.
3. Open an ordinary website. Click the Blob toolbar button, then **Use Blob on this page**. The Blob tab should slide in on the right edge and the drawer should open on the welcome screen.
4. Click **Continue as a Guest**, then **Add a Blob**. Move over the page: elements highlight. Click one. The page's own link or button must not activate.
5. Type a comment and press Enter. A numbered pin appears, and "Guest · Saved on this device" shows at the bottom.
6. Reload. Blob is gone (access was for that tab visit only). Click the toolbar button, choose **Always show on …**, and accept Chrome's prompt. Reload again: the pin is back without clicking anything.
7. Click the pin. Reply, **Resolve**, open History then Resolved, **Reopen**.
8. Drag the Blob button somewhere else; reload; it stays there.
9. Click the toolbar button, **Turn off for …**. Blob disappears from the page. Turn it back on: the comment is still there.
10. Open `chrome://extensions` and click the toolbar button: the popup should say Blob can't run on this page.
11. Quit and reopen Chrome, return to the website: the comment is still there.

Also worth trying: refuse the permission prompt in step 6 (the popup should say access wasn't granted), and a second page on the same website (its comments should be listed separately).

## Known problems and limitations

- The popup was checked by opening the built popup page with stand-ins for `chrome.tabs` and `chrome.permissions`, and comparing screenshots with Figma. It has not been opened from the toolbar in real Chrome since the redesign.
- The Figma prototype could not be played (the link needs a Figma sign-in). Interactions were taken from the component variants instead: the recent-website item has "Initial" and "Hover" variants. Anything in the prototype beyond that is not reflected.
- Popup differences from the frame: a letter tile stands in for the website's favicon (showing the real one needs another permission or a network request); the ticked state of the tick box uses a standard check mark, because only the unticked state was in the frame; when the website already has comments the heading reads "N Blobs on this website", a state the frame does not show; "Hide Blob on this tab" was dropped because the frame has no place for it.

- The comment tag's header says "New comment" when writing the first comment and "Comment" for an existing conversation; the Figma frames say "New comment" in both. The header's Resolve control is not in the Figma frames.
- Scrollbar clearance is tested only where scrollbars float over the content (the test browser hides them). The classic-scrollbar case inside a page's own scrolling area is handled in code but not covered by a test, and has not been checked in real Chrome.
- Browser tests serve their fixture pages on port 43117. If something else is using that port the tests stop with a clear error.

- `npm run test:e2e` cannot run on the original development machine: Playwright's full Chromium build fails to start there with a Windows "side-by-side configuration" error. It runs on CI. Use `npm run test:e2e:harness` locally on machines like that.
- One browser test failed once locally in harness mode and passed in the next 55 runs; which test and why is unknown. CI retries a failed test once and reports it as flaky if the retry passes.

- See "Not verified" above. Treat anything involving Chrome's own extension plumbing as untested.
- A pin on an element inside a scrolling panel is still drawn if the element is scrolled out of the panel's visible area.
- An anchor can become unavailable after a small text change on the element. This is deliberate caution, and Reattach recovers it.
- All data is stored under one key, which will not suit thousands of conversations.
- The header title and some labels follow the Figma frame linked as the starting point; other frames use different wording ("Blob · Comment together on the web").
- Sign in, Inbox and private rooms from the design are hidden or marked unavailable, as planned for this milestone.

## Decisions pending

- **Copyright line.** LICENSE says "Blob contributors". A named holder may be preferable.
- **Mascot licence.** The mascot artwork is in the repository as part of the extension. Whether it is covered by MIT or reserved should be stated in THIRD_PARTY.md.
- The drawer header follows the Approved for Implementation page.
- **Sharing rules.** The proposed audience rules in ROADMAP.md need confirming before Milestone 2.

## Exact next task

Review and verify Milestone 1 in a real browser. Do not start accounts, sharing or rooms.

1. Reload the unpacked production build and compare all six guest sections against the Approved for Implementation page. Check the 600 × 800 drawer, the 450 px comment tag, the feedback hover label and page disclosures at 100% zoom, then repeat at a narrow width. Record differences before changing launcher interactions.
2. Confirm `npm run test:e2e` is green on CI after the pin-order fix, and look into any test CI reports as flaky.
3. Review the code against [MILESTONE-1.md](MILESTONE-1.md): guest journey, persistence, page identity, anchoring, permissions, draft recovery, host-page interference, and consistency with the Figma references.
4. Fix concrete defects with focused regression tests, then update this file.
