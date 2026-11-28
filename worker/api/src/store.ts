/**
 * Everything the sharing server does to its database.
 *
 * The rules that matter (who may read, reply, stop sharing, delete; expiry;
 * the firm limits) are written into the statements themselves, and each action
 * runs as one batch: one indivisible step. That is what makes them hold when
 * many people act at the same moment. A reply cannot land in a conversation
 * that stopped being shared a millisecond earlier, and a retry cannot post
 * twice, because the check and the write are the same step.
 *
 * Every time is milliseconds since 1970 and is passed in, so tests can move the
 * clock.
 */

import type { AnchorDescriptor } from '../../../lib/types';
import { randomToken, sha256 } from './crypto';
import type { Db } from './db';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const RULES = {
  /** How long someone stays signed in. Fixed, so reading costs no write. */
  sessionMs: 30 * DAY,
  /** The choices under "Link expires". `never` means until the owner stops sharing. */
  expiry: { never: null, '7d': 7 * DAY, '14d': 14 * DAY, '30d': 30 * DAY } as Record<string, number | null>,
  /** Comments and replies that can be uploaded when a conversation is first shared. */
  messagesAtCreation: 200,
  /** The most a shared conversation can hold. */
  messagesPerShare: 500,
  repliesPerMinute: 30,
  repliesPerDay: 1000,
  sharesPerDay: 30,
  signInsPerHour: 20,
} as const;

export type Failure = 'gone' | 'forbidden' | 'invalid' | 'too-many' | 'full';

export interface Account {
  id: string;
  name: string;
}

export interface ShareSummary {
  id: string;
  code: string;
  expiresAt: number | null;
  createdAt: number;
}

export interface SharedMessage {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  replyTo: string | null;
  /** True for a reply the owner carried over from an earlier link. */
  carried: boolean;
  createdAt: number;
}

export interface SharedConversation extends ShareSummary {
  ownerId: string;
  ownerName: string;
  pageUrl: string;
  pageTitle: string;
  anchor: AnchorDescriptor;
  rootId: string;
  messages: SharedMessage[];
}

export interface NewMessage {
  id: string;
  body: string;
  replyTo: string | null;
  createdAt: number;
  /** Set only for a reply carried over from an earlier link: the name to show it under. */
  carriedName: string | null;
}

export interface NewShare {
  id: string;
  pageUrl: string;
  pageTitle: string;
  anchor: AnchorDescriptor;
  expiresAt: number | null;
  /** The first is the conversation's first comment. */
  messages: NewMessage[];
}

/** Still shared at `?N`: no deadline, or the deadline has not arrived. */
const alive = (table: string, nowParam: string) => `(${table}.expires_at IS NULL OR ${table}.expires_at > ${nowParam})`;
/** How far a counter has got. A missing row means zero. */
const counted = (keyParam: string) => `(SELECT COALESCE(SUM(count), 0) FROM counters WHERE key = ${keyParam})`;

export class ApiStore {
  constructor(private readonly db: Db) {}

  /* ---------- Accounts and sessions ---------- */

  /**
   * Signs someone in by their identity fingerprint, creating the account the
   * first time. Two sign-ins for a new identity at the same moment still make
   * one account. Returns the session's secret, which is shown once and stored
   * only as a scramble.
   */
  async signIn(identity: { fingerprint: string; kind: string; name: string }, now: number): Promise<{ token: string; account: Account } | 'too-many'> {
    const accountId = randomToken(16);
    const token = randomToken(32);
    const tokenHash = await sha256(token);
    const limitKey = `signin:${identity.fingerprint}:${Math.floor(now / HOUR)}`;
    const results = await this.db.batch<Account>([
      this.db
        .prepare('INSERT INTO accounts (id, name, created_at) SELECT ?1, ?2, ?3 WHERE NOT EXISTS (SELECT 1 FROM identities WHERE fingerprint = ?4)')
        .bind(accountId, identity.name, now, identity.fingerprint),
      this.db
        .prepare(
          'INSERT INTO identities (fingerprint, account_id, kind, created_at) SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM accounts WHERE id = ?2) ON CONFLICT(fingerprint) DO NOTHING',
        )
        .bind(identity.fingerprint, accountId, identity.kind, now),
      this.db
        .prepare(
          `INSERT INTO sessions (token_hash, account_id, created_at, expires_at)
           SELECT ?1, i.account_id, ?2, ?3 FROM identities i WHERE i.fingerprint = ?4 AND ${counted('?5')} < ?6`,
        )
        .bind(tokenHash, now, now + RULES.sessionMs, identity.fingerprint, limitKey, RULES.signInsPerHour),
      this.db
        .prepare(
          'INSERT INTO counters (key, count, expires_at) SELECT ?1, 1, ?2 WHERE EXISTS (SELECT 1 FROM sessions WHERE token_hash = ?3) ON CONFLICT(key) DO UPDATE SET count = count + 1',
        )
        .bind(limitKey, now + 2 * HOUR, tokenHash),
      this.db.prepare('SELECT a.id, a.name FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ?1').bind(tokenHash),
    ]);
    const account = results[4]?.results[0];
    return account ? { token, account } : 'too-many';
  }

  /** Who a session secret belongs to, if it is still good. */
  async authenticate(token: string, now: number): Promise<Account | null> {
    const { results } = await this.db
      .prepare('SELECT a.id, a.name FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ?1 AND s.expires_at > ?2')
      .bind(await sha256(token), now)
      .all<Account>();
    return results[0] ?? null;
  }

  async signOut(token: string): Promise<void> {
    await this.db.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(await sha256(token)).run();
  }

  async rename(accountId: string, name: string): Promise<void> {
    await this.db.prepare('UPDATE accounts SET name = ?2 WHERE id = ?1').bind(accountId, name).run();
  }

  /**
   * Removes the account and everything of theirs on the server: their sessions
   * and sign-in fingerprints, the conversations they shared (with every reply
   * in them), their replies in other people's conversations, and their counters.
   */
  async deleteAccount(accountId: string): Promise<void> {
    await this.db.batch([
      this.db
        .prepare(
          `DELETE FROM counters WHERE key LIKE '%:' || ?1 || ':%'
             OR EXISTS (SELECT 1 FROM identities i WHERE i.account_id = ?1 AND counters.key LIKE 'signin:' || i.fingerprint || ':%')`,
        )
        .bind(accountId),
      this.db.prepare('DELETE FROM accounts WHERE id = ?1').bind(accountId),
    ]);
  }

  /* ---------- Sharing ---------- */

  /**
   * Uploads a conversation and returns its link code. Calling it again with the
   * same id (a retry) returns the same share and changes nothing.
   */
  async createShare(ownerId: string, share: NewShare, now: number): Promise<ShareSummary | Failure> {
    const code = randomToken(18);
    const limitKey = `share:d:${ownerId}:${Math.floor(now / DAY)}`;
    const results = await this.db.batch<{ id: string; code: string; owner_id: string; expires_at: number | null; created_at: number }>([
      this.db
        .prepare(
          `INSERT INTO shares (id, code, owner_id, page_url, page_title, anchor, root_id, expires_at, created_at)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9 WHERE ${counted('?10')} < ?11
           ON CONFLICT(id) DO NOTHING`,
        )
        .bind(share.id, code, ownerId, share.pageUrl, share.pageTitle, JSON.stringify(share.anchor), share.messages[0]!.id, share.expiresAt, now, limitKey, RULES.sharesPerDay),
      // Counted only if the share was made by this very call (its code is ours).
      this.db
        .prepare(
          'INSERT INTO counters (key, count, expires_at) SELECT ?1, 1, ?2 WHERE EXISTS (SELECT 1 FROM shares WHERE id = ?3 AND code = ?4) ON CONFLICT(key) DO UPDATE SET count = count + 1',
        )
        .bind(limitKey, now + 2 * DAY, share.id, code),
      // The comments, in one statement however many there are. Again only for a share made by this call.
      this.db
        .prepare(
          `INSERT INTO messages (share_id, id, author_id, body, reply_to, carried_name, created_at)
           SELECT ?1, json_extract(m.value, '$.id'), ?2, json_extract(m.value, '$.body'), json_extract(m.value, '$.replyTo'),
                  json_extract(m.value, '$.carriedName'), json_extract(m.value, '$.createdAt')
           FROM json_each(?3) m
           WHERE EXISTS (SELECT 1 FROM shares WHERE id = ?1 AND code = ?4)
           ON CONFLICT(share_id, id) DO NOTHING`,
        )
        .bind(share.id, ownerId, JSON.stringify(share.messages), code),
      this.db.prepare('SELECT id, code, owner_id, expires_at, created_at FROM shares WHERE id = ?1').bind(share.id),
    ]);
    const row = results[3]?.results[0];
    if (!row) return 'too-many';
    // The id is already someone else's conversation. Ids are random, so this is not an accident.
    if (row.owner_id !== ownerId) return 'invalid';
    return { id: row.id, code: row.code, expiresAt: row.expires_at, createdAt: row.created_at };
  }

  /** The conversation behind a link, for anyone signed in. Nothing if it has ended. */
  async readShare(code: string, now: number): Promise<SharedConversation | 'gone'> {
    const [shares, messages] = await this.db.batch<Record<string, unknown>>([
      this.db
        .prepare(
          `SELECT s.id, s.code, s.owner_id, o.name AS owner_name, s.page_url, s.page_title, s.anchor, s.root_id, s.expires_at, s.created_at
           FROM shares s JOIN accounts o ON o.id = s.owner_id
           WHERE s.code = ?1 AND ${alive('s', '?2')}`,
        )
        .bind(code, now),
      this.db
        .prepare(
          `SELECT m.id, m.author_id, a.name AS author_name, m.body, m.reply_to, m.carried_name, m.created_at
           FROM messages m JOIN shares s ON s.id = m.share_id JOIN accounts a ON a.id = m.author_id
           WHERE s.code = ?1 AND ${alive('s', '?2')}
           ORDER BY m.created_at, m.rowid`,
        )
        .bind(code, now),
    ]);
    const share = shares?.results[0];
    if (!share) return 'gone';
    const rows = messages?.results ?? [];
    // A reply whose comment has since been deleted stands on its own.
    const ids = new Set(rows.map((row) => row.id as string));
    return {
      id: share.id as string,
      code: share.code as string,
      ownerId: share.owner_id as string,
      ownerName: share.owner_name as string,
      pageUrl: share.page_url as string,
      pageTitle: share.page_title as string,
      anchor: JSON.parse(share.anchor as string) as AnchorDescriptor,
      rootId: share.root_id as string,
      expiresAt: (share.expires_at as number | null) ?? null,
      createdAt: share.created_at as number,
      messages: rows.map((row) => ({
        id: row.id as string,
        authorId: row.author_id as string,
        authorName: (row.carried_name as string | null) ?? (row.author_name as string),
        body: row.body as string,
        replyTo: row.reply_to && ids.has(row.reply_to as string) ? (row.reply_to as string) : null,
        carried: row.carried_name !== null && row.carried_name !== undefined,
        createdAt: row.created_at as number,
      })),
    };
  }

  /** The conversations someone is sharing right now, newest first. */
  async listShares(ownerId: string, now: number): Promise<ShareSummary[]> {
    const { results } = await this.db
      .prepare(`SELECT s.id, s.code, s.expires_at, s.created_at FROM shares s WHERE s.owner_id = ?1 AND ${alive('s', '?2')} ORDER BY s.created_at DESC LIMIT 200`)
      .bind(ownerId, now)
      .all<{ id: string; code: string; expires_at: number | null; created_at: number }>();
    return results.map((row) => ({ id: row.id, code: row.code, expiresAt: row.expires_at, createdAt: row.created_at }));
  }

  /**
   * Adds a comment or reply. In one step it checks that the conversation is
   * still shared (deadline included), that the person is within their limits
   * and that there is room, and only then writes. Sending the same id again
   * (a retry) succeeds without posting twice.
   */
  async addMessage(
    code: string,
    authorId: string,
    message: { id: string; body: string; replyTo: string | null },
    now: number,
  ): Promise<{ id: string; replyTo: string | null; createdAt: number } | Failure> {
    const minuteKey = `reply:m:${authorId}:${Math.floor(now / MINUTE)}`;
    const dayKey = `reply:d:${authorId}:${Math.floor(now / DAY)}`;
    const bump = (key: string, lifetime: number) =>
      this.db
        .prepare(
          `INSERT INTO counters (key, count, expires_at)
           SELECT ?1, 1, ?2 WHERE EXISTS (
             SELECT 1 FROM messages m JOIN shares s ON s.id = m.share_id
             WHERE s.code = ?3 AND m.id = ?4 AND m.author_id = ?5 AND m.created_at = ?6)
           ON CONFLICT(key) DO UPDATE SET count = count + 1`,
        )
        .bind(key, now + lifetime, code, message.id, authorId, now);
    const results = await this.db.batch<Record<string, unknown>>([
      this.db
        .prepare(
          `INSERT INTO messages (share_id, id, author_id, body, reply_to, carried_name, created_at)
           SELECT s.id, ?1, ?2, ?3,
                  -- Replies are one level deep: answering a reply joins the comment it answered.
                  (SELECT COALESCE(p.reply_to, p.id) FROM messages p WHERE p.share_id = s.id AND p.id = ?4),
                  NULL, ?5
           FROM shares s
           WHERE s.code = ?6 AND ${alive('s', '?5')}
             AND ${counted('?7')} < ?8
             AND ${counted('?9')} < ?10
             AND (SELECT COUNT(*) FROM messages c WHERE c.share_id = s.id) < ?11
             AND (?4 IS NULL OR EXISTS (SELECT 1 FROM messages p WHERE p.share_id = s.id AND p.id = ?4))
           ON CONFLICT(share_id, id) DO NOTHING`,
        )
        .bind(message.id, authorId, message.body, message.replyTo, now, code, minuteKey, RULES.repliesPerMinute, dayKey, RULES.repliesPerDay, RULES.messagesPerShare),
      // Counted only if the comment was written by this very call (same id, author and instant).
      bump(minuteKey, 2 * MINUTE),
      bump(dayKey, 2 * DAY),
      // What happened, so the caller can be told exactly.
      this.db
        .prepare(
          `SELECT s.id AS share_id,
                  (SELECT COUNT(*) FROM messages c WHERE c.share_id = s.id) AS total,
                  ${counted('?3')} AS in_minute, ${counted('?4')} AS in_day
           FROM shares s WHERE s.code = ?1 AND ${alive('s', '?2')}`,
        )
        .bind(code, now, minuteKey, dayKey),
      this.db
        .prepare('SELECT m.author_id, m.reply_to, m.created_at FROM messages m JOIN shares s ON s.id = m.share_id WHERE s.code = ?1 AND m.id = ?2')
        .bind(code, message.id),
    ]);
    const share = results[3]?.results[0];
    if (!share) return 'gone';
    const saved = results[4]?.results[0];
    if (saved) {
      // Saved now, or already there from an earlier attempt. Someone else's id is refused.
      if (saved.author_id !== authorId) return 'invalid';
      return { id: message.id, replyTo: (saved.reply_to as string | null) ?? null, createdAt: saved.created_at as number };
    }
    if ((share.in_minute as number) >= RULES.repliesPerMinute || (share.in_day as number) >= RULES.repliesPerDay) return 'too-many';
    if ((share.total as number) >= RULES.messagesPerShare) return 'full';
    // What is left: it answers a comment that is not in this conversation.
    return 'invalid';
  }

  /**
   * Removes one of your own comments. The first comment cannot be removed on
   * its own; stopping sharing is how the conversation is taken down. Removing
   * something already gone is not an error.
   */
  async deleteMessage(code: string, messageId: string, authorId: string, now: number): Promise<'ok' | Failure> {
    const results = await this.db.batch<Record<string, unknown>>([
      this.db
        .prepare(
          `DELETE FROM messages
           WHERE id = ?1 AND author_id = ?2
             AND share_id = (SELECT s.id FROM shares s WHERE s.code = ?3 AND ${alive('s', '?4')})
             AND id != (SELECT s.root_id FROM shares s WHERE s.code = ?3)`,
        )
        .bind(messageId, authorId, code, now),
      this.db.prepare(`SELECT s.root_id FROM shares s WHERE s.code = ?1 AND ${alive('s', '?2')}`).bind(code, now),
      this.db.prepare('SELECT m.author_id FROM messages m JOIN shares s ON s.id = m.share_id WHERE s.code = ?1 AND m.id = ?2').bind(code, messageId),
    ]);
    const share = results[1]?.results[0];
    if (!share) return 'gone';
    const left = results[2]?.results[0];
    if (!left) return 'ok';
    // Still there: it is either someone else's, or the first comment.
    return 'forbidden';
  }

  /**
   * Stops sharing: the link goes dead and the server's copy is deleted, replies
   * included. Only the owner may. Stopping something already stopped is fine.
   */
  async stopSharing(code: string, ownerId: string): Promise<'ok' | 'forbidden'> {
    const results = await this.db.batch<{ owner_id: string }>([
      this.db.prepare('DELETE FROM shares WHERE code = ?1 AND owner_id = ?2').bind(code, ownerId),
      this.db.prepare('SELECT owner_id FROM shares WHERE code = ?1').bind(code),
    ]);
    return results[1]?.results[0] ? 'forbidden' : 'ok';
  }

  /* ---------- Housekeeping ---------- */

  /**
   * Deletes what has run out: conversations past their deadline (replies
   * included, even if nobody visits again), ended sessions and old counters.
   * Run on a timer. Access is refused from the deadline on regardless of
   * whether this has run yet.
   */
  async sweep(now: number): Promise<{ shares: number; sessions: number; counters: number }> {
    const [shares, sessions, counters] = await this.db.batch([
      this.db.prepare('DELETE FROM shares WHERE expires_at IS NOT NULL AND expires_at <= ?1').bind(now),
      this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?1').bind(now),
      this.db.prepare('DELETE FROM counters WHERE expires_at <= ?1').bind(now),
    ]);
    return { shares: shares?.meta.changes ?? 0, sessions: sessions?.meta.changes ?? 0, counters: counters?.meta.changes ?? 0 };
  }
}
