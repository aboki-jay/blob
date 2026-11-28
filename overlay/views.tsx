import { useEffect, useRef, useState } from 'react';
import laugh from '@/assets/icons/laugh.svg?raw';
import { newId } from '@/lib/messages';
import { hostLabel, type PageInfo } from '@/lib/page';
import type { BlobData, Drafts, Thread } from '@/lib/types';
import { send, useDraft } from './client';
import type { SavePhase } from './components';
import { byRecent, dayLabel, groupBySite, lastEvent, pageName, plural, shortTime, stamp } from './format';
import { pageIcon, type Located } from './hooks';
import { Avatar, Button, Icon, Notice, SiteCard, StorageNote, icons } from './ui';

/* ---------- Welcome ---------- */

export function Welcome({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="pane pane--center">
      <div className="empty" style={{ width: 'min(304px, 100%)' }}>
        <div className="art" aria-hidden="true">
          <div className="art__window">
            <span className="art__dots">
              <i />
              <i />
              <i />
            </span>
            <Icon svg={icons.mascot} />
            <span className="art__lines">
              <i />
              <i />
            </span>
          </div>
        </div>
        <div className="stack gap8">
          <h1 className="welcome__title">Leave a thought right where it belongs.</h1>
          <p className="t12 muted">
            Add comments to the websites you visit. Start as a guest to save your comments on this device.
          </p>
        </div>
        <div className="stack gap12" style={{ width: 'min(268px, 100%)' }}>
          <Button block disabled title="Accounts are unavailable in the local guest version">Sign in</Button>
          <Button variant="soft" block onClick={onContinue}>
            Continue as a Guest
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Rows ---------- */

function ThreadRow({
  thread,
  detail,
  onOpen,
  now,
}: {
  thread: Thread;
  detail: string;
  onOpen: () => void;
  now: Date;
}) {
  const last = thread.messages[thread.messages.length - 1];
  return (
    <li>
      <button type="button" className="activity" onClick={onOpen}>
        <Avatar small />
        <span className="activity__main">
          <span className="activity__top">
            <span className="medium clip">{lastEvent(thread)}</span>
            <span className="anchor-tag clip" title={thread.anchor.label}><Icon svg={icons.file} />{thread.anchor.label}</span>
            <span className="muted">{shortTime(thread.updatedAt, now)}</span>
          </span>
          <span className="activity__preview">{last?.body}</span>
          <span className="muted clip">{detail}</span>
          <span className="activity-peek" aria-hidden="true">
            <span className="spread"><strong>Guest</strong><small>{shortTime(thread.updatedAt, now)}</small></span>
            <span className="peek-body">{last?.body}</span>
            <span className="peek-link">View blob <Icon svg={icons.chevron} /></span>
          </span>
        </span>
      </button>
    </li>
  );
}

function ByDay({ threads, render }: { threads: Thread[]; render: (thread: Thread) => React.ReactNode }) {
  const now = new Date();
  const days: { label: string; threads: Thread[] }[] = [];
  for (const thread of threads) {
    const label = dayLabel(thread.updatedAt, now);
    const day = days[days.length - 1];
    if (day?.label === label) day.threads.push(thread);
    else days.push({ label, threads: [thread] });
  }
  return (
    <>
      {days.map((day) => (
        <section key={day.label} className="stack gap4" aria-label={day.label}>
          <h3 className="day-label" data-today={day.label === 'Today'}>{day.label}</h3>
          <ul className="stack">{day.threads.map(render)}</ul>
        </section>
      ))}
    </>
  );
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="empty empty--grow">
      <div className={'state-art ' + (title.startsWith('No Blobs') ? 'state-art--site' : '')} aria-hidden="true">
        <div className="state-art__sheet">
          {[0, 1, 2].map(row => <span key={row}><i /><b /></span>)}
        </div>
        {title.startsWith('No Blobs') && <Icon svg={icons.mascot} />}
      </div>
      <div className="stack gap4">
        <p className="t16 medium">{title}</p>
        <p className="muted">{body}</p>
      </div>
      {action}
    </div>
  );
}

/* ---------- Activity: this website ---------- */

export function Activity({
  data,
  page,
  located,
  onAdd,
  onOpen,
  onResolved,
}: {
  data: BlobData;
  page: PageInfo;
  located: Record<string, Located>;
  onAdd: () => void;
  onOpen: (threadId: string) => void;
  onResolved: () => void;
}) {
  const now = new Date();
  const onSite = Object.values(data.threads)
    .filter((t) => t.origin === page.origin)
    .sort(byRecent);
  const here = onSite.filter((t) => t.pageKey === page.key);
  const elsewhere = onSite.filter((t) => t.pageKey !== page.key);
  const resolved = onSite.filter((t) => t.status === 'resolved').length;
  const title = document.title.trim() || page.host;

  const detail = (thread: Thread, withPage: boolean) => {
    const parts = [withPage ? (data.pages[thread.pageKey]?.label ?? '') : '', thread.anchor.label];
    if (thread.status === 'resolved') parts.push('Resolved');
    else if (!withPage && located[thread.id]?.status === 'unavailable') parts.push('Location unavailable');
    return parts.filter(Boolean).join(' · ');
  };

  return (
    <div className="pane activity-pane">
      <div className="stack gap8">
        <SiteCard inline icon={pageIcon()} title={title} detail={`${page.origin}${page.label === '/' ? '' : page.label}`} />
      </div>
      {onSite.length === 0 ? (
        <EmptyState
          title="No Blobs on this website yet"
          body="Choose a part of this page and leave your first comment"
          action={
            <Button block onClick={onAdd}>
              Add a Blob
            </Button>
          }
        />
      ) : (
        <>
          <div className="row">
            <Button onClick={onAdd}>Add a Blob</Button>
            <Button variant="text" onClick={onResolved}>
              Resolved{resolved ? ` (${resolved})` : ''}
            </Button>
          </div>
          <section className="stack gap12" aria-label="This page">
            <h2 className="group-label">
              <span>This page</span>
              <span className="muted" style={{ fontWeight: 400 }}>
                Newest first
              </span>
            </h2>
            {here.length === 0 ? (
              <EmptyState title="No Activity yet" body="Comments on this page appear here after you leave a comment or reply." />
            ) : (
              <ByDay
                threads={here}
                render={(t) => <ThreadRow key={t.id} thread={t} now={now} detail={detail(t, false)} onOpen={() => onOpen(t.id)} />}
              />
            )}
          </section>
          {elsewhere.length > 0 && (
            <>
              <div className="divider" />
              <section className="stack gap12" aria-label={`Other pages on ${hostLabel(page.origin)}`}>
                <h2 className="group-label">Other pages on {hostLabel(page.origin)}</h2>
                <ByDay
                  threads={elsewhere}
                  render={(t) => <ThreadRow key={t.id} thread={t} now={now} detail={detail(t, true)} onOpen={() => onOpen(t.id)} />}
                />
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- History: every website ---------- */

export type HistoryTab = 'websites' | 'resolved';

export function History({
  data,
  page,
  tab,
  onTab,
  onBack,
  onOpen,
  onAdd,
  onReopen,
}: {
  data: BlobData;
  page: PageInfo;
  tab: HistoryTab;
  onTab: (tab: HistoryTab) => void;
  onBack: () => void;
  onOpen: (threadId: string) => void;
  onAdd: () => void;
  onReopen: (threadId: string) => Promise<boolean>;
}) {
  const now = new Date();
  const sites = groupBySite(data);
  const resolved = Object.values(data.threads)
    .filter((t) => t.status === 'resolved')
    .sort((a, b) => (b.resolvedAt ?? b.updatedAt).localeCompare(a.resolvedAt ?? a.updatedAt));
  const [filterOpen, setFilterOpen] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  return (
    <div className="pane">
      <div className="history-head">
        <button className="view-close" aria-label="Close history" onClick={onBack}><Icon svg={icons.x} /></button>
        <h1 className="heading">History</h1>
        <button className="filter-button" aria-expanded={filterOpen} onClick={() => setFilterOpen(!filterOpen)}>
          <Icon svg={icons.filter} />{tab === 'resolved' ? 'Resolved' : 'Filter'}
        </button>
      </div>
      {filterOpen && <div className="tabs" role="tablist" aria-label="History views">
        {(['websites', 'resolved'] as const).map(value => <button key={value} role="tab" className="tab"
          aria-selected={tab === value} onClick={() => { onTab(value); setFilterOpen(false); }}>
          {value === 'websites' ? 'Websites' : 'Resolved'}
        </button>)}
      </div>}
      {tab === 'websites' ? (
        <>
          {sites.length === 0 ? (
            <EmptyState
              title="No history yet"
              body="Websites appear here once you leave a comment on them."
              action={
                <Button block onClick={onAdd}>
                  Add a Blob
                </Button>
              }
            />
          ) : (
            sites.map((site, index) => (
              <section key={site.origin} className="history-site" aria-label={site.host}>
                {(index === 0 || dayLabel(sites[index - 1]!.latest, now) !== dayLabel(site.latest, now)) &&
                  <h3 className="day-label" data-today={dayLabel(site.latest, now) === 'Today'}>{dayLabel(site.latest, now)}</h3>}
                <details>
                  <summary><strong className="clip">{site.title || site.host}</strong><small className="clip">{site.host}</small></summary>
                  <p className="t12 muted">{site.host} · {plural(site.count, 'conversation')}{site.origin === page.origin ? ' · Current website' : ''}</p>
                {site.pages.map((group) => (
                  <details key={group.page.key} className="history-page">
                    <summary>{pageName(group.page)}</summary>
                    {group.page.key !== page.key && <a className="link" href={group.page.url} target="_blank" rel="noopener noreferrer">Open page</a>}
                    <ul className="stack">
                      {group.threads.map((t) => (
                        <ThreadRow
                          key={t.id}
                          thread={t}
                          now={now}
                          detail={[t.anchor.label, t.status === 'resolved' ? 'Resolved' : ''].filter(Boolean).join(' · ')}
                          onOpen={() => onOpen(t.id)}
                        />
                      ))}
                    </ul>
                  </details>
                ))}
                </details>
              </section>
            ))
          )}
        </>
      ) : (
        <>
          <div className="stack gap8">
            <div className="row">
              <span className="chip">Status: Resolved</span>
              <span className="t12 muted">Across all websites</span>
            </div>
            <p className="t12 muted">Completed conversations stay here until you reopen them.</p>
          </div>
          <div className="divider" />
          {failed && (
            <Notice error title="Couldn’t reopen that conversation">
              Nothing was changed. Please try again.
            </Notice>
          )}
          {resolved.length === 0 ? (
            <EmptyState title="No resolved conversations" body="When you resolve a conversation it moves here." />
          ) : (
            <ul className="stack gap8">
              {resolved.map((t) => (
                <li key={t.id} className="stack gap4">
                  <ul>
                    <ThreadRow
                      thread={t}
                      now={now}
                      detail={`${hostLabel(t.origin)} · ${data.pages[t.pageKey]?.label ?? ''} · ${t.anchor.label}`}
                      onOpen={() => onOpen(t.id)}
                    />
                  </ul>
                  <div className="spread">
                    <span className="t12 muted">Resolved by you · {stamp(t.resolvedAt ?? t.updatedAt, now)}</span>
                    <Button
                      variant="outline"
                      onClick={async () => setFailed((await onReopen(t.id)) ? null : t.id)}
                      aria-label={`Reopen conversation on ${t.anchor.label}`}
                    >
                      Reopen
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- One conversation ---------- */

export function ThreadView({
  thread,
  data,
  page,
  located,
  drafts,
  loaded,
  backLabel,
  onBack,
  onShow,
  onReattach,
  onDeleted,
}: {
  thread: Thread;
  data: BlobData;
  page: PageInfo;
  located: Located | undefined;
  drafts: Drafts;
  loaded: boolean;
  backLabel: string;
  onBack: () => void;
  onShow: () => void;
  onReattach: () => void;
  onDeleted: () => void;
}) {
  const now = new Date();
  const record = data.pages[thread.pageKey];
  const onThisPage = thread.pageKey === page.key;
  const unavailable = onThisPage && located?.status === 'unavailable';
  const [text, setText] = useDraft(`reply:${thread.id}`, drafts, loaded);
  const [phase, setPhase] = useState<SavePhase>('idle');
  const [emptyReply, setEmptyReply] = useState(false);
  const [action, setAction] = useState<{ failed?: string; confirmDelete?: boolean; busy?: boolean }>({});
  const messageId = useRef(newId());
  const end = useRef<HTMLDivElement>(null);
  const replyBox = useRef<HTMLTextAreaElement>(null);
  const count = thread.messages.length;
  const [showReplies, setShowReplies] = useState(true);

  // Keep the newest message and the reply box in view.
  // (Braces matter: newer browsers return a Promise from scrollIntoView, and an
  // effect must not return one.)
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [count]);

  const sendReply = async () => {
    if (phase === 'saving') return;
    if (!text.trim()) {
      setEmptyReply(true);
      return;
    }
    setPhase('saving');
    // The same message id is reused on every retry, so a reply is never saved twice.
    const result = await send({ type: 'thread/reply', threadId: thread.id, messageId: messageId.current, body: text });
    if (result.ok) {
      messageId.current = newId();
      setText('');
      setShowReplies(true);
      setPhase('idle');
    } else {
      setPhase('failed');
    }
  };

  const run = async (label: string, request: Parameters<typeof send>[0], after?: () => void) => {
    setAction({ busy: true });
    const result = await send(request);
    if (result.ok) {
      setAction({});
      after?.();
    } else {
      setAction({ failed: label });
    }
  };

  return (
    <div className="pane thread-pane">
      <button type="button" className="link back" onClick={onBack}>
        {backLabel}
      </button>
      <div className="thread-target">
        <h1 className="clip" title={thread.anchor.label}>Pinned to “{thread.anchor.label}”</h1>
        <details><summary>Page details</summary>
          <p>{record?.title || hostLabel(thread.origin)}</p>
          <p>{hostLabel(thread.origin)} · {record?.label ?? ''}</p>
          <StorageNote />
        </details>
      </div>

      {unavailable && thread.status === 'open' && (
        <>
          <Notice title="Location unavailable">
            This page changed, and Blob can’t find the part this comment was attached to. Your conversation is safe.
          </Notice>
          <div className="stack gap8">
            <p className="t12 medium">Previous location</p>
            <div className="card t12" style={{ padding: 12 }}>
              {thread.anchor.label}
            </div>
            <Button block onClick={onReattach}>
              Choose a new location
            </Button>
          </div>
        </>
      )}

      <span className={`chip ${thread.status === 'resolved' ? '' : 'chip--neutral'}`}>
        {thread.status === 'resolved' ? 'Resolved' : 'Open'} · Saved on this device
      </span>

      <ul className="stack gap8" aria-label="Messages">
        {thread.messages.map((message, index) => (
          <li key={message.id} className="message" hidden={index > 0 && !showReplies}>
            <div className="message__head">
              <Avatar small />
              <div className="stack gap4">
                <span className="medium">You</span>
                <span className="muted">
                  {stamp(message.createdAt, now)} · {index === 0 ? 'Comment' : 'Reply'}
                </span>
              </div>
            </div>
            <p className="wrap">{message.body}</p>
            {thread.status === 'open' && <div className="message-tools">
              <button type="button" disabled aria-label="Reactions unavailable" title="Reactions are unavailable"><Icon svg={laugh} /></button>
              <button type="button" onClick={() => replyBox.current?.focus()}>Reply</button>
            </div>}
            {index === 0 && count > 1 && <button type="button" className="thread-replies" aria-expanded={showReplies}
              onClick={() => setShowReplies(!showReplies)}>
              <Avatar small />{count - 1} {count === 2 ? 'reply' : 'replies'}
              <small>Last reply {shortTime(thread.messages[count - 1]!.createdAt, now)}</small>
              <Icon svg={icons.chevron} />
            </button>}
          </li>
        ))}
      </ul>

      {thread.status === 'resolved' && (
        <Notice title="Resolved by you">The discussion stays in your activity and Resolved view.</Notice>
      )}

      {action.failed && (
        <Notice error title={`Couldn’t ${action.failed}`}>
          Nothing was changed. Please try again.
        </Notice>
      )}

      {action.confirmDelete ? (
        <Notice error title="Delete this conversation?">
          <div className="stack gap12">
            <p>
              This removes the comment{count > 1 ? ` and its ${count - 1} ${count === 2 ? 'reply' : 'replies'}` : ''} from this
              device. It can’t be undone.
            </p>
            <div className="row">
              <Button variant="danger" disabled={action.busy} onClick={() => run('delete the conversation', { type: 'thread/delete', threadId: thread.id }, onDeleted)}>
                Delete conversation
              </Button>
              <Button variant="outline" onClick={() => setAction({})}>
                Keep it
              </Button>
            </div>
          </div>
        </Notice>
      ) : (
        <div className="row">
          {thread.status === 'open' ? (
            <Button variant="soft" disabled={action.busy} onClick={() => run('resolve the conversation', { type: 'thread/status', threadId: thread.id, status: 'resolved' })}>
              Resolve
            </Button>
          ) : (
            <Button disabled={action.busy} onClick={() => run('reopen the conversation', { type: 'thread/status', threadId: thread.id, status: 'open' })}>
              Reopen thread
            </Button>
          )}
          {onThisPage ? (
            !unavailable && (
              <Button variant="outline" onClick={onShow}>
                Show on page
              </Button>
            )
          ) : (
            <a className="btn btn--outline" href={record?.url ?? thread.pageKey} target="_blank" rel="noopener noreferrer">
              Open page
            </a>
          )}
          <Button variant="danger-text" onClick={() => setAction({ confirmDelete: true })}>
            Delete
          </Button>
        </div>
      )}

      {thread.status === 'open' && (
        <div className="stack gap8" style={{ marginTop: 'auto' }}>
          <div className="composer__entry reply-entry">
            <Avatar small />
            <textarea
              ref={replyBox}
              rows={1}
              value={text}
              maxLength={5000}
              placeholder="Add a comment"
              aria-label="Reply"
              aria-invalid={emptyReply}
              onChange={(event) => {
                setEmptyReply(false);
                setText(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void sendReply();
                }
              }}
            />
            <button className="send-arrow" aria-label={phase === 'failed' ? 'Try again' : 'Send reply'}
              disabled={phase === 'saving'} onClick={() => void sendReply()}><Icon svg={icons.sendArrow} /></button>
          </div>
            <p className={phase === 'failed' || emptyReply ? 'danger t12' : 'sr-only'} role="status" aria-live="polite">
              {emptyReply
                ? 'Write a reply first.'
                : phase === 'failed'
                  ? 'Couldn’t save your reply. Your draft is kept here.'
                  : phase === 'saving'
                    ? 'Saving…'
                    : 'Only you · Saved on this device'}
            </p>

        </div>
      )}
      <div ref={end} />
    </div>
  );
}
