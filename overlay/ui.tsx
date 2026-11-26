import commentMode from '@/assets/icons/comment-mode.svg?raw';
import resolved from '@/assets/icons/resolved.svg?raw';
import chevron from '@/assets/icons/chevron-right.svg?raw';
import sendArrow from '@/assets/icons/send.svg?raw';
import filter from '@/assets/icons/filter.svg?raw';
import file from '@/assets/icons/file.svg?raw';
import settings from '@/assets/icons/settings.svg?raw';
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import historyActive from '@/assets/icons/history-active.svg?raw';
import history from '@/assets/icons/history.svg?raw';
import mascot from '@/assets/icons/mascot.svg?raw';
import lock from '@/assets/icons/message-square-lock.svg?raw';
import messageActive from '@/assets/icons/message-square-text-active.svg?raw';
import message from '@/assets/icons/message-square-text.svg?raw';
import x from '@/assets/icons/x.svg?raw';

/** Icons exported from the Figma file, bundled as-is. */
export const icons = { commentMode, resolved, chevron, sendArrow, filter, file, settings, historyActive, history, mascot, lock, messageActive, message, x };

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

/**
 * The square at the start of a website card: the website's own icon when there
 * is one and it loads, otherwise the first letter of its name.
 */
export function SiteTile({ icon, letter }: { icon?: string; letter: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [icon]);
  return (
    <span className="site__tile" aria-hidden="true">
      {icon && !failed ? (
        // No referrer: the website learns nothing about Blob from the request.
        <img src={icon} alt="" width={24} height={24} referrerPolicy="no-referrer" draggable={false} onError={() => setFailed(true)} />
      ) : (
        letter
      )}
    </span>
  );
}

export function SiteCard({ title, detail, inline, icon }: { title: string; detail: string; inline?: boolean; icon?: string }) {
  const letter = (detail.replace(/^https?:\/\//, '').replace(/^www\./, '')[0] ?? 'b').toUpperCase();
  return (
    <div className={`site ${inline ? 'site--inline' : ''}`}>
      <SiteTile icon={icon} letter={letter} />
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
