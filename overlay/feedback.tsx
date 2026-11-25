import { useState } from 'react';
import { Button, Icon, icons } from './ui';

const ratings = [['😡', 'Frustrated'], ['😐', 'Neutral'], ['🙂', 'Okay'], ['😄', 'Good']] as const;

export function Feedback({ onBack }: { onBack: () => void }) {
  const [rating, setRating] = useState('');
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
      <label>Tell us why<textarea placeholder="Share your feedback" rows={5} /></label>
      <Button block disabled>Submit</Button>
      <p className="t12 muted">Feedback delivery is unavailable in the local guest version.</p>
    </div>
  </section>;
}
