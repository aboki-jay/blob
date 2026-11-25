/**
 * Blob's storage layer.
 *
 * All guest data lives in extension-owned `chrome.storage.local`, never in the
 * website's own storage. Only the background service worker writes, and it
 * writes one change at a time (see `BlobStore.mutate`), so two tabs saving at
 * the same moment cannot overwrite each other. Any context may read.
 */

import {
  SCHEMA_VERSION,
  defaultSettings,
  emptyData,
  type AnchorDescriptor,
  type BlobData,
  type BlobSettings,
  type Drafts,
  type EnabledSites,
  type Thread,
  type ThreadStatus,
} from '../types';
import type { PageInfo } from '../page';

/** The part of `chrome.storage.local` Blob relies on. Tests pass a fake. */
export interface StorageArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export const KEYS = {
  data: 'blob:data',
  settings: 'blob:settings',
  drafts: 'blob:drafts',
  sites: 'blob:sites',
} as const;

export type ErrorCode =
  | 'invalid'
  | 'not-found'
  | 'forbidden'
  | 'storage-failed'
  | 'newer-schema'
  | 'unsupported-page';

export class BlobError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'BlobError';
  }
}

type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/**
 * Upgrades from older versions, keyed by the version they upgrade *from*.
 * There are none yet. When the shape changes: bump SCHEMA_VERSION and add
 * `[oldVersion]: (data) => upgraded` here so existing guest comments survive.
 */
const MIGRATIONS: Record<number, Migration> = {};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Turns whatever is in storage into current-version data, or throws. */
export function migrate(raw: unknown): BlobData {
  if (raw === undefined || raw === null) return emptyData();
  if (!isRecord(raw) || typeof raw.version !== 'number') {
    throw new BlobError('invalid', 'Stored data is not in a recognised shape.');
  }
  if (raw.version > SCHEMA_VERSION) {
    // Written by a newer Blob. Refuse to touch it rather than damage it.
    throw new BlobError('newer-schema', 'Stored data was written by a newer version of Blob.');
  }
  let data = raw;
  while ((data.version as number) < SCHEMA_VERSION) {
    const step = MIGRATIONS[data.version as number];
    if (!step) throw new BlobError('invalid', `No migration from version ${String(data.version)}.`);
    data = step(data);
  }
  return {
    version: SCHEMA_VERSION,
    threads: isRecord(data.threads) ? (data.threads as BlobData['threads']) : {},
    pages: isRecord(data.pages) ? (data.pages as BlobData['pages']) : {},
  };
}

export async function readData(area: StorageArea): Promise<BlobData> {
  const stored = await area.get(KEYS.data);
  return migrate(stored[KEYS.data]);
}

export function parseSettings(raw: unknown): BlobSettings {
  const settings = defaultSettings();
  if (!isRecord(raw)) return settings;
  if (typeof raw.onboarded === 'boolean') settings.onboarded = raw.onboarded;
  const pos = raw.blobPosition;
  if (isRecord(pos) && typeof pos.x === 'number' && typeof pos.y === 'number') {
    settings.blobPosition = { x: clamp01(pos.x), y: clamp01(pos.y) };
  }
  return settings;
}

export function parseDrafts(raw: unknown): Drafts {
  if (!isRecord(raw)) return {};
  const drafts: Drafts = {};
  for (const [key, text] of Object.entries(raw)) if (typeof text === 'string') drafts[key] = text;
  return drafts;
}

export function parseSites(raw: unknown): EnabledSites {
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : [];
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5);

export interface CreateThreadInput {
  id: string;
  messageId: string;
  page: PageInfo;
  title: string;
  anchor: AnchorDescriptor;
  body: string;
}

export class BlobStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly area: StorageArea,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /** Runs one task after every earlier task has finished, even if they failed. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async write(items: Record<string, unknown>): Promise<void> {
    try {
      await this.area.set(items);
    } catch (error) {
      throw new BlobError('storage-failed', error instanceof Error ? error.message : String(error));
    }
  }

  private async read(key: string): Promise<unknown> {
    try {
      return (await this.area.get(key))[key];
    } catch (error) {
      throw new BlobError('storage-failed', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Read, change, write: as one step. Nothing is written if `change` throws,
   * and nothing is reported as saved unless the write succeeded.
   */
  private mutate<T>(change: (data: BlobData) => T): Promise<T> {
    return this.enqueue(async () => {
      const data = migrate(await this.read(KEYS.data));
      const result = change(data);
      await this.write({ [KEYS.data]: data });
      return result;
    });
  }

  /** Safe to call twice with the same id: the second call changes nothing. */
  createThread(input: CreateThreadInput): Promise<Thread> {
    return this.mutate((data) => {
      const existing = data.threads[input.id];
      if (existing) return existing;
      const now = this.now();
      const { page } = input;
      const onPage = Object.values(data.threads).filter((t) => t.pageKey === page.key);
      const thread: Thread = {
        id: input.id,
        pageKey: page.key,
        origin: page.origin,
        number: onPage.reduce((max, t) => Math.max(max, t.number), 0) + 1,
        status: 'open',
        anchor: input.anchor,
        messages: [{ id: input.messageId, body: input.body, createdAt: now }],
        createdAt: now,
        updatedAt: now,
      };
      data.threads[thread.id] = thread;
      data.pages[page.key] = {
        key: page.key,
        origin: page.origin,
        url: page.url,
        title: input.title,
        label: page.label,
      };
      return thread;
    });
  }

  /**
   * Adds a comment to a conversation. With `replyTo`, it is filed as a reply
   * to that comment. Replies are one level deep: replying to a reply joins the
   * same group. Safe to call twice with the same messageId.
   */
  addReply(threadId: string, messageId: string, body: string, replyTo?: string): Promise<Thread> {
    return this.mutate((data) => {
      const thread = data.threads[threadId];
      if (!thread) throw new BlobError('not-found');
      if (thread.messages.some((m) => m.id === messageId)) return thread;
      const now = this.now();
      const message: Thread['messages'][number] = { id: messageId, body, createdAt: now };
      if (replyTo) {
        const target = thread.messages.find((m) => m.id === replyTo);
        if (!target) throw new BlobError('not-found');
        message.replyTo = target.replyTo ?? target.id;
      }
      thread.messages.push(message);
      thread.updatedAt = now;
      return thread;
    });
  }

  setStatus(threadId: string, status: ThreadStatus): Promise<Thread> {
    return this.mutate((data) => {
      const thread = data.threads[threadId];
      if (!thread) throw new BlobError('not-found');
      if (thread.status === status) return thread;
      const now = this.now();
      thread.status = status;
      thread.updatedAt = now;
      if (status === 'resolved') thread.resolvedAt = now;
      else delete thread.resolvedAt;
      return thread;
    });
  }

  /** Points an existing conversation at a new element. Messages are untouched. */
  reattach(threadId: string, anchor: AnchorDescriptor): Promise<Thread> {
    return this.mutate((data) => {
      const thread = data.threads[threadId];
      if (!thread) throw new BlobError('not-found');
      thread.anchor = anchor;
      return thread;
    });
  }

  /** Removes a conversation and its replies. Deleting twice is not an error. */
  deleteThread(threadId: string): Promise<void> {
    return this.enqueue(async () => {
      const data = migrate(await this.read(KEYS.data));
      const thread = data.threads[threadId];
      const drafts = parseDrafts(await this.read(KEYS.drafts));
      const draftKey = `reply:${threadId}`;
      if (!thread && !(draftKey in drafts)) return;
      if (thread) {
        delete data.threads[threadId];
        const pageStillUsed = Object.values(data.threads).some((t) => t.pageKey === thread.pageKey);
        if (!pageStillUsed) delete data.pages[thread.pageKey];
      }
      delete drafts[draftKey];
      await this.write({ [KEYS.data]: data, [KEYS.drafts]: drafts });
    });
  }

  /** Saves unsent text. Empty text removes the draft. */
  setDraft(key: string, text: string): Promise<void> {
    return this.enqueue(async () => {
      const drafts = parseDrafts(await this.read(KEYS.drafts));
      if (text) drafts[key] = text;
      else if (key in drafts) delete drafts[key];
      else return;
      await this.write({ [KEYS.drafts]: drafts });
    });
  }

  updateSettings(patch: Partial<BlobSettings>): Promise<BlobSettings> {
    return this.enqueue(async () => {
      const settings = parseSettings({ ...parseSettings(await this.read(KEYS.settings)), ...patch });
      await this.write({ [KEYS.settings]: settings });
      return settings;
    });
  }

  setSites(sites: EnabledSites): Promise<void> {
    return this.enqueue(() => this.write({ [KEYS.sites]: sites }));
  }
}
