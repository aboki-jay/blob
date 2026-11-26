/** Where people can reach the Blob project. It forwards to the maintainer's inbox. */
export const CONTACT_EMAIL = 'blob@davidokunlola.com';

/**
 * A link that opens the person's own mail app with a message already started.
 * Blob sends nothing itself: the person reads the message and chooses to send it.
 */
export function feedbackMailto(rating: string, text: string): string {
  const lines = [rating ? `How I like Blob: ${rating}` : '', text.trim()].filter(Boolean);
  const query = new URLSearchParams({ subject: 'Blob feedback', body: lines.join('\n\n') });
  // Mail apps expect %20 for spaces, not the + that URLSearchParams writes.
  return `mailto:${CONTACT_EMAIL}?${query.toString().replace(/\+/g, '%20')}`;
}
