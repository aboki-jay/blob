/**
 * Random values and one-way scrambles. All of it is quick: Cloudflare's free
 * plan allows about 10 ms of processor time per request, which rules out the
 * deliberately slow scrambles used for passwords. Blob has no passwords.
 */

const encoder = new TextEncoder();

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

/** A random, URL-safe value that cannot be guessed. 32 bytes by default. */
export function randomToken(bytes = 32): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  let binary = '';
  for (const byte of buffer) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** What is stored for a session: its secret can be checked but not read back. */
export async function sha256(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

/**
 * The stored form of a sign-in identity (Google's account number, or an email
 * address). It is scrambled with a key only the server holds, so the database
 * alone cannot be used to test whether a known address has an account.
 */
export async function fingerprint(key: string, kind: string, subject: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(`${kind}:${subject}`)));
}
