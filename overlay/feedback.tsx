import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { CONTACT_EMAIL, feedbackMailto } from '@/lib/contact';
import { FEEDBACK_MAX, type Rating } from '@/lib/feedback';
import { send } from './client';
import { Button, Icon, icons } from './ui';

const ratings = [['😡', 'Frustrated'], ['😐', 'Neutral'], ['🙂', 'Okay'], ['😄', 'Good']] as const;

type Phase = 'idle' | 'sending' | 'sent' | 'failed';

function useFeedbackDraft() {
  const [rating, setRating] = useState<Rating>('');
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const inFlight = useRef(false);

  const submit = async () => {
    if (inFlight.current || !(rating || text.trim())) return;
    inFlight.current = true;
    setPhase('sending');
    const result = await send({ type: 'feedback/send', rating, text });
    inFlight.current = false;
    if (result.ok) {
      setRating('');
      setText('');
    }
    setPhase(result.ok ? 'sent' : 'failed');
  };
  return { rating, setRating, text, setText, phase, setPhase, submit };
}

const FeedbackDraft = createContext<ReturnType<typeof useFeedbackDraft> | null>(null);

/** Keep the pending request and its draft when the drawer closes or changes views. */
export function FeedbackDraftProvider({ children }: { children: ReactNode }) {
  const draft = useFeedbackDraft();
  return <FeedbackDraft.Provider value={draft}>{children}</FeedbackDraft.Provider>;
}

/**
 * The feedback form. Where a feedback relay is set up, Submit sends the rating
 * and text to the Blob project (and nothing else). Where it is not, Submit stays
 * off and the form offers to start an email instead.
 */
export function Feedback({ onBack }: { onBack: () => void }) {
  const draft = useContext(FeedbackDraft);
  if (!draft) throw new Error('Feedback requires a draft provider');
  const { rating, setRating, text, setText, phase, setPhase, submit } = draft;
  const [canSend, setCanSend] = useState(false);
  const sending = phase === 'sending';

  useEffect(() => {
    let alive = true;
    void send<{ enabled: boolean }>({ type: 'feedback/status' }).then((result) => {
      if (alive) setCanSend(result.ok && result.data.enabled);
    });
    return () => {
      alive = false;
    };
  }, []);

  const hasSomething = Boolean(rating || text.trim());
  const emailLink = (
    <a className="link" href={feedbackMailto(rating, text)} target="_blank" rel="noopener noreferrer">
      {CONTACT_EMAIL}
    </a>
  );

  return <section className="pane feedback">
    <header className="history-head">
      <button className="view-close" aria-label="Close feedback" onClick={onBack}><Icon svg={icons.x} /></button>
      <h1>Give feedback</h1>
    </header>
    <div className="feedback-form">
      <h2>How do you like Blob?</h2>
      <div className="ratings" role="group" aria-label="Rate Blob">
        {ratings.map(([emoji, label]) => <button key={label} disabled={sending} aria-label={label} aria-pressed={rating === label}
          onClick={() => { setRating(label); setPhase('idle'); }}>{emoji}<small>{label}</small></button>)}
      </div>
      <label>Tell us why<textarea disabled={sending} placeholder="Share your feedback" rows={5} value={text} maxLength={FEEDBACK_MAX}
        onChange={(event) => { setText(event.target.value); setPhase('idle'); }} /></label>
      <Button block disabled={!canSend || !hasSomething || phase === 'sending'} onClick={() => void submit()}>
        {phase === 'sending' ? 'Sending…' : 'Submit'}
      </Button>
      {sending ? <p className="t12 muted" role="status">Sending feedback…</p> : !canSend ? (
        // No relay: Blob cannot deliver this itself. The link starts an email in
        // the person's own mail app, with what they chose and wrote above.
        <p className="t12 muted">Blob can’t send feedback for you yet. Email it to {emailLink} instead.</p>
      ) : phase === 'sent' ? (
        <p className="t12 muted" role="status">Thank you. Your feedback was sent.</p>
      ) : phase === 'failed' ? (
        <p className="t12 danger" role="alert">Couldn’t send it, and nothing was lost. Try again, or email it to {emailLink}.</p>
      ) : (
        <p className="t12 muted">Only your feedback is sent to the Blob team.</p>
      )}
    </div>
  </section>;
}
