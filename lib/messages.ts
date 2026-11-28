/**
 * The message API between Blob's UI and its background service worker.
 *
 * The page overlay and the popup never write storage themselves. They send one
 * of the requests below; the background checks it (`parseRequest`) and performs
 * it. Everything in a request is treated as untrusted input.
 */

import { LIMITS, REACTIONS, isTheme, type AnchorAttr, type AnchorDescriptor, type BlobSettings, type Reaction, type ThreadStatus } from './types';
import { FEEDBACK_MAX, RATINGS, type Rating } from './feedback';
import type { ErrorCode } from './storage/store';

export type Request =
  | { type: 'thread/create'; id: string; messageId: string; href: string; title: string; anchor: AnchorDescriptor; body: string }
  | { type: 'thread/reply'; threadId: string; messageId: string; body: string; replyTo?: string }
  | { type: 'thread/status'; threadId: string; status: ThreadStatus }
  /** Add (`on`) or take back one of the fixed reactions on a comment. */
  | { type: 'thread/react'; threadId: string; messageId: string; emoji: Reaction; on: boolean }
  | { type: 'thread/reattach'; threadId: string; anchor: AnchorDescriptor }
  | { type: 'thread/delete'; threadId: string }
  | { type: 'draft/set'; key: string; text: string }
  | { type: 'settings/set'; settings: Partial<BlobSettings> }
  /** Can feedback be sent from this copy of Blob? */
  | { type: 'feedback/status' }
  /** Send the feedback form to the Blob project. The only request that leaves the device. */
  | { type: 'feedback/send'; rating: Rating; text: string }
  /** Popup only: show Blob on a tab the person just clicked the toolbar button on. */
  | { type: 'tab/activate'; tabId: number }
  /** Popup only: stop showing Blob on a website. Saved comments are kept. */
  | { type: 'site/disable'; origin: string };

export type Response<T = unknown> = { ok: true; data: T } | { ok: false; error: ErrorCode; message?: string };

/** Messages the background or popup sends to the overlay in a tab. */
export type OverlayCommand = { type: 'overlay/ping' } | { type: 'overlay/open' } | { type: 'overlay/unmount' };

const ID = /^[A-Za-z0-9_-]{8,64}$/;
const DRAFT_KEY = /^(new|reply):.{1,2100}$/s;
const ATTRS: AnchorAttr[] = ['role', 'type', 'name', 'href', 'alt', 'ariaLabel', 'testId'];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === 'string' && ID.test(v);
const str = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v.slice(0, max) : undefined;

/** A comment must contain something other than whitespace. Returns the trimmed text. */
export function cleanBody(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const body = value.trim();
  if (!body || body.length > LIMITS.body) return null;
  return body;
}

/** Rebuilds an anchor from untrusted input, keeping only known fields within limits. */
export function parseAnchor(value: unknown): AnchorDescriptor | null {
  if (!isRecord(value)) return null;
  const selector = str(value.selector, LIMITS.selector);
  const tag = str(value.tag, 60);
  const label = str(value.label, LIMITS.label);
  const offset = value.offset;
  if (!selector || !tag || !label || !isRecord(offset)) return null;
  const { x, y } = offset;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;

  const anchor: AnchorDescriptor = {
    selector,
    tag: tag.toLowerCase(),
    label,
    offset: { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) },
  };
  const id = str(value.id, 64);
  if (id) anchor.id = id;
  const text = str(value.text, LIMITS.anchorText);
  if (text) anchor.text = text;
  const context = str(value.context, LIMITS.anchorContext);
  if (context) anchor.context = context;
  if (isRecord(value.attrs)) {
    const attrs: Partial<Record<AnchorAttr, string>> = {};
    for (const key of ATTRS) {
      const attr = str(value.attrs[key], 120);
      if (attr) attrs[key] = attr;
    }
    if (Object.keys(attrs).length) anchor.attrs = attrs;
  }
  if (Array.isArray(value.classes)) {
    const classes = value.classes.filter((c): c is string => typeof c === 'string' && c.length <= 64).slice(0, 3);
    if (classes.length) anchor.classes = classes;
  }
  return anchor;
}

/** Returns a checked request, or null if the message is not one Blob understands. */
export function parseRequest(raw: unknown): Request | null {
  if (!isRecord(raw) || typeof raw.type !== 'string') return null;
  switch (raw.type) {
    case 'thread/create': {
      const anchor = parseAnchor(raw.anchor);
      const body = cleanBody(raw.body);
      if (!isId(raw.id) || !isId(raw.messageId) || !anchor || !body) return null;
      if (typeof raw.href !== 'string' || raw.href.length > 4000) return null;
      const title = typeof raw.title === 'string' ? raw.title : '';
      return { type: raw.type, id: raw.id, messageId: raw.messageId, href: raw.href, title, anchor, body };
    }
    case 'thread/reply': {
      const body = cleanBody(raw.body);
      if (!isId(raw.threadId) || !isId(raw.messageId) || !body) return null;
      if (raw.replyTo !== undefined && !isId(raw.replyTo)) return null;
      const reply = { type: raw.type, threadId: raw.threadId, messageId: raw.messageId, body } as const;
      return raw.replyTo ? { ...reply, replyTo: raw.replyTo } : reply;
    }
    case 'thread/status':
      if (!isId(raw.threadId) || (raw.status !== 'open' && raw.status !== 'resolved')) return null;
      return { type: raw.type, threadId: raw.threadId, status: raw.status };
    case 'thread/react': {
      // Only the reactions Blob offers: never free text from the page.
      const emoji = REACTIONS.find((reaction) => reaction === raw.emoji);
      if (!isId(raw.threadId) || !isId(raw.messageId) || !emoji || typeof raw.on !== 'boolean') return null;
      return { type: raw.type, threadId: raw.threadId, messageId: raw.messageId, emoji, on: raw.on };
    }
    case 'thread/reattach': {
      const anchor = parseAnchor(raw.anchor);
      if (!isId(raw.threadId) || !anchor) return null;
      return { type: raw.type, threadId: raw.threadId, anchor };
    }
    case 'thread/delete':
      return isId(raw.threadId) ? { type: raw.type, threadId: raw.threadId } : null;
    case 'draft/set':
      if (typeof raw.key !== 'string' || !DRAFT_KEY.test(raw.key) || typeof raw.text !== 'string') return null;
      return { type: raw.type, key: raw.key, text: raw.text.slice(0, LIMITS.body) };
    case 'settings/set': {
      if (!isRecord(raw.settings)) return null;
      const settings: Partial<BlobSettings> = {};
      if ('theme' in raw.settings) {
        if (!isTheme(raw.settings.theme)) return null;
        settings.theme = raw.settings.theme;
      }
      if (typeof raw.settings.onboarded === 'boolean') settings.onboarded = raw.settings.onboarded;
      const pos = raw.settings.blobPosition;
      if (isRecord(pos) && typeof pos.x === 'number' && typeof pos.y === 'number') {
        settings.blobPosition = { x: pos.x, y: pos.y };
      }
      return { type: raw.type, settings };
    }
    case 'feedback/status':
      return { type: raw.type };
    case 'feedback/send': {
      const rating = raw.rating === undefined ? '' : raw.rating;
      if (rating !== '' && !(RATINGS as readonly unknown[]).includes(rating)) return null;
      if (raw.text !== undefined && typeof raw.text !== 'string') return null;
      const text = (raw.text ?? '').trim();
      // Something must be said: a rating, some text, or both.
      if (text.length > FEEDBACK_MAX || (!rating && !text)) return null;
      return { type: raw.type, rating: rating as Rating, text };
    }
    case 'tab/activate':
      return typeof raw.tabId === 'number' && Number.isInteger(raw.tabId) ? { type: raw.type, tabId: raw.tabId } : null;
    case 'site/disable':
      return typeof raw.origin === 'string' && raw.origin.length < 300 ? { type: raw.type, origin: raw.origin } : null;
    default:
      return null;
  }
}

/** A fresh id for a conversation or message. Made once per attempt, so a retry reuses it. */
export function newId(): string {
  return crypto.randomUUID();
}
