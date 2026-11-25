/**
 * Anchoring: describing the element a comment is pinned to, and finding it again.
 *
 * This module knows nothing about storage or rendering. It takes DOM elements
 * in and gives plain data out (`describeElement`), or plain data in and an
 * element out (`resolveAnchor`).
 *
 * The guiding rule: an honest "Location unavailable" beats a confident pin on
 * the wrong element.
 */

import { LIMITS, type AnchorAttr, type AnchorDescriptor } from '../types';

export type Resolution =
  | { status: 'found'; element: Element }
  | { status: 'unavailable'; reason: 'missing' | 'ambiguous' };

/** The custom element that hosts Blob's own UI. Never a valid target. */
export const OVERLAY_TAG = 'blob-overlay';

const SKIP_TEXT_IN = new Set(['script', 'style', 'noscript', 'template', 'textarea', 'select', 'input', 'option']);

const KIND: Record<string, string> = {
  a: 'Link', button: 'Button', img: 'Image', picture: 'Image', svg: 'Graphic', video: 'Video',
  input: 'Field', textarea: 'Text field', select: 'Menu', label: 'Label', form: 'Form',
  h1: 'Heading', h2: 'Heading', h3: 'Heading', h4: 'Heading', h5: 'Heading', h6: 'Heading',
  p: 'Paragraph', li: 'List item', ul: 'List', ol: 'List', table: 'Table', figure: 'Figure',
  nav: 'Navigation', header: 'Header', footer: 'Footer', main: 'Main content', aside: 'Sidebar',
  section: 'Section', article: 'Article', blockquote: 'Quote', code: 'Code', pre: 'Code',
};

const tagOf = (el: Element) => el.localName.toLowerCase();

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

function isEditable(el: Element): boolean {
  const value = el.getAttribute('contenteditable');
  return value !== null && value.toLowerCase() !== 'false';
}

/**
 * True for anything a person types into: form controls and editable regions.
 * Blob may pin a comment to these, but never reads what is inside them.
 */
export function isPrivateField(el: Element): boolean {
  const tag = tagOf(el);
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  for (let cur: Element | null = el; cur; cur = cur.parentElement) if (isEditable(cur)) return true;
  return false;
}

/** The element's visible text, skipping form controls, editable regions and code. */
function readText(el: Element, max: number): string | undefined {
  if (isPrivateField(el)) return undefined;
  let out = '';
  const walk = (node: Node): void => {
    if (out.length > max * 3) return;
    if (node.nodeType === 3) {
      out += node.nodeValue ?? '';
      return;
    }
    if (node.nodeType !== 1) return;
    const child = node as Element;
    if (SKIP_TEXT_IN.has(tagOf(child)) || isEditable(child) || tagOf(child) === OVERLAY_TAG) return;
    out += ' ';
    child.childNodes.forEach(walk);
  };
  el.childNodes.forEach(walk);
  const text = squash(out);
  return text ? text.slice(0, max) : undefined;
}

/** Ids and class names made by build tools change between visits; ignore them. */
function looksStable(token: string): boolean {
  if (!token || token.length > 64) return false;
  if (/^[:_\d]/.test(token)) return false;
  if (/\d{3,}/.test(token)) return false;
  if (/^(radix-|headlessui-|react-aria|mui-|ember|css-|sc-|jsx-|svelte-|astro-)/i.test(token)) return false;
  if (/(?=[a-f0-9]*\d)[a-f0-9]{7,}/i.test(token)) return false;
  if (/[A-Za-z0-9]+_{2}[A-Za-z0-9_-]{5,}$/.test(token) && /\d/.test(token)) return false;
  return true;
}

function cssEscape(value: string): string {
  const native = (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS?.escape;
  if (native) return native(value);
  return value.replace(/^(\d)/, '\\3$1 ').replace(/[^\w-]/g, '\\$&');
}

function safeQueryAll(root: ParentNode, selector: string): Element[] {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}

function buildSelector(el: Element): string {
  const doc = el.ownerDocument;
  const parts: string[] = [];
  for (let cur: Element | null = el; cur && cur !== doc.documentElement; cur = cur.parentElement) {
    if (cur.id && looksStable(cur.id) && safeQueryAll(doc, `#${cssEscape(cur.id)}`).length === 1) {
      parts.unshift(`#${cssEscape(cur.id)}`);
      break;
    }
    const tag = cssEscape(tagOf(cur));
    const parent: Element | null = cur.parentElement;
    const twins = parent ? Array.from(parent.children).filter((c) => tagOf(c) === tagOf(cur!)) : [cur];
    parts.unshift(twins.length > 1 ? `${tag}:nth-of-type(${twins.indexOf(cur) + 1})` : tag);
  }
  return parts.join(' > ').slice(0, LIMITS.selector);
}

/** Text of the nearest heading that introduces the element, if there is one. */
function contextOf(el: Element): string | undefined {
  const body = el.ownerDocument.body;
  let depth = 0;
  for (let cur = el.parentElement; cur && cur !== body && depth < 6; cur = cur.parentElement, depth++) {
    const heading = cur.querySelector('h1,h2,h3,h4,h5,h6,[role="heading"],legend,caption,figcaption');
    if (heading && heading !== el && !el.contains(heading)) {
      return readText(heading, LIMITS.anchorContext);
    }
  }
  return undefined;
}

function readAttrs(el: Element): Partial<Record<AnchorAttr, string>> {
  const attrs: Partial<Record<AnchorAttr, string>> = {};
  const put = (key: AnchorAttr, value: string | null | undefined) => {
    const text = value ? squash(value).slice(0, 120) : '';
    if (text) attrs[key] = text;
  };
  put('role', el.getAttribute('role'));
  put('type', el.getAttribute('type'));
  put('name', el.getAttribute('name'));
  put('alt', el.getAttribute('alt'));
  put('ariaLabel', el.getAttribute('aria-label'));
  put('testId', el.getAttribute('data-testid') ?? el.getAttribute('data-test') ?? el.getAttribute('data-cy'));
  const href = el.getAttribute('href');
  if (href && tagOf(el) === 'a') {
    // Keep only the path. Query strings and hashes can carry tokens.
    try {
      put('href', new URL(href, el.ownerDocument.baseURI).pathname);
    } catch {
      /* not a usable link */
    }
  }
  return attrs;
}

function stableClasses(el: Element): string[] {
  const value = el.getAttribute('class') ?? '';
  return value.split(/\s+/).filter(looksStable).slice(0, 3);
}

function labelFor(el: Element, text: string | undefined, attrs: Partial<Record<AnchorAttr, string>>): string {
  const tag = tagOf(el);
  let kind = KIND[tag] ?? (attrs.role ? attrs.role[0]!.toUpperCase() + attrs.role.slice(1) : 'Element');
  if (tag === 'input') {
    const type = (attrs.type ?? 'text').toLowerCase();
    kind = type === 'password' ? 'Password field' : type === 'checkbox' ? 'Checkbox' : type === 'radio' ? 'Radio button' : type === 'submit' || type === 'button' ? 'Button' : 'Field';
  }
  const name = attrs.ariaLabel ?? attrs.alt ?? text;
  if (!name) return kind;
  const short = name.length > 40 ? `${name.slice(0, 39)}…` : name;
  return `${kind} “${short}”`.slice(0, LIMITS.label);
}

const round = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000;

/**
 * Describes an element so it can be found again later.
 * `point` is where the person clicked, in viewport coordinates.
 */
export function describeElement(el: Element, point?: { x: number; y: number }): AnchorDescriptor {
  const text = readText(el, LIMITS.anchorText);
  const attrs = readAttrs(el);
  const classes = stableClasses(el);
  const rect = el.getBoundingClientRect();
  // Small targets get the pin on their top-right corner, like the design.
  // Large ones keep the exact spot that was clicked.
  const compact = rect.width <= 320 && rect.height <= 120;
  const offset =
    !point || compact || rect.width === 0 || rect.height === 0
      ? { x: 1, y: 0 }
      : { x: round((point.x - rect.left) / rect.width), y: round((point.y - rect.top) / rect.height) };

  const descriptor: AnchorDescriptor = {
    selector: buildSelector(el),
    tag: tagOf(el),
    label: labelFor(el, text, attrs),
    offset,
  };
  if (el.id && looksStable(el.id)) descriptor.id = el.id;
  if (text) descriptor.text = text;
  const context = contextOf(el);
  if (context) descriptor.context = context;
  if (Object.keys(attrs).length) descriptor.attrs = attrs;
  if (classes.length) descriptor.classes = classes;
  return descriptor;
}

function wordOverlap(a: string, b: string): number {
  const wa = new Set(a.toLowerCase().split(' '));
  const wb = new Set(b.toLowerCase().split(' '));
  let shared = 0;
  wa.forEach((w) => wb.has(w) && shared++);
  return shared / (wa.size + wb.size - shared || 1);
}

/** How well an element matches a description: 0 (no) to 1 (every recorded detail agrees). */
function matchScore(el: Element, d: AnchorDescriptor): { score: number; weight: number } {
  if (tagOf(el) !== d.tag) return { score: 0, weight: 1 };
  let got = 0;
  let weight = 0;
  if (d.text) {
    weight += 5;
    const text = readText(el, LIMITS.anchorText);
    if (text === d.text) got += 5;
    else if (text) got += 5 * wordOverlap(text, d.text) * 0.9;
  }
  if (d.id) {
    weight += 4;
    if (el.id === d.id) got += 4;
  }
  if (d.attrs) {
    const now = readAttrs(el);
    for (const key of Object.keys(d.attrs) as AnchorAttr[]) {
      weight += 2;
      if (now[key] === d.attrs[key]) got += 2;
    }
  }
  if (d.classes?.length) {
    weight += 2;
    const now = new Set((el.getAttribute('class') ?? '').split(/\s+/));
    got += (2 * d.classes.filter((c) => now.has(c)).length) / d.classes.length;
  }
  return { score: weight ? got / weight : 0, weight };
}

/** Is there anything distinctive enough to search the whole page for? */
function isSearchable(d: AnchorDescriptor): boolean {
  if (d.id) return true;
  if (d.text && d.text.length >= 3) return true;
  const a = d.attrs;
  return Boolean(a && (a.ariaLabel || a.alt || a.href || a.name || a.testId));
}

/** Finds the element a description refers to, or reports that it cannot. */
export function resolveAnchor(d: AnchorDescriptor, doc: Document = document): Resolution {
  const direct = safeQueryAll(doc, d.selector)[0];
  if (direct && tagOf(direct) === d.tag) {
    const { score, weight } = matchScore(direct, d);
    // Same place in the page and the details still agree. If a heading was
    // recorded it must still agree too: otherwise a reordered list would put
    // the pin on a look-alike.
    const contextAgrees = !d.context || contextOf(direct) === d.context;
    if (weight === 0 || (score >= 0.6 && contextAgrees)) return { status: 'found', element: direct };
  }

  if (!isSearchable(d)) return { status: 'unavailable', reason: 'missing' };

  // The element is no longer where it was. Look for it elsewhere on the page.
  const candidates = safeQueryAll(doc, cssEscape(d.tag))
    .slice(0, 5000)
    .filter((el) => !el.closest(OVERLAY_TAG))
    .map((el) => ({ el, score: matchScore(el, d).score }))
    .filter((c) => c.score >= 0.8);
  if (candidates.length === 0) return { status: 'unavailable', reason: 'missing' };

  const best = Math.max(...candidates.map((c) => c.score));
  let top = candidates.filter((c) => c.score >= best - 0.001);
  if (top.length > 1 && d.context) {
    const sameContext = top.filter((c) => contextOf(c.el) === d.context);
    if (sameContext.length > 0) top = sameContext;
  }
  if (top.length === 1) return { status: 'found', element: top[0]!.el };
  // Several look-alikes and no way to tell them apart.
  return { status: 'unavailable', reason: 'ambiguous' };
}

export interface PinPosition {
  x: number;
  y: number;
  /** False when the element takes up no space (for example `display: none`). */
  visible: boolean;
}

/** Where to draw the pin, in viewport coordinates, from the element's current box. */
export function pinPosition(el: Element, offset: { x: number; y: number }): PinPosition {
  const rect = el.getBoundingClientRect();
  return {
    x: rect.left + rect.width * offset.x,
    y: rect.top + rect.height * offset.y,
    visible: rect.width > 0 || rect.height > 0,
  };
}
