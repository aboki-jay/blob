import { useState } from 'react';
import { CONTACT_EMAIL, feedbackMailto } from '@/lib/contact';
import { Button, Icon, icons } from './ui';

const ratings = [['😡', 'Frustrated'], ['😐', 'Neutral'], ['🙂', 'Okay'], ['😄', 'Good']] as const;

export function Feedback({ onBack }: { onBack: () => void }) {
  const [rating, setRating] = useState('');
  const [text, setText] = useState('');
  return <section className="pane feedback">
    <header className="history-head">
      <button className="view-close" aria-label="Close feedback" onClick={onBack}><Icon svg={icons.x} /></button>
      <h1>Give feedback</h1>
    </header>
    <div className="feedback-form">
      <h2>How do you like Blob?</h2>
      <div className="ratings" role="group" aria-label="Rate Blob">
        {ratings.map(([emoji, label]) => <button key={label} aria-label={label} aria-pressed={rating === label}
          onClick={() => setRating(label)}>{emoji}<small>{label}</small></button>)}
      </div>
      <label>Tell us why<textarea placeholder="Share your feedback" rows={5} value={text} maxLength={2000} onChange={(event) => setText(event.target.value)} /></label>
      <Button block disabled>Submit</Button>
      {/* Blob has no server, so it cannot deliver this itself. The link starts an
          email in the person's own mail app, with what they chose and wrote above. */}
      <p className="t12 muted">
        Blob can’t send feedback for you yet. Email it to{' '}
        <a className="link" href={feedbackMailto(rating, text)} target="_blank" rel="noopener noreferrer">{CONTACT_EMAIL}</a>
        {' '}instead.
      </p>
    </div>
  </section>;
}
