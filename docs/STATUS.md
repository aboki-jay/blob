# Status

Last updated: 25 November 2026

Milestone 1 (local guest experience) is implemented. Its automated checks pass. **It has not yet been run as an installed extension in Chrome**, so the toolbar popup, Chrome's permission prompt and real `chrome.storage` are unverified. Doing that is the next task.

## What works

- Toolbar popup: use Blob on the current tab, always show on a website, turn a website off, hide on this tab, and an explanation on pages Chrome blocks.
- Draggable Blob button that tells a click from a drag, remembers its position and stays on screen.
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
| `npm run typecheck` | Passes. |
| `npm test` | 54 unit tests pass: page identity and URL sanitising, storage (reload persistence, failed writes, duplicate-safe retry, concurrent updates, schema versions), request validation and permissions, anchoring (repeated text, moved target, removed target, private fields). |
| `npm run build` | Production build succeeds. |
| `npm run check:manifest` | Generated manifest asks only for `activeTab`, `scripting`, `storage`, with optional per-site access. No `host_permissions`, `content_scripts` or `web_accessible_resources`. |
| `npm run test:e2e:harness` | 11 browser tests pass, 1 skipped (the popup test, which needs the real extension). These run the real built overlay script in headless Chromium on the fixture pages, with stand-in extension APIs. Covered: the guest journey through reload, reply, resolve and reopen; separate pages on one website; History grouping; repeated text, moved and removed targets, reattach; Escape; failed save and retry; nothing typed into the page being stored; single-page app navigation; dragging and keyboard use of the Blob button; host-page style conflicts; delete confirmation; removal when site access is lost. |
| Visual comparison with Figma | Screenshots in `docs/screenshots/` were compared by eye with the welcome, empty, composer, conversation and History frames. |

## Not verified

- **`npm run test:e2e` (the real extension in Chromium) has never run.** On the development machine, Playwright's full Chromium build fails to start with a Windows "side-by-side configuration" error, before any test code runs. The headless shell used by the harness works. CI is set up to run it, but CI has not run yet either.
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
3. Open an ordinary website. Click the Blob toolbar button, then **Use Blob on this page**. The Blob button should appear bottom right and the drawer should open on the welcome screen.
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

- See "Not verified" above. Treat anything involving Chrome's own extension plumbing as untested.
- On Windows machines with the same Chromium launch error, use `npm run test:e2e:harness`.
- A pin on an element inside a scrolling panel is still drawn if the element is scrolled out of the panel's visible area.
- An anchor can become unavailable after a small text change on the element. This is deliberate caution, and Reattach recovers it.
- All data is stored under one key, which will not suit thousands of conversations.
- The header title and some labels follow the Figma frame linked as the starting point; other frames use different wording ("Blob · Comment together on the web").
- Sign in, Inbox and private rooms from the design are hidden or marked unavailable, as planned for this milestone.

## Decisions pending

- **Copyright line.** LICENSE says "Blob contributors". A named holder may be preferable.
- **Mascot licence.** The mascot artwork is in the repository as part of the extension. Whether it is covered by MIT or reserved should be stated in THIRD_PARTY.md.
- **Header wording.** "Blob: Collaborative comment for webpage" (main design) or "Blob · Comment together on the web" (additions page).
- **Sharing rules.** The proposed audience rules in ROADMAP.md need confirming before Milestone 2.

## Exact next task

Review and verify Milestone 1 in a real browser. Do not start accounts, sharing or rooms.

1. Do the manual walkthrough above in Chrome and record what happened here.
2. Get `npm run test:e2e` running (in CI, or on a machine where Chromium starts) and fix what it finds.
3. Review the code against [MILESTONE-1.md](MILESTONE-1.md): guest journey, persistence, page identity, anchoring, permissions, draft recovery, host-page interference, and consistency with the Figma references.
4. Fix concrete defects with focused regression tests, then update this file.
