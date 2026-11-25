import type { ButtonHTMLAttributes, ReactNode } from 'react';
import historyActive from '@/assets/icons/history-active.svg?raw';
import history from '@/assets/icons/history.svg?raw';
import mascot from '@/assets/icons/mascot.svg?raw';
import lock from '@/assets/icons/message-square-lock.svg?raw';
import messageActive from '@/assets/icons/message-square-text-active.svg?raw';
import message from '@/assets/icons/message-square-text.svg?raw';
import x from '@/assets/icons/x.svg?raw';

/** Icons exported from the Figma file, bundled as-is. */
export const icons = { historyActive, history, mascot, lock, messageActive, message, x };

/** Draws one of Blob's own bundled SVG files. Never used for page content. */
export function Icon({ svg, className = '' }: { svg: string; className?: string }) {
  return <span className={`icon ${className}`} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
}

type Variant = 'primary' | 'soft' | 'outline' | 'text' | 'danger' | 'danger-text';

export function Button({
  variant = 'primary',
  block,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; block?: boolean }) {
  return <button type="button" className={`btn btn--${variant} ${block ? 'btn--block' : ''} ${className}`} {...props} />;
}

export function Avatar({ small }: { small?: boolean }) {
  return (
    <span className={`avatar ${small ? 'avatar--sm' : ''}`} aria-hidden="true">
      G
    </span>
  );
}

export function Notice({ title, children, error }: { title: string; children?: ReactNode; error?: boolean }) {
  return (
    <div className={`notice ${error ? 'notice--error' : ''}`} role={error ? 'alert' : 'status'}>
      <p className="medium">{title}</p>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

/** The website tile: a letter instead of a favicon, so Blob needs no extra access. */
export function SiteCard({ title, detail, inline }: { title: string; detail: string; inline?: boolean }) {
  const letter = (detail.replace(/^https?:\/\//, '').replace(/^www\./, '')[0] ?? 'b').toUpperCase();
  return (
    <div className={`site ${inline ? 'site--inline' : ''}`}>
      <span className="site__tile" aria-hidden="true">
        {letter}
      </span>
      <span className="stack grow">
        <span className="t13 medium clip">{title}</span>
        <span className="t12 faint clip">{detail}</span>
      </span>
    </div>
  );
}

/** Where guest comments live and what that means. Shown wherever "Only you" appears. */
export function StorageNote() {
  return (
    <details className="about t12">
      <summary>Only you · Stored on this device</summary>
      <p>
        Blob keeps these comments in this browser, inside the extension. Nobody else can see them. They are not backed up
        to an account, and they are deleted if you remove Blob or clear its data.
      </p>
    </details>
  );
}
