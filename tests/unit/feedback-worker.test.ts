import { describe, expect, it, vi } from 'vitest';
import { handle, parseFeedback, type Env } from '@/worker/feedback/src/index';

type Sent = Parameters<Env['EMAIL']['send']>[0];

function setup(over: Partial<Env> = {}) {
  const sent: Sent[] = [];
  const env: Env = {
    EMAIL: {
      send: vi.fn(async (message: Sent) => {
        sent.push(message);
        return { messageId: 'test' };
      }),
    },
    FEEDBACK_TO: 'maintainer@example.com',
    FEEDBACK_FROM: 'feedback@example.com',
    ...over,
  };
  return { env, sent };
}

const post = (body: unknown, init: RequestInit = {}) =>
  new Request('https://feedback.example/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  });

describe('feedback relay', () => {
  it('emails the rating, text and version to the maintainer, as plain text', async () => {
    const { env, sent } = setup();
    const response = await handle(post({ rating: 'Good', text: '  Pins are easy to place  ', version: '0.1.0' }), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: 'maintainer@example.com',
      from: { email: 'feedback@example.com', name: 'Blob feedback' },
      subject: 'Blob feedback: Good',
    });
    expect(sent[0]!.text).toBe('Rating: Good\nBlob version: 0.1.0\n\nPins are easy to place');
    expect(sent[0]).not.toHaveProperty('html');
  });

  it('accepts a rating alone or text alone, but not nothing', async () => {
    const { env, sent } = setup();
    expect((await handle(post({ rating: 'Okay' }), env)).status).toBe(200);
    expect((await handle(post({ text: 'Just a note' }), env)).status).toBe(200);
    expect(sent[1]!.subject).toBe('Blob feedback: no rating');
    for (const empty of [{}, { text: '   ' }, { rating: '' }]) {
      expect((await handle(post(empty), env)).status).toBe(400);
    }
    expect(sent).toHaveLength(2);
  });

  it('refuses input it does not recognise', async () => {
    const { env, sent } = setup();
    const bad = [
      { rating: 'Excellent', text: 'x' },
      { rating: 'Good\r\nBcc: someone@example.com', text: 'x' },
      { rating: 'Good', text: 42 },
      { text: 'x'.repeat(2001) },
      'not json',
      '[]',
      'null',
    ];
    for (const body of bad) expect((await handle(post(body), env)).status, JSON.stringify(body).slice(0, 40)).toBe(400);
    expect((await handle(post('x'.repeat(9000)), env)).status).toBe(413);
    expect(sent).toHaveLength(0);
  });

  it('ignores a made-up version and any extra fields', async () => {
    const { env, sent } = setup();
    await handle(post({ text: 'Hello', version: '<script>', to: 'victim@example.com', subject: 'Free money', html: '<b>hi</b>' }), env);
    expect(sent[0]).toMatchObject({ to: 'maintainer@example.com', subject: 'Blob feedback: no rating' });
    expect(sent[0]!.text).toContain('Blob version: unknown');
    expect(sent[0]).not.toHaveProperty('html');
  });

  it('only accepts POST, and answers the browser’s permission check', async () => {
    const { env } = setup();
    expect((await handle(new Request('https://feedback.example/'), env)).status).toBe(405);
    const preflight = await handle(new Request('https://feedback.example/', { method: 'OPTIONS' }), env);
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
    expect((await handle(post({ text: 'x' }), env)).headers.get('access-control-allow-origin')).toBe('*');
  });

  it('turns away a sender who is posting too fast, without sending', async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const { env, sent } = setup({ LIMITER: { limit } });
    expect((await handle(post({ text: 'again' }), env)).status).toBe(429);
    expect(limit).toHaveBeenCalledWith({ key: '203.0.113.9' });
    expect(sent).toHaveLength(0);
  });

  it('reports a failed send as a failure', async () => {
    const { env } = setup({
      EMAIL: {
        send: async () => {
          throw Object.assign(new Error('nope'), { code: 'E_RECIPIENT_PLAN_RESTRICTED' });
        },
      },
    });
    const response = await handle(post({ text: 'x' }), env);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ ok: false, error: 'send-failed' });
  });

  it('says so when it has not been set up', async () => {
    const { env } = setup({ FEEDBACK_TO: undefined });
    expect((await handle(post({ text: 'x' }), env)).status).toBe(503);
  });

  it('cleans what it accepts', () => {
    expect(parseFeedback({ rating: 'Neutral', text: ' ok ', version: '1.2.3' })).toEqual({ rating: 'Neutral', text: 'ok', version: '1.2.3' });
    expect(parseFeedback('Good')).toBeNull();
  });
});
