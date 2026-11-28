/**
 * Helpers for testing the sharing server (worker/api) without Cloudflare: the
 * real request handler, the real statements, a stand-in database (d1.ts), and
 * a clock the test controls.
 */

import { handle, type Env } from '../../worker/api/src/index';
import { createTestDb, type TestDb } from './d1';
import { anchor, id } from './helpers';

export const DAY = 24 * 60 * 60 * 1000;
/** A fixed starting instant, so nothing depends on when the tests run. */
export const START = Date.UTC(2026, 10, 28, 12, 0, 0);

export interface Reply<T = Record<string, any>> {
  status: number;
  body: T & { ok: boolean; error?: string };
}

export interface Server {
  db: TestDb;
  env: Env;
  /** The server's idea of the time. Move it forward to test deadlines. */
  clock: { now: number };
  call(method: string, path: string, options?: { token?: string; body?: unknown; host?: string; rawBody?: string }): Promise<Reply>;
  /** Signs a test person in and returns their session secret. */
  signIn(name: string): Promise<string>;
}

export function createServer(overrides: Partial<Env> = {}): Server {
  const db = createTestDb();
  const env: Env = { DB: db, FINGERPRINT_KEY: 'unit-test-key', TEST_SIGN_IN: 'on', ...overrides };
  const clock = { now: START };
  const server: Server = {
    db,
    env,
    clock,
    async call(method, path, options = {}) {
      const headers: Record<string, string> = {};
      if (options.token) headers.authorization = `Bearer ${options.token}`;
      const body = options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
      if (body !== undefined) headers['content-type'] = 'application/json';
      const request = new Request(`http://${options.host ?? 'localhost'}/api/v1${path}`, { method, headers, body });
      const response = await handle(request, env, { now: () => clock.now });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : { ok: response.ok } };
    },
    async signIn(name) {
      const reply = await server.call('POST', '/test/sign-in', { body: { name, subject: name.toLowerCase().replace(/\W+/g, '-') } });
      if (!reply.body.ok) throw new Error(`test sign-in failed: ${reply.body.error}`);
      return reply.body.token as string;
    },
  };
  return server;
}

/** A conversation as the owner's device would upload it. */
export const newShare = (over: Record<string, unknown> = {}) => ({
  id: id(),
  page: { url: 'https://example.com/pricing?token=SECRET&plan=team', title: 'Pricing' },
  anchor: anchor(),
  expires: 'never',
  messages: [{ id: id(), body: 'Is this price right?', createdAt: START - 60_000 }],
  ...over,
});

/** The link code from a share's address. */
export const codeOf = (url: string) => url.split('/t/')[1]!;

/** Shares a conversation as `token` and returns its code and the upload that made it. */
export async function share(server: Server, token: string, over: Record<string, unknown> = {}) {
  const upload = newShare(over);
  const reply = await server.call('POST', '/shares', { token, body: upload });
  if (!reply.body.ok) throw new Error(`sharing failed: ${reply.body.error}`);
  return { code: codeOf(reply.body.share.url), upload, share: reply.body.share as { id: string; url: string; expiresAt: number | null } };
}
