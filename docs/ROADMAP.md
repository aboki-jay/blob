# Roadmap

Blob is a fun project with limited resources. Each milestone should leave something small, understandable, and useful.

## Milestone 1: Local guest experience (built, awaiting real-browser verification)

Load the extension, enable it on a supported site, place a comment on an element as a guest, refresh, and reopen the same conversation. Find it in History, reply locally, resolve and reopen it, and reattach it if its location changes. No backend, account, or AI service.

Full specification: [MILESTONE-1.md](MILESTONE-1.md). What has and has not been verified: [STATUS.md](STATUS.md).

## Milestone 2: Shared threads (planned, not started)

- Real accounts and sign-in.
- Explicit upload of a selected thread; signing in alone never uploads guest comments.
- Server-enforced access, recipient viewing and replying, revocable links.
- A defined experience for recipients without the extension.

Draft specification: [MILESTONE-2.md](MILESTONE-2.md).

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

Audience rules. Rules 1, 2 and 4 were confirmed by the maintainer on 27 November 2026; rule 3 is a working proposal for Milestone 3:

1. Single threads remain private until explicitly shared.
2. A shared Single thread can be viewed and replied to only by someone who has its link and is signed in. (Changed from the earlier proposal, which let anyone with the link view.)
3. Private-room content is available only to authorised members.
4. Access to Blob never grants access to a private underlying website.

Decided for Milestone 2: Cloudflare (Workers and D1) for the server, and Google sign-in.

Still undecided: how History behaves once shared content exists, and the other items under "Still to confirm" in [MILESTONE-2.md](MILESTONE-2.md).
