# Instructions for coding agents

Blob is an open-source Chrome extension for persistent, Figma-style comments on website elements. The maintainer is a product designer and a nontechnical builder: explain important decisions in plain language and work in small, reviewable milestones.

## Current state

The repository holds documentation only. No code, package manager, or build exists yet. Read [docs/STATUS.md](docs/STATUS.md) first; it names the exact next task. Do not describe anything as working unless you ran it.

## Commands

None yet. When the project is scaffolded, list the real install, dev, type-check, test, and build commands here and keep them current.

## Scope

- Build only the milestone named in docs/STATUS.md. The specification for the first one is [docs/MILESTONE-1.md](docs/MILESTONE-1.md).
- Accounts, sharing, private rooms, real-time features, AI integrations, and billing are roadmap items. Do not build them early, and do not present mock network operations as real features.
- Milestone 1 must work without a backend, authentication provider, cloud database, AI API, or paid service.
- Do not publish to the Chrome Web Store, create paid infrastructure, or use production credentials.

## Architecture boundaries

Planned boundaries are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Keep these separate:

- **Storage**: one typed layer over `chrome.storage.local`, with a versioned schema and a single owner for writes.
- **Anchoring**: finding and re-finding the commented element. Independent of rendering and storage.
- **Overlay UI**: the injected Blob button, pins, and drawer, inside a Shadow Root.
- **Permissions**: temporary `activeTab` activation versus optional per-site access.

Prefer small, readable modules over speculative abstractions. Keep one extension project until a later milestone needs more.

## Design references

- Main design: https://www.figma.com/design/Fcy1Fpb2zNZALUhRbNjkUC/Blob?node-id=21-72
- Additional screens and flows: https://www.figma.com/design/Fcy1Fpb2zNZALUhRbNjkUC/Blob?node-id=235-3203

Inspect Figma read-only; never edit the file. If you cannot access it, say so and never claim to have inspected it. The additions page includes proposals, not a list of features to build immediately.

Known direction: primary colour `#623DF5`; Inter and Geist; compact navigation rail, draggable Blob, pinned comments, and drawer; no glass effect; reusable components and design tokens; usable at narrow widths and browser zoom.

## Privacy rules

- Guest data stays on the device, in extension-owned storage, never the website's `localStorage`.
- Never read or store password fields, form values, or editable-field contents.
- No whole-page HTML, screenshots, unrelated browsing activity, or telemetry.
- Never persist, log, or commit URL credentials or known authentication/session tokens.
- Render comments as text. Treat page content and messages as untrusted input.
- Request the minimum permissions and check the generated manifest, not only source configuration.

## Repository hygiene

- Never commit secrets, build output, browser profiles, or personal test data.
- Only add assets and dependencies that can be redistributed under their licences. Access to the Figma file does not grant redistribution rights for its fonts or illustrations.
- Keep documentation concise and consistent with the code. Update docs/STATUS.md at the end of each piece of work.
