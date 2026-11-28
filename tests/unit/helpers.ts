import type { StorageArea } from '@/lib/storage/store';
import type { AnchorDescriptor } from '@/lib/types';

/** An in-memory stand-in for chrome.storage.local that can be told to fail. */
export class FakeArea implements StorageArea {
  items: Record<string, unknown> = {};
  failWrites = false;
  writes = 0;

  async get(keys: string | string[]): Promise<Record<string, unknown>> {
    // Real storage hands back copies, never live objects.
    const out: Record<string, unknown> = {};
    for (const key of [keys].flat()) {
      if (key in this.items) out[key] = structuredClone(this.items[key]);
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
    return out;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 1));
    if (this.failWrites) throw new Error('QUOTA_BYTES quota exceeded');
    this.writes++;
    Object.assign(this.items, structuredClone(items));
  }
}

export const anchor = (over: Partial<AnchorDescriptor> = {}): AnchorDescriptor => ({
  selector: 'main > button',
  tag: 'button',
  label: 'Button “Explore our work”',
  text: 'Explore our work',
  offset: { x: 1, y: 0 },
  ...over,
});

let counter = 0;
/** Ids in the same shape the UI makes them. */
export const id = () => `test-id-${String(++counter).padStart(6, '0')}`;
