/**
 * Sending feedback to the Blob project.
 *
 * This is the one place Blob talks to a server, and only when someone presses
 * Submit on the feedback form. It sends the rating, the text and Blob's version
 * number to the relay in `worker/feedback/`, which emails them to the
 * maintainer. Nothing about the page being viewed or any saved comment is
 * included. Everything else in Blob works with this switched off.
 */

import { BlobError } from './storage/store';

/** The ratings the form offers. The relay accepts exactly these. */
export const RATINGS = ['Frustrated', 'Neutral', 'Okay', 'Good'] as const;
export type Rating = (typeof RATINGS)[number] | '';

export const FEEDBACK_MAX = 2000;

/**
 * Where the relay lives. Set it to '' to switch feedback sending off: the form
 * then offers an email link instead. The browser tests use a local stand-in so
 * they never send real feedback.
 */
export const FEEDBACK_ENDPOINT: string =
  import.meta.env.MODE === 'e2e' ? 'http://127.0.0.1:43117/__feedback' : 'https://blob-feedback.davidokunlola.com/';

export interface FeedbackInput {
  rating: Rating;
  text: string;
}

/** Posts feedback to the relay. Throws a BlobError if it cannot be delivered. */
export async function postFeedback(input: FeedbackInput, version: string, endpoint: string = FEEDBACK_ENDPOINT): Promise<void> {
  if (!endpoint) throw new BlobError('unavailable', 'Feedback sending is not set up.');
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rating: input.rating, text: input.text, version }),
      // No cookies or other credentials go with it.
      credentials: 'omit',
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new BlobError('send-failed', error instanceof Error ? error.message : String(error));
  }
  if (!response.ok) throw new BlobError('send-failed', `The feedback service answered ${response.status}.`);
}
