import avatarBody from '@/assets/icons/avatar-body.svg?raw';
import avatarHead from '@/assets/icons/avatar-head.svg?raw';
import check from '@/assets/icons/check.svg?raw';
import externalLink from '@/assets/icons/external-link.svg?raw';
import logIn from '@/assets/icons/log-in.svg?raw';
import warningArt from '@/assets/icons/warning.svg?raw';
import { useEffect, useState } from 'react';
import type { Request, Response } from '@/lib/messages';
import { cleanTitle, getPageInfo, hostLabel, originPattern, safeIconUrl, type PageInfo } from '@/lib/page';
import { groupBySite, type SiteGroup } from '@/overlay/format';
import { KEYS, migrate, parseSettings } from '@/lib/storage/store';
import { Icon, SiteTile, icons } from '@/overlay/ui';

/**
 * The toolbar popup, from the Figma section "Chrome popup" (guest frame).
 *
 * The first time it is opened it shows the welcome screen (Figma "Main/welcome"):
 * sign in, or continue as a guest. After that it does three things: puts Blob on
 * the page you are looking at, lets you choose "Always show" for that one
 * website, and lists the websites you have commented on. Signing in is in the
 * design but not built, so "Sign in" and "Login" are shown switched off.
 */

type Status =
  | { kind: 'loading' }
  /** A page Chrome does not let extensions touch, or not a web page at all. */
  | { kind: 'unsupported' }
  | { kind: 'ready'; tabId: number; page: PageInfo; title: string; icon?: string; lasting: boolean; showing: boolean };

type Note = { tone: 'info' | 'error'; text: string } | null;

/** How many recent websites the popup lists: two rows of two. */
const RECENT_LIMIT = 4;

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
  // Chrome hands over the tab's icon address along with its title when the toolbar button is clicked.
  return { kind: 'ready', tabId: tab.id, page, title: cleanTitle(tab.title), icon: safeIconUrl(tab.favIconUrl), lasting, showing };
}

/** The little list-and-mascot picture above the message. */
function Art({ warning }: { warning?: boolean }) {
  return (
    <div className={`art ${warning ? 'art--warning' : ''}`} aria-hidden="true">
      <div className="art__panel">
        {[0, 1, 2].map((row) => (
          <div key={row} className="art__row">
            <i />
            <span>
              <b />
              <b />
            </span>
          </div>
        ))}
        <div className="art__fade" />
      </div>
      <Icon svg={warning ? warningArt : icons.mascot} className="art__badge" />
    </div>
  );
}

/** The little browser-window picture on the welcome screen. */
function WelcomeArt() {
  return (
    <div className="welcome-art" aria-hidden="true">
      <div className="welcome-art__window">
        <span className="welcome-art__dots">
          <i />
          <i />
          <i />
        </span>
        <span className="welcome-art__body">
          <Icon svg={icons.mascot} />
          <span className="welcome-art__lines">
            <i />
            <i />
          </span>
        </span>
      </div>
    </div>
  );
}

/**
 * Shown until someone chooses how to use Blob. Signing in is not built, so the
 * only way on is as a guest.
 */
function Welcome({ onContinue }: { onContinue: () => Promise<boolean> }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const start = async () => {
    setBusy(true);
    setFailed(false);
    const ok = await onContinue();
    setBusy(false);
    if (!ok) setFailed(true);
  };

  return (
    <main className="popup">
      <section className="card card--welcome">
        <div className="welcome">
          <div className="welcome__intro">
            <WelcomeArt />
            <h1>Leave a thought right where it belongs.</h1>
            <p>Add comments to the websites you visit. Start as a guest to save your comments on this device.</p>
          </div>
          <div className="welcome__actions">
            <button type="button" className="btn btn--primary btn--large" disabled title="Signing in isn’t available yet">
              Sign in
            </button>
            <button type="button" className="btn btn--soft btn--large" onClick={() => void start()} disabled={busy}>
              Continue as a Guest
            </button>
          </div>
          {failed && (
            <p className="note note--error" role="alert">
              Blob couldn’t save that choice. Try again.
            </p>
          )}
        </div>
      </section>

      <footer className="footer">
        <span className="footer__brand">
          <Icon svg={icons.mascot} />
          Blob
        </span>
      </footer>
    </main>
  );
}

export function Popup() {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState(false);
  const [sites, setSites] = useState<SiteGroup[]>([]);
  /** Whether the welcome screen has been answered. Unknown until storage is read. */
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    void readStatus().then(setStatus, () => setStatus({ kind: 'unsupported' }));
    void browser.storage.local.get([KEYS.data, KEYS.settings]).then(
      (raw) => {
        setOnboarded(parseSettings(raw[KEYS.settings]).onboarded);
        try {
          setSites(groupBySite(migrate(raw[KEYS.data])));
        } catch {
          setSites([]);
        }
      },
      // Storage could not be read: do not hold the popup on a welcome it cannot save.
      () => setOnboarded(true),
    );
  }, []);

  if (status.kind === 'loading' || onboarded === null) return <main className="popup" aria-busy="true" />;

  if (!onboarded) {
    return (
      <Welcome
        onContinue={async () => {
          const reply = await ask({ type: 'settings/set', settings: { onboarded: true } });
          if (reply.ok) setOnboarded(true);
          return reply.ok;
        }}
      />
    );
  }

  const ready = status.kind === 'ready' ? status : null;
  const host = ready ? hostLabel(ready.page.origin) : '';
  const here = ready ? (sites.find((site) => site.origin === ready.page.origin)?.count ?? 0) : 0;

  const openBlob = async () => {
    if (!ready) return;
    setBusy(true);
    setNote(null);
    const ok = ready.showing
      ? await browser.tabs.sendMessage(ready.tabId, { type: 'overlay/open' }).then(() => true, () => false)
      : (await ask({ type: 'tab/activate', tabId: ready.tabId })).ok;
    setBusy(false);
    if (ok) window.close();
    else setNote({ tone: 'error', text: 'Blob couldn’t start on this page. Chrome blocks extensions on some pages, such as PDFs and a few protected sites.' });
  };

  const allowAlways = async () => {
    if (!ready) return;
    setNote(null);
    // Must be the first thing that happens after the click, or Chrome refuses to ask.
    let granted = false;
    try {
      granted = await browser.permissions.request({ origins: [originPattern(ready.page.origin)] });
    } catch {
      granted = false;
    }
    if (!granted) {
      setNote({ tone: 'info', text: `Access wasn’t granted, so Blob won’t appear on ${host} by itself. You can still use it on this page.` });
      return;
    }
    await ask({ type: 'tab/activate', tabId: ready.tabId });
    setStatus({ ...ready, lasting: true, showing: true });
    setNote({ tone: 'info', text: `Blob will appear whenever you visit ${host}.` });
  };

  const turnOff = async () => {
    if (!ready) return;
    setBusy(true);
    const pattern = originPattern(ready.page.origin);
    await ask({ type: 'site/disable', origin: pattern });
    const stillAllowed = await browser.permissions.contains({ origins: [pattern] }).catch(() => false);
    await browser.tabs.sendMessage(ready.tabId, { type: 'overlay/unmount' }).catch(() => undefined);
    setBusy(false);
    setStatus({ ...ready, lasting: stillAllowed, showing: false });
    setNote(
      stillAllowed
        ? { tone: 'error', text: 'Chrome still allows Blob here: this access was granted in Chrome’s own settings. Change it in Chrome’s extension settings for Blob.' }
        : { tone: 'info', text: `Blob is off for ${host}. Your comments are kept on this device.` },
    );
  };

  const recent = sites.slice(0, RECENT_LIMIT);

  return (
    <main className="popup">
      <section className="card">
        <div className="card__top">
          {ready ? (
            <div className="site">
              <SiteTile icon={ready.icon} letter={host[0]?.toUpperCase() ?? 'B'} />
              <span className="site__text">
                <span className="site__title">{ready.title || host}</span>
                <span className="site__url">{ready.page.origin}</span>
              </span>
            </div>
          ) : (
            <span />
          )}
          <span className="chip" title="Guest. Only you can see your comments. They are stored on this device and are not backed up.">
            <span className="chip__avatar" aria-hidden="true">
              <Icon svg={avatarHead} className="chip__head" />
              <Icon svg={avatarBody} className="chip__body" />
            </span>
            Guest
          </span>
        </div>

        <div className="hero">
          {/* A message needs the room, so the picture steps aside while one is showing.
              It is removed rather than hidden: the mascot's colours are defined once per
              page, and a hidden copy would take them away from the one in the footer. */}
          {!note && <Art warning={!ready} />}
          <div className="hero__text">
            {ready ? (
              <>
                <h1>{here === 0 ? 'No Blobs on this website yet' : `${here} Blob${here === 1 ? '' : 's'} on this website`}</h1>
                <p>{here === 0 ? 'Choose a part of this page and leave your first comment' : 'Open Blob to read them or add another comment'}</p>
              </>
            ) : (
              <>
                <h1>Blob can’t run on this page</h1>
                <p>Chrome doesn’t let extensions add comments to browser pages, the Chrome Web Store, PDFs or local files. Open an ordinary website and try again.</p>
              </>
            )}
          </div>
          {ready && (
            <div className="hero__actions">
              <button type="button" className="btn btn--primary" onClick={() => void openBlob()} disabled={busy}>
                {ready.showing ? 'Open Blob' : 'Use Blob on this page'}
              </button>
              <label className="check">
                <input type="checkbox" checked={ready.lasting} disabled={busy} onChange={() => void (ready.lasting ? turnOff() : allowAlways())} />
                <span className="check__box" aria-hidden="true">
                  <Icon svg={check} />
                </span>
                <span className="check__label">Always show on {host}</span>
              </label>
            </div>
          )}
          {note && (
            <p className={`note ${note.tone === 'error' ? 'note--error' : ''}`} role={note.tone === 'error' ? 'alert' : 'status'}>
              {note.text}
            </p>
          )}
        </div>

        {recent.length > 0 && (
          <nav className="recent" aria-label="Recent websites">
            <h2>
              Recent websites <span>({sites.length})</span>
            </h2>
            <ul>
              {recent.map((site) => (
                <li key={site.origin}>
                  <a href={site.pages[0]?.page.url ?? site.origin} target="_blank" rel="noopener noreferrer" title={`Open ${site.host}`}>
                    <span className="recent__name">
                      {site.host} <span className="recent__count">({site.count})</span>
                    </span>
                    <span className="recent__open">
                      <Icon svg={externalLink} />
                      Open
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </section>

      <footer className="footer">
        <span className="footer__brand">
          <Icon svg={icons.mascot} />
          Blob
        </span>
        <button type="button" className="footer__login" disabled title="Signing in isn’t available yet">
          <Icon svg={logIn} />
          Login
        </button>
      </footer>
    </main>
  );
}
