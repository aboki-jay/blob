import { describe, expect, it } from 'vitest';
import { getPageInfo, isSupportedUrl, originPattern, safeIconUrl, siteEnabled } from '@/lib/page';

const key = (href: string) => getPageInfo(href)?.key;

describe('page identity', () => {
  it('keeps two pages on the same website separate', () => {
    expect(key('https://example.com/')).not.toBe(key('https://example.com/pricing'));
    expect(getPageInfo('https://example.com/pricing')?.origin).toBe('https://example.com');
  });

  it('treats a query string as part of the page', () => {
    expect(key('https://example.com/item?id=1')).not.toBe(key('https://example.com/item?id=2'));
  });

  it('treats a hash route as part of the page, but not a plain anchor', () => {
    expect(key('https://app.example.com/#/inbox')).not.toBe(key('https://app.example.com/#/settings'));
    expect(key('https://example.com/docs#install')).toBe(key('https://example.com/docs'));
  });

  it('ignores parameter order, tracking parameters and a trailing slash', () => {
    expect(key('https://example.com/a/?b=2&a=1&utm_source=mail&fbclid=xyz')).toBe(key('https://example.com/a?a=1&b=2'));
  });

  it('keeps ports apart', () => {
    expect(key('http://localhost:3000/')).not.toBe(key('http://localhost:4000/'));
  });
});

describe('safe URLs', () => {
  it('never keeps credentials or session tokens', () => {
    const info = getPageInfo(
      'https://user:hunter2@example.com/account;jsessionid=ABC123?token=SECRET1&access_token=SECRET2&order=42&sid=SECRET3#/profile?api_key=SECRET4&tab=billing',
    )!;
    for (const text of [info.key, info.url, info.label]) {
      expect(text).not.toMatch(/hunter2|user:|SECRET|ABC123|jsessionid/);
    }
    // ...while the parts that identify the page survive.
    expect(info.url).toBe('https://example.com/account?order=42#/profile?tab=billing');
  });

  it('drops a sign-in redirect but keeps an ordinary `code` parameter', () => {
    expect(getPageInfo('https://example.com/callback?code=abc&state=xyz')?.url).toBe('https://example.com/callback');
    expect(getPageInfo('https://example.com/promo?code=SPRING')?.url).toBe('https://example.com/promo?code=SPRING');
  });

  it('drops a hash that carries a sign-in response', () => {
    expect(getPageInfo('https://example.com/done#access_token=SECRET&expires_in=3600')?.url).toBe('https://example.com/done');
  });
});

describe('supported pages', () => {
  it('accepts ordinary web pages only', () => {
    expect(isSupportedUrl('https://example.com/')).toBe(true);
    expect(isSupportedUrl('http://localhost:5173/')).toBe(true);
    for (const href of ['chrome://extensions', 'chrome-extension://abc/popup.html', 'file:///C:/notes.html', 'about:blank', 'https://chromewebstore.google.com/detail/x', '', undefined]) {
      expect(isSupportedUrl(href)).toBe(false);
      expect(getPageInfo(href ?? '')).toBeNull();
    }
  });
});

describe('site access patterns', () => {
  it('builds the pattern Chrome uses for one website', () => {
    expect(originPattern('https://example.com')).toBe('https://example.com/*');
    expect(originPattern('http://localhost:3000')).toBe('http://localhost/*');
  });

  it('matches only the granted website', () => {
    const granted = ['https://example.com/*', 'https://*.wiki.org/*'];
    expect(siteEnabled(granted, 'https://example.com')).toBe(true);
    expect(siteEnabled(granted, 'http://example.com')).toBe(false);
    expect(siteEnabled(granted, 'https://other.com')).toBe(false);
    expect(siteEnabled(granted, 'https://en.wiki.org')).toBe(true);
    expect(siteEnabled([], 'https://example.com')).toBe(false);
  });
});

describe('website icons', () => {
  it('accepts ordinary web addresses and embedded images', () => {
    expect(safeIconUrl('https://example.com/favicon.ico')).toBe('https://example.com/favicon.ico');
    expect(safeIconUrl('http://localhost:3000/icon.svg')).toBe('http://localhost:3000/icon.svg');
    expect(safeIconUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
  });

  it('refuses anything else, and never keeps credentials', () => {
    for (const value of ['javascript:alert(1)', 'chrome://favicon/https://example.com', 'file:///C:/icon.png', 'data:text/html,<script>1</script>', 'not a url', '', undefined, null]) {
      expect(safeIconUrl(value)).toBeUndefined();
    }
    expect(safeIconUrl('https://user:hunter2@example.com/favicon.ico')).toBe('https://example.com/favicon.ico');
  });
});
