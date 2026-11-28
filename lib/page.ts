/**
 * Page identity and safe URLs.
 *
 * A conversation belongs to a page, not just a website. Two rules pull in
 * opposite directions here:
 *   1. Different pages must stay separate, including pages told apart only by
 *      a query string (`?id=42`) or a hash route (`#/settings`).
 *   2. Secrets that happen to be in the address must never be saved.
 *
 * So Blob keeps the address as-is and removes only what is listed below.
 */

import { LIMITS } from './types';

/** Query parameters that carry sign-in or session secrets. Removed everywhere. */
const SECRET_PARAM =
  /^(access_?token|id_?token|refresh_?token|auth_?token|token|auth|authorization|bearer|api_?key|apikey|client_?secret|secret|password|passwd|pwd|pass|session|session_?id|sessionid|sid|phpsessid|jsessionid|aspsessionid\w*|sso|ticket|otp|nonce|signature|sig|x-amz-\w[\w-]*|x-goog-\w[\w-]*)$/i;

/** Parameters added by ad and email tracking. They do not identify a page. */
const TRACKING_PARAM = /^(utm_\w+|fbclid|gclid|gbraid|wbraid|dclid|msclkid|mc_eid|mc_cid|_ga|_gl|igshid|yclid)$/i;

export interface PageInfo {
  origin: string;
  /** Stable identity used to group conversations. */
  key: string;
  /** Sanitised address that can be opened again. */
  url: string;
  /** Short path for lists, e.g. "/pricing?plan=team". */
  label: string;
  host: string;
}

/** Ordinary web pages only. Browser pages, files and extensions are not supported. */
export function isSupportedUrl(href: string | undefined | null): boolean {
  if (!href) return false;
  try {
    const url = new URL(href);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    // Chrome never allows extensions to run on its own store.
    if (url.hostname === 'chromewebstore.google.com') return false;
    if (url.hostname === 'chrome.google.com' && url.pathname.startsWith('/webstore')) return false;
    return true;
  } catch {
    return false;
  }
}

function cleanParams(params: URLSearchParams): [string, string][] {
  const all = [...params.entries()];
  // `code` + `state` together are a sign-in redirect; on their own they are
  // ordinary record identifiers and are kept.
  const isSignInRedirect = params.has('code') && params.has('state');
  return all.filter(([name]) => {
    if (SECRET_PARAM.test(name) || TRACKING_PARAM.test(name)) return false;
    if (isSignInRedirect && (name === 'code' || name === 'state')) return false;
    return true;
  });
}

/**
 * A hash is part of the page only when it is a route (`#/inbox`, `#!/inbox`).
 * A plain anchor (`#pricing`) is the same page scrolled elsewhere, and a hash
 * holding key=value pairs is usually a sign-in response, so both are dropped.
 */
function routeHash(hash: string): string {
  if (!/^#!?\//.test(hash)) return '';
  const queryStart = hash.indexOf('?');
  if (queryStart === -1) return hash;
  const kept = cleanParams(new URLSearchParams(hash.slice(queryStart + 1)));
  const query = new URLSearchParams(kept).toString();
  return hash.slice(0, queryStart) + (query ? `?${query}` : '');
}

/** Returns null for anything that is not an ordinary http(s) page. */
export function getPageInfo(href: string): PageInfo | null {
  if (!isSupportedUrl(href)) return null;
  const url = new URL(href);

  // Never keep `user:password@host`.
  url.username = '';
  url.password = '';

  // Drop `;jsessionid=...` style path parameters.
  let path = url.pathname.replace(/;[^/]*/g, '');
  if (path.length > 1) path = path.replace(/\/+$/, '');
  if (!path) path = '/';

  const kept = cleanParams(url.searchParams);
  const navigableQuery = new URLSearchParams(kept).toString();
  // Order of parameters does not change which page it is.
  const sorted = [...kept].sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  const identityQuery = new URLSearchParams(sorted).toString();
  const hash = routeHash(url.hash);

  const origin = url.origin;
  const key = origin + path + (identityQuery ? `?${identityQuery}` : '') + hash;
  const safeUrl = origin + path + (navigableQuery ? `?${navigableQuery}` : '') + hash;
  let label = path + (navigableQuery ? `?${navigableQuery}` : '') + hash;
  if (label.length > LIMITS.label) label = `${label.slice(0, LIMITS.label - 1)}…`;

  return { origin, key, url: safeUrl, label, host: url.host };
}

/** `https://www.example.com` -> `example.com`. For display only. */
export function hostLabel(origin: string): string {
  try {
    return new URL(origin).host.replace(/^www\./, '');
  } catch {
    return origin;
  }
}

/** The match pattern Chrome uses for "this website", e.g. `https://example.com/*`. */
export function originPattern(origin: string): string {
  const url = new URL(origin);
  // Match patterns do not include a port; Chrome matches every port on the host.
  return `${url.protocol}//${url.hostname}/*`;
}

/** True when one of Chrome's granted match patterns covers this website. */
export function siteEnabled(patterns: string[], origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  return patterns.some((pattern) => {
    const parts = /^(\*|https?):\/\/([^/]+)\//.exec(pattern);
    if (!parts) return false;
    const [, scheme, host] = parts as unknown as [string, string, string];
    if (scheme !== '*' && `${scheme}:` !== url.protocol) return false;
    if (host === '*') return true;
    if (host.startsWith('*.')) return url.hostname === host.slice(2) || url.hostname.endsWith(host.slice(1));
    return host === url.hostname;
  });
}

/**
 * A website's icon address, if it is one Blob is willing to show: an ordinary
 * web address or an embedded image. Anything else (scripts, files, browser
 * pages) is refused. The address is only ever displayed, never saved.
 */
export function safeIconUrl(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  if (/^data:image\/(png|jpeg|gif|webp|svg\+xml|x-icon|vnd\.microsoft\.icon)[;,]/i.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    url.username = '';
    url.password = '';
    return url.href;
  } catch {
    return undefined;
  }
}

export function cleanTitle(title: string | undefined | null): string {
  const text = (title ?? '').replace(/\s+/g, ' ').trim();
  return text.length > LIMITS.title ? `${text.slice(0, LIMITS.title - 1)}…` : text;
}
