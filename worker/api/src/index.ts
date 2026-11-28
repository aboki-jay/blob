/**
 * Blob's sharing server: a Cloudflare Worker with a D1 database.
 *
 * This file turns web requests into calls on the store (store.ts) and store
 * results into answers. It decides nothing about access itself beyond "is this
 * person signed in": the rules live in the store, in the same step as the
 * reads and writes they guard.
 *
 * Everything is JSON under /api/v1. Someone signed in sends their session
 * secret as `Authorization: Bearer <secret>`. There are no cookies, which is
 * what makes it safe to accept requests from any origin (the extension has no
 * fixed one).
 *
 * Not here yet: Google sign-in (the next step), the emailed code, and the web
 * page for recipients.
 */

import { fingerprint } from './crypto';
import type { Db } from './db';
import { ApiStore, type Account, type Failure, type SharedConversation } from './store';
import { cleanName, isToken, parseNewShare, parseReply } from './validate';

export interface Env {
  DB: Db;
  /** The key identities are scrambled with. A secret, never in the repository. */
  FINGERPRINT_KEY?: string;
  /** "on" only on a developer's machine and on the test copy. See `testSignInAllowed`. */
  TEST_SIGN_IN?: string;
  /** Where shared links point, e.g. https://blob.davidokunlola.com. Defaults to wherever the request came in. */
  PUBLIC_ORIGIN?: string;
}

export interface Deps {
  now(): number;
}

/** The real service's address. The test-only sign-in can never work here. */
export const PRODUCTION_HOSTS = ['blob.davidokunlola.com'];

const BASE = '/api/v1';
/** The most a request may carry. Sharing uploads a whole conversation; nothing else needs much. */
const MAX_BODY = { share: 400_000, other: 16_000 };

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '86400',
};

const STATUS: Record<string, number> = {
  unauthorized: 401,
  forbidden: 403,
  'not-found': 404,
  'method-not-allowed': 405,
  gone: 410,
  'too-large': 413,
  invalid: 400,
  full: 409,
  'too-many': 429,
  busy: 503,
};

class Refusal extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' } });
const ok = (data: Record<string, unknown> = {}) => json(200, { ok: true, ...data });
const refuse = (code: string) => json(STATUS[code] ?? 400, { ok: false, error: code });

/** Turns a store failure into a refusal; passes a success through. */
function unless<T>(result: T | Failure): T {
  if (typeof result === 'string' && result in STATUS) throw new Refusal(result);
  return result as T;
}

async function readJson(request: Request, max: number): Promise<unknown> {
  if (Number(request.headers.get('content-length') ?? 0) > max) throw new Refusal('too-large');
  const text = await request.text();
  if (text.length > max) throw new Refusal('too-large');
  try {
    return JSON.parse(text);
  } catch {
    throw new Refusal('invalid');
  }
}

/**
 * The test-only sign-in lets the load test and browser tests have accounts
 * without Google. It needs three things at once: the switch set to "on", a
 * request that did not arrive at the real service's address, and an address
 * that is a developer's machine or the test copy. `npm run check:worker`
 * separately refuses a configuration that sets the switch for the real service.
 */
export function testSignInAllowed(env: Env, url: URL): boolean {
  if (env.TEST_SIGN_IN !== 'on') return false;
  if (PRODUCTION_HOSTS.includes(url.hostname)) return false;
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname.startsWith('blob-api-test.');
}

/** What a signed-in reader is shown. Account ids stay on the server; names and "is this you" are enough. */
function present(share: SharedConversation, me: Account, origin: string) {
  const isOwner = share.ownerId === me.id;
  return {
    share: {
      // The owner's device knows its own share by this id; nobody else needs it.
      ...(isOwner ? { id: share.id } : {}),
      url: `${origin}/t/${share.code}`,
      pageUrl: share.pageUrl,
      pageTitle: share.pageTitle,
      anchor: share.anchor,
      expiresAt: share.expiresAt,
      createdAt: share.createdAt,
      owner: { name: share.ownerName },
      isOwner,
    },
    messages: share.messages.map((message) => ({
      id: message.id,
      body: message.body,
      replyTo: message.replyTo,
      createdAt: message.createdAt,
      // A carried-over reply is shown under the name it came with; it is nobody's "you".
      author: { name: message.authorName, isYou: !message.carried && message.authorId === me.id, isOwner: !message.carried && message.authorId === share.ownerId },
      carried: message.carried,
      canDelete: message.authorId === me.id && message.id !== share.rootId,
    })),
  };
}

export async function handle(request: Request, env: Env, deps: Deps = { now: Date.now }): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(request.url);
  if (!url.pathname.startsWith(`${BASE}/`)) return refuse('not-found');
  const path = url.pathname.slice(BASE.length + 1).split('/');
  const method = request.method;
  const now = deps.now();
  const origin = env.PUBLIC_ORIGIN ?? url.origin;

  try {
    // Answers without touching the database, so "is it up?" costs nothing.
    if (path.length === 1 && path[0] === 'health') return method === 'GET' ? ok() : refuse('method-not-allowed');

    const store = new ApiStore(env.DB);

    if (path.length === 2 && path[0] === 'test' && path[1] === 'sign-in') {
      // Looks like it does not exist unless all three conditions hold.
      if (!testSignInAllowed(env, url)) return refuse('not-found');
      if (method !== 'POST') return refuse('method-not-allowed');
      const body = await readJson(request, MAX_BODY.other);
      const name = cleanName((body as { name?: unknown })?.name);
      const subject = (body as { subject?: unknown })?.subject;
      if (!name || typeof subject !== 'string' || !/^[\w.-]{1,80}$/.test(subject)) return refuse('invalid');
      const identity = { fingerprint: await fingerprint(env.FINGERPRINT_KEY ?? 'test-only-key', 'test', subject), kind: 'test', name };
      const session = unless(await store.signIn(identity, now));
      return ok({ token: session.token, account: { name: session.account.name } });
    }

    // Everything below needs someone signed in.
    const header = request.headers.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const me = isToken(token) ? await store.authenticate(token, now) : null;
    if (!me) return refuse('unauthorized');

    if (path.length === 1 && path[0] === 'me') {
      if (method === 'GET') return ok({ account: { name: me.name } });
      if (method === 'PATCH') {
        const name = cleanName(((await readJson(request, MAX_BODY.other)) as { name?: unknown })?.name);
        if (!name) return refuse('invalid');
        await store.rename(me.id, name);
        return ok({ account: { name } });
      }
      if (method === 'DELETE') {
        await store.deleteAccount(me.id);
        return ok();
      }
      return refuse('method-not-allowed');
    }

    if (path.length === 1 && path[0] === 'sign-out') {
      if (method !== 'POST') return refuse('method-not-allowed');
      await store.signOut(token);
      return ok();
    }

    if (path[0] === 'shares') {
      if (path.length === 1) {
        if (method === 'GET') {
          const shares = await store.listShares(me.id, now);
          return ok({ shares: shares.map((share) => ({ id: share.id, url: `${origin}/t/${share.code}`, expiresAt: share.expiresAt, createdAt: share.createdAt })) });
        }
        if (method === 'POST') {
          const input = parseNewShare(await readJson(request, MAX_BODY.share), now);
          if (!input) return refuse('invalid');
          const share = unless(await store.createShare(me.id, input, now));
          return ok({ share: { id: share.id, url: `${origin}/t/${share.code}`, expiresAt: share.expiresAt, createdAt: share.createdAt } });
        }
        return refuse('method-not-allowed');
      }

      const code = path[1];
      // A malformed code is answered like one that has ended: nothing to learn from the difference.
      if (!isToken(code)) return refuse('gone');

      if (path.length === 2) {
        if (method === 'GET') return ok(present(unless(await store.readShare(code, now)), me, origin));
        if (method === 'DELETE') {
          unless(await store.stopSharing(code, me.id));
          return ok();
        }
        return refuse('method-not-allowed');
      }

      if (path.length === 3 && path[2] === 'messages') {
        if (method !== 'POST') return refuse('method-not-allowed');
        const reply = parseReply(await readJson(request, MAX_BODY.other));
        if (!reply) return refuse('invalid');
        const saved = unless(await store.addMessage(code, me.id, reply, now));
        return ok({ message: saved });
      }

      if (path.length === 4 && path[2] === 'messages') {
        if (method !== 'DELETE') return refuse('method-not-allowed');
        const messageId = path[3];
        if (!messageId || !/^[A-Za-z0-9_-]{8,64}$/.test(messageId)) return refuse('invalid');
        unless(await store.deleteMessage(code, messageId, me.id, now));
        return ok();
      }
    }

    return refuse('not-found');
  } catch (error) {
    if (error instanceof Refusal) return refuse(error.code);
    // The database refused or is overloaded, or something unforeseen. Say "busy"
    // and nothing else: details stay in the log, and never include what anyone wrote.
    console.error('blob api failed:', error instanceof Error ? error.name : 'unknown');
    return refuse('busy');
  }
}

export default {
  fetch: (request: Request, env: Env) => handle(request, env),
  /** On a timer: delete conversations past their deadline, ended sessions and old counters. */
  scheduled: async (_event: unknown, env: Env) => {
    await new ApiStore(env.DB).sweep(Date.now());
  },
};
