import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { OVERLAY_TAG } from '@/lib/anchor';
import type { AnchorDescriptor } from '@/lib/types';
import { Feedback } from './feedback';
import { Avatar, Icon, StorageNote, icons } from './ui';

const viewport = () => ({ w: document.documentElement.clientWidth || innerWidth, h: innerHeight });
const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), Math.max(min, max));

/* ---------- The floating Blob button ---------- */

const BLOB = 56;
const EDGE = 8;
const DRAG_THRESHOLD = 5;

export function BlobButton({
  position,
  count,
  onOpen,
  onMove,
  buttonRef,
}: {
  position: { x: number; y: number } | null;
  count: number;
  onOpen: () => void;
  onMove: (position: { x: number; y: number }) => void;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const [vp, setVp] = useState(viewport);
  const [local, setLocal] = useState(position);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<{ px: number; py: number; left: number; top: number; moved: boolean } | null>(null);
  const skipClick = useRef(false);

  useEffect(() => setLocal(position), [position]);
  useEffect(() => {
    const onResize = () => setVp(viewport());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Stored as fractions of the viewport, then kept fully on screen at any size.
  const left = clamp(local ? local.x * vp.w - BLOB / 2 : vp.w - BLOB - 20, EDGE, vp.w - BLOB - EDGE);
  const top = clamp(local ? local.y * vp.h - BLOB / 2 : vp.h - BLOB - 84, EDGE, vp.h - BLOB - EDGE);

  const place = (nextLeft: number, nextTop: number) => {
    const l = clamp(nextLeft, EDGE, vp.w - BLOB - EDGE);
    const t = clamp(nextTop, EDGE, vp.h - BLOB - EDGE);
    return { x: (l + BLOB / 2) / vp.w, y: (t + BLOB / 2) / vp.h };
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { px: event.clientX, py: event.clientY, left, top, moved: false };
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
    setLocal(place(g.left + dx, g.top + dy));
  };
  const onPointerUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g?.moved) return;
    skipClick.current = true;
    setDragging(false);
    onMove(place(left, top));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = { ArrowLeft: [-24, 0], ArrowRight: [24, 0], ArrowUp: [0, -24], ArrowDown: [0, 24] }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = place(left + step[0]!, top + step[1]!);
    setLocal(next);
    onMove(next);
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`blob ${dragging ? 'blob--dragging' : ''}`}
      style={{ left, top }}
      aria-label={count ? `Open Blob. ${count} open comment${count === 1 ? '' : 's'} on this page.` : 'Open Blob'}
      title="Blob: click to open, drag to move"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onClick={() => {
        if (skipClick.current) skipClick.current = false;
        else onOpen();
      }}
    >
      <Icon svg={icons.mascot} />
      {count > 0 && <span className="blob__count">{count}</span>}
    </button>
  );
}

/* ---------- The drawer ---------- */

export type Section = 'activity' | 'history';

export function Drawer({
  tag,
  section,
  onSection,
  onClose,
  children,
}: {
  tag?: Element | null;
  section: Section | null;
  onSection: (section: Section) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [feedback, setFeedback] = useState(false);
  const [theme, setTheme] = useState('Light');
  const profile = useRef<HTMLDetailsElement>(null);
  const navigate = (next: Section) => {
    setFeedback(false);
    if (profile.current) profile.current.open = false;
    onSection(next);
  };
  useEffect(() => ref.current?.focus(), []);
  const rect = tag?.getBoundingClientRect();
  const tagStyle = rect ? {
    left: clamp(rect.left, 8, viewport().w - Math.min(450, viewport().w - 16) - 8),
    top: clamp(rect.bottom + 12, 8, viewport().h - Math.min(500, viewport().h - 16) - 8),
  } : undefined;
  return (
    <div ref={ref} className={tag ? 'drawer thread-tag' : 'drawer'} style={tagStyle} data-theme={theme} role="dialog" aria-label="Blob" tabIndex={-1}>
      <div className="drawer__header">
        <div className="drawer__title">
          <Icon svg={icons.mascot} />
          <span className="clip">{tag ? 'Comment' : 'Blob: Collaborative comment for webpage'}</span>
        </div>
        <button type="button" className="drawer__close" aria-label="Close Blob" onClick={onClose}>
          <Icon svg={icons.x} />
        </button>
      </div>
      <div className="drawer__body">
        {feedback ? <Feedback onBack={() => setFeedback(false)} /> : children}
        <nav className="rail" aria-label="Blob sections">
          <button
            type="button"
            className="rail__history"
            aria-label="History"
            title="History"
            aria-current={section === 'history' ? 'page' : undefined}
            disabled={section === null}
            onClick={() => navigate('history')}
          >
            <Icon svg={section === 'history' ? icons.historyActive : icons.history} />
          </button>
          <div className="rail__group">
            <Icon svg={icons.mascot} className="rail__mascot" />
            <button
              type="button"
              className="rail__item"
              aria-label="Comments on this website"
              title="Comments on this website"
              aria-current={section === 'activity' ? 'page' : undefined}
              disabled={section === null}
              onClick={() => navigate('activity')}
            >
              <span>
                <Icon svg={section === 'activity' ? icons.messageActive : icons.message} />
              </span>
            </button>
            <button
              type="button"
              className="rail__item"
              aria-label="Private rooms are not available yet"
              title="Private rooms are not available yet"
              aria-disabled="true"
            >
              <span>
                <Icon svg={icons.lock} />
              </span>
            </button>
          </div>
          <details className="profile" ref={profile}>
            <summary aria-label="Guest profile"><Avatar /></summary>
            <div className="profile-menu">
              <div className="profile-id"><Avatar small /><div><strong>Guest</strong><p>Stored on this device</p></div></div>
              <details className="profile-settings"><summary><Icon svg={icons.settings} />Settings</summary><StorageNote /></details>
              <button onClick={() => { setFeedback(true); if (profile.current) profile.current.open = false; }}>
                <Icon svg={icons.message} />Feedback
              </button>
              <div className="theme-choices" aria-label="Appearance">
                {['Dark', 'Light', 'System'].map(value => <button key={value} aria-pressed={theme === value}
                  onClick={() => setTheme(value)}>{value}</button>)}
              </div>
            </div>
          </details>
        </nav>
      </div>
    </div>
  );
}

/* ---------- Choosing an element on the page ---------- */

/** The page element under a point, ignoring Blob's own UI and the page background. */
function pageElementAt(x: number, y: number): Element | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (el.localName === OVERLAY_TAG) continue;
    if (el === document.documentElement || el === document.body) return null;
    return el;
  }
  return null;
}

const SCROLLS = new Set(['auto', 'scroll', 'overlay']);

/**
 * Scrolls whichever scrolling panel of the page lies under a point, as the
 * wheel would if Blob's layer were not in the way. Returns false when there is
 * none, which leaves the browser to scroll the page itself.
 */
function scrollPanelUnder(x: number, y: number, dx: number, dy: number): boolean {
  let el: Element | null = document.elementsFromPoint(x, y).find((found) => found.localName !== OVERLAY_TAG) ?? null;
  for (; el && el !== document.documentElement && el !== document.scrollingElement; el = el.parentElement) {
    const style = getComputedStyle(el);
    const left = SCROLLS.has(style.overflowX) && el.scrollWidth > el.clientWidth ? dx : 0;
    const top = SCROLLS.has(style.overflowY) && el.scrollHeight > el.clientHeight ? dy : 0;
    if (!left && !top) continue;
    const before = [el.scrollLeft, el.scrollTop];
    el.scrollBy({ left, top, behavior: 'instant' });
    // Already at its end: carry on to whatever contains it, as the browser does.
    if (el.scrollLeft !== before[0] || el.scrollTop !== before[1]) return true;
  }
  return false;
}

export function Picker({
  hint,
  onPick,
}: {
  hint: string;
  onPick: (element: Element, point?: { x: number; y: number }) => void;
}) {
  const [box, setBox] = useState<DOMRect | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const catcher = useRef<HTMLDivElement>(null);

  // The layer covers the page, so the wheel never reaches a panel that scrolls
  // on its own (common in web apps). Pass it on. The page itself needs no help:
  // the browser scrolls it from anywhere.
  useEffect(() => {
    const layer = catcher.current;
    if (!layer) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return; // pinch or Ctrl+wheel zoom
      const unit = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? window.innerHeight : 1;
      // Shift turns a vertical wheel into sideways scrolling.
      const [dx, dy] = event.shiftKey && !event.deltaX ? [event.deltaY, 0] : [event.deltaX, event.deltaY];
      if (scrollPanelUnder(event.clientX, event.clientY, dx * unit, dy * unit)) event.preventDefault();
    };
    layer.addEventListener('wheel', onWheel, { passive: false });
    return () => layer.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const refresh = () => {
      const p = pointer.current;
      setBox(p ? (pageElementAt(p.x, p.y)?.getBoundingClientRect() ?? null) : null);
    };
    // Keyboard route: Tab to something on the page, then press Enter.
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Enter') return;
      const focused = document.activeElement;
      if (!focused || focused === document.body || focused.localName === OVERLAY_TAG) return;
      event.preventDefault();
      event.stopPropagation();
      onPick(focused);
    };
    const onFocus = () => {
      const focused = document.activeElement;
      if (focused && focused !== document.body && focused.localName !== OVERLAY_TAG) {
        pointer.current = null;
        setBox(focused.getBoundingClientRect());
      }
    };
    window.addEventListener('scroll', refresh, { capture: true, passive: true });
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus);
    return () => {
      window.removeEventListener('scroll', refresh, { capture: true });
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocus);
    };
  }, [onPick]);

  const hintTop = box ? (box.top > 52 ? box.top - 44 : box.bottom + 8) : 0;

  return (
    <>
      {/* Sits over the whole page and takes every click, so nothing on the page is activated. */}
      <div
        ref={catcher}
        className="catcher"
        onPointerMove={(event) => {
          pointer.current = { x: event.clientX, y: event.clientY };
          setBox(pageElementAt(event.clientX, event.clientY)?.getBoundingClientRect() ?? null);
        }}
        onPointerLeave={() => {
          pointer.current = null;
          setBox(null);
        }}
        onClick={(event) => {
          const element = pageElementAt(event.clientX, event.clientY);
          if (element) onPick(element, { x: event.clientX, y: event.clientY });
        }}
      />
      {box && (
        <>
          <div className="outline" style={{ left: box.left, top: box.top, width: box.width, height: box.height }} />
          <div className="hint" style={{ left: clamp(box.left, 8, viewport().w - 240), top: hintTop }}>
            {hint}
          </div>
        </>
      )}
    </>
  );
}

/** The pill at the bottom of the page: a short status and one or two actions. */
export function Bar({ children, actions }: { children: ReactNode; actions: ReactNode }) {
  return (
    <div className="bar" role="status">
      <span className="accent medium clip">{children}</span>
      <span className="row" style={{ flexWrap: 'nowrap' }}>
        {actions}
      </span>
    </div>
  );
}

/**
 * Guest navigation while choosing a comment location (Figma "Bottom navigation").
 * Collapsed, it shows icons only, and a pill naming whatever is pointed at or
 * focused appears just under the bar. Expanded, the names are written out.
 */
export function GuestNav({ onExit, onResolved }: { onExit: () => void; onResolved: () => void }) {
  const [expanded, setExpanded] = useState(false);
  // The pill repeats what the item's label already says, so it is hidden from screen readers.
  const tip = (label: string) =>
    !expanded && (
      <span className="nav-tip" aria-hidden="true">
        {label}
      </span>
    );
  return (
    <nav className={`bar guest-nav ${expanded ? 'guest-nav--expanded' : ''}`} aria-label="Comment tools">
      <Icon svg={icons.mascot} className="nav-mascot" />
      <span className="nav-current nav-item" aria-label="Comment" aria-current="true">
        <Icon svg={icons.commentMode} />
        {expanded && 'Comment'}
        {tip('Comment')}
      </span>
      <button className="nav-item" disabled aria-label="Inbox unavailable for guests">
        <Icon svg={icons.message} />
        {tip('Inbox unavailable for guests')}
      </button>
      <button className="nav-item" aria-label="Resolved conversations" onClick={onResolved}>
        <Icon svg={icons.resolved} />
        {expanded && 'Resolved'}
        {tip('Resolved')}
      </button>
      <span className="nav-avatar nav-item" aria-label="Guest">
        <Avatar small />
        {tip('Guest')}
      </span>
      <button aria-label="Cancel" onClick={onExit}>
        Exit
      </button>
      <button className="nav-item" aria-expanded={expanded} aria-label={expanded ? 'Collapse tools' : 'Expand tools'} onClick={() => setExpanded(!expanded)}>
        <Icon svg={icons.chevron} />
        {tip('Expand')}
      </button>
    </nav>
  );
}

/** A ring around an element on the page. */
export function Outline({ element, pulse }: { element: Element; pulse?: boolean }) {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return <div className={`outline ${pulse ? 'outline--pulse' : ''}`} style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />;
}

/* ---------- Writing a new comment ---------- */

export type SavePhase = 'idle' | 'saving' | 'failed';

export function Composer({
  element,
  anchor,
  pageLabel,
  text,
  onText,
  phase,
  onSubmit,
  onClose,
}: {
  element: Element;
  anchor: AnchorDescriptor;
  pageLabel: string;
  text: string;
  onText: (text: string) => void;
  phase: SavePhase;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [height, setHeight] = useState(260);
  const [empty, setEmpty] = useState(false);

  useEffect(() => input.current?.focus(), []);
  useLayoutEffect(() => {
    if (ref.current) setHeight(ref.current.offsetHeight);
  });

  // Below the element if there is room, otherwise above, always on screen.
  const rect = element.getBoundingClientRect();
  const vp = viewport();
  const width = Math.min(450, vp.w - 16);
  const left = clamp(rect.left, 8, vp.w - width - 8);
  const below = rect.bottom + 12;
  const top = below + height <= vp.h - 8 ? below : clamp(rect.top - height - 12, 8, vp.h - height - 8);

  const submit = () => {
    if (!text.trim()) {
      setEmpty(true);
      input.current?.focus();
      return;
    }
    onSubmit();
  };

  const status = empty
    ? 'Write a comment first.'
    : phase === 'saving'
      ? 'Saving…'
      : phase === 'failed'
        ? 'Couldn’t save. Draft kept here.'
        : text.trim()
          ? 'Draft kept in this browser'
          : 'Stored on this device';

  return (
    <div ref={ref} className="composer" style={{ left, top }} role="dialog" aria-label="New comment">
      <div className="composer__header spread">
        <p className="medium">New comment</p>
        <button type="button" className="icon-btn" aria-label="Close new comment" onClick={onClose}>
          <Icon svg={icons.x} />
        </button>
      </div>
      <p className="composer__target clip" title={pageLabel}>Pinned to “{anchor.label}”</p>
      <div className="composer__entry">
        <span title="Only you · Guest"><Avatar small /><span className="sr-only">Only you · Guest</span></span>
        <textarea
          ref={input}
          rows={1}
          value={text}
          maxLength={5000}
          placeholder="Add a comment"
          aria-label="Comment"
          aria-invalid={empty}
          onChange={(event) => {
            setEmpty(false);
            onText(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <button type="button" className="send-arrow" onClick={submit} disabled={phase === 'saving'}
          aria-label={phase === 'failed' ? 'Try again' : 'Post comment'}><Icon svg={icons.sendArrow} /></button>
      </div>
      <p className={empty || phase !== 'idle' || text.trim() ? 'composer__status t12' : 'sr-only'} role="status">{status}</p>
    </div>
  );
}

/* ---------- Pins ---------- */

export function Pin({
  x,
  y,
  number,
  label,
  active,
  onOpen,
}: {
  x: number;
  y: number;
  number: number;
  label: string;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={`pin ${active ? 'pin--active' : ''}`}
      style={{ left: x, top: y }}
      aria-label={`Comment ${number} on ${label}. Open conversation.`}
      onClick={onOpen}
    >
      {number}
    </button>
  );
}
