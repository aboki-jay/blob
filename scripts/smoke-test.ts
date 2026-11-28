// Walks through every kind of request against a running copy of the sharing
// server, once each, and checks the answers.
//
//   node scripts/smoke-test.ts --url http://127.0.0.1:8787
//   node scripts/smoke-test.ts --url https://blob-api-test.<you>.workers.dev
//
// Why it exists: the unit tests run against a stand-in database. Cloudflare's
// real one has limits the stand-in does not (it refused a statement the
// stand-in accepted, the first time the test copy was deployed). This runs the
// real statements on the real database. Run it after every deploy of the test
// copy, before the load test.
//
// Only ever point it at a developer's machine or the test copy. It signs in
// through the test-only sign-in, so against the real service it stops at once.
// It deletes the two accounts it makes, and everything of theirs, when it ends.

const args = process.argv.slice(2);
const base = args[args.indexOf('--url') + 1]?.replace(/\/+$/, '');
if (!args.includes('--url') || !base) {
  console.error('Give the server to test: --url http://127.0.0.1:8787');
  process.exit(2);
}

interface Answer {
  status: number;
  body: any;
}

async function call(method: string, path: string, token?: string, body?: unknown): Promise<Answer> {
  const headers: Record<string, string> = { 'user-agent': 'blob-smoke-test' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${base}/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: { ok: false, error: `not JSON: ${text.slice(0, 80)}` } };
  }
}

let failed = 0;
function check(what: string, passed: boolean, detail?: unknown) {
  console.log(`${passed ? '  ok  ' : '  FAIL'} ${what}${passed || detail === undefined ? '' : `  -> ${JSON.stringify(detail).slice(0, 200)}`}`);
  if (!passed) failed++;
}
const expectStatus = (what: string, answer: Answer, status: number) => check(what, answer.status === status, answer);

const id = () => crypto.randomUUID();
const run = id().slice(0, 8);
const codeOf = (url: string) => url.split('/t/')[1]!;
const anchor = { selector: 'main > h1', tag: 'h1', label: 'Heading “Smoke test”', text: 'Smoke test', offset: { x: 0.5, y: 0.5 } };

console.log(`Walking through the sharing server at ${base}`);

expectStatus('it is up', await call('GET', '/health'), 200);
expectStatus('nothing is shown to someone not signed in', await call('GET', '/me'), 401);

const signIn = async (name: string) => {
  const answer = await call('POST', '/test/sign-in', undefined, { name, subject: `smoke-${run}-${name.toLowerCase()}` });
  check(`${name} signs in`, answer.status === 200 && typeof answer.body.token === 'string', answer);
  return answer.body.token as string;
};
let ada = await signIn('Ada');
let grace = await signIn('Grace');
if (!ada || !grace) {
  console.log('Cannot go on without the two test accounts. Is this the test copy, with the test sign-in switched on?');
  process.exit(1);
}

/* ----- Sharing and reading ----- */

const [root, own, carried] = [id(), id(), id()];
const upload = {
  id: id(),
  page: { url: 'https://example.com/pricing?token=SECRET&plan=team', title: 'Pricing' },
  anchor,
  expires: '7d',
  messages: [
    { id: root, body: 'Is this price right?', createdAt: Date.now() - 60_000 },
    { id: own, body: 'My own follow-up', replyTo: root, createdAt: Date.now() - 50_000 },
    { id: carried, body: 'Said under an earlier link', replyTo: root, createdAt: Date.now() - 40_000, carriedName: 'Someone Else' },
  ],
};
const shared = await call('POST', '/shares', ada, upload);
check('Ada shares a conversation of three comments', shared.status === 200 && /\/t\/[A-Za-z0-9_-]{24}$/.test(shared.body.share?.url ?? ''), shared);
const code = codeOf(shared.body.share?.url ?? '/t/none');
check('the link expires in seven days', Math.abs((shared.body.share?.expiresAt ?? 0) - Date.now() - 7 * 86_400_000) < 120_000, shared.body.share);

const again = await call('POST', '/shares', ada, upload);
check('sending the same upload again shares once', again.status === 200 && again.body.share?.url === shared.body.share?.url, again);

const seen = await call('GET', `/shares/${code}`, grace);
check('Grace, with the link, reads all three comments', seen.status === 200 && seen.body.messages?.length === 3, seen);
check('the page address was sanitised on the server', seen.body.share?.pageUrl === 'https://example.com/pricing?plan=team', seen.body.share);
check('Grace is told it is Ada’s, and not hers', seen.body.share?.owner?.name === 'Ada' && seen.body.share?.isOwner === false && !('id' in (seen.body.share ?? {})), seen.body.share);
const carriedSeen = seen.body.messages?.find((m: any) => m.id === carried);
check('the carried-over reply is shown under its own name and flagged', carriedSeen?.carried === true && carriedSeen?.author?.name === 'Someone Else', carriedSeen);
expectStatus('a made-up link looks like one that has ended', await call('GET', '/shares/AAAAAAAAAAAAAAAAAAAAAAAA', grace), 410);

const listed = await call('GET', '/shares', ada);
check('Ada’s list of shares has it', listed.status === 200 && listed.body.shares?.some((s: any) => s.id === upload.id), listed);

/* ----- Replying ----- */

const reply = { id: id(), body: 'Looks right to me.', replyTo: own };
const sent = await call('POST', `/shares/${code}/messages`, grace, reply);
check('Grace replies; answering a reply joins the first comment', sent.status === 200 && sent.body.message?.replyTo === root, sent);
const [twiceA, twiceB] = await Promise.all([call('POST', `/shares/${code}/messages`, grace, reply), call('POST', `/shares/${code}/messages`, grace, reply)]);
check('the same reply sent twice more is accepted without repeating', twiceA.status === 200 && twiceB.status === 200, [twiceA, twiceB]);
const second = { id: id(), body: 'One more thought.' };
expectStatus('Grace adds a second comment', await call('POST', `/shares/${code}/messages`, grace, second), 200);
expectStatus('a reply to a comment that is not there is refused', await call('POST', `/shares/${code}/messages`, grace, { id: id(), body: 'Hm', replyTo: id() }), 400);
expectStatus('an empty reply is refused', await call('POST', `/shares/${code}/messages`, grace, { id: id(), body: '   ' }), 400);
check('five comments in all, none doubled', (await call('GET', `/shares/${code}`, ada)).body.messages?.length === 5);

/* ----- Deleting and stopping ----- */

expectStatus('Ada cannot delete Grace’s reply', await call('DELETE', `/shares/${code}/messages/${reply.id}`, ada), 403);
expectStatus('nobody can delete the first comment on its own', await call('DELETE', `/shares/${code}/messages/${root}`, ada), 403);
expectStatus('Grace deletes her own reply', await call('DELETE', `/shares/${code}/messages/${reply.id}`, grace), 200);
expectStatus('deleting it again is not an error', await call('DELETE', `/shares/${code}/messages/${reply.id}`, grace), 200);
expectStatus('Grace cannot stop Ada’s sharing', await call('DELETE', `/shares/${code}`, grace), 403);

const renamed = await call('PATCH', '/me', ada, { name: 'Ada L.' });
check('Ada changes her display name', renamed.status === 200 && renamed.body.account?.name === 'Ada L.', renamed);

expectStatus('Ada stops sharing', await call('DELETE', `/shares/${code}`, ada), 200);
expectStatus('the link is dead for Grace at once', await call('GET', `/shares/${code}`, grace), 410);
expectStatus('and a reply to it is refused', await call('POST', `/shares/${code}/messages`, grace, { id: id(), body: 'Too late' }), 410);

const fresh = await call('POST', '/shares', ada, { ...upload, id: id(), expires: 'never' });
const freshCode = codeOf(fresh.body.share?.url ?? '/t/none');
check('sharing again gives a fresh link with no deadline', fresh.status === 200 && freshCode !== code && fresh.body.share?.expiresAt === null, fresh);
expectStatus('the old link stays dead', await call('GET', `/shares/${code}`, grace), 410);
expectStatus('Grace replies under the new link', await call('POST', `/shares/${freshCode}/messages`, grace, { id: id(), body: 'Still agree.' }), 200);

/* ----- Signing out, and deleting accounts ----- */

expectStatus('Grace signs out', await call('POST', '/sign-out', grace), 200);
expectStatus('her old session no longer works', await call('GET', '/me', grace), 401);
grace = await signIn('Grace');

expectStatus('Ada deletes her account', await call('DELETE', '/me', ada), 200);
expectStatus('her session is gone', await call('GET', '/me', ada), 401);
expectStatus('and so is the conversation she was sharing', await call('GET', `/shares/${freshCode}`, grace), 410);
ada = await signIn('Ada');
check('signing in again is a new, empty account', (await call('GET', '/shares', ada)).body.shares?.length === 0);

// Leave nothing behind.
expectStatus('clean up: Ada’s new account deleted', await call('DELETE', '/me', ada), 200);
expectStatus('clean up: Grace’s account deleted', await call('DELETE', '/me', grace), 200);

console.log(failed ? `FAILED: ${failed} step${failed === 1 ? '' : 's'} went wrong.` : 'PASSED: every kind of request behaved as it should.');
process.exit(failed ? 1 : 0);
