import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { pinPosition, resolveAnchor, type PinPosition, type Resolution } from '@/lib/anchor';
import { getPageInfo, safeIconUrl, type PageInfo } from '@/lib/page';
import type { Thread } from '@/lib/types';

/**
 * The page currently shown in this tab. Single-page apps change the address
 * without loading a new document, so this watches for that too.
 */
export function usePage(): PageInfo | null {
  const [href, setHref] = useState(() => location.href);
  useEffect(() => {
    const check = () => setHref(location.href);
    const nav = (window as { navigation?: EventTarget }).navigation;
    window.addEventListener('popstate', check);
    window.addEventListener('hashchange', check);
    nav?.addEventListener('currententrychange', check);
    // Older browsers have no navigation events for pushState; look once a second.
    const poll = nav ? undefined : setInterval(check, 1000);
    return () => {
      window.removeEventListener('popstate', check);
      window.removeEventListener('hashchange', check);
      nav?.removeEventListener('currententrychange', check);
      clearInterval(poll);
    };
  }, []);
  // The key changes only when the page identity does, not for every tracking parameter.
  const info = getPageInfo(href);
  const key = info?.key ?? null;
  const ref = useRef(info);
  if (ref.current?.key !== key) ref.current = info;
  return ref.current;
}

/**
 * Re-renders the caller when the page scrolls, resizes or changes layout, at
 * most once per animation frame. Used to keep pins glued to their elements.
 */
export function useLayoutTick(active: boolean): number {
  const [tick, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const schedule = () => {
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          bump();
        });
      }
    };
    window.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    const resize = new ResizeObserver(schedule);
    resize.observe(document.documentElement);
    if (document.body) resize.observe(document.body);
    const mutation = new MutationObserver(schedule);
    mutation.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
      resize.disconnect();
      mutation.disconnect();
    };
  }, [active]);
  return tick;
}

export interface Located {
  status: 'found' | 'unavailable';
  element?: Element;
  position?: PinPosition;
}

/**
 * Finds the element for each conversation on this page and keeps looking as
 * the page changes. Elements are searched for again when the page's structure
 * changes; positions are simply re-read from the element on every layout tick.
 */
export function useAnchors(threads: Thread[]): Record<string, Located> {
  const cache = useRef(new Map<string, { anchorJson: string; result: Resolution }>());
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const tick = useLayoutTick(threads.length > 0);

  const resolveAll = useCallback(
    (force: boolean) => {
      const next = new Map<string, { anchorJson: string; result: Resolution }>();
      for (const thread of threads) {
        const anchorJson = JSON.stringify(thread.anchor);
        const known = cache.current.get(thread.id);
        const stillGood =
          !force && known && known.anchorJson === anchorJson && known.result.status === 'found' && known.result.element.isConnected;
        next.set(thread.id, stillGood ? known : { anchorJson, result: resolveAnchor(thread.anchor) });
      }
      cache.current = next;
      bump();
    },
    [threads],
  );

  // Conversations changed (new page, new comment, reattached): resolve now.
  useEffect(() => resolveAll(false), [resolveAll]);

  // The page's structure changed: resolve again, at most a few times a second.
  useEffect(() => {
    if (threads.length === 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      timer ??= setTimeout(() => {
        timer = undefined;
        resolveAll(true);
      }, 300);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [threads.length, resolveAll]);

  void tick; // positions below are re-read on every tick
  const located: Record<string, Located> = {};
  for (const thread of threads) {
    const result = cache.current.get(thread.id)?.result;
    if (result?.status === 'found' && result.element.isConnected) {
      located[thread.id] = { status: 'found', element: result.element, position: pinPosition(result.element, thread.anchor.offset) };
    } else if (result) {
      located[thread.id] = { status: 'unavailable' };
    }
  }
  return located;
}

/**
 * Runs `handler` for Escape, wherever the keyboard focus is. The handler is
 * told whether focus is inside Blob and returns true if it used the key press;
 * otherwise the page receives Escape as usual.
 */
export function useEscape(active: boolean, handler: (inBlob: boolean) => boolean, host: Element): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (!latest.current(event.composedPath().includes(host))) return;
      event.preventDefault();
      event.stopPropagation();
    };
    // Capture on window so it works whether focus is in the page or in Blob.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, host]);
}

/**
 * The icon the page itself declares (the one in its browser tab), or the
 * website's default `/favicon.ico`. Read from the page each time; never saved.
 */
export function pageIcon(doc: Document = document): string | undefined {
  const links = Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel~="icon" i][href]'));
  // Prefer one declared at a size close to the 24px it is shown at.
  const sized = links.find((link) => /(^|\s)(32x32|48x48|any)(\s|$)/i.test(link.getAttribute('sizes') ?? ''));
  const chosen = sized ?? links[0];
  return safeIconUrl(chosen ? chosen.href : `${doc.location.origin}/favicon.ico`);
}
