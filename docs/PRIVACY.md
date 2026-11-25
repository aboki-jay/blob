# Privacy

> No Blob software exists yet, so nothing is collected or stored today. This document states the commitments the first milestone must meet. It will be rewritten to describe actual behaviour once code lands.

## What Blob will store (Milestone 1)

- Your comments and replies, with IDs, timestamps, and resolved status.
- The page each conversation belongs to: a page identity and a safe, navigable URL.
- A small anchor for each comment: a selector, limited nearby text, and basic element characteristics, enough to find the element again.
- The Blob button's position and your per-site access choices.

## Where it is stored

In extension-owned `chrome.storage.local`, on your device only. Not in the website's own storage, and not on any server. Milestone 1 has no backend.

Local storage is not an account backup. It is removed if you uninstall the extension or clear its data.

## What Blob will not collect

- Password fields, form values, or the contents of editable fields.
- Whole-page HTML or screenshots.
- General browsing history. History lists only websites where you have left comments.
- Telemetry or analytics.
- URL credentials or known authentication/session tokens. These are stripped before a URL is saved; route and record identifiers needed to find the page again are kept.

## Permissions

- `activeTab`: temporary access to the current tab when you click the toolbar button.
- Optional per-site access: requested only when you choose to keep Blob enabled on a website. You can refuse or revoke it. Revoking removes Blob's overlay from that site without deleting your saved comments.
- Storage, and the scripting access needed to show the overlay.

Blob will not ask for access to every website just to try it.

## Known limitations

- The overlay is drawn inside the page. A Shadow Root isolates its styling, but it is not a security boundary: scripts on the host page could in principle observe overlay content shown on that page.
- Anchors include a short piece of nearby page text. On pages showing sensitive content, that snippet is saved on your device with the comment.

## Later milestones

Sharing and rooms will require sending selected content to a server. That will always be an explicit action on a specific thread, and this document will be updated before any such feature ships.
