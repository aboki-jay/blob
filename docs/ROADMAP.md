# Roadmap

Blob is a fun project with limited resources. Each milestone should leave something small, understandable, and useful.

## Milestone 1: Local guest experience (built, awaiting real-browser verification)

Load the extension, enable it on a supported site, place a comment on an element as a guest, refresh, and reopen the same conversation. Find it in History, reply locally, resolve and reopen it, and reattach it if its location changes. No backend, account, or AI service.

Full specification: [MILESTONE-1.md](MILESTONE-1.md). What has and has not been verified: [STATUS.md](STATUS.md).

## Milestone 2: Shared threads

- Real accounts and sign-in.
- Explicit upload of a selected thread; signing in alone never uploads guest comments.
- Server-enforced access, recipient viewing and replying, revocable links.
- A defined experience for recipients without the extension.

## Milestone 3: Private rooms

- Invitations and membership.
- Website and page grouping inside a room; discussions can span several websites.
- Server-enforced permissions.

## Milestone 4: Real-time collaboration

- Persistent updates plus temporary presence.
- Reconnection and access revocation handled properly.

## Milestone 5: Public release

- Distributable assets with clear licences.
- Final privacy documentation.
- Extension-store packaging.
- Contributor readiness.

## Not planned

- An AI agent built into Blob.
- Billing, team administration, or a marketing site (not before a public release, if at all).

## Decisions pending

These audience rules are working proposals, to be confirmed before sharing is implemented:

1. Single threads remain private until explicitly shared.
2. A shared Single thread may be viewed by someone with its link; signing in is required to reply.
3. Private-room content is available only to authorised members.
4. Access to Blob never grants access to a private underlying website.

Also undecided: the backend and authentication provider for Milestone 2, and how History and Inbox behave once shared content exists.
