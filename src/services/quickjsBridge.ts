/**
 * QuickJS extension bridge
 *
 * Runs Paperback extension bundles in the vendored QuickJS-NG engine (the same
 * one the Kotlin port uses) instead of a hidden WebView, and answers the
 * engine's device calls - network, cookies, Cloudflare handoff, per-source
 * storage - from React Native.
 *
 * The engine side of the contract lives in
 * `modules/paperback-quickjs/android/src/main/assets/js/prelude.js`:
 *
 *   JS -> RN   __paperbackNative(op, argsJson, id)
 *   RN -> JS   native.complete(id, json, isError)   -> __paperbackResolve
 *
 * Ops that reach this file: `request`, `state.*`, `requestManager.create`,
 * `home.section` (streamed sections). `log`/`timer.*` are answered natively.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getBrowserAuthHosts,
  getBrowserAuthToken,
  getCookies as getNativeCookies,
} from 'cloudflare-bypass';
import type { ExtensionBridge } from './sourceService';
import { getCookiesForUrl, getGlobalUserAgent, setCookiesForDomain } from './cookieStore';
import { appendPaperbackRequestParams } from './paperbackRequestUtils';

interface NativeCallEvent {
  sourceId: string;
  op: string;
  id: number;
  args: string;
}

interface EventSubscription {
  remove(): void;
}

interface QuickJsNativeModule {
  version(): string;
  selfTest(): string;
  loadSource(sourceId: string, code: string, apiVersion: string): string;
  evalScript(sourceId: string, code: string, filename: string): string | null;
  invoke(
    sourceId: string,
    method: string,
    argsJson: string,
    streamId: number,
    timeoutSeconds: number
  ): Promise<string>;
  complete(sourceId: string, callId: number, json: string | null, isError: boolean): boolean;
  unloadSource(sourceId: string): boolean;
  shutdown(): boolean;
  addListener(event: 'onNativeCall', listener: (event: NativeCallEvent) => void): EventSubscription;
}

const FALLBACK_UA =
  'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36';

const BINARY_URL = /\.(jpe?g|png|gif|webp|avif|bmp)(\?|#|$)/i;

const STATE_PREFIX = '@extension_state_';

let native: QuickJsNativeModule | null = null;
let listener: EventSubscription | null = null;

/** One runtime per source; only the sources loaded here are answered. */
const loadedSources = new Set<string>();
/** Serialises calls per source: the engine is single-threaded anyway. */
const sourceQueues = new Map<string, Promise<unknown>>();
/** Sections streamed while a `getHomePageSections` call is pending. */
const streamedSections = new Map<number, any[]>();
/** `App.createRequestManager` settings per manager id. */
const requestManagers = new Map<number, { requestsPerSecond: number; requestTimeoutMs: number }>();
/** Next free start time (ms, `Date.now()` based) per manager - the rate limiter. */
const requestSlots = new Map<string, number>();

let nextStreamId = 1_000_000;

const YURI_GARDEN_SCRAMBLE_PREFIX = 'yg-scramble:';

export const isQuickJsAvailable = (): boolean => {
  try {
    getNative();
    return true;
  } catch {
    return false;
  }
};

function getNative(): QuickJsNativeModule {
  if (native) return native;
  // Required lazily so a build without the module still loads the app.
  const { requireNativeModule } = require('expo-modules-core') as typeof import('expo-modules-core');
  native = requireNativeModule<QuickJsNativeModule>('PaperbackQuickJs');
  if (!listener) {
    listener = native.addListener('onNativeCall', handleNativeCall);
  }
  return native;
}

const completeOk = (sourceId: string, id: number, value: unknown) => {
  try {
    getNative().complete(sourceId, id, JSON.stringify(value === undefined ? null : value), false);
  } catch (error) {
    console.warn('[QuickJS] complete failed:', error);
  }
};

const completeError = (sourceId: string, id: number, message: string) => {
  try {
    getNative().complete(sourceId, id, message, true);
  } catch (error) {
    console.warn('[QuickJS] complete(error) failed:', error);
  }
};

function handleNativeCall(event: NativeCallEvent) {
  const { sourceId, op, id } = event;
  let args: any = null;
  try {
    args = event.args ? JSON.parse(event.args) : null;
  } catch {
    args = null;
  }

  switch (op) {
    case 'request':
      void handleRequest(sourceId, args || {}, id);
      return;
    case 'requestManager.create': {
      const managerId = Number(args?.id) || 0;
      requestManagers.set(managerId, {
        requestsPerSecond: Number(args?.requestsPerSecond) || 5,
        requestTimeoutMs: Number(args?.requestTimeout) || 20000,
      });
      completeOk(sourceId, id, true);
      return;
    }
    case 'state.get':
      void handleStateGet(sourceId, args || {}, id);
      return;
    case 'state.set':
      void handleStateSet(sourceId, args || {}, id);
      return;
    case 'state.remove':
      void handleStateRemove(sourceId, args || {}, id);
      return;
    case 'state.list':
      void handleStateList(sourceId, args || {}, id);
      return;
    case 'home.section': {
      const bucket = streamedSections.get(id);
      if (bucket && args) bucket.push(args);
      return;
    }
    default:
      console.warn(`[QuickJS] unhandled op: ${op}`);
      completeOk(sourceId, id, null);
  }
}

// ------------------------------------------------------------------- storage --

const stateKey = (sourceId: string, secure: boolean, key: string) =>
  `${STATE_PREFIX}${sourceId}_${secure ? 'secure_' : ''}${key}`;

async function handleStateGet(sourceId: string, args: any, callId: number) {
  try {
    const raw = await AsyncStorage.getItem(stateKey(sourceId, !!args.secure, String(args.key)));
    completeOk(sourceId, callId, raw === null ? null : JSON.parse(raw));
  } catch (error: any) {
    completeError(sourceId, callId, error?.message || 'state.get failed');
  }
}

async function handleStateSet(sourceId: string, args: any, callId: number) {
  try {
    await AsyncStorage.setItem(
      stateKey(sourceId, !!args.secure, String(args.key)),
      JSON.stringify(args.value ?? null)
    );
    completeOk(sourceId, callId, true);
  } catch (error: any) {
    completeError(sourceId, callId, error?.message || 'state.set failed');
  }
}

async function handleStateRemove(sourceId: string, args: any, callId: number) {
  try {
    await AsyncStorage.removeItem(stateKey(sourceId, !!args.secure, String(args.key)));
    completeOk(sourceId, callId, true);
  } catch (error: any) {
    completeError(sourceId, callId, error?.message || 'state.remove failed');
  }
}

async function handleStateList(sourceId: string, args: any, callId: number) {
  try {
    const prefix = stateKey(sourceId, !!args.secure, '');
    const keys = await AsyncStorage.getAllKeys();
    completeOk(
      sourceId,
      callId,
      keys.filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length))
    );
  } catch (error: any) {
    completeError(sourceId, callId, error?.message || 'state.list failed');
  }
}

// ------------------------------------------------------------------- network --

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i];
    const b2 = i + 1 < bytes.length ? bytes[i + 1] : NaN;
    const b3 = i + 2 < bytes.length ? bytes[i + 2] : NaN;
    out += BASE64_ALPHABET.charAt(b1 >> 2);
    out += BASE64_ALPHABET.charAt(((b1 & 3) << 4) | (Number.isNaN(b2) ? 0 : b2 >> 4));
    out += Number.isNaN(b2) ? '=' : BASE64_ALPHABET.charAt(((b2 & 15) << 2) | (Number.isNaN(b3) ? 0 : b3 >> 6));
    out += Number.isNaN(b3) ? '=' : BASE64_ALPHABET.charAt(b3 & 63);
  }
  return out;
}

/** Resolves with [promise] or falls back once [ms] elapsed - native helpers must never stall a request. */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>(resolve => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, ms);
    promise.then(
      value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}

async function buildRequestHeaders(sourceId: string, url: string, extra: Record<string, string>) {
  const headers: Record<string, string> = {
    'User-Agent': getGlobalUserAgent() || FALLBACK_UA,
    Accept: '*/*',
    ...extra,
  };

  let storedCookies = getCookiesForUrl(url);
  if (!storedCookies || !storedCookies.includes('cf_clearance')) {
    // The native CookieManager lives on the UI thread; if it is slow or
    // unavailable the request still goes out with the in-memory jar.
    const nativeCookies = await withTimeout(getNativeCookies(url), 1500, '');
    if (nativeCookies && nativeCookies.includes('cf_clearance')) {
      storedCookies = nativeCookies;
      setCookiesForDomain(url, nativeCookies);
    }
  }
  if (storedCookies) {
    const existing = Object.keys(headers).find(key => key.toLowerCase() === 'cookie');
    headers[existing || 'Cookie'] = existing
      ? `${headers[existing]}; ${storedCookies}`
      : storedCookies;
  }

  const hasAuthorization = Object.keys(headers).some(key => key.toLowerCase() === 'authorization');
  if (!hasAuthorization) {
    const [token, allowedHosts] = await withTimeout(
      Promise.all([getBrowserAuthToken(sourceId), getBrowserAuthHosts(sourceId)]),
      1500,
      ['', [] as string[]]
    );
    try {
      const host = new URL(url).hostname.toLowerCase();
      const allowed = (allowedHosts || []).some(
        candidate => host === candidate || host.endsWith(`.${candidate}`)
      );
      if (token && allowed) headers.Authorization = `Bearer ${token}`;
    } catch {
      // Malformed URL: no Cloudflare session to attach.
    }
  }

  return headers;
}

/**
 * Paperback's `RequestManager.schedule` never starts more than
 * `requestsPerSecond` requests: a chapter of 200 E-Hentai pages issues 200
 * `request` ops at once and, without pacing, they all sit in OkHttp's queue
 * until their own 30 s timeout aborts them. Pace the starts like the Kotlin
 * port does and let the timeout clock begin when the request actually starts.
 */
async function waitForRequestSlot(key: string, requestsPerSecond: number) {
  if (!Number.isFinite(requestsPerSecond) || requestsPerSecond <= 0) return;
  const interval = 1000 / requestsPerSecond;
  const now = Date.now();
  const startAt = Math.max(now, requestSlots.get(key) ?? 0);
  requestSlots.set(key, startAt + interval);
  const delay = startAt - now;
  if (delay > 0) {
    await new Promise<void>(resolve => setTimeout(resolve, delay));
  }
}

async function handleRequest(sourceId: string, args: any, callId: number) {
  const manager = requestManagers.get(Number(args.managerId));
  const timeoutMs = Math.min(
    Math.max(manager?.requestTimeoutMs || Number(args.requestTimeout) || 20000, 1000),
    120000
  );

  let url: string;
  try {
    url = appendPaperbackRequestParams(String(args.url || ''), args.param);
    // Validate early: a bad URL must reject the extension promise, not crash.
    void new URL(url);
  } catch {
    completeError(sourceId, callId, `invalid request url: ${args.url}`);
    return;
  }

  const method = String(args.method || 'GET').toUpperCase();
  const isBinaryRequest =
    BINARY_URL.test(url) || String(args.responseType || '').toLowerCase() === 'arraybuffer';

  let body: string | undefined;
  if (method !== 'GET' && method !== 'HEAD' && args.data !== undefined && args.data !== null) {
    body = typeof args.data === 'string' ? args.data : JSON.stringify(args.data);
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;

  try {
    await waitForRequestSlot(
      `${sourceId}/${Number(args.managerId) || 0}`,
      Number(args.requestsPerSecond ?? manager?.requestsPerSecond ?? 0)
    );
    timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers = await buildRequestHeaders(sourceId, url, args.headers || {});
    const response = await fetch(url, { method, headers, body, signal: controller.signal });
    if (timer) clearTimeout(timer);

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    const contentType = responseHeaders['content-type'] || '';
    const isBinary =
      isBinaryRequest ||
      /^image\//i.test(contentType) ||
      /application\/(octet-stream|zip)/i.test(contentType);

    const payload: Record<string, any> = {
      status: response.status,
      url: response.url || url,
      headers: responseHeaders,
    };

    if (isBinary) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      payload.data = '';
      payload.rawData = toBase64(bytes);
      payload.isBinary = true;
    } else {
      payload.data = await response.text();
    }

    completeOk(sourceId, callId, payload);
  } catch (error: any) {
    if (timer) clearTimeout(timer);
    const message = error?.name === 'AbortError' ? `request timed out after ${timeoutMs}ms` : error?.message;
    console.warn(`[QuickJS] request failed: ${url} - ${message}`);
    completeError(sourceId, callId, message || 'request failed');
  }
}

// ------------------------------------------------------------------- methods --

function parseJson(raw: string | null | undefined): any {
  if (raw === null || raw === undefined || raw === '') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function enqueue<T>(sourceId: string, task: () => Promise<T>): Promise<T> {
  const previous = sourceQueues.get(sourceId) || Promise.resolve();
  const next = previous.then(task, task);
  sourceQueues.set(
    sourceId,
    next.catch(() => undefined)
  );
  return next;
}

const isYuriGardenChapterImageUrl = (url: unknown): url is string =>
  typeof url === 'string' &&
  /^https:\/\/(?:db\.yurigarden\.com|cdn\.yurigarden\.moe)\/.+\/chapters\/\d+\/.+/i.test(url);

function encodeScramblePayload(payload: { url: string; decoded?: number[] }): string | null {
  try {
    return YURI_GARDEN_SCRAMBLE_PREFIX + btoa(JSON.stringify(payload));
  } catch {
    return null;
  }
}

/**
 * `getChapterDetails` returns `{ pages: [{ url, ... }] }`; the reader wants a
 * plain string per page, with scrambled/DRM pages marked through `drm://`.
 */
function normalizeChapterPages(extensionId: string, details: any): string[] {
  const raw = Array.isArray(details) ? details : details?.pages;
  if (!Array.isArray(raw)) return [];

  return raw.map((page: any) => {
    let url =
      typeof page === 'string'
        ? page
        : page?.url || page?.image || page?.imageUrl || String(page);

    const payload =
      page && typeof page === 'object' && Array.isArray(page.decoded) && page.decoded.length > 0
        ? encodeScramblePayload({ url, decoded: page.decoded })
        : isYuriGardenChapterImageUrl(url)
          ? encodeScramblePayload({ url })
          : null;

    if (payload) url = `drm://${extensionId}/${payload}`;
    else if (url && url.includes('#drm_data=')) url = `drm://${extensionId}/${url}`;

    return url;
  });
}

function timeoutForMethod(method: string): number {
  return method === 'getChapterDetails' ? 120 : 60;
}

/**
 * Fetches an image through the source's own request manager so headers,
 * cookies and Cloudflare clearance match. Used by the reader/downloads.
 * `__paperbackFetchImage` is installed by the native module on load.
 */
function fetchImageDataUrl(sourceId: string, imageUrl: string): Promise<string | null> {
  return enqueue(sourceId, async () => {
    const raw = await getNative().invoke(
      sourceId,
      '__paperbackFetchImage',
      JSON.stringify([imageUrl]),
      0,
      120
    );
    return parseJson(raw);
  });
}

export function createQuickJsBridge(): ExtensionBridge {
  return {
    loadExtension: async (extensionId, sourceJs, apiVersion) => {
      try {
        const module = getNative();
        const capabilities = module.loadSource(
          extensionId,
          sourceJs,
          apiVersion === '0.9' ? '0.9' : '0.8'
        );
        loadedSources.add(extensionId);
        console.log(
          `[QuickJS] loaded ${extensionId} (${apiVersion}) on QuickJS ${module.version()}: ${capabilities}`
        );
        return true;
      } catch (error: any) {
        loadedSources.delete(extensionId);
        console.warn(`[QuickJS] failed to load ${extensionId}:`, error?.message || error);
        return false;
      }
    },

    runExtensionMethod: async (extensionId, method, args) => {
      if (!loadedSources.has(extensionId)) {
        throw new Error(`Extension not loaded: ${extensionId}`);
      }

      if (method === 'fetchImage' || method === 'decryptDrmImage') {
        const dataUrl = await fetchImageDataUrl(extensionId, String(args?.[0] || ''));
        if (!dataUrl) throw new Error(`${method} is not available through QuickJS`);
        return dataUrl;
      }

      return enqueue(extensionId, async () => {
        const streaming = method === 'getHomePageSections';
        const streamId = streaming ? nextStreamId++ : 0;
        if (streaming) streamedSections.set(streamId, []);

        try {
          const raw = await getNative().invoke(
            extensionId,
            method,
            JSON.stringify(Array.isArray(args) ? args : []),
            streamId,
            timeoutForMethod(method)
          );

          if (streaming) return streamedSections.get(streamId) || [];
          const value = parseJson(raw);
          if (method === 'getChapterDetails') {
            return { pages: normalizeChapterPages(extensionId, value) };
          }
          return value;
        } finally {
          if (streaming) streamedSections.delete(streamId);
        }
      });
    },

    isLoaded: (extensionId: string) => loadedSources.has(extensionId),

    invalidateExtension: async (extensionId: string) => {
      loadedSources.delete(extensionId);
      sourceQueues.delete(extensionId);
      // Sections are keyed by stream id and cleared when a call finishes.
      try {
        getNative().unloadSource(extensionId);
      } catch (error) {
        console.warn(`[QuickJS] could not unload ${extensionId}:`, error);
      }
    },
  };
}
