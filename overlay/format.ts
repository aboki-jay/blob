import { hostLabel } from '@/lib/page';
import type { BlobData, PageRecord, Thread } from '@/lib/types';

/**
 * Sorting rule used everywhere: newest activity first, by `updatedAt` (the time
 * of the latest comment, reply, resolve or reopen). Ties fall back to creation
 * time, then id, so the order never flickers.
 */
export function byRecent(a: Thread, b: Thread): number {
  return b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function dayLabel(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** "Just now", "09:20" for today, otherwise the day. */
export function shortTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (now.getTime() - date.getTime() < 60_000) return 'Just now';
  return dayLabel(iso, now) === 'Today' ? clock(iso) : dayLabel(iso, now);
}

export function stamp(iso: string, now = new Date()): string {
  if (now.getTime() - new Date(iso).getTime() < 60_000) return 'Just now';
  return `${dayLabel(iso, now)} · ${clock(iso)}`;
}

/** One-line description of the latest thing that happened in a conversation. */
export function lastEvent(thread: Thread): string {
  if (thread.status === 'resolved' && thread.resolvedAt === thread.updatedAt) return 'You resolved a thread';
  if (thread.messages.length > 1) return 'You replied';
  return 'You added a comment';
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export interface PageGroup {
  page: PageRecord;
  threads: Thread[];
}

export interface SiteGroup {
  origin: string;
  host: string;
  title: string;
  pages: PageGroup[];
  count: number;
  latest: string;
}

/**
 * History: websites, then the pages on each, then the conversations on each
 * page. Only websites with at least one saved conversation appear.
 */
export function groupBySite(data: BlobData, include: (thread: Thread) => boolean = () => true): SiteGroup[] {
  const sites = new Map<string, SiteGroup>();
  for (const thread of Object.values(data.threads).filter(include).sort(byRecent)) {
    const page: PageRecord = data.pages[thread.pageKey] ?? {
      key: thread.pageKey,
      origin: thread.origin,
      url: thread.pageKey,
      title: '',
      label: thread.pageKey.replace(thread.origin, '') || '/',
    };
    let site = sites.get(thread.origin);
    if (!site) {
      site = { origin: thread.origin, host: hostLabel(thread.origin), title: page.title, pages: [], count: 0, latest: thread.updatedAt };
      sites.set(thread.origin, site);
    }
    let group = site.pages.find((g) => g.page.key === page.key);
    if (!group) {
      group = { page, threads: [] };
      site.pages.push(group);
    }
    group.threads.push(thread);
    site.count++;
  }
  return [...sites.values()];
}

export function pageName(page: PageRecord | undefined): string {
  if (!page) return 'Page';
  return page.title ? `${page.title} · ${page.label}` : page.label;
}
