import { useEffect, useState } from 'react';
import type { Request, Response } from '@/lib/messages';
import { getPageInfo, hostLabel, originPattern, type PageInfo } from '@/lib/page';
import { groupBySite, plural, type SiteGroup } from '@/overlay/format';
import { KEYS, migrate } from '@/lib/storage/store';
import { Icon, icons } from '@/overlay/ui';

type Status =
  | { kind: 'loading' }
  /** A page Chrome does not let extensions touch, or not a web page at all. */
  | { kind: 'unsupported' }
  | { kind: 'ready'; tabId: number; page: PageInfo; lasting: boolean; showing: boolean };

type Note = { tone: 'info' | 'error'; title: string; body: string } | null;

const ask = async (request: Request): Promise<Response> =>
  ((await browser.runtime.sendMessage(request).catch((error: unknown) => ({ ok: false, error: 'storage-failed', message: String(error) }))) as Response) ?? {
    ok: false,
    error: 'storage-failed',
  };

const isShowing = (tabId: number) =>
  browser.tabs.sendMessage(tabId, { type: 'overlay/ping' }).then(
    (reply) => Boolean((reply as { ok?: boolean } | undefined)?.ok),
    () => false,
  );

async function readStatus(): Promise<Status> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const page = tab?.url ? getPageInfo(tab.url) : null;
  if (!tab?.id || !page) return { kind: 'unsupported' };
  const [lasting, showing] = await Promise.all([
    browser.permissions.contains({ origins: [originPattern(page.origin)] }).catch(() => false),
    isShowing(tab.id),
  ]);
  return { kind: 'ready', tabId: tab.id, page, lasting, showing };
}

export function Popup() {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState(false);
  const [sites, setSites] = useState<SiteGroup[]>([]);

  useEffect(() => {
    void readStatus().then(setStatus, () => setStatus({ kind: 'unsupported' }));
    void browser.storage.local.get(KEYS.data).then((raw) => {
      try {
        setSites(groupBySite(migrate(raw[KEYS.data])));
      } catch {
        setSites([]);
      }
    });
  }, []);

  if (status.kind === 'loading') return <main className="popup" aria-busy="true" />;

  const host = status.kind === 'ready' ? hostLabel(status.page.origin) : '';

  const openBlob = async () => {
    if (status.kind !== 'ready') return;
    setBusy(true);
    setNote(null);
    const ok = status.showing
      ? await browser.tabs.sendMessage(status.tabId, { type: 'overlay/open' }).then(() => true, () => false)
      : (await ask({ type: 'tab/activate', tabId: status.tabId })).ok;
    setBusy(false);
    if (ok) window.close();
    else
      setNote({
        tone: 'error',
        title: 'Blob couldn’t start on this page',
        body: 'Chrome blocks extensions on some pages, such as PDFs, browser pages and a few protected sites. Nothing was changed.',
      });
  };

  const allowAlways = async () => {
    if (status.kind !== 'ready') return;
    setNote(null);
    // Must be the first thing that happens after the click, or Chrome refuses to ask.
    let granted = false;
    try {
      granted = await browser.permissions.request({ origins: [originPattern(status.page.origin)] });
    } catch {
      granted = false;
    }
    if (!granted) {
      setNote({
        tone: 'info',
        title: 'Access wasn’t granted',
        body: `Blob will stay off ${host} unless you click this toolbar button. You can still use it on this tab now.`,
      });
      return;
    }
    await ask({ type: 'tab/activate', tabId: status.tabId });
    setStatus({ ...status, lasting: true, showing: true });
    setNote({ tone: 'info', title: `Blob is on for ${host}`, body: 'It will appear whenever you visit this website.' });
  };

  const turnOff = async () => {
    if (status.kind !== 'ready') return;
    setBusy(true);
    const pattern = originPattern(status.page.origin);
    await ask({ type: 'site/disable', origin: pattern });
    const stillAllowed = await browser.permissions.contains({ origins: [pattern] }).catch(() => false);
    await browser.tabs.sendMessage(status.tabId, { type: 'overlay/unmount' }).catch(() => undefined);
    setBusy(false);
    setStatus({ ...status, lasting: stillAllowed, showing: false });
    setNote(
      stillAllowed
        ? {
            tone: 'error',
            title: 'Chrome still allows Blob here',
            body: 'This website’s access was granted in Chrome’s settings. Open Chrome’s extension settings for Blob to change it.',
          }
        : { tone: 'info', title: `Blob is off for ${host}`, body: 'Your saved comments are kept on this device.' },
    );
  };

  const hide = async () => {
    if (status.kind !== 'ready') return;
    await browser.tabs.sendMessage(status.tabId, { type: 'overlay/unmount' }).catch(() => undefined);
    setStatus({ ...status, showing: false });
  };

  const total = sites.reduce((sum, site) => sum + site.count, 0);

  return (
    <main className="popup">
      <header className="popup__header">
        <Icon svg={icons.mascot} />
        <h1>Blob</h1>
      </header>

      {status.kind === 'unsupported' ? (
        <section className="notice" role="status">
          <p className="strong">Blob can’t run on this page</p>
          <p>
            Chrome doesn’t let extensions add comments to browser pages, the Chrome Web Store, PDFs or local files. Open an
            ordinary website and click this button again.
          </p>
        </section>
      ) : (
        <>
          <section className="site">
            <span className="site__tile" aria-hidden="true">
              {host[0]?.toUpperCase()}
            </span>
            <span className="site__text">
              <span className="strong clip">{host}</span>
              <span className="muted clip">
                {status.lasting ? 'Blob appears here automatically' : status.showing ? 'On this tab only' : 'Blob is not on this page'}
              </span>
            </span>
          </section>

          <button type="button" className="btn btn--primary" onClick={() => void openBlob()} disabled={busy}>
            {status.showing ? 'Open Blob' : 'Use Blob on this page'}
          </button>

          {status.lasting ? (
            <button type="button" className="btn btn--outline" onClick={() => void turnOff()} disabled={busy}>
              Turn off for {host}
            </button>
          ) : (
            <>
              <button type="button" className="btn btn--soft" onClick={() => void allowAlways()} disabled={busy}>
                Always show on {host}
              </button>
              <p className="muted small">
                Without this, Blob stays only until you leave or reload the page. Chrome will ask you to confirm access to this
                one website.
              </p>
              {status.showing && (
                <button type="button" className="btn btn--text" onClick={() => void hide()}>
                  Hide Blob on this tab
                </button>
              )}
            </>
          )}
        </>
      )}

      {note && (
        <section className={`notice ${note.tone === 'error' ? 'notice--error' : ''}`} role={note.tone === 'error' ? 'alert' : 'status'}>
          <p className="strong">{note.title}</p>
          <p>{note.body}</p>
        </section>
      )}

      <section className="saved" aria-label="Your saved comments">
        <p className="strong">
          {total === 0 ? 'No comments yet' : `${plural(total, 'conversation')} on ${plural(sites.length, 'website')}`}
        </p>
        <p className="muted small">Only you · Stored on this device. Not backed up; removing Blob deletes them.</p>
        {sites.slice(0, 5).map((site) => (
          <a key={site.origin} className="saved__row" href={site.pages[0]?.page.url ?? site.origin} target="_blank" rel="noopener noreferrer">
            <span className="clip">{site.host}</span>
            <span className="muted">{site.count}</span>
          </a>
        ))}
      </section>
    </main>
  );
}
