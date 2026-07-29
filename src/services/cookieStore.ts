/**
 * Cookie Store - Bridges WebView cookies to native fetch requests
 *
 * After Cloudflare bypass in WebView, cookies are extracted and stored here.
 * The ExtensionRunner fetch proxy reads from this store to include cookies.
 */

// domain -> cookie string
const cookieStore: Map<string, string> = new Map();

// Store the extracted User-Agent from WebView
let globalUserAgent: string | undefined;

export const setGlobalUserAgent = (ua: string) => {
  globalUserAgent = ua;
};

export const getGlobalUserAgent = (): string | undefined => {
  return globalUserAgent;
};

/**
 * Store cookies for a domain (extracted from WebView)
 */
export const setCookiesForDomain = (domain: string, cookies: string) => {
  // Normalize domain - strip protocol, path, port
  const normalized = normalizeDomain(domain);
  const existing = cookieStore.get(normalized) || '';

  // Merge cookies (new ones override existing)
  const merged = mergeCookies(existing, cookies);
  cookieStore.set(normalized, merged);

  console.log(`[CookieStore] Set cookies for ${normalized}: ${merged.substring(0, 100)}...`);
};

/**
 * Get cookies for a URL (matches domain and parent domains)
 */
export const getCookiesForUrl = (url: string): string => {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;

    // Try exact match first, then parent domains
    // e.g., for api.yurigarden.com, try:
    //   api.yurigarden.com → yurigarden.com → com
    const parts = hostname.split('.');
    const cookies: string[] = [];

    for (let i = 0; i < parts.length - 1; i++) {
      const domain = parts.slice(i).join('.');
      const stored = cookieStore.get(domain);
      if (stored) {
        cookies.push(stored);
      }
    }

    return cookies.join('; ');
  } catch {
    return '';
  }
};

/**
 * Clear all stored cookies
 */
export const clearCookies = () => {
  cookieStore.clear();
};

function normalizeDomain(urlOrDomain: string): string {
  try {
    if (urlOrDomain.includes('://')) {
      const urlObj = new URL(urlOrDomain);
      return urlObj.hostname;
    }
    return urlOrDomain.replace(/^\./, '');
  } catch {
    return urlOrDomain;
  }
}

function mergeCookies(existing: string, incoming: string): string {
  const cookieMap = new Map<string, string>();

  // Parse existing
  if (existing) {
    for (const part of existing.split(';')) {
      const trimmed = part.trim();
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        cookieMap.set(trimmed.substring(0, eqIdx).trim(), trimmed);
      }
    }
  }

  // Parse incoming (overrides existing)
  if (incoming) {
    for (const part of incoming.split(';')) {
      const trimmed = part.trim();
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        cookieMap.set(trimmed.substring(0, eqIdx).trim(), trimmed);
      }
    }
  }

  return Array.from(cookieMap.values()).join('; ');
}
