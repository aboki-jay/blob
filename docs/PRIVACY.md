# Privacy

This describes what Blob actually does as of Milestone 1.

## What Blob stores

- Your comments and replies, with ids, timestamps and open/resolved status.
- For each page you commented on: its address with secrets removed (see below), its title, and a short path label.
- For each comment, a small description of the element it is pinned to: a CSS path, the tag, up to 80 characters of the element's text, the nearest heading, a few attributes, up to three class names, and the pin's position inside the element.
- Text you have typed into Blob but not yet posted (drafts).
- Where you left the Blob button, whether you dismissed the welcome screen, and which websites you chose "Always show" for.

## Where

In the extension's own `chrome.storage.local`, on this device. Not in the website's storage. Not on a server: Blob has no backend, and nothing you write is sent anywhere.

The one thing Blob loads from the web is a website's own icon, to show beside its name. In the toolbar popup it uses the icon address Chrome supplies for the tab you are on; on the page it uses the icon the page declares. Showing it can make one request to that website (or wherever it hosts its icon) for the image, with no referrer. The icon and its address are not saved.

This is not an account backup. Everything is deleted if you remove Blob or clear its data. Deleting a conversation in Blob removes it, its replies and its draft.

## What Blob does not store or read

- Passwords, form values, or anything typed into a text field or editable area on a page. You can pin a comment to a field, but Blob records only the field's own attributes, never its contents.
- Whole pages, page HTML or screenshots.
- Your browsing history. History in Blob lists only pages where you left a comment.
- Telemetry or analytics of any kind.
- Sign-in details in addresses. Before a page's address is saved, Blob removes `user:password@`, session and token parameters, sign-in redirect codes and tracking parameters. The rules are listed in [ARCHITECTURE.md](ARCHITECTURE.md#page-identity).

## Permissions

| Permission | Why |
| --- | --- |
| `activeTab` | Temporary access to the tab you are on, only after you click Blob's toolbar button. |
| `scripting` | Lets Blob place its on-page interface into that tab, or into websites you allowed. |
| `storage` | Saves your comments on this device. |
| Optional access to one website | Only if you choose "Always show on …". Chrome asks you to confirm. Blob then appears on that website automatically. |

Blob never asks for access to all websites. You can turn a website off again from the popup ("Turn off for …") or in Chrome's extension settings. Turning it off removes Blob from open pages of that website and keeps your comments.

## Known limitations

- Blob's interface is drawn inside the page you are viewing. A Shadow Root keeps the styles apart, but it is not a security boundary: scripts running on that page could read what Blob shows there, including your comments on that page.
- The saved description of an element includes a short piece of the page's visible text and a heading. On a page showing sensitive information, that snippet is stored on your device with the comment.
- The list of removed address parameters covers common names. An unusual, site-specific secret parameter would not be recognised.
- Blob adds two fonts to the page under private names while it is showing. A page could detect that Blob is present.

## Later milestones

Sharing and rooms will mean sending chosen content to a server. That will always be an explicit action on a specific conversation, and this document will change before any such feature ships.
