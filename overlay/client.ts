import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import type { Request, Response } from '@/lib/messages';
import { KEYS, migrate, parseDrafts, parseSettings, parseSites } from '@/lib/storage/store';
import { defaultSettings, emptyData, type BlobData, type BlobSettings, type Drafts, type EnabledSites } from '@/lib/types';

/** Called when this copy of Blob has been cut off from the extension (it was updated or removed). */
let onDisconnected: () => void = () => undefined;
export const setDisconnectHandler = (handler: () => void) => {
  onDisconnected = handler;
};

const isDisconnected = (error: unknown) => !browser.runtime?.id || /context invalidated/i.test(String(error));

/**
 * Asks the background to do something. Never throws: any failure, including
 * the background not answering, comes back as `{ ok: false }` so the UI can
 * say so instead of pretending the save worked.
 */
export async function send<T = unknown>(request: Request): Promise<Response<T>> {
  try {
    const response = (await browser.runtime.sendMessage(request)) as Response<T> | undefined;
    return response ?? { ok: false, error: 'storage-failed', message: 'No response from Blob.' };
  } catch (error) {
    if (isDisconnected(error)) onDisconnected();
    return { ok: false, error: 'storage-failed', message: String(error) };
  }
}

export interface Stored {
  /** False until the first read from storage has finished. */
  loaded: boolean;
  /** Set when saved data cannot be read, for example it was written by a newer Blob. */
  problem: string | null;
  data: BlobData;
  settings: BlobSettings;
  drafts: Drafts;
  sites: EnabledSites;
}

const initial: Stored = {
  loaded: false,
  problem: null,
  data: emptyData(),
  settings: defaultSettings(),
  drafts: {},
  sites: [],
};

function parse(raw: Record<string, unknown>, previous: Stored): Stored {
  let data = previous.data;
  let problem: string | null = null;
  try {
    data = migrate(raw[KEYS.data]);
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
  }
  return {
    loaded: true,
    problem,
    data,
    settings: parseSettings(raw[KEYS.settings]),
    drafts: parseDrafts(raw[KEYS.drafts]),
    sites: parseSites(raw[KEYS.sites]),
  };
}

/** Everything Blob has saved, kept current as any tab changes it. */
export function useStored(): Stored {
  const [stored, setStored] = useState<Stored>(initial);
  useEffect(() => {
    let alive = true;
    const read = () =>
      browser.storage.local
        .get(Object.values(KEYS))
        .then((raw) => alive && setStored((prev) => parse(raw, prev)))
        .catch((error) => {
          if (isDisconnected(error)) onDisconnected();
          else if (alive) setStored((prev) => ({ ...prev, loaded: true, problem: String(error) }));
        });
    const onChanged = (_changes: unknown, area: string) => {
      if (area === 'local') void read();
    };
    void read();
    browser.storage.onChanged.addListener(onChanged);
    return () => {
      alive = false;
      browser.storage.onChanged.removeListener(onChanged);
    };
  }, []);
  return stored;
}

/**
 * Text being written, kept in memory and copied to storage shortly after each
 * change so it survives a reload. If storing fails the text simply stays here.
 */
export function useDraft(key: string, drafts: Drafts, loaded: boolean): [string, (text: string) => void] {
  const [text, setText] = useState(() => drafts[key] ?? '');
  const seeded = useRef(loaded);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Pick up the stored draft once storage has been read.
  useEffect(() => {
    if (loaded && !seeded.current) {
      seeded.current = true;
      setText((current) => current || (drafts[key] ?? ''));
    }
  }, [loaded, drafts, key]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const update = (next: string) => {
    setText(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void send({ type: 'draft/set', key, text: next }), 400);
  };
  return [text, update];
}
