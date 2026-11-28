/**
 * Blob's feedback relay: a Cloudflare Worker.
 *
 * It does one thing. Blob's feedback form posts a rating and some text here,
 * and this emails them to the maintainer. It is the only server-side piece of
 * Blob; commenting never touches it.
 *
 * It stores nothing and logs no message content. On Cloudflare's free plan it
 * can only send to the account's own verified addresses, which is all it needs.
 */

/** The ratings the form offers. Anything else is refused. */
export const RATINGS = ['Frustrated', 'Neutral', 'Okay', 'Good'] as const;

const MAX_TEXT = 2000;
const MAX_BODY_BYTES = 8 * 1024;

export interface Env {
  /** Cloudflare Email Sending. */
  EMAIL: { send(message: { to: string; from: { email: string; name: string }; subject: string; text: string }): Promise<{ messageId: string }> };
  /** Counts requests per sender so the form cannot be used to flood the inbox. */
  LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  /** Where feedback is delivered. A secret, so the address is not in the repository. */
  FEEDBACK_TO?: string;
  /** The address feedback is sent from, on the onboarded domain. */
  FEEDBACK_FROM?: string;
}

// Blob is a browser extension, so requests come from many origins. There are no
// cookies or credentials involved, which is what makes "any origin" safe here.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

const reply = (status: number, body: { ok: boolean; error?: string }) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

interface Feedback {
  rating: string;
  text: string;
  version: string;
}

/** Checks untrusted input. Returns the cleaned feedback, or null if it is not acceptable. */
export function parseFeedback(value: unknown): Feedback | null {
  if (typeof value !== 'object' || value === null) return null;
  const input = value as Record<string, unknown>;
  const rating = typeof input.rating === 'string' ? input.rating : '';
  if (rating && !(RATINGS as readonly string[]).includes(rating)) return null;
  if (input.text !== undefined && typeof input.text !== 'string') return null;
  const text = (input.text ?? '').trim();
  if (text.length > MAX_TEXT) return null;
  if (!rating && !text) return null;
  const version = typeof input.version === 'string' && /^[\w.-]{1,20}$/.test(input.version) ? input.version : 'unknown';
  return { rating, text, version };
}

export async function handle(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return reply(405, { ok: false, error: 'method-not-allowed' });
  if (!env.FEEDBACK_TO || !env.FEEDBACK_FROM) return reply(503, { ok: false, error: 'not-configured' });

  // A few messages a minute per sender is plenty for a feedback form.
  const sender = request.headers.get('cf-connecting-ip') ?? 'unknown';
  if (env.LIMITER && !(await env.LIMITER.limit({ key: sender })).success) {
    return reply(429, { ok: false, error: 'too-many-requests' });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return reply(413, { ok: false, error: 'too-large' });
  let feedback: Feedback | null = null;
  try {
    feedback = parseFeedback(JSON.parse(raw));
  } catch {
    feedback = null;
  }
  if (!feedback) return reply(400, { ok: false, error: 'invalid' });

  try {
    await env.EMAIL.send({
      to: env.FEEDBACK_TO,
      from: { email: env.FEEDBACK_FROM, name: 'Blob feedback' },
      // The rating comes from a fixed list, so the subject cannot be forged.
      subject: `Blob feedback: ${feedback.rating || 'no rating'}`,
      // Plain text only. Nothing a sender types is ever treated as HTML.
      text: [`Rating: ${feedback.rating || 'not given'}`, `Blob version: ${feedback.version}`, '', feedback.text || '(no message)'].join('\n'),
    });
  } catch (error) {
    // Log why it failed, never what was written.
    console.error('feedback send failed:', (error as { code?: string }).code ?? 'unknown');
    return reply(502, { ok: false, error: 'send-failed' });
  }
  return reply(200, { ok: true });
}

export default { fetch: handle };
