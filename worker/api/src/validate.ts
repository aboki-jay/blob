/**
 * Checks everything the server is sent. The extension and the web page are
 * never trusted to have checked it already: the same rules are applied again
 * here (they are shared with the extension, in lib/input.ts and lib/page.ts).
 */

import { cleanBody, isId, isRecord, parseAnchor } from '../../../lib/input';
import { cleanTitle, getPageInfo } from '../../../lib/page';
import { RULES, type NewMessage, type NewShare } from './store';

export const NAME_MAX = 60;

/** A display name: plain text, one line, not empty. */
export function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.replace(/\s+/g, ' ').trim();
  return name && name.length <= NAME_MAX ? name : null;
}

/** A session secret or link code as the server makes them: URL-safe, of a sensible length. */
export const isToken = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{20,100}$/.test(value);

/** A reply to an existing shared conversation. */
export function parseReply(raw: unknown): { id: string; body: string; replyTo: string | null } | null {
  if (!isRecord(raw)) return null;
  const body = cleanBody(raw.body);
  if (!isId(raw.id) || !body) return null;
  if (raw.replyTo !== undefined && raw.replyTo !== null && !isId(raw.replyTo)) return null;
  return { id: raw.id, body, replyTo: (raw.replyTo as string | undefined) ?? null };
}

/**
 * A conversation being shared. Returns it cleaned, or null if it is not
 * acceptable. `now` is used for the deadline and to stop comments being dated
 * in the future.
 */
export function parseNewShare(raw: unknown, now: number): NewShare | null {
  if (!isRecord(raw) || !isId(raw.id) || !isRecord(raw.page)) return null;

  // The page's address goes through the same sanitising as on the device, so
  // credentials and session tokens cannot reach the server even from a client
  // that skipped it.
  const page = typeof raw.page.url === 'string' && raw.page.url.length <= 4000 ? getPageInfo(raw.page.url) : null;
  const anchor = parseAnchor(raw.anchor);
  if (!page || !anchor) return null;

  if (typeof raw.expires !== 'string' || !(raw.expires in RULES.expiry)) return null;
  const lifetime = RULES.expiry[raw.expires];
  const expiresAt = lifetime === null || lifetime === undefined ? null : now + lifetime;

  if (!Array.isArray(raw.messages) || raw.messages.length < 1 || raw.messages.length > RULES.messagesAtCreation) return null;
  const messages: NewMessage[] = [];
  /** For each comment seen so far: the comment its replies should hang under. */
  const group = new Map<string, string>();
  for (const item of raw.messages) {
    if (!isRecord(item) || !isId(item.id) || group.has(item.id)) return null;
    const body = cleanBody(item.body);
    if (!body) return null;
    const createdAt = typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? Math.min(Math.max(0, Math.floor(item.createdAt)), now) : now;
    let carriedName: string | null = null;
    if (item.carriedName !== undefined && item.carriedName !== null) {
      carriedName = cleanName(item.carriedName);
      if (!carriedName) return null;
    }
    // A reply must answer a comment that came earlier in this same upload.
    // Replies are one level deep, as they are on the device.
    const replyTo = isId(item.replyTo) ? (group.get(item.replyTo) ?? null) : null;
    group.set(item.id, replyTo ?? item.id);
    messages.push({ id: item.id, body, replyTo, createdAt, carriedName });
  }
  // The first comment is the owner's own and starts the conversation.
  const first = messages[0]!;
  if (first.carriedName || first.replyTo) return null;

  const title = typeof raw.page.title === 'string' ? cleanTitle(raw.page.title) : '';
  return { id: raw.id, pageUrl: page.url, pageTitle: title, anchor, expiresAt, messages };
}
