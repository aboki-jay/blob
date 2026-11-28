# Blob sharing server

A Cloudflare Worker with a D1 database. It is what lets someone share a comment and someone else read it and reply. It is Milestone 2's server; the plan and its decisions are in [docs/MILESTONE-2.md](../../docs/MILESTONE-2.md).

**It is not deployed, and nothing in the extension talks to it yet.** This is step 1 of the milestone: the server, its rules and their tests, with no interface.

## What it does today

Everything is JSON under `/api/v1`. Someone signed in sends their session secret as `Authorization: Bearer <secret>`. There are no cookies.

| Request | What it does | Who may |
| --- | --- | --- |
| `GET /health` | Says it is up. Touches no data. | Anyone |
| `GET /me`, `PATCH /me`, `DELETE /me` | Your display name; change it; delete your account and everything of yours on the server | Signed in |
| `POST /sign-out` | Ends this session | Signed in |
| `POST /shares` | Shares a conversation and returns its link | Signed in |
| `GET /shares` | What you are sharing now | Signed in |
| `GET /shares/<code>` | The conversation behind a link | Signed in, with the link |
| `POST /shares/<code>/messages` | Adds a comment or reply | Signed in, with the link |
| `DELETE /shares/<code>/messages/<id>` | Removes one of your own comments (not the first comment) | Its author |
| `DELETE /shares/<code>` | Stops sharing: the link dies and the server's copy is deleted | The owner |
| `POST /test/sign-in` | A sign-in for tests. Does not exist on the real service. | See below |

Not here yet: Google sign-in (step 2), the web page for recipients (step 4), Save to History (step 6) and the emailed code (step 7).

## The rules, and where they live

- **Rules are in the database statements** ([src/store.ts](src/store.ts)), in the same step as the reads and writes they guard. A reply is checked (still shared? before the deadline? within your limits? room left?) and written as one indivisible step, so it cannot land in a conversation that stopped being shared a moment earlier, however many people are acting at once.
- **A retry never repeats.** Ids for conversations and comments are made on the device and sent with the request. Sending the same one again succeeds without doing it twice.
- **A dead link looks like no link.** An ended, expired, mistyped or made-up link all get the same answer, `410 gone`.
- **Firm limits** per person, counted in the database: 30 replies a minute, 1,000 a day, 30 new shares a day, 20 sign-ins an hour.
- **Deadlines** are checked on every read and reply. A timer every 15 minutes then deletes what has run out.
- **Everything is checked again** on arrival ([src/validate.ts](src/validate.ts)), with the same code the extension uses, and stored as plain text.
- **When the database cannot answer**, the server says `503 busy` and nothing else.

What is kept, and what is not, is in [the plan](../../docs/MILESTONE-2.md#what-the-server-keeps). In short: shared conversations, a random id and a display name per account, and scrambled fingerprints for sign-ins and sessions.

## The test-only sign-in

Tests need accounts without Google. `POST /api/v1/test/sign-in` provides them, and is fenced three ways:

1. It only works when the setting `TEST_SIGN_IN` is exactly `on`.
2. The server refuses it at the real service's address whatever that setting says, and anywhere that is not a developer's machine or the test copy (`blob-api-test.…`).
3. `npm run check:worker` fails if the configuration sets it for the real service.

Otherwise it answers `404`, as if it were not there.

## Running it on your own machine

No Cloudflare account is needed for this.

```bash
cd worker/api
npx wrangler d1 migrations apply blob-test --local --env test
npx wrangler dev --env test --port 8787
```

Then, from the repository root, the 150-person load test:

```bash
npm run test:load -- --url http://127.0.0.1:8787
```

## The load test

The scenario is the one agreed in the plan: 150 people open a shared conversation within ten seconds and one in five replies; then all 150 read and reply, one action every ten seconds, for two minutes. It passes only if no request fails and no reply is lost or doubled. One reply in ten is deliberately sent twice.

| Where | Command | What it shows |
| --- | --- | --- |
| In the unit tests, on every change | `npm test` | Blob's own code is correct under load, and no request needs more database work than Cloudflare's free plan allows |
| Against a local server | `npm run test:load -- --url http://127.0.0.1:8787` | The same, on Cloudflare's real runtime and database engine |
| Against the test copy on Cloudflare | `npm run test:load -- --url https://blob-api-test.<you>.workers.dev --real-time --judge-time` | Real response times; also requires 95 in 100 responses within one second |

Only the last one says anything about Cloudflare's capacity. Never point the load test at the real service; it would stop at the sign-in anyway.

## Deploying the test copy (maintainer)

Needed before the last row of that table can be run. Not done yet.

```bash
cd worker/api
npx wrangler login
npx wrangler d1 create blob-test
```

Put the id it prints into `wrangler.jsonc`, under `env` > `test` > `database_id`. Then:

```bash
npx wrangler d1 migrations apply blob-test --remote --env test
npx wrangler deploy --env test
npx wrangler secret put FINGERPRINT_KEY --env test
```

For the key, type any long random text. It is what sign-in identities are scrambled with, and it must never be written into the repository.

The real service is deployed later, when it has a page to serve.

## Tests

`npm test` covers the rules ([tests/unit/api.test.ts](../../tests/unit/api.test.ts)) and the load test ([tests/unit/api-load.test.ts](../../tests/unit/api-load.test.ts)) against the real request handler and the real statements, with a stand-in database built on SQLite, which is what D1 is. A further test breaks the server on purpose and checks the load test notices.
