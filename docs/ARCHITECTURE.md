# Architecture

> This is the intended design for Milestone 1. Nothing here is implemented yet. Replace this notice with a description of the actual code when it lands, including any tradeoffs that changed.

## Starting choices

- Chrome Manifest V3, one extension project.
- WXT, React, and TypeScript, following WXT's project conventions.
- CSS variables and scoped component styles, with design tokens.
- No backend, web app, or authentication in Milestone 1.

## Extension parts

| Part | Responsibility |
| --- | --- |
| Toolbar popup | Activate Blob on the current page, request or revoke site access, and explain pages where Chrome blocks injection. |
| Background service worker | Owns storage writes, validates messages, and registers or removes content scripts as site access changes. Holds no durable state in memory. |
| Content script overlay | The draggable Blob, pins, composer, and drawer, rendered inside a Shadow Root on the page. |
| Storage layer | Typed access to `chrome.storage.local` with a versioned schema. |
| Anchoring module | Describes a target element and finds it again later. No rendering or storage code. |

The Shadow Root isolates styling. It is not a security boundary against the host page.

## Storage model

- Records (conversations, comments, replies) have stable IDs and timestamps.
- The schema carries a version so later updates can migrate guest work rather than discard it.
- A single owner performs writes, through a narrow validated message API, to avoid lost updates between tabs.
- Views refresh when stored data changes.

## Page identity

- Each conversation belongs to a page, not just a domain. Query strings and hash routes are not discarded indiscriminately, because many sites use them to identify a page.
- A safe, navigable URL is stored separately from the page identity.
- URL credentials and known authentication/session tokens are removed before anything is saved. The sanitisation rules will be documented here.

## Anchoring strategy

- Combine a selector with limited text and context and basic element characteristics.
- Pin placement uses a position relative to the element; screen coordinates alone never identify a target.
- Pins reposition on scroll, resize, and relevant DOM changes, and survive single-page-app navigation without duplicate overlays or leaked listeners.
- If the target is missing or ambiguous, show "Location unavailable", keep the conversation, and offer "Reattach". An unavailable anchor is preferred over a confident pin on the wrong element.

## Permission behaviour

- `activeTab` gives temporary access after a toolbar click.
- Optional per-site permission, requested by an explicit user action, lets Blob reappear on later visits; the content script is registered or removed to match.
- Denial and revocation are handled. Revoking access removes the overlay and its listeners but keeps saved comments.
- No broad all-sites access is required to try the extension.

## Not supported initially

Embedded frames, closed shadow roots, canvas-based content, PDFs, and restricted browser pages (such as `chrome://` pages and the Chrome Web Store). Only ordinary top-level HTML pages are in scope.

## Tradeoffs to record

To be written as real decisions are made during implementation.
