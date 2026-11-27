# Status

Last updated: 27 November 2026

Milestone 1 implements local guest comments. The production build and browser harness have been exercised locally. The next design check is a walkthrough of the unpacked extension in Chrome, including the toolbar and permission prompt.

## Approved design review

The [Approved for Implementation page](https://www.figma.com/design/Fcy1Fpb2zNZALUhRbNjkUC/Blob?node-id=297-6696) is the visual reference for all six sections. Review Welcome and Empty state, Bottom navigation, Comment tags, Feedback, History and Activity using the production build. New demo captures in `docs/screenshots/` show the guest flows, profile appearance menu, feedback hover state and expanded History. Captures use the production overlay in headless Chromium with stand-in extension APIs.

Account examples use local guest data. Feedback supports rating and text entry; Submit sends through the feedback relay (see "Known problems and limitations" for what is still to finish). Per-message reactions and signed-in examples remain outside the implemented guest flows. Manual Chrome visual sign-off is pending.

## What works

- First-time welcome in the toolbar popup, from the Figma frame "Main/welcome" (node 27:319). On a fresh install the first click on the Blob toolbar button shows the picture, "Leave a thought right where it belongs.", **Sign in** (shown switched off, because signing in is Milestone 2) and **Continue as a Guest**. It shows on any page, including Chrome's own pages where Blob cannot run. Continuing is remembered, the popup becomes the usual one, and the drawer on the page no longer asks. Differences from the frame: the frame is the 600 x 800 drawer, so only its centre content is used, in the 450 x 500 popup; the line under the heading keeps the drawer's wording ("Start as a guest to save your comments on this device") because the frame's wording promises sign-in. The drawer keeps its own copy of the welcome for anyone who reaches it without having answered.
- Closing the drawer: pointing at the close button, or reaching it with the keyboard, turns its corner red (`#FF5252`) and the cross white, from the Figma frame "Main/welcome/close" (node 352:2041). The change fades in over about a tenth of a second, and not at all for people who ask for reduced motion. Checked by a browser test with stand-ins and a screenshot compared with the frame (`docs/screenshots/19-close-hover.png`); not seen in real Chrome.
- Toolbar popup, rebuilt from the Figma "Chrome popup" guest frame, at 450 x 500. Layout follows the 450 x 500 Figma frame (node 341:1937): margins, card padding and corners, gaps between blocks, the centred message, the picture's size, and "Recent websites" 18px above the card's edge. Text, buttons, the website card and the tick box keep their sizes from the 800 x 600 frame, because the smaller frame is a 62.5% scale of it and its 8-10px text would be hard to read (the maintainer's choice). "Recent websites" shows four: the current website, a Guest chip, "Use Blob on this page", an "Always show on ..." tick box that asks Chrome for access to that one website and gives it up again when unticked, and "Recent websites" with a count each. Pointing at a recent website widens it and shows "Open". Pages Chrome blocks get an explanation and nothing to press. "Login" is shown switched off, because signing in is not built.
- Blob tab (48 × 96) docked to the left or right edge: tucked at rest, slides out when the pointer comes near or it has focus, tells a click from a drag, and remembers its edge and height. It keeps clear of scrollbars: it sits inside a scrollbar that belongs to the page's own scrolling area or floats over the content, and its tucked part is cut off rather than drawn over the scrollbar.
- Comment tag on the page, from the Figma "Comment tags" section: clicking a pin opens a card beside the element with "Pinned to …", the comments (name, time, text), replies grouped under the comment they answer with an "N replies" bar that expands and collapses, and an "Add a comment" bar. The same card is used to write the first comment, and it stays open after posting. Resolve is in the card's header.
- Reactions on a comment, from the Figma frame "Comment with emoji hover" (node 271:7602). Pointing at a comment shows a smiley, the reactions already given, a divider and Reply. The smiley opens six reactions to choose from (👍 ❤️ 😂 😮 😢 🙏) in a pill that floats just above it, following a chat-app reference the maintainer supplied; it drops below the smiley when there is no room above, and goes away on a choice, a click elsewhere, or any scrolling. A chosen reaction stays under the comment as a grey pill with its count, and pressing that pill takes it back. Reactions are the guest's own and are saved on the device, so a count is always 1. A comment with reactions keeps them in view when not pointed at; only Reply steps back. Replies can be reacted to as well. The floating pill and its six emoji come from the maintainer's reference, not from a Figma frame. The reference also has a "+" for choosing any emoji; that is left for a later update. Reactions appear only in the on-page card, not in the drawer's conversation view. Checked by unit tests, a browser test with stand-ins and screenshots compared with the frame (`docs/screenshots/20-reaction-choices.png`, `21-reaction.png`); not seen in real Chrome.
- Injected drawer with Welcome ("Continue as a Guest"), Activity for the current website, History (Websites and Resolved) and a conversation view.
- Add a Blob: choose an element (mouse, or Tab then Enter), write a comment, see a numbered pin. Escape cancels. The page can be scrolled while choosing, including pages that scroll inside their own panel, as many web apps do. (Fixed 27 November 2026: the layer that stops clicks reaching the page also stopped the wheel reaching such panels. Blob now passes the wheel on to the panel under the pointer. Covered by a browser test with stand-ins, and the maintainer confirmed it in real Chrome on the website where it had been stuck. A panel scrolled this way moves in steps, without the browser's smooth glide, and touch-screen dragging inside a panel is not handled.)
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
| `npm test` | 78 unit tests pass: page identity and URL sanitising, storage (reload persistence, failed writes, duplicate-safe retry, concurrent updates, schema versions and the upgrade from version 1, reactions), request validation and permissions, anchoring (repeated text, moved target, removed target, private fields), and the feedback relay's logic with a stand-in for Cloudflare's email service. |
| `npm run build` | Production build succeeds. |
| `npm run check:manifest` | Generated manifest asks only for `activeTab`, `scripting`, `storage`, with optional per-site access. No `host_permissions`, `content_scripts` or `web_accessible_resources`. |
| `npm run test:e2e:harness` | 24 browser tests pass, 1 skipped (a popup test that needs the real extension); last run 27 November 2026, including the first-time welcome in the popup, the drawer's close button, scrolling while choosing, and reactions. These run the real built overlay script in headless Chromium on the fixture pages, with stand-in extension APIs. Covered: the guest journey through reload, reply, resolve and reopen; separate pages on one website; History grouping; repeated text, moved and removed targets, reattach; Escape; failed save and retry; nothing typed into the page being stored; single-page app navigation; docked tab movement and keyboard use; guest profile, feedback and navigation at 360px; host-page style conflicts; delete confirmation; removal when site access is lost. |
| `npm run test:e2e` on CI | First run (pull request 1): the real built extension in Chromium, 11 of 12 passed, including the popup test. The one failure was a pin-order assumption: Chrome's storage returns saved items in alphabetical key order, not saving order. Pins are now ordered by number, and the harness mimics Chrome's ordering so this class of mistake fails locally too. Later runs passed. The latest, run 4 on commit `a231d7a` (27 November 2026: popup rebuild, 450 x 500 popup, feedback relay), reported success for both jobs, "Types, unit tests, build" and "Browser tests". Only the pass or fail result was read; the logs need a GitHub sign-in, so the test count and whether any test passed only on its retry were not checked. **Run 5, on commit `11fc4cb` (popup welcome, reactions, close effect, scroll fix), failed** in the first browser-test step, the stand-in run that passes on the development machine, so the real-extension step never ran. The log could not be read (no sign-in), so which test failed is not known. The likely cause, not confirmed: the new reactions test measured positions while the comment card and the reaction pill were still animating, which a faster machine catches mid-movement. That test now waits for movement to finish. Whether this was the failure will only be known from the next CI run. |
| Visual comparison with Figma | Screenshots in `docs/screenshots/` were compared by eye with the welcome, empty, composer, conversation and History frames. |

## Not verified

- Loading the unpacked extension in Chrome and using it by hand.
- The toolbar popup against a real tab, including injection through `activeTab`.
- Chrome's permission prompt: granting, refusing, and revoking from Chrome's settings.
- Persistence across a full browser restart (unit-tested against a fake storage area only).
- Fonts and styles when the overlay runs in Chrome's isolated extension world rather than the page's own.
- `npm run dev`.
- Screen readers. Labels, focus order and focus rings were built in and partly exercised by the tests, but no assistive technology was used.

## Manual walkthrough (about ten minutes)

The maintainer chose to do this before merging Milestone 1 (27 November 2026). The steps were rewritten that day to match the current design; they have not been run.

1. `npm install`, then `npm run build`.
2. In Chrome open `chrome://extensions`, turn on Developer mode, click **Load unpacked**, choose `.output/chrome-mv3`. Pin Blob to the toolbar.
3. Open an ordinary website and click the Blob toolbar button. On a fresh install the popup shows the welcome screen: **Sign in** is switched off; click **Continue as a Guest**. The popup then shows the website's name and icon. (If Blob has been used in this browser before there is no welcome screen. To see it, remove Blob in `chrome://extensions` and load it again; this deletes its saved comments.) Click **Use Blob on this page**; on a website already set to "Always show" the button reads **Open Blob**. The Blob tab should appear docked to the right edge and the drawer should open on Activity.
4. Click **Add a Blob**. Move over the page: elements highlight. Click one. The page's own link or button must not activate.
5. Type a comment in the card that appears and press Enter. A numbered pin appears and the card stays open showing the comment.
6. Reload. Blob is gone (access was for that tab visit only). Click the toolbar button, tick **Always show on …**, and accept Chrome's prompt. Reload again: the pin is back without clicking anything.
7. Click the pin: the comment card opens beside it, not the drawer. Reply, then **Resolve** from the card's header. Open the drawer, go to History then Resolved, and **Reopen**.
8. Move the pointer away: the Blob tab tucks into the edge, and it must not sit on top of the page's scrollbar. Drag the tab up or down, or across to the other edge; reload; it stays where you left it.
9. Click the toolbar button and untick **Always show on …**. Reload: Blob no longer appears by itself. Tick it again: the comment is still there.
10. Open `chrome://extensions` and click the toolbar button: the popup should say Blob can't run on this page, with nothing to press.
11. Quit and reopen Chrome, return to the website: the comment is still there.
12. Open the feedback form in the drawer, pick a rating, write a line and press **Submit**. It should say the feedback was sent, and an email should arrive in the project inbox.

Also worth trying: refuse the permission prompt in step 6 (the popup should say access wasn't granted), a second page on the same website (its comments should be listed separately), and the popup's "Recent websites" after commenting on two websites.

## Known problems and limitations

- The project's contact address is blob@davidokunlola.com (Cloudflare Email Routing, forwarding to the maintainer's inbox; receive-only).
- Feedback: the form's Submit button sends the rating and text to the Blob project through the relay in `worker/feedback/` (see its README). The relay was deployed to Cloudflare on 27 November 2026 at `https://blob-feedback.davidokunlola.com/`, and `FEEDBACK_ENDPOINT` in `lib/feedback.ts` points to it, so Submit is switched on in the real build.
  - Checked against the live relay from a terminal: it answers on that address, answers the browser's pre-check with the headers an extension needs, refuses anything that is not a `POST`, and the per-sender limit was accepted by Cloudflare's free plan. Cloudflare's default `workers.dev` address is switched off and answers 404.
  - The inbox secret (`FEEDBACK_TO`) was set by the maintainer in the Cloudflare dashboard. One real test message was then posted to the live relay from a terminal and it answered `{"ok":true}`. Invalid input is refused with `400`. The maintainer confirmed the email arrived in the inbox.
  - **The per-sender limit is loose.** It is set to 5 a minute, but Cloudflare's limiter counts approximately: 33 invalid requests sent one after another over about two minutes were all let through, and it only started refusing (`429`) during a burst of 60 at once, and then only some of them. It will blunt a flood, not stop a patient sender. A firm limit would need the relay to keep a counter somewhere, which it does not do today.
  - Not checked: Submit pressed in real Chrome against the live relay. The form and the Worker's logic are covered by unit and browser tests with stand-ins only.
  - The domain's own website has a catch-all route that answered for the relay's address at first; the relay has a second, exact route to take priority (explained in the relay's README).

- Bottom navigation (shown while choosing where to comment): collapsed, pointing at or keyboard-focusing an item shows its name in a pill 5px under the bar, from the Figma "Bottom navigation" section (the pill is "Frame 47"). The bar now sits 45px above the bottom of the window to leave the pill room. Expanded, the names are written out and there are no pills. The guest bar shows no count badges, matching the "Collapsed view/Guest" frame; the badges in "Collapsed view/Active" belong to the signed-in bar, which is not built.

- Website cards (popup and drawer) show the website's own icon, falling back to its initial when there is none or it fails to load. In the popup the address comes from Chrome's tab information; on the page it is the icon the page declares. Tested against local fixture icons only. History and "Recent websites" still have no icons, because fetching icons for websites you are not on would contact those websites.

- The first-time welcome in the popup was checked the same way as the rest of the popup (stand-ins, and a screenshot compared with the Figma frame: `docs/screenshots/18-popup-welcome.png`). It has not been seen in real Chrome, and the real-extension test that now covers it has not run on CI yet.
- The popup was checked by opening the built popup page with stand-ins for `chrome.tabs` and `chrome.permissions`, and comparing screenshots with Figma. It has not been opened from the toolbar in real Chrome since the redesign.
- The Figma prototype could not be played (the link needs a Figma sign-in). Interactions were taken from the component variants instead: the recent-website item has "Initial" and "Hover" variants. Anything in the prototype beyond that is not reflected.
- Popup differences from the frame: the ticked state of the tick box uses a standard check mark, because only the unticked state was in the frame; when the website already has comments the heading reads "N Blobs on this website", a state the frame does not show; "Hide Blob on this tab" was dropped because the frame has no place for it.

- The comment tag's header says "New comment" when writing the first comment and "Comment" for an existing conversation; the Figma frames say "New comment" in both. The header's Resolve control is not in the Figma frames.
- Scrollbar clearance is tested only where scrollbars float over the content (the test browser hides them). The classic-scrollbar case inside a page's own scrolling area is handled in code but not covered by a test, and has not been checked in real Chrome.
- Browser tests serve their fixture pages on port 43117. If something else is using that port the tests stop with a clear error.

- `npm run test:e2e` cannot run on the original development machine: Playwright's full Chromium build fails to start there with a Windows "side-by-side configuration" error. It runs on CI. Use `npm run test:e2e:harness` locally on machines like that.
- One browser test failed once locally in harness mode and passed in the next 55 runs; which test and why is unknown. CI retries a failed test once and reports it as flaky if the retry passes.

- See "Not verified" above. Treat anything involving Chrome's own extension plumbing as untested.
- A pin on an element inside a scrolling panel is still drawn if the element is scrolled out of the panel's visible area.
- An anchor can become unavailable after a small text change on the element. This is deliberate caution, and Reattach recovers it.
- Saved data is now at version 2 (version 1 plus reactions). Existing comments are upgraded untouched the first time this build saves anything. After that, an older build of Blob will refuse to read them and say they were written by a newer version; nothing is lost, and the current build reads them again.
- All data is stored under one key, which will not suit thousands of conversations.
- The header title and some labels follow the Figma frame linked as the starting point; other frames use different wording ("Blob · Comment together on the web").
- Sign in, Inbox and private rooms from the design are hidden or marked unavailable, as planned for this milestone.

## Decisions pending

- **Copyright line.** LICENSE says "Blob contributors". A named holder may be preferable.
- **Mascot licence.** The mascot artwork is in the repository as part of the extension. Whether it is covered by MIT or reserved should be stated in THIRD_PARTY.md.
- The drawer header follows the Approved for Implementation page.
- **Milestone 2.** The maintainer confirmed the sharing rule (sign-in needed to view and to reply), Google sign-in, and Cloudflare for the server on 27 November 2026. A draft specification is in [MILESTONE-2.md](MILESTONE-2.md); its "Still to confirm" list needs answers. Nothing in it is built, and building waits for the walkthrough below and the merge of the Milestone 1 pull request.

## Exact next task

Review and verify Milestone 1 in a real browser. Do not start accounts, sharing or rooms.

1. Reload the unpacked production build and compare all six guest sections against the Approved for Implementation page. Check the 600 × 800 drawer, the 450 px comment tag, the feedback hover label and page disclosures at 100% zoom, then repeat at a narrow width. Record differences before changing launcher interactions.
2. CI failed on `11fc4cb` (see the table above). Push the test fix and read the next run; if it fails again, open the "Browser tests" log on the pull request to see which test, and look into any test it reports as flaky.
3. Review the code against [MILESTONE-1.md](MILESTONE-1.md): guest journey, persistence, page identity, anchoring, permissions, draft recovery, host-page interference, and consistency with the Figma references.
4. Fix concrete defects with focused regression tests, then update this file.
