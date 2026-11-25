# Blob

Blob is an open-source Chrome extension for leaving persistent, Figma-style comments on elements of any website.

> **Status: pre-alpha.** This repository currently contains the project plan and documentation only. No extension code has been written yet. See [docs/STATUS.md](docs/STATUS.md).

## What Blob will do

A draggable Blob button sits on a supported page. Clicking it opens an on-page drawer where you can pin a comment to an element, reply, resolve and reopen conversations, and find them again later.

The first milestone is a local guest experience: comments are saved privately on your device, with no account, backend, or AI service. Sharing, private rooms, and real-time collaboration come later.

## Planned functionality

| Milestone | Summary |
| --- | --- |
| 1. Local guest experience | Place a comment on a real page, save it on the device, find it again after a refresh. |
| 2. Shared threads | Accounts, explicit sharing of a selected thread, revocable links. |
| 3. Private rooms | Invitations, membership, discussions spanning several websites. |
| 4. Real-time collaboration | Live updates and presence. |
| 5. Public release | Store packaging, privacy documentation, contributor readiness. |

Details are in [docs/ROADMAP.md](docs/ROADMAP.md). The full specification for the first milestone is in [docs/MILESTONE-1.md](docs/MILESTONE-1.md).

## Planned stack

- Chrome Manifest V3
- [WXT](https://wxt.dev), React, and TypeScript
- `chrome.storage.local` behind a small typed storage layer
- An injected overlay isolated in a Shadow Root

These are starting choices, described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). They become commitments once the first code lands.

## Running it

There is nothing to run yet. Setup, build, and "load unpacked" instructions will be added here with the first working code.

## Privacy

Blob is designed to keep guest comments on the device and to request the minimum Chrome permissions. See [docs/PRIVACY.md](docs/PRIVACY.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Coding agents should read [AGENTS.md](AGENTS.md).

## Licence

[MIT](LICENSE)
