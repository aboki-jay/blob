import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { OVERLAY_TAG } from '@/lib/anchor';
import { Icon, icons } from './ui';

/**
 * The Blob tab: how Blob sits on a page when the drawer is closed.
 *
 * It is docked to the left or right edge of the window. At rest it is tucked
 * part of the way off screen, with the mascot peeking out. It slides out when
 * the pointer comes near, when it has keyboard focus, and for a moment when it
 * first appears. Click it to open the drawer; drag it up and down the edge, or
 * across to the other edge.
 *
 * The shape follows the Figma frame "The drawer/white" (a 1:2 tab with the
 * outward corners rounded), drawn at about half that frame's size.
 */

export type Side = 'left' | 'right';

/** Must match the sizes in launcher.css. */
const WIDTH = 48;
const HEIGHT = 96;
const EDGE = 8;
/** How close the pointer must come, in px, before the tab slides out. */
const NEAR = 120;
const DRAG_THRESHOLD = 5;
/** How long the tab stays out when it first appears. */
const HELLO_MS = 2600;
/** Room left for a scrollbar that is drawn over the page instead of beside it. */
const OVERLAY_SCROLLBAR = 14;

const viewport = () => ({ w: document.documentElement.clientWidth || innerWidth, h: innerHeight });
const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), Math.max(min, max));

/** Which edge a saved position belongs to. No saved position means the right edge. */
export const sideOf = (position: { x: number; y: number } | null): Side => (position && position.x < 0.5 ? 'left' : 'right');

let overlayScrollbars: boolean | undefined;
/** True where scrollbars float over the content and take up no room of their own. */
function usesOverlayScrollbars(): boolean {
  if (overlayScrollbars === undefined) {
    const probe = document.createElement('div');
    // `all: initial` first: the page's own rules (borders, sizes) must not skew the measurement.
    probe.style.cssText =
      'all:initial!important;position:fixed!important;top:-200px!important;width:100px!important;height:100px!important;overflow:scroll!important;visibility:hidden!important';
    document.documentElement.append(probe);
    overlayScrollbars = probe.offsetWidth === probe.clientWidth;
    probe.remove();
  }
  return overlayScrollbars;
}

const scrollsVertically = (el: Element) =>
  el.scrollHeight > el.clientHeight + 1 && /(auto|scroll|overlay)/.test(getComputedStyle(el).overflowY);

/**
 * How far to keep the tab in from the window edge so that it never covers a
 * scrollbar. The window's own scrollbar is already outside the area Blob can
 * draw in; this finds the others: a scrollbar belonging to something on the
 * page that reaches the edge, and scrollbars that float over the content.
 */
function scrollbarInset(side: Side, y: number): number {
  const w = viewport().w;
  const x = side === 'right' ? w - 2 : 1;
  const atEdge = document.elementsFromPoint(x, y).find((el) => el.localName !== OVERLAY_TAG);
  for (let cur: Element | null | undefined = atEdge; cur && cur !== document.documentElement; cur = cur.parentElement) {
    if (!(cur instanceof HTMLElement) || !scrollsVertically(cur)) continue;
    const rect = cur.getBoundingClientRect();
    const reachesEdge = side === 'right' ? rect.right >= w - 1 : rect.left <= 1;
    if (!reachesEdge) continue;
    const style = getComputedStyle(cur);
    // A scrollbar sits on the right, or on the left where text runs right to left.
    if ((side === 'right') === (style.direction === 'rtl')) continue;
    const borders = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
    const bar = cur.offsetWidth - cur.clientWidth - borders;
    if (bar >= 1) return Math.ceil(bar);
    if (usesOverlayScrollbars()) return OVERLAY_SCROLLBAR;
  }
  const root = document.scrollingElement;
  const rootOnThisSide = (side === 'right') !== (getComputedStyle(document.documentElement).direction === 'rtl');
  if (root && rootOnThisSide && root.scrollHeight > root.clientHeight + 1 && usesOverlayScrollbars()) return OVERLAY_SCROLLBAR;
  return 0;
}

/**
 * The tab greets once per page load. It is put back every time the drawer
 * closes, and a greeting on every close would stop being a greeting.
 */
let greeted = false;

export function EdgeTab({
  position,
  count,
  onOpen,
  onMove,
  buttonRef,
}: {
  /** x: 0 for the left edge, 1 for the right. y: the tab's centre as a fraction of the window height. */
  position: { x: number; y: number } | null;
  count: number;
  onOpen: () => void;
  onMove: (position: { x: number; y: number }) => void;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const [vp, setVp] = useState(viewport);
  const [local, setLocal] = useState(position);
  const [near, setNear] = useState(false);
  const [hello, setHello] = useState(!greeted);
  const [dragging, setDragging] = useState(false);
  const [focused, setFocused] = useState(false);
  const [inset, setInset] = useState(0);
  const gesture = useRef<{ px: number; py: number; top: number; moved: boolean } | null>(null);
  const skipClick = useRef(false);

  useEffect(() => setLocal(position), [position]);

  const side = sideOf(local);
  const height = Math.min(HEIGHT, vp.h - EDGE * 2);
  const top = clamp((local?.y ?? 0.5) * vp.h - height / 2, EDGE, vp.h - height - EDGE);

  // Say hello the first time, then tuck away.
  useEffect(() => {
    if (greeted) return;
    greeted = true;
    const timer = setTimeout(() => setHello(false), HELLO_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onResize = () => setVp(viewport());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Stay clear of scrollbars. Pages change, so look again every so often.
  useEffect(() => {
    const measure = () => setInset(scrollbarInset(side, top + height / 2));
    measure();
    const timer = setInterval(measure, 1500);
    return () => clearInterval(timer);
  }, [side, top, height, vp.w]);

  // Slide out when the pointer comes near the tab's edge of the window.
  const zone = useRef({ side, top, height, w: vp.w });
  zone.current = { side, top, height, w: vp.w };
  useEffect(() => {
    let frame = 0;
    let last: { x: number; y: number } | null = null;
    const check = () => {
      frame = 0;
      if (!last) return setNear(false);
      const z = zone.current;
      const fromEdge = z.side === 'right' ? z.w - last.x : last.x;
      setNear(fromEdge <= NEAR && last.y >= z.top - 40 && last.y <= z.top + z.height + 40);
    };
    const onMove = (event: globalThis.PointerEvent) => {
      last = { x: event.clientX, y: event.clientY };
      frame ||= requestAnimationFrame(check);
    };
    const onLeave = () => {
      last = null;
      frame ||= requestAnimationFrame(check);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  const place = (nextSide: Side, nextTop: number) => {
    const t = clamp(nextTop, EDGE, vp.h - height - EDGE);
    return { x: nextSide === 'left' ? 0 : 1, y: (t + height / 2) / vp.h };
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { px: event.clientX, py: event.clientY, top, moved: false };
  };
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    if (!g) return;
    const dx = event.clientX - g.px;
    const dy = event.clientY - g.py;
    // A small wobble while clicking is still a click.
    if (!g.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    g.moved = true;
    setDragging(true);
    // Up and down follows the pointer; across snaps to whichever edge is nearer.
    setLocal(place(event.clientX < vp.w / 2 ? 'left' : 'right', g.top + dy));
  };
  const onPointerUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g?.moved) return;
    skipClick.current = true;
    setDragging(false);
    onMove(place(side, top));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    let next: { x: number; y: number } | null = null;
    if (event.key === 'ArrowUp') next = place(side, top - 24);
    else if (event.key === 'ArrowDown') next = place(side, top + 24);
    else if (event.key === 'ArrowLeft') next = place('left', top);
    else if (event.key === 'ArrowRight') next = place('right', top);
    if (!next) return;
    event.preventDefault();
    setLocal(next);
    onMove(next);
  };

  const out = near || hello || dragging || focused;

  return (
    // The slot is a window the tab slides behind: whatever is tucked away is
    // cut off at the slot's outer edge, so it never spills over a scrollbar.
    <div className={`edge-slot edge-slot--${side}`} style={{ top, height, width: WIDTH, [side]: inset }}>
      <button
        ref={buttonRef}
        type="button"
        className={`blob edge-tab edge-tab--${side} ${out ? 'edge-tab--out' : ''} ${dragging ? 'edge-tab--dragging' : ''}`}
        data-side={side}
        aria-label={count ? `Open Blob. ${count} open comment${count === 1 ? '' : 's'} on this page.` : 'Open Blob'}
        title="Blob: click to open, drag to move"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onClick={() => {
          if (skipClick.current) skipClick.current = false;
          else onOpen();
        }}
      >
        <Icon svg={icons.mascot} />
        {count > 0 && <span className="edge-tab__count">{count}</span>}
      </button>
    </div>
  );
}
