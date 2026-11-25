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

const readAll = (): Record<string, unknown> => JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');

const harness = {
  failWrites: false,
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
    sendMessage: (message: unknown) =>
      handleRequest(
        // Messages cross a process boundary in the real extension; copy them here too.
        JSON.parse(JSON.stringify(message)),
        { pageOrigin: location.origin, fromExtensionPage: false },
        { store, activateTab: async () => undefined, disableSite: async () => undefined },
      ),
    onMessage: event(messageListeners),
  },
  storage: { local, onChanged: event(changeListeners) },
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
