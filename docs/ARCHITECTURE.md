# Architecture

How Blob is put together as of Milestone 1 (local guest experience). One extension project: Chrome Manifest V3, built with WXT, React and TypeScript. No backend.

## The parts

| Part | Files | What it does |
| --- | --- | --- |
| Toolbar popup | `entrypoints/popup/` | Turns Blob on for the current tab, asks for or gives up lasting access to a website, and explains pages Chrome will not let Blob run on. |
| Background service worker | `entrypoints/background.ts`, `lib/handler.ts`, `lib/sites.ts` | The only part that writes storage. Validates every request. Registers or removes the overlay script as site access changes. |
| Overlay | `entrypoints/overlay.ts`, `overlay/` | The Blob button, pins, composer and drawer drawn on the page. |
| Storage layer | `lib/storage/store.ts` | Typed access to `chrome.storage.local`. |
| Page identity | `lib/page.ts` | Decides which page a conversation belongs to and produces a safe URL. |
| Anchoring | `lib/anchor/` | Describes the chosen element and finds it again. |

Chrome can stop the background worker at any moment, so it keeps nothing in memory. Every request reads storage afresh.

## How Blob reaches a page

The overlay script is deliberately **not** a manifest content script. It gets onto a page in one of two ways, both started by the person:

1. **This tab, for now.** Clicking the toolbar button gives Chrome's `activeTab` access to that tab. The popup's "Use Blob on this page" asks the background to inject the overlay. Access ends when the tab reloads or navigates.
2. **Always on this website.** "Always show on example.com" requests the optional host permission for that one website. When Chrome reports it was granted, the background registers the overlay script for that website (`chrome.scripting.registerContentScripts`) so it loads on later visits.

Chrome's permission list is the source of truth. `syncSites` copies it to the registered script and to a stored list; it runs on install, on browser start, and whenever a permission is added or removed, whether from the popup or from Chrome's own settings. An overlay that sees its website leave the stored list removes itself from the page straight away. Saved comments are never touched by any of this.

If Chrome refuses the permission, the popup says so and Blob stays usable on the current tab only. If Chrome refuses injection, the popup shows the reason; nothing is drawn on the page.

The generated manifest asks for `activeTab`, `scripting` and `storage`, plus optional host permissions. `npm run check:manifest` fails the build if anything broader appears.

## Storage model

Everything is in extension-owned `chrome.storage.local`, under four keys:

| Key | Contents |
| --- | --- |
| `blob:data` | `{ version, threads, pages }`. A thread is one conversation: its page, pin number, status, anchor and messages (the first message is the comment, the rest are replies). |
| `blob:drafts` | Unsent text, keyed by `new:<page>` or `reply:<thread>`. |
| `blob:settings` | Whether the welcome screen was dismissed, and where the Blob button was left. |
| `blob:sites` | Websites with lasting access, mirrored from Chrome. |

- **Versioned.** `blob:data` carries a schema version. `migrate()` upgrades older data step by step. Data written by a *newer* Blob is never overwritten: the store refuses and the UI explains.
- **One writer.** The overlay and popup never write. They send a request; the background validates it and performs it.
- **No lost updates.** The store runs writes one after another, each as read, change, write. Two tabs saving at once both succeed.
- **Honest failures.** If a write fails, the request fails, and the UI keeps the text and offers Try again.
- **Safe retries.** The UI creates the conversation id and message id before the first attempt and reuses them on retry. Creating or replying with an id that already exists changes nothing, so a retry cannot duplicate.
- **Live views.** Every open overlay listens for storage changes and re-renders.

Timestamps are ISO 8601 strings. `updatedAt` is the time of the latest comment, reply, resolve or reopen. Every list sorts by `updatedAt`, newest first, then creation time, then id.

## Page identity

A conversation belongs to a page, identified by a key built from the address. The address is kept as it is, with only these removed:

- `user:password@` credentials.
- Query parameters that carry secrets or sessions (`token`, `access_token`, `api_key`, `session`, `sid`, `jsessionid`, signed-URL parameters and similar), in the query and in hash routes.
- `code` and `state` when both are present (a sign-in redirect). `code` alone is kept.
- Tracking parameters (`utm_*`, `fbclid`, `gclid` and similar).
- `;jsessionid=...` path parameters.
- A hash that is a plain anchor (`#pricing`) or carries key=value pairs. A hash route (`#/inbox`) is kept, because many apps use it to identify the page.

For the key only, parameter order and a trailing slash are ignored. The saved URL is the same sanitised address, kept in its original parameter order so it opens correctly. Different ports are different websites.

The full list is in `lib/page.ts` and is covered by `tests/unit/page.test.ts`.

## Anchoring

When an element is chosen, Blob records: a CSS path (a stable `id` where there is one, otherwise tag and position), the tag, up to 80 characters of its text, the nearest heading above it, a few attributes (`role`, `type`, `name`, `alt`, `aria-label`, test id, and a link's path without its query), up to three class names, and where inside the element the pin sits as fractions of its width and height. Ids and class names that look machine-generated are ignored.

For form controls and editable regions, no text is recorded at all.

To find it again:

1. Try the CSS path. Accept the result only if the recorded details still agree, including the heading. This stops a pin landing on a look-alike after a list is reordered.
2. Otherwise search the page for an element of the same tag that matches almost perfectly. One clear winner is accepted. Among identical candidates, the recorded heading decides.
3. If nothing matches, or several match and nothing tells them apart, the anchor is **unavailable**.

Unavailable is a normal state: the conversation stays, the drawer says "Location unavailable", and **Choose a new location** lets the person pick a replacement element. Reattaching updates the same conversation; it never creates a second one.

Pins are drawn from the element's current box on every scroll, resize and layout change (once per animation frame). Elements are searched for again when the page's structure changes (at most a few times a second).

## The overlay on the page

- One custom element, `<blob-overlay>`, appended to `<html>`, with a Shadow Root for style isolation. Styles are attached as a constructed stylesheet. Sizes are in px because `rem` would follow the website.
- This is styling isolation, not a security boundary. Scripts on the page can reach into the Shadow Root.
- Inter and Geist are bundled in the script and given to the browser as bytes under private family names, so no font files are exposed to websites and no request is made.
- While choosing an element, a transparent layer covers the page and takes every click, so nothing on the page is activated.
- Typing inside Blob does not reach the website's keyboard shortcuts.
- Single-page apps: the page layer is keyed by page identity, so moving to another route discards pins, composer and selection and starts clean.
- Injecting twice does nothing. A copy left by an older version of the extension removes itself when a new one arrives.
- On unmount the element, all listeners and observers, and the fonts are removed.

## Feedback relay

The only server-side piece, and the only request Blob makes with someone's words in it. It is optional and separate from commenting.

- The feedback form sends `feedback/send` (rating and text) to the background, like any other request. The background posts it, with Blob's version number, to `FEEDBACK_ENDPOINT` (`lib/feedback.ts`). The overlay never calls the network itself.
- The endpoint is the Worker in `worker/feedback/`, served at `blob-feedback.davidokunlola.com`. It validates the input again, limits each sender to a few messages a minute, and emails the feedback to the maintainer through Cloudflare Email Sending. The recipient is a Worker secret. It stores nothing.
- No host permission is needed: the Worker allows requests from any origin, and no cookies or credentials are sent.
- With `FEEDBACK_ENDPOINT` empty, the background reports feedback as unavailable, Submit stays off, and the form offers an email link.
- Browser tests use a stand-in relay on the fixture server, so no test sends real feedback.

## Not supported

Content inside embedded frames, closed shadow roots, canvas-drawn interfaces, PDFs, local files, and browser pages (`chrome://`, the Chrome Web Store). Elements inside an open shadow root are anchored to the component that contains them.

## Tradeoffs made

- **Runtime injection instead of a manifest content script.** Costs a little code in the background; avoids asking for access to every website.
- **A letter tile instead of a favicon.** Fetching favicons reliably needs another permission.
- **The whole data set under one key.** Simple and atomic to write. It will need splitting if someone keeps thousands of conversations.
- **A strict anchor matcher.** Small text changes can make an anchor unavailable when a looser matcher would have found it. That is the intended direction of error.
- **Open Shadow Root.** Needed for automated browser tests; it adds no real exposure because the boundary is not a security one either way.
- **A test harness alongside the real-extension tests.** `tests/e2e/harness.ts` stands in for Chrome's extension APIs so the browser tests can run where an extension cannot be loaded. It is never part of the shipped extension.
