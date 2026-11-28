import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Lets something leave gracefully. Whatever is put inside stays on screen for
 * `ms` after it is taken away, marked `data-leaving` so the stylesheet can fade
 * it out, instead of vanishing in one frame.
 *
 * While leaving it cannot be clicked, focused or read by a screen reader. If
 * something new is put inside before the time is up, the old one goes at once:
 * there are never two.
 */
export function Leaving({ ms, inline, children }: { ms: number; inline?: boolean; children: ReactNode }) {
  const showing = children !== null && children !== undefined && children !== false;
  const last = useRef<ReactNode>(null);
  // True once the goodbye is over (and before anything was ever shown).
  const [gone, setGone] = useState(!showing);

  if (showing) last.current = children;
  // Shown again: adjust during this render, so the newcomer is never skipped.
  if (showing && gone) setGone(false);

  useEffect(() => {
    if (showing || gone) return;
    const timer = setTimeout(() => {
      last.current = null;
      setGone(true);
    }, ms);
    return () => clearTimeout(timer);
  }, [showing, gone, ms]);

  if (!showing && gone) return null;
  const leaving = !showing;
  const Wrapper = inline ? 'span' : 'div';
  return (
    // `display: contents` (see style.css): the wrapper takes no part in layout.
    <Wrapper className="presence" data-leaving={leaving ? '' : undefined} aria-hidden={leaving ? true : undefined} inert={leaving}>
      {showing ? children : last.current}
    </Wrapper>
  );
}
