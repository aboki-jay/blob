# Milestone 1: A working local guest experience

This is the specification for the first milestone. It is not yet implemented.

## Done when

A person can load the extension, enable it on a supported site, use it as a guest, place a comment on an element, refresh the page, and reopen the same conversation. They can also find it in History, reply locally, resolve and reopen it, and recover or reattach it if its location changes. Permission and save failures have clear outcomes without pretending success.

It must work without a backend, authentication provider, cloud database, AI API, or paid service.

## 1. Activation and drawer

- A browser-toolbar route activates Blob on the current supported page.
- The necessary site permission is handled before the on-page UI appears.
- A draggable floating Blob distinguishes a click from a drag, stays within the viewport, remembers its position, and recovers sensibly after resizing.
- Clicking opens an injected drawer consistent with the design; closing it returns to the Blob button. Chrome's native side panel is not a substitute.
- A first-time user can continue as a guest.
- Account and room features are hidden or clearly unavailable. No fake sign-in flows.

## 2. Place a comment

- Comment mode highlights the element being targeted.
- Clicking a target opens a pinned composer without triggering that element's normal action.
- Escape cancels selection, and normal page interaction returns when selection ends.
- Blob's own UI cannot be selected.
- Password fields, form values, and editable-field contents are never read or stored.
- Empty or whitespace-only comments are rejected.
- Saving, saved, and failed-save states are shown accurately.
- A failed save keeps the text and offers Retry without creating duplicates.

## 3. Threads and persistence

- Comments and local replies are saved in extension-owned storage.
- Records have stable IDs and timestamps; the stored schema is versioned.
- Data persists across reloads and browser restarts.
- A thread shows its page context, timestamps, replies, and status.
- The guest can resolve, reopen, and delete their conversation, with confirmation before deleting a conversation and its replies.
- The UI says "Only you", explains that comments are stored on this device, and is clear that this is not an account backup and can be removed with extension data.

## 4. Activity and History

- The current website and page are identified prominently.
- Page discussions stay distinct even on the same website.
- History is grouped by website, then by page and conversation.
- Only websites with Blob participation appear; no general browsing history is collected.
- Activity is sorted consistently using documented timestamps.
- There is a sensible empty state and a local Resolved view.
- No collaborative Inbox or private rooms.

## 5. Anchoring and recovery

- A small anchoring module, separate from rendering and storage.
- A suitable selector combined with limited text/context and element characteristics.
- Element-relative position for pin placement.
- Page identity is preserved: URLs on a domain are not merged, and query strings and hash routes are not discarded indiscriminately.
- A safe navigable URL is stored separately from page identity, with URL credentials and known authentication/session tokens removed. Sanitisation rules are documented.
- Pins reposition on scroll, resize, and relevant DOM changes.
- Single-page-app navigation causes no duplicate overlays, stale threads, or leaked listeners.
- A missing or ambiguous target shows "Location unavailable" and keeps the conversation; "Reattach" lets the person choose a replacement element.
- Ordinary top-level HTML pages only. Embedded frames, closed shadow roots, canvas content, PDFs, and restricted browser pages are documented as unsupported.

## Chrome and privacy requirements

- Minimum permissions. `activeTab` for temporary activation; optional per-site permission, requested by explicit user action, for Blob to reappear on later visits.
- Denial and revocation are handled, with content scripts registered or removed accordingly. Disabling site access removes the overlay and listeners without deleting saved comments.
- No broad access to every website just to try the extension. Check the generated manifest.
- Where Chrome blocks injection, the explanation appears in an extension surface such as the toolbar popup.
- The overlay lives in a Shadow Root (styling isolation, not a security boundary).
- Stored data stays out of the website's `localStorage`. Writes go through a narrow, validated message API with one clear owner; views refresh when data changes; no lost updates between tabs.
- Durable state is persisted, not held in service-worker memory. Handlers and observers are cleaned up on unmount.
- Comments render as text. Page content and messages are untrusted input.
- No whole-page HTML, screenshots, unrelated browsing activity, or telemetry.

## Out of scope

Accounts and authentication; uploading or synchronising guest comments; public share links or a hosted viewer; collaborative Inbox; private-room membership, invitations, or permissions; real-time presence and live cursors; AI integrations; billing, team administration, or a marketing site.

A copied page URL, `blob:` URL, or `chrome-extension:` URL is not a shared conversation and must not be presented as one.

## Verification

Use local fixture pages so checks are repeatable. Run type checks, tests, and a production build, and exercise the installed extension in a real browser where possible. Test:

- Persistence after reload.
- Two pages on the same website remaining separate.
- Repeated text, a moved target, and a removed target.
- Failed storage writes, retained drafts, and duplicate-safe retry.
- Concurrent local updates.
- Permission denial and revocation.
- Host-page style conflicts and cleanup after navigation.
- Keyboard access, focus visibility, labelled icon buttons, Escape behaviour, scrolling, and reply-composer visibility.
