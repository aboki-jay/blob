import { mountOverlay } from '@/overlay/mount';

/**
 * The on-page overlay: the Blob button, pins, composer and drawer.
 *
 * This is deliberately not listed as a content script in the manifest. It
 * reaches a page in one of two ways, both started by the person:
 *   - the toolbar popup injects it into the current tab (temporary access), or
 *   - the background registers it for a website the person granted access to.
 */
export default defineUnlistedScript(() => {
  mountOverlay();
});
