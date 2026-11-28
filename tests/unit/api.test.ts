import { describe, expect, it } from 'vitest';
import { RULES } from '../../worker/api/src/store';
import { DAY, START, codeOf, createServer, newShare, share } from './api-helpers';
import { id } from './helpers';

const MINUTE = 60_000;
const reply = (body = 'Looks right to me.', over: Record<string, unknown> = {}) => ({ id: id(), body, ...over });

describe('signing in', () => {
  it('shows nothing to someone who is not signed in', async () => {
    const server = createServer();
    const owner = await server.signIn('Ada');
    const { code } = await share(server, owner);

    const routes: [string, string, unknown?][] = [
      ['GET', '/me'],
      ['GET', '/shares'],
      ['POST', '/shares', newShare()],
      ['GET', `/shares/${code}`],
      ['POST', `/shares/${code}/messages`, reply()],
      ['DELETE', `/shares/${code}`],
      ['DELETE', '/me'],
    ];
    for (const [method, path, body] of routes) {
      for (const token of [undefined, 'not-a-real-session-secret-000000', 'short']) {
        const answer = await server.call(method, path, { token, body });
        expect(answer.status, `${method} ${path}`).toBe(401);
        expect(answer.body).toEqual({ ok: false, error: 'unauthorized' });
      }
    }
    // The conversation is untouched.
    expect((await server.call('GET', `/shares/${code}`, { token: owner })).body.messages).toHaveLength(1);
  });

  it('keeps only scrambles of who signed in and of the session', async () => {
    const server = createServer();
    const answer = await server.call('POST', '/test/sign-in', { body: { name: 'Ada Lovelace', subject: 'ada.private.identity' } });
    const token = answer.body.token as string;
    const dump = JSON.stringify(['accounts', 'identities', 'sessions'].map((table) => server.db.raw.prepare(`SELECT * FROM ${table}`).all()));
    expect(dump).toContain('Ada Lovelace'); // the display name is kept, on purpose
    expect(dump).not.toContain('ada.private.identity');
    expect(dump).not.toContain(token);
    // The answer carries the name and the secret, and no account id.
    expect(answer.body).toEqual({ ok: true, token, account: { name: 'Ada Lovelace' } });
  });

  it('is the same account next time, and two first sign-ins at once make one account', async () => {
    const server = createServer();
    const [first, second] = await Promise.all([server.signIn('Grace'), server.signIn('Grace')]);
    expect(first).not.toBe(second);
    expect(server.db.raw.prepare('SELECT COUNT(*) AS n FROM accounts').get()).toEqual({ n: 1 });
    expect(server.db.raw.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 2 });
    // Something shared in one session is theirs in the other.
    const { code } = await share(server, first);
    expect((await server.call('GET', `/shares/${code}`, { token: second })).body.share.isOwner).toBe(true);
  });

  it('signs out one session and expires sessions after 30 days', async () => {
    const server = createServer();
    const [here, there] = [await server.signIn('Ada'), await server.signIn('Ada')];
    expect((await server.call('POST', '/sign-out', { token: here })).body.ok).toBe(true);
    expect((await server.call('GET', '/me', { token: here })).status).toBe(401);
    expect((await server.call('GET', '/me', { token: there })).body.account).toEqual({ name: 'Ada' });

    server.clock.now = START + RULES.sessionMs - 1;
    expect((await server.call('GET', '/me', { token: there })).status).toBe(200);
    server.clock.now = START + RULES.sessionMs;
    expect((await server.call('GET', '/me', { token: there })).status).toBe(401);
  });

  it('limits how often one identity can sign in', async () => {
    const server = createServer();
    for (let i = 0; i < RULES.signInsPerHour; i++) await server.signIn('Ada');
    const blocked = await server.call('POST', '/test/sign-in', { body: { name: 'Ada', subject: 'ada' } });
    expect(blocked.status).toBe(429);
    // Someone else is unaffected, and the hour passes.
    await server.signIn('Grace');
    server.clock.now += 60 * MINUTE;
    await server.signIn('Ada');
  });
});

describe('the test-only sign-in', () => {
  const attempt = (server: ReturnType<typeof createServer>, host?: string) =>
    server.call('POST', '/test/sign-in', { body: { name: 'Ada', subject: 'ada' }, host });

  it('does not exist unless it is switched on', async () => {
    for (const TEST_SIGN_IN of [undefined, '', 'off', 'true', 'ON']) {
      const answer = await attempt(createServer({ TEST_SIGN_IN }));
      expect(answer.status).toBe(404);
      expect(answer.body).toEqual({ ok: false, error: 'not-found' });
    }
  });

  it('cannot be reached at the real service’s address, even switched on', async () => {
    const server = createServer({ TEST_SIGN_IN: 'on' });
    expect((await attempt(server, 'blob.davidokunlola.com')).status).toBe(404);
    // Nor at any other address that is not a developer's machine or the test copy.
    expect((await attempt(server, 'blob-api.example.workers.dev')).status).toBe(404);
    expect((await attempt(server, 'example.com')).status).toBe(404);
    expect(server.db.raw.prepare('SELECT COUNT(*) AS n FROM accounts').get()).toEqual({ n: 0 });
    // It works on the test copy and on a developer's machine.
    expect((await attempt(server, 'blob-api-test.example.workers.dev')).status).toBe(200);
    expect((await attempt(server, '127.0.0.1')).status).toBe(200);
  });
});

describe('sharing and reading', () => {
  it('lets anyone signed in who has the link read it, and tells them only what they need', async () => {
    const server = createServer();
    const [owner, reader] = [await server.signIn('Ada'), await server.signIn('Grace')];
    const { code, upload, share: made } = await share(server, owner);

    expect(made.url).toMatch(/^http:\/\/localhost\/t\/[A-Za-z0-9_-]{24}$/);
    // The link's code is not the conversation's id.
    expect(code).not.toBe(upload.id);

    const seen = (await server.call('GET', `/shares/${code}`, { token: reader })).body;
    expect(seen.share).toMatchObject({ pageTitle: 'Pricing', owner: { name: 'Ada' }, isOwner: false, expiresAt: null });
    expect(seen.share).not.toHaveProperty('id');
    // The page's address was sanitised again on the server: the session token is gone, the rest is kept.
    expect(seen.share.pageUrl).toBe('https://example.com/pricing?plan=team');
    expect(seen.messages).toEqual([
      {
        id: upload.messages[0]!.id,
        body: 'Is this price right?',
        replyTo: null,
        createdAt: START - 60_000,
        author: { name: 'Ada', isYou: false, isOwner: true },
        carried: false,
        canDelete: false,
      },
    ]);
    // Account ids never leave the server, and the secret never reaches storage.
    const accounts = server.db.raw.prepare('SELECT id FROM accounts').all() as { id: string }[];
    for (const account of accounts) expect(JSON.stringify(seen)).not.toContain(account.id);
    expect(JSON.stringify(server.db.raw.prepare('SELECT * FROM shares').all())).not.toContain('SECRET');

    const mine = (await server.call('GET', `/shares/${code}`, { token: owner })).body;
    expect(mine.share).toMatchObject({ id: upload.id, isOwner: true });
    expect(mine.messages[0].author).toEqual({ name: 'Ada', isYou: true, isOwner: true });
  });

  it('answers an unknown, malformed or mistyped link exactly like one that has ended', async () => {
    const server = createServer();
    const token = await server.signIn('Ada');
    for (const code of ['AAAAAAAAAAAAAAAAAAAAAAAA', 'short', '../../etc/passwd', 'x'.repeat(200)]) {
      const answer = await server.call('GET', `/shares/${encodeURIComponent(code)}`, { token });
      expect(answer.status).toBe(410);
      expect(answer.body).toEqual({ ok: false, error: 'gone' });
    }
  });

  it('a retry with the same id shares once; someone else cannot take the id', async () => {
    const server = createServer();
    const [owner, other] = [await server.signIn('Ada'), await server.signIn('Grace')];
    const upload = newShare({ messages: [{ id: id(), body: 'First' }, { id: id(), body: 'Second' }] });

    const first = await server.call('POST', '/shares', { token: owner, body: upload });
    const again = await server.call('POST', '/shares', { token: owner, body: upload });
    expect(again.body.share).toEqual(first.body.share);
    expect(server.db.raw.prepare('SELECT COUNT(*) AS n FROM shares').get()).toEqual({ n: 1 });
    expect(server.db.raw.prepare('SELECT COUNT(*) AS n FROM messages').get()).toEqual({ n: 2 });

    const stolen = await server.call('POST', '/shares', { token: other, body: { ...upload, messages: [{ id: id(), body: 'Mine now' }] } });
    expect(stolen.status).toBe(400);
    expect((await server.call('GET', `/shares/${codeOf(first.body.share.url)}`, { token: owner })).body.messages.map((m: any) => m.body)).toEqual(['First', 'Second']);
  });

  it('lists what someone is sharing now', async () => {
    const server = createServer();
    const [owner, other] = [await server.signIn('Ada'), await server.signIn('Grace')];
    const forever = await share(server, owner);
    const week = await share(server, owner, { expires: '7d' });
    await share(server, other);

    const listed = async () => ((await server.call('GET', '/shares', { token: owner })).body.shares as { id: string }[]).map((s) => s.id).sort();
    expect(await listed()).toEqual([forever.upload.id, week.upload.id].sort());
    server.clock.now += 7 * DAY;
    expect(await listed()).toEqual([forever.upload.id]);
  });
});

describe('replying', () => {
  it('lets a reader reply, groups replies one level deep, and never posts a retry twice', async () => {
    const server = createServer();
    const [owner, reader] = [await server.signIn('Ada'), await server.signIn('Grace')];
    const { code, upload } = await share(server, owner);
    const rootId = upload.messages[0]!.id;

    const first = reply('Agreed.', { replyTo: rootId });
    server.clock.now += 1000;
    const sent = await server.call('POST', `/shares/${code}/messages`, { token: reader, body: first });
    expect(sent.body).toEqual({ ok: true, message: { id: first.id, replyTo: rootId, createdAt: START + 1000 } });
    // An impatient second click, and a retry a moment later.
    server.clock.now += 1000;
    const retried = await server.call('POST', `/shares/${code}/messages`, { token: reader, body: first });
    expect(retried.body.message).toEqual(sent.body.message);

    // Answering a reply joins the comment it answered.
    const nested = reply('And me.', { replyTo: first.id });
    expect((await server.call('POST', `/shares/${code}/messages`, { token: owner, body: nested })).body.message.replyTo).toBe(rootId);

    const seen = (await server.call('GET', `/shares/${code}`, { token: reader })).body.messages;
    expect(seen.map((m: any) => [m.body, m.replyTo, m.author.name, m.author.isYou, m.canDelete])).toEqual([
      ['Is this price right?', null, 'Ada', false, false],
      ['Agreed.', rootId, 'Grace', true, true],
      ['And me.', rootId, 'Ada', false, false],
    ]);
  });

  it('refuses a reply to a comment that is not in the conversation, and one using someone else’s id', async () => {
    const server = createServer();
    const [owner, reader] = [await server.signIn('Ada'), await server.signIn('Grace')];
    const { code } = await share(server, owner);
    const elsewhere = await share(server, owner);

    const stray = await server.call('POST', `/shares/${code}/messages`, { token: reader, body: reply('Hm', { replyTo: elsewhere.upload.messages[0]!.id }) });
    expect(stray.status).toBe(400);

    const mine = reply('Mine');
    await server.call('POST', `/shares/${code}/messages`, { token: owner, body: mine });
    const taken = await server.call('POST', `/shares/${code}/messages`, { token: reader, body: { ...mine, body: 'Overwritten?' } });
    expect(taken.status).toBe(400);
    const bodies = (await server.call('GET', `/shares/${code}`, { token: owner })).body.messages.map((m: any) => m.body);
    expect(bodies).toEqual(['Is this price right?', 'Mine']);
  });

  it('checks what is written: empty, oversized, wrong shape, too big a request', async () => {
    const server = createServer();
    const token = await server.signIn('Ada');
    const { code } = await share(server, token);
    for (const body of [{ id: id(), body: '   ' }, { id: id(), body: 'x'.repeat(5001) }, { id: 'no', body: 'ok' }, { body: 'no id' }, 'text', null, { id: id(), body: 'ok', replyTo: 7 }]) {
      expect((await server.call('POST', `/shares/${code}/messages`, { token, body })).status).toBe(400);
    }
    expect((await server.call('POST', `/shares/${code}/messages`, { token, rawBody: '{not json' })).status).toBe(400);
    expect((await server.call('POST', `/shares/${code}/messages`, { token, rawBody: JSON.stringify({ id: id(), body: 'x', pad: 'y'.repeat(20_000) }) })).status).toBe(413);
    // A comment is stored exactly as written, as text: nothing is interpreted.
    const script = '<img src=x onerror=alert(1)> & "quotes"';
    await server.call('POST', `/shares/${code}/messages`, { token, body: reply(script) });
    expect((await server.call('GET', `/shares/${code}`, { token })).body.messages.at(-1).body).toBe(script);
  });

  it('holds each person to a firm number of replies a minute', async () => {
    const server = createServer();
    const [owner, reader] = [await server.signIn('Ada'), await server.signIn('Grace')];
    const { code } = await share(server, owner);
    const send = (token: string) => server.call('POST', `/shares/${code}/messages`, { token, body: reply() });

    // All at once, the way a script would: exactly the allowance gets through.
    const burst = await Promise.all(Array.from({ length: RULES.repliesPerMinute + 10 }, () => send(reader)));
    expect(burst.filter((r) => r.status === 200)).toHaveLength(RULES.repliesPerMinute);
    expect(burst.filter((r) => r.status === 429)).toHaveLength(10);
    // Deleting does not buy more.
    const mine = (await server.call('GET', `/shares/${code}`, { token: reader })).body.messages.filter((m: any) => m.canDelete);
    await server.call('DELETE', `/shares/${code}/messages/${mine[0].id}`, { token: reader });
    expect((await send(reader)).status).toBe(429);
    // Someone else is unaffected, and so is the same person a minute later.
    expect((await send(owner)).status).toBe(200);
    server.clock.now += MINUTE;
    expect((await send(reader)).status).toBe(200);
  });
});

describe('stopping, deleting and deadlines', () => {
  it('only the owner can stop sharing; then the link is dead and the server’s copy is gone', async () => {
    const server = createServer();
    const [owner, reader] = [await server.signIn('Ada'), await server.signIn('Grace')];
    const { code } = await share(server, owner);
    await server.call('POST', `/shares/${code}/messages`, { token: reader, body: reply() });

    const refused = await server.call('DELETE', `/shares/${code}`, { token: reader });
    expect(refused.status).toBe(403);
    expect((await server.call('GET', `/shares/${code}`, { token: reader })).body.messages).toHaveLength(2);

    expect((await server.call('DELETE', `/shares/${code}`, { token: owner })).body.ok).toBe(true);
    // Read and reply are refused at once, including from a page that was already open.
    expect((await server.call('GET', `/shares/${code}`, { token: reader })).status).toBe(410);
    expect((await server.call('POST', `/shares/${code}/messages`, { token: reader, body: reply() })).status).toBe(410);
    expect(server.db.raw.prepare('SELECT (SELECT COUNT(*) FROM shares) + (SELECT COUNT(*) FROM messages) AS n').get()).toEqual({ n: 0 });
    // Stopping again is not an error.
    expect((await server.call('DELETE', `/shares/${code}`, { token: owner })).body.ok).toBe(true);
  });

  it('sharing again gives a fresh link; the old one stays dead', async () => {
    const server = createServer();
    const [owner, reader] = [await server.signIn('Ada'), await server.signIn('Grace')];
    const before = await share(server, owner);
    await server.call('DELETE', `/shares/${before.code}`, { token: owner });

    // The device shares it again: a new share id, the same comments.
    const after = await share(server, owner, { messages: before.upload.messages });
    expect(after.code).not.toBe(before.code);
    expect((await server.call('GET', `/shares/${after.code}`, { token: reader })).status).toBe(200);
    expect((await server.call('GET', `/shares/${before.code}`, { token: reader })).status).toBe(410);
  });

  it.each([
    ['7d', 7],
    ['14d', 14],
    ['30d', 30],
  ])('a %s link ends exactly at its deadline, whoever has been visiting', async (expires, days) => {
    const server = createServer();
    const [owner, reader] = [await server.signIn('Ada'), await server.signIn('Grace')];
    const { code, share: made } = await share(server, owner, { expires });
    const deadline = START + days * DAY;
    expect(made.expiresAt).toBe(deadline);

    // Visits and replies along the way leave the deadline where it was.
    server.clock.now = deadline - DAY;
    await server.call('POST', `/shares/${code}/messages`, { token: reader, body: reply() });
    expect((await server.call('GET', `/shares/${code}`, { token: reader })).body.share.expiresAt).toBe(deadline);

    server.clock.now = deadline - 1;
    expect((await server.call('GET', `/shares/${code}`, { token: reader })).status).toBe(200);
    expect((await server.call('POST', `/shares/${code}/messages`, { token: reader, body: reply('Just in time') })).status).toBe(200);

    server.clock.now = deadline;
    // (A sign-in lasts 30 days too, so for the longest link both run out together.
    // Signing in again keeps this about the link.)
    const [ownerNow, readerNow] = [await server.signIn('Ada'), await server.signIn('Grace')];
    expect((await server.call('GET', `/shares/${code}`, { token: ownerNow })).status).toBe(410);
    // A reply sent from a page that was opened before the deadline.
    expect((await server.call('POST', `/shares/${code}/messages`, { token: readerNow, body: reply('Too late') })).status).toBe(410);
    expect((await server.call('GET', '/shares', { token: ownerNow })).body.shares).toEqual([]);

    // The timer then deletes the server's copy, replies included, without anyone visiting.
    expect(server.db.raw.prepare('SELECT COUNT(*) AS n FROM messages').get()).toEqual({ n: 3 });
    const { ApiStore } = await import('../../worker/api/src/store');
    expect((await new ApiStore(server.db).sweep(server.clock.now)).shares).toBe(1);
    expect(server.db.raw.prepare('SELECT (SELECT COUNT(*) FROM shares) + (SELECT COUNT(*) FROM messages) AS n').get()).toEqual({ n: 0 });
  });

  it('"Until I stop sharing" has no deadline at all', async () => {
    const server = createServer();
    const owner = await server.signIn('Ada');
    const { code } = await share(server, owner, { expires: 'never' });
    server.clock.now += 400 * DAY;
    const { ApiStore } = await import('../../worker/api/src/store');
    await new ApiStore(server.db).sweep(server.clock.now);
    // Their session has long expired, so they sign in again; the conversation is still there.
    const later = await server.signIn('Ada');
    expect((await server.call('GET', `/shares/${code}`, { token: later })).body.messages).toHaveLength(1);
  });

  it('people can delete their own replies, and only those', async () => {
    const server = createServer();
    const [owner, reader] = [await server.signIn('Ada'), await server.signIn('Grace')];
    const { code, upload } = await share(server, owner);
    const theirs = reply('From Grace', { replyTo: upload.messages[0]!.id });
    const answer = reply('Answering Grace', { replyTo: upload.messages[0]!.id });
    await server.call('POST', `/shares/${code}/messages`, { token: reader, body: theirs });
    await server.call('POST', `/shares/${code}/messages`, { token: owner, body: answer });

    // Not someone else's, not even for the owner; and not the first comment.
    expect((await server.call('DELETE', `/shares/${code}/messages/${theirs.id}`, { token: owner })).status).toBe(403);
    expect((await server.call('DELETE', `/shares/${code}/messages/${upload.messages[0]!.id}`, { token: owner })).status).toBe(403);
    expect((await server.call('DELETE', `/shares/${code}/messages/${answer.id}`, { token: reader })).status).toBe(403);

    expect((await server.call('DELETE', `/shares/${code}/messages/${theirs.id}`, { token: reader })).body.ok).toBe(true);
    expect((await server.call('DELETE', `/shares/${code}/messages/${theirs.id}`, { token: reader })).body.ok).toBe(true); // again: fine
    const bodies = (await server.call('GET', `/shares/${code}`, { token: owner })).body.messages.map((m: any) => m.body);
    expect(bodies).toEqual(['Is this price right?', 'Answering Grace']);
  });

  it('deleting an account removes everything of theirs from the server, and nothing of anyone else’s', async () => {
    const server = createServer();
    const [ada, grace] = [await server.signIn('Ada'), await server.signIn('Grace')];
    const adas = await share(server, ada);
    const graces = await share(server, grace);
    await server.call('POST', `/shares/${graces.code}/messages`, { token: ada, body: reply('Ada was here') });
    await server.call('POST', `/shares/${adas.code}/messages`, { token: grace, body: reply('Grace was here') });

    // What the server knows Ada by, noted before she goes.
    const adaId = (server.db.raw.prepare("SELECT id FROM accounts WHERE name = 'Ada'").get() as { id: string }).id;
    const adaPrint = (server.db.raw.prepare('SELECT fingerprint FROM identities WHERE account_id = ?').get(adaId) as { fingerprint: string }).fingerprint;
    const keys = () => (server.db.raw.prepare('SELECT key FROM counters').all() as { key: string }[]).map((row) => row.key);
    expect(keys().filter((key) => key.includes(adaId) || key.includes(adaPrint))).toHaveLength(4); // her sign-in, share, and reply minute and day

    expect((await server.call('DELETE', '/me', { token: ada })).body.ok).toBe(true);
    expect((await server.call('GET', '/me', { token: ada })).status).toBe(401);
    expect((await server.call('GET', `/shares/${adas.code}`, { token: grace })).status).toBe(410);
    const left = (await server.call('GET', `/shares/${graces.code}`, { token: grace })).body.messages.map((m: any) => m.body);
    expect(left).toEqual(['Is this price right?']);

    const count = (table: string) => (server.db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    expect({ accounts: count('accounts'), identities: count('identities'), sessions: count('sessions'), shares: count('shares'), messages: count('messages') }).toEqual({
      accounts: 1,
      identities: 1,
      sessions: 1,
      shares: 1,
      messages: 1,
    });
    // No counter still names the deleted account or its sign-in fingerprint. Grace's are all still there.
    expect(keys().filter((key) => key.includes(adaId) || key.includes(adaPrint))).toEqual([]);
    expect(keys()).toHaveLength(4);
  });
});

describe('what may be shared', () => {
  it('refuses a conversation that is not well formed', async () => {
    const server = createServer();
    const token = await server.signIn('Ada');
    const bad: Record<string, unknown>[] = [
      { id: 'no' },
      { page: { url: 'chrome://extensions/', title: 'x' } },
      { page: { url: 'file:///C:/secret.html', title: 'x' } },
      { page: 'https://example.com' },
      { anchor: { selector: 'a' } },
      { expires: '1y' },
      { expires: 7 },
      { messages: [] },
      { messages: 'none' },
      { messages: [{ id: id(), body: '' }] },
      { messages: [{ id: id(), body: 'x'.repeat(5001) }] },
      { messages: [{ id: 'same-id-000001', body: 'a' }, { id: 'same-id-000001', body: 'b' }] },
      { messages: Array.from({ length: RULES.messagesAtCreation + 1 }, () => ({ id: id(), body: 'x' })) },
      // The first comment must be the owner's own.
      { messages: [{ id: id(), body: 'Carried', carriedName: 'Grace' }] },
      { messages: [{ id: id(), body: 'ok' }, { id: id(), body: 'bad name', carriedName: '   ' }] },
    ];
    for (const over of bad) {
      const answer = await server.call('POST', '/shares', { token, body: newShare(over) });
      expect(answer.status, JSON.stringify(over).slice(0, 80)).toBe(400);
    }
    expect((await server.call('POST', '/shares', { token, rawBody: JSON.stringify(newShare({ pad: 'y'.repeat(500_000) })) })).status).toBe(413);
    expect(server.db.raw.prepare('SELECT COUNT(*) AS n FROM shares').get()).toEqual({ n: 0 });
  });

  it('uploads a whole conversation, and marks replies carried over from an earlier link', async () => {
    const server = createServer();
    const [owner, reader] = [await server.signIn('Ada'), await server.signIn('Grace')];
    const [root, mine, theirs, nested] = [id(), id(), id(), id()];
    const { code } = await share(server, owner, {
      messages: [
        { id: root, body: 'First comment', createdAt: START - 5000 },
        { id: mine, body: 'My own reply', replyTo: root, createdAt: START - 4000 },
        { id: theirs, body: 'What Grace said last time', replyTo: root, createdAt: START - 3000, carriedName: 'Grace H.' },
        // Answers a reply: filed under the first comment. Dated in the future: brought back to now.
        { id: nested, body: 'Nested', replyTo: theirs, createdAt: START + 999_999 },
        // Answers something that is not in the upload: stands on its own.
        { id: id(), body: 'Orphan', replyTo: 'not-in-this-upload', createdAt: START - 1000 },
      ],
    });
    const seen = (await server.call('GET', `/shares/${code}`, { token: reader })).body.messages;
    expect(seen.map((m: any) => [m.body, m.replyTo, m.author, m.carried, m.canDelete])).toEqual([
      ['First comment', null, { name: 'Ada', isYou: false, isOwner: true }, false, false],
      ['My own reply', root, { name: 'Ada', isYou: false, isOwner: true }, false, false],
      // Shown under the name it came with, flagged, and nobody's "you": the server cannot vouch for it.
      ['What Grace said last time', root, { name: 'Grace H.', isYou: false, isOwner: false }, true, false],
      ['Orphan', null, { name: 'Ada', isYou: false, isOwner: true }, false, false],
      ['Nested', root, { name: 'Ada', isYou: false, isOwner: true }, false, false],
    ]);
  });

  it('holds each person to a firm number of new shares a day', async () => {
    const server = createServer();
    const token = await server.signIn('Ada');
    for (let i = 0; i < RULES.sharesPerDay; i++) await share(server, token);
    expect((await server.call('POST', '/shares', { token, body: newShare() })).status).toBe(429);
    server.clock.now += DAY;
    await share(server, token);
  });
});

describe('when the database cannot answer', () => {
  it('says it is busy, reveals nothing, and loses nothing', async () => {
    const server = createServer();
    const token = await server.signIn('Ada');
    const { code } = await share(server, token);
    const attempt = reply('Sent while the database was down');

    server.db.failing = true;
    for (const [method, path, body] of [['GET', `/shares/${code}`], ['POST', `/shares/${code}/messages`, attempt], ['POST', '/shares', newShare()], ['GET', '/me']] as const) {
      const answer = await server.call(method, path, { token, body });
      expect(answer.status).toBe(503);
      expect(answer.body).toEqual({ ok: false, error: 'busy' });
    }
    // "Is it up?" needs no database.
    expect((await server.call('GET', '/health')).body).toEqual({ ok: true });

    // Back again: the same reply is sent once more and arrives once.
    server.db.failing = false;
    expect((await server.call('POST', `/shares/${code}/messages`, { token, body: attempt })).status).toBe(200);
    expect((await server.call('GET', `/shares/${code}`, { token })).body.messages).toHaveLength(2);
  });
});

describe('requests in general', () => {
  it('answers the browser’s pre-check, and refuses what it does not know', async () => {
    const server = createServer();
    const token = await server.signIn('Ada');
    expect((await server.call('OPTIONS', '/shares')).status).toBe(204);
    expect((await server.call('GET', '/nothing-here', { token })).status).toBe(404);
    expect((await server.call('PUT', '/me', { token, body: {} })).status).toBe(405);
    expect((await server.call('PATCH', '/shares', { token, body: {} })).status).toBe(405);
    // Changing the display name.
    expect((await server.call('PATCH', '/me', { token, body: { name: '  Ada   L.  ' } })).body.account).toEqual({ name: 'Ada L.' });
    expect((await server.call('PATCH', '/me', { token, body: { name: 'x'.repeat(61) } })).status).toBe(400);
  });
});
