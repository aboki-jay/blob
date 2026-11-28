/**
 * Site access.
 *
 * Blob can be on a page in two ways:
 *   - Temporarily: the person clicked the toolbar button, which gives Chrome's
 *     `activeTab` access to that one tab until it navigates away.
 *   - Lastingly: the person granted the optional permission for one website.
 *     Blob then registers its overlay script for that website so it reappears
 *     on later visits.
 *
 * Chrome's own permission list is the source of truth. `syncSites` copies it
 * into the registered script and into storage, where open overlays watch it.
 */

import { browser } from 'wxt/browser';
import type { BlobStore } from './storage/store';

export const OVERLAY_SCRIPT = 'overlay.js';
const SCRIPT_ID = 'blob-overlay';

/** Websites the person has granted lasting access to, as match patterns. */
export async function grantedSites(): Promise<string[]> {
  const { origins = [] } = await browser.permissions.getAll();
  return origins.filter((pattern) => /^https?:\/\//.test(pattern)).sort();
}

/** Makes the registered overlay script and the stored list match Chrome's permissions. */
export async function syncSites(store: BlobStore): Promise<string[]> {
  const sites = await grantedSites();
  const registered = await browser.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (sites.length === 0) {
    if (registered.length) await browser.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  } else {
    const script = { id: SCRIPT_ID, matches: sites, js: [OVERLAY_SCRIPT], runAt: 'document_idle' as const };
    if (registered.length) await browser.scripting.updateContentScripts([script]);
    else await browser.scripting.registerContentScripts([{ ...script, persistAcrossSessions: true }]);
  }
  await store.setSites(sites);
  return sites;
}

/**
 * Puts the overlay into a tab and opens it. Throws if Chrome refuses, for
 * example on a page type extensions are not allowed to touch.
 */
export async function activateTab(tabId: number): Promise<void> {
  await browser.scripting.executeScript({ target: { tabId }, files: [`/${OVERLAY_SCRIPT}`] });
  await browser.tabs.sendMessage(tabId, { type: 'overlay/open' });
}

/** After access is granted, show Blob on tabs of that website that are already open. */
export async function showOnOpenTabs(patterns: string[]): Promise<void> {
  if (patterns.length === 0) return;
  const tabs = await browser.tabs.query({ url: patterns }).catch(() => []);
  await Promise.all(
    tabs.map((tab) =>
      tab.id === undefined
        ? undefined
        : browser.scripting
            .executeScript({ target: { tabId: tab.id }, files: [`/${OVERLAY_SCRIPT}`] })
            .catch(() => undefined),
    ),
  );
}

/** Gives up lasting access to a website. Saved comments are not touched. */
export async function disableSite(pattern: string, store: BlobStore): Promise<void> {
  await browser.permissions.remove({ origins: [pattern] }).catch(() => false);
  await syncSites(store);
}
