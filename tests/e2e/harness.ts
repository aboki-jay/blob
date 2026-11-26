/**
 * A stand-in for the extension, for machines where the browser tests cannot
 * load a real extension.
 *
 * It gives an ordinary web page a fake `chrome` object so the real, built
 * overlay script can run there. Requests go to the real request handler and
 * the real storage layer; only Chrome's own plumbing (injection, permissions,
 * chrome.storage) is replaced. It is never part of the shipped extension.
 */

import { handleRequest } from '@/lib/handler';
import { BlobStore, type StorageArea } from '@/lib/storage/store';

type Listener = (...args: any[]) => void;

const STORE_KEY = 'blob-harness-storage';
const changeListeners = new Set<Listener>();
const messageListeners = new Set<Listener>();

/**
 * Chrome's storage hands objects back with their keys in alphabetical order,
 * not the order they were saved in. Do the same, so code that quietly relies
 * on saving order fails here too.
 */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value !== 'object' || value === null) return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
  return sorted;
}

const readAll = (): Record<string, unknown> =>
  sortKeys(JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}')) as Record<string, unknown>;

const harness = {
  failWrites: false,
  /** For the popup: the tab it believes it was opened on. */
  tab: { id: 1, url: 'https://www.wise.com/pricing', title: 'Wise: The International account' } as { id: number; url: string; title: string },
  /** For the popup: websites with lasting access, and whether Chrome's prompt will be accepted. */
  granted: [] as string[],
  acceptPrompt: true,
  /** For the popup: what it asked the background to do. */
  requests: [] as unknown[],
  /** Sends a command to the overlay, as the popup or background would. */
  command(message: unknown) {
    messageListeners.forEach((listener) => listener(message, { id: 'blob-harness' }, () => undefined));
  },
};

const local: StorageArea & { get(keys?: string | string[] | null): Promise<Record<string, unknown>> } = {
  async get(keys) {
    const all = readAll();
    if (keys === null || keys === undefined) return all;
    const out: Record<string, unknown> = {};
    for (const key of [keys].flat()) if (key in all) out[key] = all[key];
    return out;
  },
  async set(items) {
    if (harness.failWrites) throw new Error('QUOTA_BYTES quota exceeded');
    const before = readAll();
    localStorage.setItem(STORE_KEY, JSON.stringify({ ...before, ...items }));
    const changes: Record<string, unknown> = {};
    for (const key of Object.keys(items)) changes[key] = { oldValue: before[key], newValue: items[key] };
    queueMicrotask(() => changeListeners.forEach((listener) => listener(changes, 'local')));
  },
};

const store = new BlobStore(local);

const event = (listeners: Set<Listener>) => ({
  addListener: (listener: Listener) => listeners.add(listener),
  removeListener: (listener: Listener) => listeners.delete(listener),
});

const fake = {
  runtime: {
    id: 'blob-harness',
    getURL: (path: string) => `chrome-extension://blob-harness/${path}`,
    sendMessage: (message: unknown) => {
      harness.requests.push(message);
      return handleRequest(
        // Messages cross a process boundary in the real extension; copy them here too.
        JSON.parse(JSON.stringify(message)),
        // Extension pages (the popup) are not web pages with an http origin.
        { pageOrigin: location.origin, fromExtensionPage: location.pathname === '/popup.html' },
        {
          store,
          activateTab: async () => undefined,
          disableSite: async (pattern) => {
            harness.granted = harness.granted.filter((p) => p !== pattern);
          },
        },
      );
    },
    onMessage: event(messageListeners),
  },
  storage: { local, onChanged: event(changeListeners) },
  // Enough of chrome.tabs and chrome.permissions for the popup to run.
  tabs: {
    query: async () => [harness.tab],
    sendMessage: async () => {
      throw new Error('Could not establish connection. Receiving end does not exist.');
    },
  },
  permissions: {
    contains: async ({ origins = [] }: { origins?: string[] }) => origins.every((o) => harness.granted.includes(o)),
    request: async ({ origins = [] }: { origins?: string[] }) => {
      if (harness.acceptPrompt) harness.granted.push(...origins);
      return harness.acceptPrompt;
    },
  },
};

Object.assign(globalThis, { chrome: fake, __blobHarness: harness });
// The stored list of enabled sites starts with this one, as it would after "Always show".
try {
  if (!('blob:sites' in readAll())) {
    localStorage.setItem(STORE_KEY, JSON.stringify({ ...readAll(), 'blob:sites': [`${location.protocol}//${location.hostname}/*`] }));
  }
} catch {
  /* a blank page has no storage; nothing to seed */
}
