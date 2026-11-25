# Instructions for coding agents

Blob is an open-source Chrome extension (Manifest V3, WXT, React, TypeScript) for persistent, Figma-style comments on website elements. The maintainer is a product designer and a nontechnical builder: explain important decisions in plain language and work in small, reviewable milestones.

Read [docs/STATUS.md](docs/STATUS.md) first. It says what works, what was verified and how, and the exact next task. Do not describe anything as working unless you ran it, and say which way you ran it.

## Commands

```bash
npm install                 # also runs `wxt prepare`
npm run check               # typecheck + unit tests + build + manifest check
npm run test:e2e            # browser tests, real extension (needs: npx playwright install chromium)
npm run test:e2e:harness    # same tests, stand-in extension APIs; use if the real run cannot start
npm run dev                 # WXT live-reload mode; not yet tried here
```

Run `npm run check` and one of the browser test commands before finishing any change. Load `.output/chrome-mv3` in `chrome://extensions` to try it by hand.

## Scope

- Build only the milestone named in docs/STATUS.md.
- Accounts, sharing, private rooms, real-time features, AI integrations and billing are roadmap items. Do not build them early, and never present a mock network operation as a real feature.
- Milestone 1 works without a backend, authentication provider, cloud database, AI API or paid service. Keep it that way.
- Do not publish to the Chrome Web Store, create paid infrastructure, or use production credentials.

## Architecture boundaries

Details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Keep these separate:

| Area | Files | Rule |
| --- | --- | --- |
| Storage | `lib/storage/store.ts` | Only the background writes. One change at a time. Schema is versioned: bump `SCHEMA_VERSION` and add a migration when the shape changes. |
| Requests | `lib/messages.ts`, `lib/handler.ts` | Every request is validated as untrusted input. No browser APIs in `handler.ts`. |
| Page identity | `lib/page.ts` | Never save URL credentials or session tokens. Do not merge pages or drop query strings wholesale. |
| Anchoring | `lib/anchor/` | No storage or rendering code. Never read form values or editable content. Prefer "unavailable" to a wrong pin. |
| Site access | `lib/sites.ts`, `entrypoints/background.ts`, `entrypoints/popup/` | `activeTab` is temporary; lasting access is an optional per-site permission. |
| Overlay UI | `overlay/`, `entrypoints/overlay.ts` | Lives in a Shadow Root. Sizes in px, not rem. Everything added to a page is removed on unmount. |

The overlay script is not a manifest content script. It is injected on a toolbar click or registered at runtime for granted sites. Do not add `content_scripts`, `host_permissions` or `web_accessible_resources`; `npm run check:manifest` fails if they appear.

Prefer small, readable modules over speculative abstractions. One extension project until a later milestone needs more.

## Design references

- Starting frames (welcome and empty states): https://www.figma.com/design/Fcy1Fpb2zNZALUhRbNjkUC/Blob?node-id=271-6323
- Main design: https://www.figma.com/design/Fcy1Fpb2zNZALUhRbNjkUC/Blob?node-id=21-72
- Additional screens and flows: https://www.figma.com/design/Fcy1Fpb2zNZALUhRbNjkUC/Blob?node-id=235-3203

Inspect Figma read-only; never edit the file. If you cannot access it, say so and never claim to have inspected it. The additions page includes proposals, not a list of features to build immediately.

Design tokens live at the top of `overlay/style.css` and mirror the Figma variables (primary `#623DF5`, Inter for body, Geist for headings). Keep the compact navigation rail, draggable Blob, pinned comments and drawer. No glass effect. Keep it usable at narrow widths and browser zoom.

## Privacy rules

- Guest data stays on the device, in extension-owned storage, never the website's `localStorage`.
- Never read or store password fields, form values or editable-field contents.
- No whole-page HTML, screenshots, unrelated browsing activity or telemetry.
- Never persist, log or commit URL credentials or known authentication/session tokens.
- Render comments as text. Treat page content and messages as untrusted input.
- Request the minimum permissions and check the generated manifest, not only source configuration.

## Repository hygiene

- Never commit secrets, build output, browser profiles or personal test data.
- Only add assets and dependencies that can be redistributed; record them in [THIRD_PARTY.md](THIRD_PARTY.md).
- Keep documentation concise and consistent with the code. Update docs/STATUS.md at the end of each piece of work.
