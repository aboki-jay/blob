import { describe, expect, it } from 'vitest';
import { getPageInfo } from '@/lib/page';
import { BlobError, BlobStore, KEYS, migrate, parseDrafts, readData } from '@/lib/storage/store';
import { SCHEMA_VERSION } from '@/lib/types';
import { FakeArea, anchor, id } from './helpers';

const home = getPageInfo('https://example.com/')!;
const pricing = getPageInfo('https://example.com/pricing')!;

const create = (store: BlobStore, page = home, body = 'More breathing room?', threadId = id()) =>
  store.createThread({ id: threadId, messageId: id(), page, title: 'Studio', anchor: anchor(), body });

describe('persistence', () => {
  it('still has the conversation after a reload (a brand new store over the same storage)', async () => {
    const area = new FakeArea();
    const thread = await create(new BlobStore(area));
    await new BlobStore(area).addReply(thread.id, id(), 'Looks better now.');

    const data = await readData(area);
    expect(data.version).toBe(SCHEMA_VERSION);
    expect(data.threads[thread.id]?.messages.map((m) => m.body)).toEqual(['More breathing room?', 'Looks better now.']);
    expect(data.pages[home.key]).toMatchObject({ url: 'https://example.com/', title: 'Studio', label: '/' });
  });

  it('gives records ids, timestamps and per-page pin numbers', async () => {
    const store = new BlobStore(new FakeArea(), () => '2026-11-25T10:00:00.000Z');
    const first = await create(store);
    const second = await create(store);
    const other = await create(store, pricing);
    expect(first).toMatchObject({ number: 1, status: 'open', createdAt: '2026-11-25T10:00:00.000Z', updatedAt: '2026-11-25T10:00:00.000Z' });
    expect(second.number).toBe(2);
    expect(other.number).toBe(1);
  });

  it('keeps two pages on the same website separate', async () => {
    const area = new FakeArea();
    const store = new BlobStore(area);
    const a = await create(store, home);
    const b = await create(store, pricing);
    const data = await readData(area);
    expect(data.threads[a.id]?.pageKey).toBe(home.key);
    expect(data.threads[b.id]?.pageKey).toBe(pricing.key);
    expect(a.origin).toBe(b.origin);
    expect(Object.keys(data.pages).sort()).toEqual([home.key, pricing.key].sort());
  });
});

describe('failed saves', () => {
  it('reports the failure and stores nothing', async () => {
    const area = new FakeArea();
    area.failWrites = true;
    await expect(create(new BlobStore(area))).rejects.toMatchObject({ code: 'storage-failed' });
    expect(area.items).toEqual({});
  });

  it('a retry with the same ids saves exactly one comment', async () => {
    const area = new FakeArea();
    const store = new BlobStore(area);
    const threadId = id();
    const input = { id: threadId, messageId: id(), page: home, title: 'Studio', anchor: anchor(), body: 'Once only' };

    area.failWrites = true;
    await expect(store.createThread(input)).rejects.toBeInstanceOf(BlobError);
    area.failWrites = false;
    await store.createThread(input);
    await store.createThread(input); // an impatient second click

    const threads = Object.values((await readData(area)).threads);
    expect(threads).toHaveLength(1);
    expect(threads[0]?.messages).toHaveLength(1);
  });

  it('a retried reply is saved once', async () => {
    const area = new FakeArea();
    const store = new BlobStore(area);
    const thread = await create(store);
    const messageId = id();
    area.failWrites = true;
    await expect(store.addReply(thread.id, messageId, 'Reply')).rejects.toMatchObject({ code: 'storage-failed' });
    area.failWrites = false;
    await store.addReply(thread.id, messageId, 'Reply');
    await store.addReply(thread.id, messageId, 'Reply');
    expect((await readData(area)).threads[thread.id]?.messages).toHaveLength(2);
  });

  it('keeps working after a failure', async () => {
    const area = new FakeArea();
    const store = new BlobStore(area);
    area.failWrites = true;
    await expect(create(store)).rejects.toBeInstanceOf(BlobError);
    area.failWrites = false;
    await expect(create(store)).resolves.toMatchObject({ number: 1 });
  });
});

describe('concurrent updates', () => {
  it('loses nothing when many saves arrive at once', async () => {
    const area = new FakeArea();
    const store = new BlobStore(area);
    const thread = await create(store);

    await Promise.all([
      ...Array.from({ length: 10 }, (_, i) => store.addReply(thread.id, id(), `reply ${i}`)),
      ...Array.from({ length: 5 }, () => create(store, pricing)),
      store.setStatus(thread.id, 'resolved'),
    ]);

    const data = await readData(area);
    expect(data.threads[thread.id]?.messages).toHaveLength(11);
    expect(data.threads[thread.id]?.status).toBe('resolved');
    const onPricing = Object.values(data.threads).filter((t) => t.pageKey === pricing.key);
    expect(onPricing.map((t) => t.number).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('resolve, reopen, reattach, delete', () => {
  it('resolves and reopens without losing messages', async () => {
    const area = new FakeArea();
    let clock = 0;
    const store = new BlobStore(area, () => new Date(Date.UTC(2026, 10, 25, 10, clock++)).toISOString());
    const thread = await create(store);
    await store.addReply(thread.id, id(), 'A reply');

    const resolved = await store.setStatus(thread.id, 'resolved');
    expect(resolved).toMatchObject({ status: 'resolved' });
    expect(resolved.resolvedAt).toBe(resolved.updatedAt);

    const reopened = await store.setStatus(thread.id, 'open');
    expect(reopened.status).toBe('open');
    expect(reopened.resolvedAt).toBeUndefined();
    expect(reopened.messages).toHaveLength(2);
  });

  it('reattaches the same conversation instead of creating a new one', async () => {
    const area = new FakeArea();
    const store = new BlobStore(area);
    const thread = await create(store);
    await store.reattach(thread.id, anchor({ selector: 'footer > a', tag: 'a', label: 'Link “Contact”', text: 'Contact' }));
    const data = await readData(area);
    expect(Object.keys(data.threads)).toEqual([thread.id]);
    expect(data.threads[thread.id]).toMatchObject({ number: 1, anchor: { tag: 'a', text: 'Contact' } });
    expect(data.threads[thread.id]?.messages).toHaveLength(1);
  });

  it('deletes a conversation, its replies, its draft, and the page record once unused', async () => {
    const area = new FakeArea();
    const store = new BlobStore(area);
    const keep = await create(store, pricing);
    const gone = await create(store, home);
    await store.addReply(gone.id, id(), 'A reply');
    await store.setDraft(`reply:${gone.id}`, 'half-written');

    await store.deleteThread(gone.id);
    await store.deleteThread(gone.id); // deleting twice is harmless

    const data = await readData(area);
    expect(Object.keys(data.threads)).toEqual([keep.id]);
    expect(Object.keys(data.pages)).toEqual([pricing.key]);
    expect(parseDrafts(area.items[KEYS.drafts])).toEqual({});
  });

  it('files a reply under the comment it answers, one level deep', async () => {
    const area = new FakeArea();
    const store = new BlobStore(area);
    const thread = await create(store);
    const first = thread.messages[0]!.id;
    const replyId = id();
    await store.addReply(thread.id, replyId, 'A reply to the first comment', first);
    await store.addReply(thread.id, id(), 'A reply to that reply', replyId);
    await store.addReply(thread.id, id(), 'Another comment on the conversation');

    const messages = (await readData(area)).threads[thread.id]!.messages;
    expect(messages.map((m) => m.replyTo)).toEqual([undefined, first, first, undefined]);
    await expect(store.addReply(thread.id, id(), 'To nothing', id())).rejects.toMatchObject({ code: 'not-found' });
    expect((await readData(area)).threads[thread.id]!.messages).toHaveLength(4);
  });

  it('refuses to change a conversation that does not exist', async () => {
    const store = new BlobStore(new FakeArea());
    await expect(store.addReply(id(), id(), 'Hello')).rejects.toMatchObject({ code: 'not-found' });
    await expect(store.setStatus(id(), 'resolved')).rejects.toMatchObject({ code: 'not-found' });
  });
});

describe('drafts and settings', () => {
  it('keeps a draft until it is cleared', async () => {
    const area = new FakeArea();
    const store = new BlobStore(area);
    await store.setDraft(`new:${home.key}`, 'not finished');
    expect(parseDrafts(area.items[KEYS.drafts])).toEqual({ [`new:${home.key}`]: 'not finished' });
    await store.setDraft(`new:${home.key}`, '');
    expect(parseDrafts(area.items[KEYS.drafts])).toEqual({});
  });

  it('remembers where the Blob button was left, within the screen', async () => {
    const store = new BlobStore(new FakeArea());
    expect(await store.updateSettings({ blobPosition: { x: 4, y: -1 } })).toMatchObject({ blobPosition: { x: 1, y: 0 } });
    expect(await store.updateSettings({ onboarded: true })).toEqual({ onboarded: true, blobPosition: { x: 1, y: 0 } });
  });
});

describe('schema versions', () => {
  it('starts empty when nothing is stored', () => {
    expect(migrate(undefined)).toEqual({ version: SCHEMA_VERSION, threads: {}, pages: {} });
  });

  it('never overwrites data written by a newer Blob', async () => {
    const area = new FakeArea();
    const future = { version: SCHEMA_VERSION + 1, threads: { x: { anything: true } }, pages: {} };
    area.items[KEYS.data] = future;
    await expect(create(new BlobStore(area))).rejects.toMatchObject({ code: 'newer-schema' });
    expect(area.items[KEYS.data]).toEqual(future);
  });

  it('rejects data it does not recognise rather than guessing', () => {
    expect(() => migrate('nonsense')).toThrow(BlobError);
    expect(() => migrate({ threads: {} })).toThrow(BlobError);
  });

  it('upgrades comments saved by version 1 without changing them', async () => {
    const area = new FakeArea();
    const thread = await create(new BlobStore(area));
    // As an older Blob would have left it: version 1, no reactions anywhere.
    const saved = structuredClone(area.items[KEYS.data]) as { version: number; threads: Record<string, unknown>; pages: unknown };
    const old = { ...saved, version: 1 };
    area.items[KEYS.data] = old;

    expect(migrate(old)).toEqual({ ...saved, version: SCHEMA_VERSION });
    // The next save writes it back at the current version, with the comment intact.
    await new BlobStore(area).addReply(thread.id, id(), 'Still here');
    const data = await readData(area);
    expect(data.version).toBe(SCHEMA_VERSION);
    expect(data.threads[thread.id]?.messages.map((m) => m.body)).toEqual(['More breathing room?', 'Still here']);
  });
});

describe('reactions', () => {
  it('adds and removes a reaction, keeps a fixed order, and is safe to repeat', async () => {
    const area = new FakeArea();
    const store = new BlobStore(area, () => '2026-11-27T10:00:00.000Z');
    const thread = await create(store);
    const messageId = thread.messages[0]!.id;
    const reactions = async () => (await readData(area)).threads[thread.id]?.messages[0]?.reactions;

    await store.setReaction(thread.id, messageId, '😮', true);
    await store.setReaction(thread.id, messageId, '👍', true);
    await store.setReaction(thread.id, messageId, '👍', true); // an impatient second click
    expect(await reactions()).toEqual(['👍', '😮']);

    await store.setReaction(thread.id, messageId, '😮', false);
    await store.setReaction(thread.id, messageId, '😮', false);
    expect(await reactions()).toEqual(['👍']);

    // With none left, nothing is stored for it at all.
    await store.setReaction(thread.id, messageId, '👍', false);
    expect(await reactions()).toBeUndefined();
  });

  it('does not count as activity, so the conversation keeps its place', async () => {
    let now = '2026-11-27T10:00:00.000Z';
    const store = new BlobStore(new FakeArea(), () => now);
    const thread = await create(store);
    now = '2026-11-28T10:00:00.000Z';
    const after = await store.setReaction(thread.id, thread.messages[0]!.id, '❤️', true);
    expect(after.updatedAt).toBe('2026-11-27T10:00:00.000Z');
  });

  it('refuses a comment or conversation that does not exist, and saves nothing on a failed write', async () => {
    const area = new FakeArea();
    const store = new BlobStore(area);
    const thread = await create(store);
    await expect(store.setReaction(id(), thread.messages[0]!.id, '👍', true)).rejects.toMatchObject({ code: 'not-found' });
    await expect(store.setReaction(thread.id, id(), '👍', true)).rejects.toMatchObject({ code: 'not-found' });

    area.failWrites = true;
    await expect(store.setReaction(thread.id, thread.messages[0]!.id, '👍', true)).rejects.toMatchObject({ code: 'storage-failed' });
    area.failWrites = false;
    expect((await readData(area)).threads[thread.id]?.messages[0]?.reactions).toBeUndefined();
  });
});
