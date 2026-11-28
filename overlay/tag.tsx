import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import laugh from '@/assets/icons/laugh.svg?raw';
import { newId } from '@/lib/messages';
import { REACTIONS, type AnchorDescriptor, type Drafts, type Message, type Reaction, type Thread } from '@/lib/types';
import { send, useDraft } from './client';
import { Leaving } from './presence';
import { Icon, icons } from './ui';

/**
 * The comment tag: the card that opens on the page next to a pinned element.
 * It follows the Figma section "Comment tags": a header, "Pinned to …", the
 * comments (each with its replies grouped underneath), and an "Add a comment"
 * bar. The same card is used to write the first comment and to read and
 * continue a conversation.
 *
 * Pointing at a comment shows a smiley for adding a reaction, beside Reply
 * (Figma "Comment with emoji hover"). Reactions are the guest's own and are
 * saved on the device like everything else, so each one counts once.
 */

export type SavePhase = 'idle' | 'saving' | 'failed';

const viewport = () => ({ w: document.documentElement.clientWidth || innerWidth, h: innerHeight });
const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), Math.max(min, max));

/** "Just now", "5 min ago", "12 hours ago", "3 days ago", then the date. */
export function ago(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const GuestAvatar = ({ tiny }: { tiny?: boolean }) => (
  <span className={`tag-avatar ${tiny ? 'tag-avatar--xs' : ''}`} aria-hidden="true">
    G
  </span>
);

/* ---------- The card ---------- */

function TagShell({
  element,
  title,
  label,
  actions,
  onClose,
  children,
  footer,
}: {
  element: Element;
  title: string;
  label: string;
  actions?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  footer: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(140);
  useLayoutEffect(() => {
    if (ref.current && ref.current.offsetHeight !== height) setHeight(ref.current.offsetHeight);
  });

  // Below the element if there is room, otherwise above, otherwise beside it.
  // Only when none of those fit does the card overlap the element.
  const rect = element.getBoundingClientRect();
  const vp = viewport();
  const width = Math.min(450, vp.w - 16);
  let left = clamp(rect.left, 8, vp.w - width - 8);
  let top = rect.bottom + 12;
  if (top + height > vp.h - 8) {
    if (rect.top - height - 12 >= 8) {
      top = rect.top - height - 12;
    } else {
      top = clamp(rect.top, 8, vp.h - height - 8);
      if (rect.right + 12 + width <= vp.w - 8) left = rect.right + 12;
      else if (rect.left - 12 - width >= 8) left = rect.left - 12 - width;
    }
  }
  // Labels such as `Button “Save”` already carry their own quotation marks.
  const pinnedTo = /[“”]/.test(label) ? label : `“${label}”`;

  return (
    <div ref={ref} className="comment-tag" style={{ left, top }} role="dialog" aria-label={title}>
      <div className="tag__header">
        <p>{title}</p>
        <span className="tag__header-actions">
          {actions}
          <button type="button" className="tag__icon-btn" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}>
            <Icon svg={icons.x} />
          </button>
        </span>
      </div>
      <div className="tag__body">
        <p className="tag__pinned" title={label}>
          Pinned to {pinnedTo}
        </p>
        {children}
      </div>
      <div className="tag__footer">{footer}</div>
    </div>
  );
}

/* ---------- The "Add a comment" bar ---------- */

function TagInput({
  text,
  onText,
  onSubmit,
  phase,
  placeholder,
  sendLabel,
  idleStatus,
  autoFocus,
  inputRef,
}: {
  text: string;
  onText: (text: string) => void;
  onSubmit: () => void;
  phase: SavePhase;
  placeholder: string;
  sendLabel: string;
  idleStatus: string;
  autoFocus?: boolean;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const own = useRef<HTMLTextAreaElement>(null);
  const input = inputRef ?? own;
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus, input]);

  const submit = () => {
    if (!text.trim()) {
      setEmpty(true);
      input.current?.focus();
      return;
    }
    onSubmit();
  };

  const problem = empty || phase === 'failed';
  const status = empty
    ? 'Write a comment first.'
    : phase === 'saving'
      ? 'Saving…'
      : phase === 'failed'
        ? 'Couldn’t save. Draft kept here.'
        : text.trim()
          ? 'Draft kept in this browser'
          : idleStatus;
  const showStatus = problem || phase === 'saving' || Boolean(text.trim());

  return (
    <>
      <div className="tag__entry">
        <span title="Only you · Guest">
          <GuestAvatar />
          <span className="sr-only">Only you · Guest</span>
        </span>
        <textarea
          ref={input}
          rows={1}
          value={text}
          maxLength={5000}
          placeholder={placeholder}
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
        <button type="button" className="tag__send" onClick={submit} disabled={phase === 'saving'} aria-label={phase === 'failed' ? 'Try again' : sendLabel}>
          <Icon svg={icons.sendArrow} />
        </button>
      </div>
      <p className={showStatus ? `tag__status ${problem ? 'tag__status--error' : ''}` : 'sr-only'} role="status" aria-live="polite">
        {status}
      </p>
    </>
  );
}

/* ---------- Writing the first comment ---------- */

export function NewCommentTag({
  element,
  anchor,
  text,
  onText,
  phase,
  onSubmit,
  onClose,
}: {
  element: Element;
  anchor: AnchorDescriptor;
  text: string;
  onText: (text: string) => void;
  phase: SavePhase;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <TagShell
      element={element}
      title="New comment"
      label={anchor.label}
      onClose={onClose}
      footer={
        <TagInput
          text={text}
          onText={onText}
          onSubmit={onSubmit}
          phase={phase}
          placeholder="Add a comment"
          sendLabel="Post comment"
          idleStatus="Stored on this device"
          autoFocus
        />
      }
    />
  );
}

/* ---------- Reading and continuing a conversation ---------- */

/** What each reaction is called, for people who cannot see it. */
const REACTION_NAMES: Record<Reaction, string> = {
  '👍': 'Thumbs up',
  '❤️': 'Heart',
  '😂': 'Laughing',
  '😮': 'Surprised',
  '😢': 'Sad',
  '🙏': 'Thanks',
};

function Comment({
  threadId,
  message,
  onReply,
  replying,
}: {
  threadId: string;
  message: Message;
  onReply?: () => void;
  replying?: boolean;
}) {
  const [choosing, setChoosing] = useState(false);
  const [failed, setFailed] = useState(false);
  // Only the reactions Blob offers are ever shown, whatever storage holds.
  const given = REACTIONS.filter((emoji) => message.reactions?.includes(emoji));

  // The choices float just above the smiley that opened them, like the reaction
  // bar in a chat app. They are placed against the window, not the card, so the
  // card's scrolling list cannot cut them off.
  const smiley = useRef<HTMLButtonElement>(null);
  const choices = useRef<HTMLSpanElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number; below: boolean } | null>(null);
  useLayoutEffect(() => {
    if (!choosing) return setPlace(null);
    const from = smiley.current?.getBoundingClientRect();
    const size = choices.current?.getBoundingClientRect();
    if (!from || !size) return;
    const vp = viewport();
    // Above the smiley, or below it when there is no room above.
    const below = from.top - size.height - 8 < 8;
    setPlace({
      left: clamp(from.left - 8, 8, vp.w - size.width - 8),
      top: below ? from.bottom + 8 : from.top - size.height - 8,
      below,
    });
  }, [choosing]);
  // They would be left behind if anything moved, so moving puts them away.
  useEffect(() => {
    if (!choosing) return;
    const close = () => setChoosing(false);
    window.addEventListener('scroll', close, { capture: true, passive: true });
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, { capture: true });
      window.removeEventListener('resize', close);
    };
  }, [choosing]);

  const react = async (emoji: Reaction, on: boolean) => {
    if (choosing) smiley.current?.focus({ preventScroll: true });
    setChoosing(false);
    setFailed(false);
    const result = await send({ type: 'thread/react', threadId, messageId: message.id, emoji, on });
    if (!result.ok) setFailed(true);
  };

  const classes = ['tag-comment', replying && 'tag-comment--replying', (given.length > 0 || choosing) && 'tag-comment--reacted'];
  return (
    <div className={classes.filter(Boolean).join(' ')} tabIndex={0} role="group" aria-label={`Your comment: ${message.body}`}>
      <div className="tag-comment__head">
        <GuestAvatar />
        <span className="tag-comment__who">
          <span className="tag-comment__name">You</span>
          <time className="tag-comment__when" dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString()}>
            {ago(message.createdAt)}
          </time>
        </span>
      </div>
      <p className="tag-comment__body">{message.body}</p>
      <div className="tag-comment__actions">
        <span
          className="tag-react"
          onKeyDown={(event) => {
            if (!choosing || event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            setChoosing(false);
            smiley.current?.focus({ preventScroll: true });
          }}
          // Clicking or tabbing away puts the choices back.
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setChoosing(false);
          }}
        >
          <button
            ref={smiley}
            type="button"
            className="tag-react__add"
            aria-label="Add a reaction"
            aria-expanded={choosing}
            onClick={() => setChoosing(!choosing)}
          >
            <Icon svg={laugh} />
          </button>
          {/* Stays for a moment after closing, so it can shrink back into the smiley. */}
          <Leaving ms={100} inline>
            {choosing && (
              <span
                ref={choices}
                className={`tag-react__choices ${place ? (place.below ? 'is-below' : 'is-above') : ''}`}
                // Measured first, then shown where it belongs.
                style={place ? { left: place.left, top: place.top } : { left: 0, top: 0, visibility: 'hidden' }}
                role="group"
                aria-label="Reactions"
              >
                {REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    aria-label={REACTION_NAMES[emoji]}
                    aria-pressed={given.includes(emoji)}
                    onClick={() => void react(emoji, !given.includes(emoji))}
                  >
                    {emoji}
                  </button>
                ))}
              </span>
            )}
          </Leaving>
          {given.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="tag-reaction"
              aria-pressed="true"
              aria-label={`${REACTION_NAMES[emoji]}, 1. Remove your reaction`}
              title="Remove your reaction"
              onClick={() => void react(emoji, false)}
            >
              <span>{emoji}</span>
              {/* One guest, so each reaction counts once. */}
              <span>1</span>
            </button>
          ))}
        </span>
        {onReply && (
          <span className="tag-comment__reply">
            <span className="tag-comment__divider" aria-hidden="true" />
            <button type="button" className="tag-reply-btn" onClick={onReply} aria-pressed={replying}>
              Reply
            </button>
          </span>
        )}
      </div>
      {failed && (
        <p className="tag__status tag__status--error" role="alert">
          Couldn’t save that reaction. Nothing was changed.
        </p>
      )}
    </div>
  );
}

function Replies({ threadId, replies }: { threadId: string; replies: Message[] }) {
  const [open, setOpen] = useState(true);
  const last = replies[replies.length - 1]!;
  return (
    <div className={`tag-replies ${open ? '' : 'tag-replies--closed'}`}>
      <button type="button" className="tag-replies__bar" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>
          <GuestAvatar tiny />
          <span className="tag-replies__count">
            {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
          </span>
          <span className="tag-replies__last">Last reply was {ago(last.createdAt).toLowerCase()}</span>
        </span>
        <Icon svg={icons.chevron} />
      </button>
      {open && replies.map((reply) => <Comment key={reply.id} threadId={threadId} message={reply} />)}
    </div>
  );
}

export function ThreadTag({
  element,
  thread,
  drafts,
  loaded,
  onClose,
}: {
  element: Element;
  thread: Thread;
  drafts: Drafts;
  loaded: boolean;
  onClose: () => void;
}) {
  const [text, setText] = useDraft(`reply:${thread.id}`, drafts, loaded);
  const [phase, setPhase] = useState<SavePhase>('idle');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [resolveFailed, setResolveFailed] = useState(false);
  const messageId = useRef(newId());
  const input = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const count = thread.messages.length;

  // Show the newest comment.
  useEffect(() => {
    list.current?.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }, [count]);

  const submit = async () => {
    if (phase === 'saving') return;
    setPhase('saving');
    // The same message id is reused on every retry, so nothing is saved twice.
    const request = { type: 'thread/reply', threadId: thread.id, messageId: messageId.current, body: text } as const;
    const result = await send(replyTo ? { ...request, replyTo } : request);
    if (result.ok) {
      messageId.current = newId();
      setText('');
      setReplyTo(null);
      setPhase('idle');
    } else {
      setPhase('failed');
    }
  };

  const resolve = async () => {
    const result = await send({ type: 'thread/status', threadId: thread.id, status: 'resolved' });
    if (result.ok) onClose();
    else setResolveFailed(true);
  };

  const topLevel = thread.messages.filter((m) => !m.replyTo);
  const repliesTo = (id: string) => thread.messages.filter((m) => m.replyTo === id);

  return (
    <TagShell
      element={element}
      title="Comment"
      label={thread.anchor.label}
      onClose={onClose}
      actions={
        <button type="button" className="tag-reply-btn" aria-label="Resolve conversation" onClick={() => void resolve()}>
          Resolve
        </button>
      }
      footer={
        <>
          {replyTo && (
            <p className="tag__replying">
              Replying to a comment
              <button type="button" className="tag-reply-btn" onClick={() => setReplyTo(null)}>
                Cancel
              </button>
            </p>
          )}
          {resolveFailed && (
            <p className="tag__status tag__status--error" role="alert">
              Couldn’t resolve. Nothing was changed.
            </p>
          )}
          <TagInput
            text={text}
            onText={setText}
            onSubmit={() => void submit()}
            phase={phase}
            placeholder={replyTo ? 'Write a reply' : 'Add a comment'}
            sendLabel={replyTo ? 'Send reply' : 'Add comment'}
            idleStatus="Only you · Saved on this device"
            inputRef={input}
          />
        </>
      }
    >
      <div className="tag__list" ref={list} aria-label="Comments">
        {topLevel.map((message) => {
          const replies = repliesTo(message.id);
          return (
            <div key={message.id} className="tag__item">
              <Comment
                threadId={thread.id}
                message={message}
                replying={replyTo === message.id}
                onReply={() => {
                  setReplyTo(replyTo === message.id ? null : message.id);
                  input.current?.focus();
                }}
              />
              {replies.length > 0 && <Replies threadId={thread.id} replies={replies} />}
            </div>
          );
        })}
      </div>
    </TagShell>
  );
}
