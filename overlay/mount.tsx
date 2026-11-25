import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';
import { OVERLAY_TAG } from '@/lib/anchor';
import type { OverlayCommand } from '@/lib/messages';
import { isSupportedUrl } from '@/lib/page';
import { App } from './App';
import { setDisconnectHandler } from './client';
import { loadFonts } from './fonts';
import css from './style.css?inline';

const MOUNTED = '__blobOverlayMounted';
const REPLACE_EVENT = 'blob:replace';

/**
 * Puts Blob's UI on the page, once. Everything it adds (one element, its
 * listeners, its fonts) is removed again by the returned `unmount`.
 */
export function mountOverlay(): void {
  const scope = globalThis as Record<string, unknown>;
  // Already here and working (the script can be injected twice): nothing to do.
  // A copy that lost its connection to the extension does not count.
  try {
    if ((scope[MOUNTED] as (() => boolean) | undefined)?.()) return;
  } catch {
    /* the earlier copy is dead; carry on and replace it */
  }
  // Ordinary top-level HTML pages only. Not frames, PDFs or other documents.
  if (window.top !== window) return;
  if (!isSupportedUrl(location.href)) return;
  if (!/^(text\/html|application\/xhtml\+xml)$/.test(document.contentType)) return;

  // A copy left behind by an older version of the extension steps aside.
  document.querySelectorAll(OVERLAY_TAG).forEach((old) => {
    old.dispatchEvent(new CustomEvent(REPLACE_EVENT));
    old.remove();
  });

  const host = document.createElement(OVERLAY_TAG);
  // The Shadow Root keeps the website's styles out and Blob's styles in. It is
  // styling isolation only: scripts on the page can still reach inside it.
  const shadow = host.attachShadow({ mode: 'open' });
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    shadow.adoptedStyleSheets = [sheet];
  } catch {
    const style = document.createElement('style');
    style.textContent = css;
    shadow.append(style);
  }
  // A website's own rules could still hide or move the host element itself.
  for (const [name, value] of Object.entries({ display: 'block', position: 'fixed', inset: '0', 'z-index': '2147483647', 'pointer-events': 'none', visibility: 'visible', opacity: '1', transform: 'none', filter: 'none' })) {
    host.style.setProperty(name, value, 'important');
  }

  // Typing in Blob must not trigger the website's keyboard shortcuts.
  const stop = (event: Event) => event.stopPropagation();
  const TYPING = ['keydown', 'keyup', 'keypress', 'input', 'beforeinput', 'paste', 'copy', 'cut'];
  TYPING.forEach((type) => shadow.addEventListener(type, stop));

  const container = document.createElement('div');
  shadow.append(container);
  document.documentElement.append(host);

  // Some websites rebuild the page and drop unknown elements; put Blob back.
  const keeper = new MutationObserver(() => {
    if (!host.isConnected) document.documentElement.append(host);
  });
  keeper.observe(document.documentElement, { childList: true });

  const commands = new EventTarget();
  const removeFonts = loadFonts();
  const root = createRoot(container);

  const onMessage = (message: OverlayCommand, sender: { id?: string }, respond: (value: unknown) => void) => {
    if (sender.id !== browser.runtime.id) return;
    if (message?.type === 'overlay/ping') respond({ ok: true });
    else if (message?.type === 'overlay/open') {
      commands.dispatchEvent(new Event('open'));
      respond({ ok: true });
    } else if (message?.type === 'overlay/unmount') {
      respond({ ok: true });
      unmount();
    }
  };

  let mounted = true;
  const alive = () => mounted && host.isConnected && Boolean(browser.runtime?.id);

  function unmount(): void {
    if (!mounted) return;
    mounted = false;
    if (scope[MOUNTED] === alive) delete scope[MOUNTED];
    keeper.disconnect();
    try {
      browser.runtime.onMessage.removeListener(onMessage);
    } catch {
      /* the extension is already gone */
    }
    root.unmount(); // runs every component's cleanup: listeners, observers, timers
    removeFonts();
    host.remove();
  }

  host.addEventListener(REPLACE_EVENT, unmount);
  setDisconnectHandler(unmount);
  browser.runtime.onMessage.addListener(onMessage);
  scope[MOUNTED] = alive;

  root.render(<App host={host} commands={commands} onUnmount={unmount} />);
}
