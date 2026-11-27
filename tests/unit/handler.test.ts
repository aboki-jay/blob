import { describe, expect, it, vi } from 'vitest';
import { handleRequest, type HandlerDeps, type Sender } from '@/lib/handler';
import { parseAnchor, parseRequest } from '@/lib/messages';
import { BlobError, BlobStore, KEYS, parseDrafts, readData } from '@/lib/storage/store';
import { FakeArea, anchor, id } from './helpers';

const page: Sender = { pageOrigin: 'https://example.com', fromExtensionPage: false };
const popup: Sender = { fromExtensionPage: true };

function setup() {
  const area = new FakeArea();
  const deps: HandlerDeps = {
    store: new BlobStore(area),
    activateTab: vi.fn(async () => undefined),
    disableSite: vi.fn(async () => undefined),
    feedback: { enabled: true, send: vi.fn(async () => undefined) },
  };
  return { area, deps };
}

const createMessage = (over: Record<string, unknown> = {}) => ({
  type: 'thread/create',
  id: id(),
  messageId: id(),
  href: 'https://example.com/pricing?token=SECRET',
  title: 'Pricing',
  anchor: anchor(),
  body: 'Is this price right?',
  ...over,
});

describe('placing a comment', () => {
  it('saves the comment under the sanitised page and clears its draft', async () => {
    const { area, deps } = setup();
    await deps.store.setDraft('new:https://example.com/pricing', 'Is this pri');
    const response = await handleRequest(createMessage(), page, deps);
    expect(response).toMatchObject({ ok: true, data: { pageKey: 'https://example.com/pricing', number: 1 } });
    expect(JSON.stringify(area.items)).not.toContain('SECRET');
    expect(parseDrafts(area.items[KEYS.drafts])).toEqual({});
  });

  it('rejects empty and whitespace-only comments', async () => {
    const { area, deps } = setup();
    for (const body of ['', '   ', '\n\t ', undefined, 42]) {
      expect(await handleRequest(createMessage({ body }), page, deps)).toEqual({ ok: false, error: 'invalid' });
    }
    expect(area.writes).toBe(0);
  });

  it('trims the comment and rejects one that is far too long', async () => {
    const { deps } = setup();
    const ok = await handleRequest(createMessage({ body: '  hello  ' }), page, deps);
    expect(ok).toMatchObject({ ok: true, data: { messages: [{ body: 'hello' }] } });
    expect(await handleRequest(createMessage({ body: 'x'.repeat(5001) }), page, deps)).toMatchObject({ ok: false });
  });

  it('will not file a comment under a different website than the sender', async () => {
    const { area, deps } = setup();
    const response = await handleRequest(createMessage({ href: 'https://bank.example/' }), page, deps);
    expect(response).toMatchObject({ ok: false, error: 'forbidden' });
    expect(area.writes).toBe(0);
  });

  it('refuses pages that are not ordinary web pages', async () => {
    const { deps } = setup();
    const response = await handleRequest(createMessage({ href: 'chrome://settings' }), page, deps);
    expect(response).toMatchObject({ ok: false, error: 'unsupported-page' });
  });

  it('says so when storage fails, and a retry does not duplicate', async () => {
    const { area, deps } = setup();
    const message = createMessage();
    area.failWrites = true;
    expect(await handleRequest(message, page, deps)).toMatchObject({ ok: false, error: 'storage-failed' });
    area.failWrites = false;
    expect(await handleRequest(message, page, deps)).toMatchObject({ ok: true });
    expect(await handleRequest(message, page, deps)).toMatchObject({ ok: true });
    expect(Object.keys((await readData(area)).threads)).toHaveLength(1);
  });
});

describe('untrusted input', () => {
  it('ignores messages it does not understand', async () => {
    const { deps } = setup();
    for (const raw of [null, 'hi', [], {}, { type: 'thread/explode' }, { type: 'thread/reply', threadId: '../x', messageId: id(), body: 'a' }]) {
      expect(await handleRequest(raw, page, deps)).toEqual({ ok: false, error: 'invalid' });
    }
  });

  it('keeps only known anchor fields, within limits', () => {
    const parsed = parseAnchor({
      ...anchor(),
      text: 'x'.repeat(500),
      html: '<script>alert(1)</script>',
      value: 'typed by the person',
      attrs: { role: 'button', onclick: 'steal()', ariaLabel: 'Go' },
      classes: ['a', 'b', 'c', 'd', 5],
      offset: { x: 7, y: -3 },
    });
    expect(parsed).not.toHaveProperty('html');
    expect(parsed).not.toHaveProperty('value');
    expect(parsed?.text).toHaveLength(80);
    expect(parsed?.attrs).toEqual({ role: 'button', ariaLabel: 'Go' });
    expect(parsed?.classes).toEqual(['a', 'b', 'c']);
    expect(parsed?.offset).toEqual({ x: 1, y: 0 });
    expect(parseAnchor({ selector: 'a', tag: 'a', label: 'Link' })).toBeNull();
  });

  it('accepts only the two real statuses', () => {
    expect(parseRequest({ type: 'thread/status', threadId: id(), status: 'archived' })).toBeNull();
    expect(parseRequest({ type: 'thread/status', threadId: id(), status: 'resolved' })).not.toBeNull();
  });
});

describe('who may ask for what', () => {
  it('only Blob’s own popup can turn Blob on or off for a tab or website', async () => {
    const { deps } = setup();
    expect(await handleRequest({ type: 'tab/activate', tabId: 7 }, page, deps)).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await handleRequest({ type: 'site/disable', origin: 'https://example.com/*' }, page, deps)).toMatchObject({ ok: false, error: 'forbidden' });
    expect(deps.activateTab).not.toHaveBeenCalled();
    expect(deps.disableSite).not.toHaveBeenCalled();

    expect(await handleRequest({ type: 'tab/activate', tabId: 7 }, popup, deps)).toMatchObject({ ok: true });
    expect(await handleRequest({ type: 'site/disable', origin: 'https://example.com/*' }, popup, deps)).toMatchObject({ ok: true });
    expect(deps.activateTab).toHaveBeenCalledWith(7);
    expect(deps.disableSite).toHaveBeenCalledWith('https://example.com/*');
  });

  it('reports a page Chrome refuses to inject into as a failure, not a success', async () => {
    const { deps } = setup();
    deps.activateTab = vi.fn(async () => {
      throw new Error('Cannot access contents of the page.');
    });
    expect(await handleRequest({ type: 'tab/activate', tabId: 7 }, popup, deps)).toMatchObject({ ok: false });
  });

  it('turning a website off does not delete its comments', async () => {
    const { area, deps } = setup();
    await handleRequest(createMessage(), page, deps);
    await handleRequest({ type: 'site/disable', origin: 'https://example.com/*' }, popup, deps);
    expect(Object.keys((await readData(area)).threads)).toHaveLength(1);
  });
});

describe('feedback', () => {
  it('passes on a rating and trimmed text, and nothing else', async () => {
    const { deps } = setup();
    const response = await handleRequest({ type: 'feedback/send', rating: 'Good', text: '  Lovely  ', page: 'https://bank.example/', comments: ['x'] }, page, deps);
    expect(response).toEqual({ ok: true, data: null });
    expect(deps.feedback.send).toHaveBeenCalledWith({ rating: 'Good', text: 'Lovely' });
  });

  it('needs a rating or some text, a known rating, and a sensible length', async () => {
    const { deps } = setup();
    for (const bad of [{}, { text: '   ' }, { rating: 'Superb', text: 'x' }, { rating: 'Good', text: 7 }, { text: 'x'.repeat(2001) }]) {
      expect(await handleRequest({ type: 'feedback/send', ...bad }, page, deps)).toEqual({ ok: false, error: 'invalid' });
    }
    expect(await handleRequest({ type: 'feedback/send', text: 'Text alone is fine' }, page, deps)).toMatchObject({ ok: true });
    expect(deps.feedback.send).toHaveBeenCalledTimes(1);
  });

  it('says whether sending is set up, and refuses to send when it is not', async () => {
    const { deps } = setup();
    expect(await handleRequest({ type: 'feedback/status' }, page, deps)).toEqual({ ok: true, data: { enabled: true } });
    deps.feedback.enabled = false;
    expect(await handleRequest({ type: 'feedback/status' }, page, deps)).toEqual({ ok: true, data: { enabled: false } });
    expect(await handleRequest({ type: 'feedback/send', text: 'Hello' }, page, deps)).toMatchObject({ ok: false, error: 'unavailable' });
    expect(deps.feedback.send).not.toHaveBeenCalled();
  });

  it('reports a failed delivery as a failure', async () => {
    const { deps } = setup();
    deps.feedback.send = vi.fn(async () => {
      throw new BlobError('send-failed');
    });
    expect(await handleRequest({ type: 'feedback/send', rating: 'Okay' }, page, deps)).toMatchObject({ ok: false, error: 'send-failed' });
  });
});

describe('the feedback relay and the form agree', () => {
  it('on the list of ratings', async () => {
    const [{ RATINGS: form }, { RATINGS: relay }] = await Promise.all([import('@/lib/feedback'), import('@/worker/feedback/src/index')]);
    expect([...form]).toEqual([...relay]);
  });
});
