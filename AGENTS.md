# Instructions for coding agents

Blob is an open-source Chrome extension (Manifest V3, WXT, React, TypeScript) for persistent, Figma-style comments on website elements. The maintainer is a product designer and a nontechnical builder: explain important decisions in plain language and work in small, reviewable milestones.

Read [docs/STATUS.md](docs/STATUS.md) first. It says what works, what was verified and how, and the exact next task. Do not describe anything as working unless you ran it, and say which way you ran it.

## Commands

```bash
npm install                 # also runs `wxt prepare`
npm run check               # typecheck + unit tests + build + manifest check + worker config check
npm run test:load -- --url http://127.0.0.1:8787   # 150-person load test against a running sharing server (see worker/api/README.md)
npm run test:smoke -- --url http://127.0.0.1:8787  # every kind of request once, against a running sharing server; run after deploying the test copy
npm run test:e2e            # browser tests, real extension (needs: npx playwright install chromium)
npm run test:e2e:harness    # same tests, stand-in extension APIs; use if the real run cannot start
npm run dev                 # WXT live-reload mode; not yet tried here
```

Run `npm run check` and one of the browser test commands before finishing any change. Load `.output/chrome-mv3` in `chrome://extensions` to try it by hand.

## Scope

- Build only the milestone named in docs/STATUS.md, and within it only the step STATUS.md names. Milestone 2 (shared threads) is in progress; its plan, decisions and order of work are in [docs/MILESTONE-2.md](docs/MILESTONE-2.md).
- Private rooms, invitations, real-time features, AI integrations and billing are roadmap items. Do not build them early, and never present a mock network operation as a real feature.
- The guest experience from Milestone 1 keeps working with no account and no server. Signing in and sharing are additions: nothing leaves the device unless its owner shares it.
- Milestone 2 has one server, the sharing server in `worker/api/` (a Cloudflare Worker with a D1 database), on free infrastructure only. Do not add another backend, an authentication service, a paid plan or an AI API without the maintainer deciding it. Milestone 2 decisions are discussed with the maintainer before they are recorded or built (see the note at the top of MILESTONE-2.md).
- The feedback relay in `worker/feedback/` is separate and optional: with `FEEDBACK_ENDPOINT` in `lib/feedback.ts` set to `''`, Blob sends no feedback. Do not route anything else through it.
- Do not publish to the Chrome Web Store, create paid infrastructure, or use production credentials. Deploying is the maintainer's step.

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
| Shared input checks | `lib/input.ts` | Used by both the extension and the sharing server. No browser, storage or network code. |
| Sharing server | `worker/api/` | Access rules live in the database statements in `src/store.ts`, each action one batch. Every input is checked again in `src/validate.ts`. The test-only sign-in must stay impossible on the real service; `npm run check:worker` enforces the configuration. Keep the 150-person load test passing (`npm test`). No `LIKE` or `GLOB` in statements: Cloudflare's database refuses long patterns. |

The overlay script is not a manifest content script. It is injected on a toolbar click or registered at runtime for granted sites. Do not add `content_scripts`, `host_permissions` or `web_accessible_resources`; `npm run check:manifest` fails if they appear.

Prefer small, readable modules over speculative abstractions. One extension project until a later milestone needs more.

## Design references

The on-page comment card (first comment, and reading or continuing a conversation from a pin) is in `overlay/tag.tsx`, styled by `overlay/tag.css`, from the Figma [Comment tags](https://www.figma.com/design/Fcy1Fpb2zNZALUhRbNjkUC/Blob?node-id=271-7345) section. Pins open this card, not the drawer.

The docked Blob tab is `EdgeTab` in `overlay/launcher.tsx`, styled by `overlay/launcher.css`. Keep `overlay/App.tsx` wired to this launcher. It replaces the old round `BlobButton`.

Use the [Approved for Implementation page](https://www.figma.com/design/Fcy1Fpb2zNZALUhRbNjkUC/Blob?node-id=297-6696) as the design source. Review its Welcome and Empty state, Bottom navigation, Comment tags, Feedback, History and Activity sections against the corresponding rendered screens. Inspect Figma read-only. If access fails, say which frames could not be inspected. Keep signed-in examples within the milestone's account and privacy boundaries.

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
