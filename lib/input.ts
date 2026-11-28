/**
 * Checks for untrusted input that both sides use: the extension's background
 * (lib/messages.ts) and the sharing server (worker/api). Keeping them here
 * means a comment or an anchor is judged by the same rules wherever it arrives.
 *
 * Nothing in this file touches the browser, storage or the network.
 */

import { LIMITS, type AnchorAttr, type AnchorDescriptor } from './types';

const ID = /^[A-Za-z0-9_-]{8,64}$/;
const ATTRS: AnchorAttr[] = ['role', 'type', 'name', 'href', 'alt', 'ariaLabel', 'testId'];

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Ids are made by Blob (random, URL-safe). Anything else is refused. */
export const isId = (v: unknown): v is string => typeof v === 'string' && ID.test(v);

export const str = (v: unknown, max: number): string | undefined =>
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
