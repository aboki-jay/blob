# Contributing to Blob

Thanks for your interest. Blob is an early local alpha, so small, focused changes are the most helpful.

## Before you start

1. Read [docs/STATUS.md](docs/STATUS.md) for what exists and the next task.
2. Read [docs/ROADMAP.md](docs/ROADMAP.md) to see which features are intentionally deferred.
3. For anything beyond a small fix, open an issue first so the approach can be agreed.

## Setup

You need Node.js 22.18 or newer and Google Chrome. No accounts or API keys.

```bash
npm install
npm run build
```

Then load `.output/chrome-mv3` from `chrome://extensions` (Developer mode, **Load unpacked**). After each rebuild, press the reload arrow on Blob's card there and reload the page you are testing on.

`npm run dev` is WXT's live-reloading mode. It has not been tried on this project yet, so treat it as a convenience rather than the supported route.

## Checks

```bash
npm run check             # types, unit tests, build, manifest permissions
npx playwright install chromium   # once
npm run test:e2e          # browser tests against the real extension
```

If the real-extension browser tests cannot start on your machine, run `npm run test:e2e:harness` instead and say so in your pull request. The harness covers the on-page behaviour but not Chrome's own injection, permissions or storage.

The browser tests use the pages in `tests/fixtures/`. Add to those rather than testing against live websites.

## Workflow

1. Fork the repository and create a branch from `main`.
2. Keep each change focused on one thing, with a test where it guards against a real risk.
3. Run the checks above.
4. In the pull request, say what you changed, why, and what you actually verified (including by hand in Chrome, if you did).

## Ground rules

- Follow the privacy rules in [docs/PRIVACY.md](docs/PRIVACY.md). Changes that store more data or ask for broader permissions need discussion first.
- Do not commit secrets, build output, browser profiles or personal test data.
- Only contribute code and assets you have the right to share under the [MIT licence](LICENSE), and list third-party material in [THIRD_PARTY.md](THIRD_PARTY.md).
