/**
 * Decides what each request does. Kept free of browser APIs so it can be
 * tested directly; `entrypoints/background.ts` supplies the real ones.
 */

import { parseRequest, type Response } from './messages';
import type { FeedbackInput } from './feedback';
import { cleanTitle, getPageInfo } from './page';
import { BlobError, type BlobStore } from './storage/store';

export interface Sender {
  /** Origin of the page the message came from, when it came from a web page tab. */
  pageOrigin?: string;
  /** True when the message came from Blob's own popup or another extension page. */
  fromExtensionPage: boolean;
}

export interface HandlerDeps {
  store: BlobStore;
  activateTab(tabId: number): Promise<void>;
  disableSite(origin: string): Promise<void>;
  /** Feedback delivery. `enabled` is false where no relay is configured. */
  feedback: { enabled: boolean; send(input: FeedbackInput): Promise<void> };
}

export async function handleRequest(raw: unknown, sender: Sender, deps: HandlerDeps): Promise<Response> {
  const request = parseRequest(raw);
  if (!request) return { ok: false, error: 'invalid' };
  const { store } = deps;
  try {
    switch (request.type) {
      case 'thread/create': {
        const page = getPageInfo(request.href);
        if (!page) throw new BlobError('unsupported-page');
        // A page can only file comments under its own address.
        if (sender.pageOrigin !== page.origin) throw new BlobError('forbidden');
        const thread = await store.createThread({
          id: request.id,
          messageId: request.messageId,
          page,
          title: cleanTitle(request.title),
          anchor: request.anchor,
          body: request.body,
        });
        // The comment is saved, so its draft is no longer needed.
        await store.setDraft(`new:${page.key}`, '').catch(() => undefined);
        return { ok: true, data: thread };
      }
      case 'thread/reply': {
        const thread = await store.addReply(request.threadId, request.messageId, request.body, request.replyTo);
        await store.setDraft(`reply:${request.threadId}`, '').catch(() => undefined);
        return { ok: true, data: thread };
      }
      case 'thread/status':
        return { ok: true, data: await store.setStatus(request.threadId, request.status) };
      case 'thread/reattach':
        return { ok: true, data: await store.reattach(request.threadId, request.anchor) };
      case 'thread/delete':
        await store.deleteThread(request.threadId);
        return { ok: true, data: null };
      case 'draft/set':
        await store.setDraft(request.key, request.text);
        return { ok: true, data: null };
      case 'settings/set':
        return { ok: true, data: await store.updateSettings(request.settings) };
      case 'feedback/status':
        return { ok: true, data: { enabled: deps.feedback.enabled } };
      case 'feedback/send':
        if (!deps.feedback.enabled) throw new BlobError('unavailable');
        await deps.feedback.send({ rating: request.rating, text: request.text });
        return { ok: true, data: null };
      case 'tab/activate':
        if (!sender.fromExtensionPage) throw new BlobError('forbidden');
        await deps.activateTab(request.tabId);
        return { ok: true, data: null };
      case 'site/disable':
        if (!sender.fromExtensionPage) throw new BlobError('forbidden');
        await deps.disableSite(request.origin);
        return { ok: true, data: null };
    }
  } catch (error) {
    if (error instanceof BlobError) return { ok: false, error: error.code, message: error.message };
    return { ok: false, error: 'storage-failed', message: error instanceof Error ? error.message : String(error) };
  }
}
