import { handleRequest, type Sender } from '@/lib/handler';
import { activateTab, disableSite, showOnOpenTabs, syncSites } from '@/lib/sites';
import { BlobStore, type StorageArea } from '@/lib/storage/store';

/**
 * The background service worker. Chrome starts and stops it at will, so it
 * keeps nothing important in memory: every request reads storage afresh.
 * It is the only part of Blob that writes storage.
 */
export default defineBackground(() => {
  const store = new BlobStore(browser.storage.local as unknown as StorageArea);

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Only Blob's own popup and overlay can reach this listener; web pages cannot.
    if (sender.id !== browser.runtime.id) return false;
    const info: Sender = {
      fromExtensionPage: !sender.tab && (sender.url ?? '').startsWith(browser.runtime.getURL('')),
      pageOrigin: sender.tab ? originOf(sender.url ?? sender.tab.url) : undefined,
    };
    void handleRequest(message, info, {
      store,
      activateTab,
      disableSite: (pattern) => disableSite(pattern, store),
    }).then(sendResponse);
    return true; // the response is sent asynchronously
  });

  // Site access can change from the popup or from Chrome's own settings.
  browser.permissions.onAdded.addListener((added) => {
    void syncSites(store).then(() => showOnOpenTabs(added.origins ?? []));
  });
  browser.permissions.onRemoved.addListener(() => void syncSites(store));

  browser.runtime.onInstalled.addListener(() => void syncSites(store));
  browser.runtime.onStartup.addListener(() => void syncSites(store));
});

function originOf(url: string | undefined): string | undefined {
  try {
    return url ? new URL(url).origin : undefined;
  } catch {
    return undefined;
  }
}
