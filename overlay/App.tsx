import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { describeElement } from '@/lib/anchor';
import { newId } from '@/lib/messages';
import { siteEnabled, type PageInfo } from '@/lib/page';
import type { AnchorDescriptor } from '@/lib/types';
import { send, useDraft, useStored, type Stored } from './client';
import { Bar, BlobButton, Composer, Drawer, Outline, Picker, Pin, type SavePhase, type Section } from './components';
import { useAnchors, useEscape, usePage } from './hooks';
import { Button, Notice } from './ui';
import { Activity, History, ThreadView, Welcome, type HistoryTab } from './views';

type View =
  | { name: 'activity' }
  | { name: 'history'; tab: HistoryTab }
  | { name: 'thread'; threadId: string; from: 'activity' | 'history' | 'resolved' };

type Mode = { kind: 'idle' } | { kind: 'select' } | { kind: 'reattach'; threadId: string };

interface Props {
  /** The custom element Blob's UI lives in. */
  host: HTMLElement;
  /** Receives "open" when the toolbar popup asks for the drawer. */
  commands: EventTarget;
  /** Removes Blob from this page completely. */
  onUnmount: () => void;
}

export function App({ host, commands, onUnmount }: Props) {
  const stored = useStored();
  const page = usePage();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>({ name: 'activity' });

  useEffect(() => {
    const onOpen = () => setOpen(true);
    commands.addEventListener('open', onOpen);
    return () => commands.removeEventListener('open', onOpen);
  }, [commands]);

  // If lasting access to this website is taken away, leave the page at once.
  // Saved comments are untouched; only the on-page UI goes.
  const enabled = page ? siteEnabled(stored.sites, page.origin) : false;
  const wasEnabled = useRef(false);
  useEffect(() => {
    if (!stored.loaded) return;
    if (wasEnabled.current && !enabled) onUnmount();
    wasEnabled.current = enabled;
  }, [enabled, stored.loaded, onUnmount]);

  if (!page) return null;
  // Keyed by page: moving to another page (including inside a single-page app)
  // starts this layer afresh, so no pin, composer or selection is carried over.
  return <PageLayer key={page.key} host={host} stored={stored} page={page} open={open} setOpen={setOpen} view={view} setView={setView} />;
}

interface ComposerState {
  threadId: string;
  messageId: string;
  anchor: AnchorDescriptor;
  element: Element;
}

function PageLayer({
  host,
  stored,
  page,
  open,
  setOpen,
  view,
  setView,
}: {
  host: HTMLElement;
  stored: Stored;
  page: PageInfo;
  open: boolean;
  setOpen: (open: boolean) => void;
  view: View;
  setView: (view: View) => void;
}) {
  const { data, settings, drafts, loaded } = stored;
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [phase, setPhase] = useState<SavePhase>('idle');
  const [pending, setPending] = useState<{ threadId: string; anchor: AnchorDescriptor; element: Element; failed?: boolean } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [spot, setSpot] = useState<string | null>(null);
  const [draft, setDraft] = useDraft(`new:${page.key}`, drafts, loaded);
  const blobRef = useRef<HTMLButtonElement>(null);

  const pageThreads = useMemo(
    () => Object.values(data.threads).filter((thread) => thread.pageKey === page.key),
    [data, page.key],
  );
  const located = useAnchors(pageThreads);
  const openCount = pageThreads.filter((thread) => thread.status === 'open').length;

  const closeDrawer = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => blobRef.current?.focus());
  }, [setOpen]);

  const openThread = (threadId: string, from: 'activity' | 'history' | 'resolved' = 'activity') => {
    setView({ name: 'thread', threadId, from });
    setSaved(null);
    setSpot(null);
    setOpen(true);
  };

  // Temporary messages clear themselves.
  useEffect(() => {
    if (!saved && !spot) return;
    const timer = setTimeout(() => {
      setSaved(null);
      setSpot(null);
    }, 8000);
    return () => clearTimeout(timer);
  }, [saved, spot]);

  const startSelecting = () => {
    setOpen(false);
    setComposer(null);
    setSaved(null);
    setSpot(null);
    setMode({ kind: 'select' });
  };

  const onPick = useCallback(
    (element: Element, point?: { x: number; y: number }) => {
      const anchor = describeElement(element, point);
      if (mode.kind === 'reattach') {
        setPending({ threadId: mode.threadId, anchor, element });
      } else {
        // Ids are made once, here. Retrying a failed save reuses them, so the
        // same comment can never be stored twice.
        setComposer({ threadId: newId(), messageId: newId(), anchor, element });
        setPhase('idle');
      }
      setMode({ kind: 'idle' });
    },
    [mode],
  );

  const saveComment = async () => {
    if (!composer || phase === 'saving') return;
    setPhase('saving');
    const result = await send({
      type: 'thread/create',
      id: composer.threadId,
      messageId: composer.messageId,
      href: location.href,
      title: document.title,
      anchor: composer.anchor,
      body: draft,
    });
    if (result.ok) {
      setComposer(null);
      setPhase('idle');
      setDraft('');
      setSaved(composer.threadId);
    } else {
      setPhase('failed');
    }
  };

  const saveLocation = async () => {
    if (!pending) return;
    const result = await send({ type: 'thread/reattach', threadId: pending.threadId, anchor: pending.anchor });
    if (result.ok) {
      setPending(null);
      openThread(pending.threadId, view.name === 'thread' ? view.from : 'activity');
    } else {
      setPending({ ...pending, failed: true });
    }
  };

  const cancelReattach = () => {
    const threadId = mode.kind === 'reattach' ? mode.threadId : pending?.threadId;
    setMode({ kind: 'idle' });
    setPending(null);
    if (threadId) setOpen(true);
  };

  useEscape(mode.kind !== 'idle' || !!pending || !!composer || open, (inBlob) => {
    if (mode.kind === 'select') setMode({ kind: 'idle' });
    else if (mode.kind === 'reattach' || pending) cancelReattach();
    else if (composer) setComposer(null);
    // With only the drawer open, leave Escape to the page unless focus is in Blob.
    else if (open && inBlob) closeDrawer();
    else return false;
    return true;
  }, host);

  const showOnPage = (threadId: string) => {
    const element = located[threadId]?.element;
    if (!element) return;
    setOpen(false);
    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setSpot(threadId);
  };

  /* ----- What the drawer shows ----- */

  const thread = view.name === 'thread' ? data.threads[view.threadId] : undefined;
  const section: Section | null = !settings.onboarded
    ? null
    : view.name === 'history' || (view.name === 'thread' && thread && view.from !== 'activity')
      ? 'history'
      : 'activity';

  let content;
  if (stored.problem) {
    content = (
      <div className="pane">
        <Notice error title="Blob can’t read its saved comments">
          {stored.problem} Nothing has been deleted. Updating Blob to the latest version usually fixes this.
        </Notice>
      </div>
    );
  } else if (!loaded) {
    content = <div className="pane" aria-busy="true" />;
  } else if (!settings.onboarded) {
    content = <Welcome onContinue={() => void send({ type: 'settings/set', settings: { onboarded: true } })} />;
  } else if (view.name === 'thread' && thread) {
    const from = view.from;
    content = (
      <ThreadView
        key={thread.id}
        thread={thread}
        data={data}
        page={page}
        located={located[thread.id]}
        drafts={drafts}
        loaded={loaded}
        backLabel={from === 'activity' ? 'Back to activity' : from === 'resolved' ? 'Back to Resolved' : 'Back to History'}
        onBack={() => setView(from === 'activity' ? { name: 'activity' } : { name: 'history', tab: from === 'resolved' ? 'resolved' : 'websites' })}
        onShow={() => showOnPage(thread.id)}
        onReattach={() => {
          setOpen(false);
          setMode({ kind: 'reattach', threadId: thread.id });
        }}
        onDeleted={() => setView(from === 'activity' ? { name: 'activity' } : { name: 'history', tab: 'websites' })}
      />
    );
  } else if (view.name === 'history') {
    content = (
      <History
        data={data}
        page={page}
        tab={view.tab}
        onTab={(tab) => setView({ name: 'history', tab })}
        onOpen={(id) => openThread(id, view.tab === 'resolved' ? 'resolved' : 'history')}
        onAdd={startSelecting}
        onReopen={async (id) => (await send({ type: 'thread/status', threadId: id, status: 'open' })).ok}
      />
    );
  } else {
    content = (
      <Activity
        data={data}
        page={page}
        located={located}
        onAdd={startSelecting}
        onOpen={(id) => openThread(id, 'activity')}
        onResolved={() => setView({ name: 'history', tab: 'resolved' })}
      />
    );
  }

  const spotElement = spot ? located[spot]?.element : undefined;
  const savedThread = saved ? data.threads[saved] : undefined;

  return (
    <div className="root">
      {mode.kind !== 'idle' && (
        <Picker hint={mode.kind === 'reattach' ? 'Click to move the comment here' : 'Click to pin your comment here'} onPick={onPick} />
      )}

      {pageThreads.map((t) => {
        const place = located[t.id];
        if (t.status !== 'open' || place?.status !== 'found' || !place.position?.visible) return null;
        return (
          <Pin
            key={t.id}
            x={place.position.x}
            y={place.position.y}
            number={t.number}
            label={t.anchor.label}
            active={spot === t.id || (open && view.name === 'thread' && view.threadId === t.id)}
            onOpen={() => openThread(t.id)}
          />
        );
      })}

      {composer && <Outline element={composer.element} />}
      {pending && <Outline element={pending.element} />}
      {spotElement && <Outline element={spotElement} pulse />}

      {composer && (
        <Composer
          element={composer.element}
          anchor={composer.anchor}
          pageLabel={page.label}
          text={draft}
          onText={setDraft}
          phase={phase}
          onSubmit={() => void saveComment()}
          onClose={() => setComposer(null)}
        />
      )}

      {mode.kind === 'select' && (
        <Bar actions={<Button variant="text" onClick={() => setMode({ kind: 'idle' })}>Cancel</Button>}>Only you · Guest</Bar>
      )}
      {mode.kind === 'reattach' && (
        <Bar actions={<Button variant="text" onClick={cancelReattach}>Cancel</Button>}>Choose a new location for this comment</Bar>
      )}
      {pending && (
        <Bar
          actions={
            <>
              <Button variant="text" onClick={cancelReattach}>
                Cancel
              </Button>
              <Button onClick={() => void saveLocation()}>{pending.failed ? 'Try again' : 'Save location'}</Button>
            </>
          }
        >
          {pending.failed ? 'Couldn’t save the new location.' : `Move this comment to ${pending.anchor.label}?`}
        </Bar>
      )}
      {mode.kind === 'idle' && !pending && !composer && !open && savedThread && (
        <Bar actions={<Button variant="text" onClick={() => openThread(savedThread.id)}>Open conversation</Button>}>
          Guest · Saved on this device
        </Bar>
      )}
      {mode.kind === 'idle' && !pending && !composer && !open && spot && data.threads[spot] && (
        <Bar actions={<Button variant="text" onClick={() => openThread(spot)}>Open conversation</Button>}>
          {data.threads[spot]!.anchor.label}
        </Bar>
      )}

      {open ? (
        <Drawer
          section={section}
          onSection={(next) => setView(next === 'history' ? { name: 'history', tab: 'websites' } : { name: 'activity' })}
          onClose={closeDrawer}
        >
          {content}
        </Drawer>
      ) : (
        <BlobButton
          buttonRef={blobRef}
          position={settings.blobPosition}
          count={openCount}
          onOpen={() => {
            setMode({ kind: 'idle' });
            setOpen(true);
          }}
          onMove={(blobPosition) => void send({ type: 'settings/set', settings: { blobPosition } })}
        />
      )}
    </div>
  );
}
