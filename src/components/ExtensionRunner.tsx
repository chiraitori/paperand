/**
 * Extension Runner - WebView-based Extension Execution
 * 
 * This component runs Paperback extensions in a hidden WebView,
 * allowing ALL extensions to work without hardcoding.
 */

import React, { useRef, useEffect, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import {
  getBrowserAuthHosts,
  getBrowserAuthToken,
  getCookies as getNativeCookies,
} from 'cloudflare-bypass';
import { setExtensionBridge, ExtensionBridge } from '../services/sourceService';
import { getCookiesForUrl, getGlobalUserAgent } from '../services/cookieStore';

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: any) => void;
}

export const ExtensionRunner: React.FC = () => {
  const webViewRef = useRef<WebView>(null);
  const requestIdRef = useRef(0);
  const pendingRequestsRef = useRef<Map<number, PendingRequest>>(new Map());
  const loadedExtensionsRef = useRef<Set<string>>(new Set());

  const sendMessage = useCallback((type: string, data: any): Promise<any> => {
    return new Promise((resolve, reject) => {
      const requestId = ++requestIdRef.current;
      pendingRequestsRef.current.set(requestId, { resolve, reject });

      const message = JSON.stringify({ type, requestId, ...data });
      webViewRef.current?.injectJavaScript(`
        window.handleMessage(${JSON.stringify(message)});
        true;
      `);

      // Large galleries may require resolving hundreds of image-page URLs before
      // Paperback can return ChapterDetails. Keep the normal bridge timeout short,
      // but allow the reader method enough time to finish.
      const timeoutMs = type === 'runMethod' && data?.method === 'getChapterDetails'
        ? 120000
        : 30000;
      setTimeout(() => {
        if (pendingRequestsRef.current.has(requestId)) {
          pendingRequestsRef.current.delete(requestId);
          reject(new Error('Request timeout'));
        }
      }, timeoutMs);
    });
  }, []);

  const handleMessage = useCallback(async (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      const { requestId, type, result, error } = data;

      if (type === 'log') {
        console.log('[ExtensionRunner]', result);
        return;
      }

      // Handle fetch proxy requests from WebView
      if (type === 'fetchProxy') {
        const { url, options, extensionId } = data;
        console.log('[ExtensionRunner] Proxying fetch:', url, 'method:', options?.method);

        // Support both body and data (some extensions use data for form data)
        let requestBody = options?.body || options?.data;

        // Get the real user agent if available, otherwise use fallback
        const userAgent = getGlobalUserAgent() || 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36';

        // Merge default headers with request headers (request headers take priority)
        const defaultHeaders: Record<string, string> = {
          'User-Agent': userAgent,
          'Accept': 'application/json, text/plain, */*',
        };
        const headers: Record<string, string> = { ...defaultHeaders, ...options?.headers };

        // Include stored cookies from WebView bypass (Cloudflare cf_clearance etc.)
        let storedCookies = getCookiesForUrl(url);

        // Fallback: try reading from native Android CookieManager
        if (!storedCookies || !storedCookies.includes('cf_clearance')) {
          try {
            const nativeCookies = await getNativeCookies(url);
            if (nativeCookies && nativeCookies.includes('cf_clearance')) {
              storedCookies = nativeCookies;
              // Also update the in-memory store for future requests
              const { setCookiesForDomain } = require('../services/cookieStore');
              setCookiesForDomain(url, nativeCookies);
            }
          } catch (e) {
            // Native module not available, skip
          }
        }

        if (storedCookies) {
          headers['Cookie'] = headers['Cookie']
            ? `${headers['Cookie']}; ${storedCookies}`
            : storedCookies;
        }

        const hasAuthorization = Object.keys(headers)
          .some(key => key.toLowerCase() === 'authorization');
        if (!hasAuthorization && extensionId) {
          try {
            const [token, allowedHosts] = await Promise.all([
              getBrowserAuthToken(extensionId),
              getBrowserAuthHosts(extensionId),
            ]);
            const requestHost = new URL(url).hostname.toLowerCase();
            const hostAllowed = allowedHosts.some(
              host => requestHost === host || requestHost.endsWith(`.${host}`)
            );
            if (token && hostAllowed) {
              headers.Authorization = `Bearer ${token}`;
            }
          } catch {
            // No configured native auth session for this extension.
          }
        }

        // Check if this is likely an image request (for DRM handling)
        const isImageRequest = url.includes('drm_data=') ||
          url.match(/\.(jpg|jpeg|png|gif|webp)(\?|#|$)/i) ||
          options?.responseType === 'arraybuffer';

        // Log the request details for debugging
        if (!isImageRequest) {
          console.log('[ExtensionRunner] Request method:', options?.method || 'GET');
          const safeHeaders = Object.fromEntries(
            Object.entries(headers).map(([key, value]) => [
              key,
              /authorization|cookie/i.test(key) ? '[redacted]' : value,
            ])
          );
          console.log('[ExtensionRunner] Request headers:', JSON.stringify(safeHeaders, null, 2));
          if (requestBody) {
            console.log('[ExtensionRunner] Request body type:', typeof requestBody);
            console.log('[ExtensionRunner] Request body:', typeof requestBody === 'string' ? requestBody.substring(0, 200) : JSON.stringify(requestBody).substring(0, 200));
          }
        }

        // Create AbortController for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000);

        try {
          const response = await fetch(url, {
            method: options?.method || 'GET',
            headers,
            body: requestBody,
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          let responseData: any;
          const responseHeaders: Record<string, string> = {};
          response.headers.forEach((value, key) => {
            responseHeaders[key] = value;
          });
          const responseMeta = {
            url: response.url || url,
            headers: responseHeaders,
            mimeType: response.headers.get('content-type') || undefined,
            cookies: [],
          };

          const respContentType = responseMeta.mimeType || '';
          if (isImageRequest || /^image\//i.test(respContentType) || /application\/octet-stream/i.test(respContentType)) {
            // For image requests, return as base64 for binary processing
            const arrayBuffer = await response.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            const base64 = btoa(binary);

            responseData = {
              requestId,
              data: '', // Not used for binary
              rawData: base64, // Base64 encoded binary data
              status: response.status,
              isBinary: true,
              ...responseMeta,
            };
          } else {
            // For text/JSON requests
            const text = await response.text();
            console.log('[ExtensionRunner] Response text length:', text.length);

            responseData = {
              requestId,
              data: text,
              status: response.status,
              ...responseMeta,
            };
          }

          webViewRef.current?.injectJavaScript(`
            window.handleFetchResponse(${JSON.stringify(responseData)});
            true;
          `);
        } catch (err: any) {
          clearTimeout(timeoutId);
          console.log('[ExtensionRunner] Proxy fetch error:', err.message);
          const responseData = {
            requestId,
            data: '',
            status: 500,
            error: err.message,
          };
          webViewRef.current?.injectJavaScript(`
            window.handleFetchResponse(${JSON.stringify(responseData)});
            true;
          `);
        }
        return;
      }

      // Handle state manager storage requests
      if (type === 'stateStore') {
        const { extensionId, key, value } = data;
        const AsyncStorage = require('@react-native-async-storage/async-storage').default;
        const storageKey = `@extension_state_${extensionId}_${key}`;
        AsyncStorage.setItem(storageKey, JSON.stringify(value))
          .then(() => {
            webViewRef.current?.injectJavaScript(`
              window.handleStateResponse(${JSON.stringify({ requestId, success: true })});
              true;
            `);
          })
          .catch((err: Error) => {
            webViewRef.current?.injectJavaScript(`
              window.handleStateResponse(${JSON.stringify({ requestId, success: false, error: err.message })});
              true;
            `);
          });
        return;
      }

      if (type === 'stateRetrieve') {
        const { extensionId, key } = data;
        const AsyncStorage = require('@react-native-async-storage/async-storage').default;
        const storageKey = `@extension_state_${extensionId}_${key}`;
        AsyncStorage.getItem(storageKey)
          .then((value: string | null) => {
            webViewRef.current?.injectJavaScript(`
              window.handleStateResponse(${JSON.stringify({ requestId, value: value ? JSON.parse(value) : null })});
              true;
            `);
          })
          .catch((err: Error) => {
            webViewRef.current?.injectJavaScript(`
              window.handleStateResponse(${JSON.stringify({ requestId, value: null, error: err.message })});
              true;
            `);
          });
        return;
      }

      const pending = pendingRequestsRef.current.get(requestId);
      if (pending) {
        pendingRequestsRef.current.delete(requestId);
        if (error) {
          pending.reject(new Error(error));
        } else {
          pending.resolve(result);
        }
      }
    } catch (e) {
      console.error('Failed to parse WebView message:', e);
    }
  }, []);

  // Create the bridge when WebView signals it's ready
  const setupBridge = useCallback(() => {
    const bridge: ExtensionBridge = {
      loadExtension: async (extensionId, sourceJs, apiVersion, initialState) => {
        try {
          await sendMessage('loadExtension', { extensionId, sourceJs, apiVersion, initialState });
          loadedExtensionsRef.current.add(extensionId);
          return true;
        } catch (e) {
          console.error(`Failed to load extension ${extensionId}:`, e);
          return false;
        }
      },

      runExtensionMethod: async (extensionId: string, method: string, args: any[]) => {
        return sendMessage('runMethod', { extensionId, method, args });
      },

      isLoaded: (extensionId: string) => {
        return loadedExtensionsRef.current.has(extensionId);
      },

      invalidateExtension: async (extensionId: string) => {
        loadedExtensionsRef.current.delete(extensionId);
        await sendMessage('unloadExtension', { extensionId });
      },
    };

    console.log('[ExtensionRunner] WebView ready, setting up bridge');
    setExtensionBridge(bridge);
  }, [sendMessage]);

  // Handle WebView load complete
  const handleLoad = useCallback(() => {
    console.log('[ExtensionRunner] WebView loaded');
    // Clear loaded extensions tracking since WebView was reloaded
    loadedExtensionsRef.current.clear();
    // Give WebView a moment to initialize scripts
    setTimeout(() => {
      setupBridge();
    }, 500);
  }, [setupBridge]);

  // The HTML/JS that runs in the WebView
  const webViewHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/cheerio/1.0.0-rc.12/cheerio.min.js"></script>
</head>
<body>
<script>
// Simple cheerio-like HTML parser using DOMParser
const createCheerio = () => {
  const load = (html) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    const $ = (selector, context) => {
      if (typeof selector === 'string') {
        if (selector.startsWith('<')) {
          // It's HTML string
          const temp = document.createElement('div');
          temp.innerHTML = selector;
          return wrapElements(Array.from(temp.childNodes));
        }
        
        // Handle context parameter - $(selector, context)
        let searchRoot = doc;
        if (context) {
          if (typeof context === 'string') {
            // context is a selector string - find within those elements
            const contextElements = Array.from(doc.querySelectorAll(context));
            const results = contextElements.flatMap(el => Array.from(el.querySelectorAll(selector)));
            return wrapElements(results);
          } else if (context.length !== undefined && context[0]) {
            // context is a wrapped element
            const el = context[0];
            if (el.querySelectorAll) {
              return wrapElements(Array.from(el.querySelectorAll(selector)));
            }
          } else if (context.querySelectorAll) {
            // Cheerio callbacks receive the raw DOM node as their second argument.
            return wrapElements(Array.from(context.querySelectorAll(selector)));
          }
        }
        
        const elements = Array.from(searchRoot.querySelectorAll(selector));
        return wrapElements(elements);
      }
      return wrapElements([selector]);
    };
    
    const wrapElements = (elements) => {
      const obj = {
        length: elements.length,
        [Symbol.iterator]: function* () {
          for (const el of elements) yield wrapElements([el]);
        },
        get: (i) => elements[i],
        first: () => wrapElements(elements.slice(0, 1)),
        last: () => wrapElements(elements.slice(-1)),
        eq: (i) => wrapElements([elements[i]]),
        each: (fn) => {
          elements.forEach((el, i) => fn(i, el));
          return obj;
        },
        map: (fn) => {
          return {
            get: () => elements.map((el, i) => fn(i, el)),
            toArray: () => elements.map((el, i) => fn(i, el)),
          };
        },
        toArray: () => elements.slice(),
        find: (sel) => wrapElements(elements.flatMap(el => Array.from(el.querySelectorAll ? el.querySelectorAll(sel) : []))),
        closest: (sel) => wrapElements(elements.map(el => el.closest?.(sel)).filter(Boolean)),
        children: (sel) => {
          const kids = elements.flatMap(el => Array.from(el.children || []));
          if (sel) return wrapElements(kids.filter(k => k.matches && k.matches(sel)));
          return wrapElements(kids);
        },
        parent: () => wrapElements(elements.map(el => el.parentElement).filter(Boolean)),
        next: () => wrapElements(elements.map(el => el.nextElementSibling).filter(Boolean)),
        prev: () => wrapElements(elements.map(el => el.previousElementSibling).filter(Boolean)),
        siblings: () => wrapElements(elements.flatMap(el => Array.from(el.parentElement?.children || []).filter(s => s !== el))),
        text: () => elements.map(el => el.textContent || '').join('').trim(),
        html: () => elements[0]?.innerHTML || '',
        attr: (name) => elements[0]?.getAttribute?.(name) || '',
        data: (name) => elements[0]?.dataset?.[name] || elements[0]?.getAttribute?.('data-' + name) || '',
        hasClass: (cls) => elements.some(el => el.classList?.contains(cls)),
        addClass: (cls) => { elements.forEach(el => el.classList?.add(cls)); return obj; },
        removeClass: (cls) => { elements.forEach(el => el.classList?.remove(cls)); return obj; },
        is: (sel) => elements.some(el => el.matches?.(sel)),
        clone: () => wrapElements(elements.map(el => el.cloneNode(true))),
        remove: () => { elements.forEach(el => el.remove?.()); return obj; },
        contents: () => wrapElements(elements.flatMap(el => Array.from(el.childNodes))),
      };
      
      // Make it array-like
      elements.forEach((el, i) => { obj[i] = el; });
      
      return obj;
    };
    
    $.html = () => doc.documentElement.outerHTML;
    $.text = () => doc.body?.textContent || '';
    $.root = () => wrapElements([doc.documentElement]);
    
    return $;
  };
  
  return { load };
};

// Create cheerio instance
const cheerio = createCheerio();

// Storage for loaded extensions
const loadedExtensions = {};
const loadedExtensionMeta = {};
const extensionStates = {};
const extensionRuntimeStates = {};
const extensionInterceptors = {};
const extensionDiscoverSections = {};
const selectorRegistry = new Map();
let selectorSequence = 0;
let activeExtensionId = null;
let extensionRunQueue = Promise.resolve();

// Fetch pending requests for proxy
const fetchPendingRequests = {};
let fetchRequestId = 0;

// State pending requests
const statePendingRequests = {};
let stateRequestId = 0;

// Handle fetch responses from React Native
window.handleFetchResponse = (response) => {
  const pending = fetchPendingRequests[response.requestId];
  if (pending) {
    delete fetchPendingRequests[response.requestId];
    pending.resolve(response);
  }
};

// Handle state responses from React Native
window.handleStateResponse = (response) => {
  const pending = statePendingRequests[response.requestId];
  if (pending) {
    delete statePendingRequests[response.requestId];
    pending.resolve(response);
  }
};

// Proxied fetch function that goes through React Native
const proxyFetch = async (url, options) => {
  const requestId = ++fetchRequestId;
  
  return new Promise((resolve, reject) => {
    fetchPendingRequests[requestId] = { resolve, reject };
    
    // Send request to React Native
    sendToRN({
      type: 'fetchProxy',
      requestId,
      extensionId: activeExtensionId,
      url,
      options: {
        method: options?.method || 'GET',
        headers: options?.headers || {},
        body: options?.body,
        data: options?.data, // For form data (used by some extensions)
        responseType: options?.responseType,
      },
    });
    
    // Timeout after 60 seconds (increased for slow connections)
    setTimeout(() => {
      if (fetchPendingRequests[requestId]) {
        delete fetchPendingRequests[requestId];
        reject(new Error('Fetch timeout'));
      }
    }, 60000);
  });
};

const appendRequestParams = (url, param) => {
  if (!param) return url;

  if (typeof param === 'string') {
    const query = param.replace(/^\\?/, '');
    if (!query) return url;
    return url + (url.includes('?') ? '&' : '?') + query;
  }

  const pairs = [];
  const entries = typeof URLSearchParams !== 'undefined' && param instanceof URLSearchParams
    ? Array.from(param.entries())
    : Object.entries(param);

  for (const [key, rawValue] of entries) {
    if (rawValue === undefined || rawValue === null) continue;
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      pairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
    }
  }

  if (!pairs.length) return url;
  return url + (url.includes('?') ? '&' : '?') + pairs.join('&');
};

// Mock App object that Paperback extensions expect
const App = {
  createRequest: (config) => config,
  createCookie: (config) => config,
  
  createRequestManager: (config) => {
    const interceptor = config?.interceptor;
    
    const manager = {
      schedule: async (request, priority) => {
        try {
          // Apply request interceptor if present
          let finalRequest = request;
          if (interceptor?.interceptRequest) {
            try {
              finalRequest = await interceptor.interceptRequest(request);
            } catch (e) {
              log('Interceptor error:', e.message);
            }
          }

          const requestUrl = appendRequestParams(finalRequest.url, finalRequest.param);
          if (requestUrl !== finalRequest.url) {
            finalRequest = { ...finalRequest, url: requestUrl };
          }
          
          // Check if this might be an image request for DRM
          const isImageRequest = finalRequest.url.includes('drm_data=') || 
                                  finalRequest.url.match(/\\.(jpg|jpeg|png|gif|webp)(\\?|#|$)/i);
          
          // Use proxy fetch to go through React Native
          const response = await proxyFetch(finalRequest.url, {
            method: finalRequest.method || 'GET',
            headers: finalRequest.headers || {},
            body: finalRequest.body,
            data: finalRequest.data, // For POST form data
            responseType: isImageRequest ? 'arraybuffer' : undefined,
          });
          
          // Build result object with all expected properties
          let result = { 
            data: response.data || '', 
            status: response.status, 
            rawData: null,
            request: finalRequest, // Add request for interceptor
          };
          
          // If binary response, convert base64 to Uint8Array for rawData
          if (response.isBinary && response.rawData) {
            try {
              const binaryString = atob(response.rawData);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
              result.rawData = bytes;
            } catch (e) {
              log('Error decoding binary response:', e.message);
            }
          }
          
          // Apply response interceptor if present (handles DRM decryption)
          if (interceptor?.interceptResponse) {
            try {
              result = await interceptor.interceptResponse(result);
            } catch (e) {
              log('Response interceptor error:', e.message);
            }
          }
          
          return result;
        } catch (error) {
          log('Request failed:', error.message);
          return { data: '', status: 500 };
        }
      },
      getDefaultUserAgent: async () => 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36',
    };
    
    return manager;
  },
  
  createSourceStateManager: () => {
    // Initialize with activeExtensionId so constructor/custom-property state calls are scoped properly
    let currentExtensionId = activeExtensionId || null;
    
    const storeValue = async (key, value) => {
      const targetExtId = currentExtensionId || activeExtensionId;
      if (!targetExtId) {
        // Fallback to in-memory storage
        extensionStates[key] = value;
        return;
      }
      
      const requestId = ++stateRequestId;
      return new Promise((resolve) => {
        statePendingRequests[requestId] = { resolve };
        sendToRN({
          type: 'stateStore',
          requestId,
          extensionId: targetExtId,
          key,
          value,
        });
        
        // Timeout fallback
        setTimeout(() => {
          if (statePendingRequests[requestId]) {
            delete statePendingRequests[requestId];
            extensionStates[key] = value; // Fallback to memory
            resolve({ success: true });
          }
        }, 5000);
      });
    };
    
    const retrieveValue = async (key) => {
      const targetExtId = currentExtensionId || activeExtensionId;
      if (!targetExtId) {
        return extensionStates[key] || null;
      }
      
      const requestId = ++stateRequestId;
      return new Promise((resolve) => {
        statePendingRequests[requestId] = { 
          resolve: (response) => resolve(response.value) 
        };
        sendToRN({
          type: 'stateRetrieve',
          requestId,
          extensionId: targetExtId,
          key,
        });
        
        // Timeout fallback
        setTimeout(() => {
          if (statePendingRequests[requestId]) {
            delete statePendingRequests[requestId];
            resolve(extensionStates[key] || null);
          }
        }, 5000);
      });
    };
    
    return {
      store: storeValue,
      retrieve: retrieveValue,
      keychain: {
        store: async (key, value) => storeValue('keychain_' + key, value),
        retrieve: async (key) => retrieveValue('keychain_' + key),
      },
      // Internal method to set the extension ID
      _setExtensionId: (id) => { currentExtensionId = id; },
    };
  },
  
  createHomeSection: (config) => ({ ...config, items: config.items || [] }),
  createPartialSourceManga: (config) => ({
    mangaId: config.mangaId,
    id: config.mangaId,
    title: config.title,
    image: config.image,
    subtitle: config.subtitle,
  }),
  createSourceManga: (config) => ({
    id: config.id,
    mangaInfo: config.mangaInfo,
    ...config.mangaInfo,
  }),
  createMangaInfo: (config) => config,
  createChapter: (config) => config,
  createChapterDetails: (config) => config,
  createPagedResults: (config) => config,
  createTagSection: (config) => config,
  createTag: (config) => config,
  createDUISection: (config) => config,
  createDUINavigationButton: (config) => config,
  createDUIForm: (config) => config,
  createDUISelect: (config) => config,
  createDUIBinding: (config) => ({
    get: config.get,
    set: config.set,
  }),
  createDUIButton: (config) => config,
  createDUISwitch: (config) => config,
  createDUIInputField: (config) => config,
  createDUISecureInputField: (config) => ({ ...config, _isSecure: true }),
  createDUILabel: (config) => ({ ...config, _isLabel: true }),
  createDUIStepper: (config) => config,
  createDUILink: (config) => config,
  createDUIMultilineLabel: (config) => ({ ...config, _isLabel: true }),
  
  // PBImage and PBCanvas for DRM image processing
  // Note: createPBImage is synchronous - parses JPEG dimensions from header
  createPBImage: (config) => {
    // Convert data to Uint8Array if needed
    let bytes;
    if (typeof config.data === 'string') {
      // It's base64
      const binaryString = atob(config.data);
      bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
    } else if (config.data instanceof Uint8Array) {
      bytes = config.data;
    } else if (config.data instanceof ArrayBuffer) {
      bytes = new Uint8Array(config.data);
    } else {
      log('createPBImage: Unknown data type:', typeof config.data);
      return { width: 0, height: 0, _bytes: null };
    }
    
    // Parse JPEG dimensions from header
    let width = 0, height = 0;
    try {
      // JPEG starts with FF D8
      if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
        let offset = 2;
        while (offset < bytes.length) {
          if (bytes[offset] !== 0xFF) {
            offset++;
            continue;
          }
          const marker = bytes[offset + 1];
          // SOF0-SOF3 markers contain image dimensions
          if (marker >= 0xC0 && marker <= 0xC3) {
            height = (bytes[offset + 5] << 8) | bytes[offset + 6];
            width = (bytes[offset + 7] << 8) | bytes[offset + 8];
            break;
          }
          // Skip to next marker
          const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
          offset += 2 + length;
        }
      }
      // PNG starts with 89 50 4E 47
      else if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
        // PNG IHDR chunk starts at offset 16 (after 8-byte signature + 4-byte length + 4-byte 'IHDR')
        width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
        height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
      }
    } catch (e) {
      log('createPBImage: Error parsing image dimensions:', e.message);
    }
    
    if (width === 0 || height === 0) {
      log('createPBImage: Could not determine image dimensions, bytes length:', bytes.length, 'first bytes:', bytes[0], bytes[1]);
    }
    
    // Create the PBImage object with the parsed dimensions
    return {
      width: width,
      height: height,
      _bytes: bytes,
    };
  },
  
  createPBCanvas: () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const drawQueue = []; // Queue of draw operations
    let sourceImage = null; // Cached source image element
    let sourceImageBytes = null; // The bytes of the source image
    
    return {
      _canvas: canvas,
      _ctx: ctx,
      width: 0,
      height: 0,
      
      setSize: function(w, h) {
        this.width = w;
        this.height = h;
        canvas.width = w;
        canvas.height = h;
      },
      
      drawImage: function(srcImg, sx, sy, sw, sh, dx, dy) {
        // srcImg is a PBImage from createPBImage with _bytes
        // Queue the draw operation to be executed when encode is called
        if (srcImg._bytes) {
          // Store reference to source bytes (should be same for all calls)
          if (!sourceImageBytes) {
            sourceImageBytes = srcImg._bytes;
          }
          drawQueue.push({ sx, sy, sw, sh, dx, dy });
        } else {
          log('drawImage: No bytes in source image');
        }
      },
      
      encode: async function(mimeType) {
        try {
          // If we have draw operations queued, execute them first
          if (drawQueue.length > 0 && sourceImageBytes) {
            // Load the source image
            const imgEl = await new Promise((resolve, reject) => {
              const img = new Image();
              img.onload = () => resolve(img);
              img.onerror = () => reject(new Error('Failed to load source image'));
              
              // Convert bytes to base64
              let binary = '';
              for (let i = 0; i < sourceImageBytes.length; i++) {
                binary += String.fromCharCode(sourceImageBytes[i]);
              }
              const base64 = btoa(binary);
              img.src = 'data:image/jpeg;base64,' + base64;
            });
            
            // Execute all queued draw operations
            for (const op of drawQueue) {
              ctx.drawImage(imgEl, op.sx, op.sy, op.sw, op.sh, op.dx, op.dy, op.sw, op.sh);
            }
          }
          
          const dataUrl = canvas.toDataURL(mimeType || 'image/jpeg', 0.9);
          // Return as Uint8Array (raw bytes)
          const base64 = dataUrl.split(',')[1];
          const binaryString = atob(base64);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          return bytes;
        } catch (e) {
          log('PBCanvas encode error:', e.message);
          return null;
        }
      },
    };
  },
};

// Make App globally available
window.App = App;

// Paperback 0.9 host API. The 0.9 index.js bundle contains the Paperback
// types and parser implementation, but expects the app to provide this global.
function paperbackMd5(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
  const paddedLength = (((bytes.length + 8) >>> 6) + 1) * 64;
  const data = new Uint8Array(paddedLength);
  data.set(bytes);
  data[bytes.length] = 0x80;

  const bitLengthLow = (bytes.length * 8) >>> 0;
  const bitLengthHigh = Math.floor(bytes.length / 0x20000000) >>> 0;
  for (let index = 0; index < 4; index++) {
    data[paddedLength - 8 + index] = (bitLengthLow >>> (index * 8)) & 0xff;
    data[paddedLength - 4 + index] = (bitLengthHigh >>> (index * 8)) & 0xff;
  }

  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const constants = Array.from(
    { length: 64 },
    (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0
  );
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < data.length; offset += 64) {
    const words = new Uint32Array(16);
    for (let word = 0; word < 16; word++) {
      const index = offset + word * 4;
      words[word] = (
        data[index]
        | (data[index + 1] << 8)
        | (data[index + 2] << 16)
        | (data[index + 3] << 24)
      ) >>> 0;
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let index = 0; index < 64; index++) {
      let f;
      let wordIndex;
      if (index < 16) {
        f = (b & c) | (~b & d);
        wordIndex = index;
      } else if (index < 32) {
        f = (d & b) | (~d & c);
        wordIndex = (5 * index + 1) % 16;
      } else if (index < 48) {
        f = b ^ c ^ d;
        wordIndex = (3 * index + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        wordIndex = (7 * index) % 16;
      }
      const sum = (a + (f >>> 0) + constants[index] + words[wordIndex]) >>> 0;
      const rotated = ((sum << shifts[index]) | (sum >>> (32 - shifts[index]))) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + rotated) >>> 0;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  return [a0, b0, c0, d0].map(word =>
    [0, 8, 16, 24].map(shift => ((word >>> shift) & 0xff).toString(16).padStart(2, '0')).join('')
  ).join('');
}

const Application = {
  isResourceLimited: false,
  filterAdultTitles: false,
  filterMatureTitles: false,

  decodeHTMLEntities: (value) => {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = String(value || '');
    return textarea.value;
  },
  sleep: (seconds) => new Promise(resolve => setTimeout(resolve, Math.max(0, Number(seconds) * 1000))),
  getDefaultUserAgent: async () => 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',

  Selector: (object, symbol) => {
    const id = 'selector-' + (++selectorSequence);
    const callback = object && object[symbol];
    if (typeof callback !== 'function') {
      throw new Error('Invalid selector: ' + String(symbol));
    }
    selectorRegistry.set(id, callback.bind(object));
    return id;
  },
  SelectorRegistry: {
    selector: (id) => {
      const callback = selectorRegistry.get(id);
      if (!callback) throw new Error('Selector not found: ' + String(id));
      return callback;
    },
  },

  registerInterceptor: (interceptorId, requestSelector, responseSelector) => {
    const extensionId = activeExtensionId;
    if (!extensionId) return;
    const list = extensionInterceptors[extensionId] || [];
    const existingIndex = list.findIndex(item => item.id === interceptorId);
    const entry = { id: interceptorId, requestSelector, responseSelector };
    if (existingIndex >= 0) list[existingIndex] = entry;
    else list.push(entry);
    extensionInterceptors[extensionId] = list;
  },
  unregisterInterceptor: (interceptorId) => {
    const extensionId = activeExtensionId;
    if (!extensionId) return;
    extensionInterceptors[extensionId] = (extensionInterceptors[extensionId] || [])
      .filter(item => item.id !== interceptorId);
  },
  setRedirectHandler: () => {},

  scheduleRequest: async (request) => {
    const extensionId = activeExtensionId;
    let finalRequest = { ...request, headers: { ...(request.headers || {}) } };
    const interceptors = extensionInterceptors[extensionId] || [];

    for (const interceptor of interceptors) {
      const callback = selectorRegistry.get(interceptor.requestSelector);
      if (callback) finalRequest = await callback(finalRequest);
    }

    const appendedUrl = appendRequestParams(finalRequest.url, finalRequest.param);
    if (appendedUrl !== finalRequest.url) {
      finalRequest = { ...finalRequest, url: appendedUrl };
    }

    if (finalRequest.cookies && Object.keys(finalRequest.cookies).length > 0) {
      const cookieHeader = Object.entries(finalRequest.cookies)
        .map(([name, value]) => name + '=' + value)
        .join('; ');
      finalRequest.headers.Cookie = finalRequest.headers.Cookie
        ? finalRequest.headers.Cookie + '; ' + cookieHeader
        : cookieHeader;
    }

    let body = finalRequest.body;
    if (body && typeof body === 'object' && !(body instanceof ArrayBuffer) && !ArrayBuffer.isView(body)) {
      body = JSON.stringify(body);
      if (!finalRequest.headers['Content-Type'] && !finalRequest.headers['content-type']) {
        finalRequest.headers['Content-Type'] = 'application/json';
      }
    } else if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
      const bytes = body instanceof ArrayBuffer
        ? new Uint8Array(body)
        : new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
      let binary = '';
      for (let index = 0; index < bytes.length; index++) binary += String.fromCharCode(bytes[index]);
      body = atob(btoa(binary));
    }

    const proxyResponse = await proxyFetch(finalRequest.url, {
      method: finalRequest.method || 'GET',
      headers: finalRequest.headers,
      body,
      responseType: 'arraybuffer',
    });

    let data;
    if (proxyResponse.rawData) {
      const binary = atob(proxyResponse.rawData);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
      data = bytes.buffer;
    } else {
      data = new TextEncoder().encode(proxyResponse.data || '').buffer;
    }

    const response = {
      url: proxyResponse.url || finalRequest.url,
      headers: proxyResponse.headers || {},
      status: proxyResponse.status || 0,
      mimeType: proxyResponse.mimeType,
      cookies: proxyResponse.cookies || [],
    };

    for (const interceptor of [...interceptors].reverse()) {
      const callback = selectorRegistry.get(interceptor.responseSelector);
      if (callback) data = await callback(finalRequest, response, data);
    }

    return [response, data];
  },

  arrayBufferToUTF8String: (buffer) => new TextDecoder('utf-8').decode(buffer),
  arrayBufferToASCIIString: (buffer) => {
    const bytes = new Uint8Array(buffer);
    let value = '';
    for (let index = 0; index < bytes.length; index++) value += String.fromCharCode(bytes[index] & 0x7f);
    return value;
  },
  arrayBufferToUTF16String: (buffer) => new TextDecoder('utf-16').decode(buffer),
  base64Encode: (value) => {
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
    let binary = '';
    for (let index = 0; index < bytes.length; index++) binary += String.fromCharCode(bytes[index]);
    return btoa(binary);
  },
  base64Decode: (value) => {
    const encoded = typeof value === 'string'
      ? value
      : new TextDecoder('utf-8').decode(value);
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return bytes.buffer;
    }
  },
  crypto_md5Hash: paperbackMd5,

  getState: (key) => extensionRuntimeStates[activeExtensionId]?.[key],
  setState: (value, key) => {
    if (!activeExtensionId) return;
    const state = extensionRuntimeStates[activeExtensionId] || {};
    state[key] = value;
    extensionRuntimeStates[activeExtensionId] = state;
    sendToRN({
      type: 'stateStore',
      requestId: ++stateRequestId,
      extensionId: activeExtensionId,
      key: 'paperback09',
      value: state,
    });
  },
  getSecureState: (key) => extensionRuntimeStates[activeExtensionId]?.['secure:' + key],
  setSecureState: (value, key) => Application.setState(value, 'secure:' + key),
  resetAllState: () => {
    if (activeExtensionId) extensionRuntimeStates[activeExtensionId] = {};
  },

  registerDiscoverSection: (section, selector) => {
    if (!activeExtensionId) return;
    const sections = extensionDiscoverSections[activeExtensionId] || [];
    sections.push({ ...section, selector });
    extensionDiscoverSections[activeExtensionId] = sections;
  },
  unregisterDiscoverSection: (sectionId) => {
    if (!activeExtensionId) return;
    extensionDiscoverSections[activeExtensionId] =
      (extensionDiscoverSections[activeExtensionId] || []).filter(section => section.id !== sectionId);
  },
  registeredDiscoverSections: () => extensionDiscoverSections[activeExtensionId] || [],
  invalidateDiscoverSections: () => {
    if (activeExtensionId) extensionDiscoverSections[activeExtensionId] = [];
  },

  executeInWebView: async (context) => {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.srcdoc = context?.source?.html || '<html><body></body></html>';
    document.body.appendChild(iframe);
    await new Promise(resolve => {
      iframe.onload = resolve;
      setTimeout(resolve, 100);
    });
    try {
      const result = iframe.contentWindow.eval(context.inject);
      return { result: await result, storage: context.storage || { cookies: [] } };
    } finally {
      iframe.remove();
    }
  },
  formDidChange: () => {},
};

window.Application = Application;

// Send message to React Native
function sendToRN(data) {
  window.ReactNativeWebView.postMessage(JSON.stringify(data));
}

// Log function that sends to RN
function log(...args) {
  sendToRN({ type: 'log', result: args.join(' ') });
}

// Handle messages from React Native
window.handleMessage = function(messageStr) {
  try {
    const message = JSON.parse(messageStr);
    const { type, requestId, extensionId, sourceJs, apiVersion, initialState, method, args } = message;

    if (type === 'loadExtension') {
      extensionRunQueue = extensionRunQueue
        .catch(() => undefined)
        .then(() => loadExtension(extensionId, sourceJs, apiVersion, initialState, requestId));
    } else if (type === 'unloadExtension') {
      extensionRunQueue = extensionRunQueue
        .catch(() => undefined)
        .then(() => unloadExtension(extensionId, requestId));
    } else if (type === 'runMethod') {
      extensionRunQueue = extensionRunQueue
        .catch(() => undefined)
        .then(() => runExtensionMethod(extensionId, method, args, requestId));
    }
  } catch (e) {
    log('Error handling message:', e.message);
  }
};

async function unloadExtension(extensionId, requestId) {
  delete loadedExtensions[extensionId];
  delete loadedExtensionMeta[extensionId];
  delete extensionDiscoverSections[extensionId];
  delete extensionInterceptors[extensionId];
  sendToRN({ requestId, result: true });
}

// Load either a Paperback 0.8 source.js or Paperback 0.9 index.js bundle.
async function loadExtension(extensionId, sourceJs, apiVersion, initialState, requestId) {
  const originalSources = window.Sources;
  const originalSource = window.source;
  try {
    log('Loading extension:', extensionId);
    activeExtensionId = extensionId;
    extensionRuntimeStates[extensionId] = initialState || extensionRuntimeStates[extensionId] || {};
    
    // IMPORTANT: Clear window.Sources BEFORE loading to ensure we get a fresh object
    // This prevents cross-contamination between extensions (e.g., Cuutruyen showing Pixiv data)
    window.Sources = undefined;
    window.source = undefined;
    
    // Keep the proven 0.8 loader path from v0.0.15. Some Browserify
    // source.js bundles rely on direct eval's execution context. Paperback
    // 0.9 needs global eval so its top-level var source becomes window.source.
    if (apiVersion === '0.9') {
      (0, eval)(sourceJs);
    } else {
      eval(sourceJs);
    }
    
    // 0.8 exports window.Sources; 0.9 exports window.source.
    const Sources = window.Sources;
    const paperback09Exports = window.source;
    const isPaperback09 = apiVersion === '0.9';
    
    if (!Sources && !paperback09Exports) {
      window.Sources = originalSources; // Restore
      window.source = originalSource;
      throw new Error('No Paperback exports found after loading extension');
    }
    
    // Log available sources for debugging
    const exportContainer = isPaperback09 ? paperback09Exports : Sources;
    const availableKeys = Object.keys(exportContainer);
    log('Available source classes:', availableKeys.join(', '));
    
    // Find the extension class - try exact match first, then case-insensitive match
    let ExtensionClass = exportContainer[extensionId];
    
    if (!ExtensionClass) {
      // Try case-insensitive match
      const lowerExtId = extensionId.toLowerCase();
      for (const key of availableKeys) {
        if (key.toLowerCase() === lowerExtId) {
          ExtensionClass = exportContainer[key];
          log('Found extension via case-insensitive match:', key);
          break;
        }
      }
    }
    
    if (!ExtensionClass) {
      // Only use first key if there's exactly ONE source in the bundle
      // This prevents picking the wrong extension when multiple are cached
      const usableKeys = isPaperback09
        ? availableKeys.filter(key =>
          !/Extension$/.test(key) && exportContainer[key] && typeof exportContainer[key] === 'object'
        )
        : availableKeys;
      if (usableKeys.length === 1) {
        ExtensionClass = exportContainer[usableKeys[0]];
        log('Using single available source:', usableKeys[0]);
      } else {
        window.Sources = originalSources; // Restore
        window.source = originalSource;
        throw new Error('Extension class not found for ' + extensionId + '. Available: ' + availableKeys.join(', '));
      }
    }
    
    if (!ExtensionClass) {
      window.Sources = originalSources; // Restore
      window.source = originalSource;
      throw new Error('No extension class found for ' + extensionId);
    }
    
    // Instantiate 0.8 classes. Paperback 0.9 normally exports a ready instance.
    let instance;
    if (typeof ExtensionClass === 'function') {
      try {
        instance = new ExtensionClass(cheerio);
      } catch (e) {
        // Try without cheerio
        instance = new ExtensionClass();
      }
    } else {
      instance = ExtensionClass;
    }
    
    // Also set cheerio on the instance if it has a cheerio property
    if (instance && !instance.cheerio) {
      instance.cheerio = cheerio;
    }
    
    // Set the extension ID on the state manager if it exists
    if (instance && instance.stateManager && instance.stateManager._setExtensionId) {
      instance.stateManager._setExtensionId(extensionId);
    }
    
    loadedExtensions[extensionId] = instance;
    loadedExtensionMeta[extensionId] = {
      apiVersion: isPaperback09 ? '0.9' : '0.8',
      sections: {},
      manga: {},
      chapters: {},
    };

    if (isPaperback09 && typeof instance.initialise === 'function') {
      await instance.initialise();
    }
    
    log('Extension loaded successfully:', extensionId);
    sendToRN({ requestId, result: true });
    
    // Restore original Sources (though we might want to keep it cleared)
    window.Sources = originalSources;
    window.source = originalSource;
    activeExtensionId = null;
  } catch (e) {
    window.Sources = originalSources;
    window.source = originalSource;
    activeExtensionId = null;
    log('Failed to load extension:', e.message);
    sendToRN({ requestId, error: e.message });
  }
}

const YURI_GARDEN_SCRAMBLE_PREFIX = 'yg-scramble:';
const YURI_GARDEN_SEGMENT_GAP = 4;
const YURI_GARDEN_BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const YURI_GARDEN_FACTORIAL_TABLE = [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800];

function encodeYuriGardenScramblePayload(payload) {
  try {
    return YURI_GARDEN_SCRAMBLE_PREFIX + btoa(JSON.stringify(payload));
  } catch (error) {
    log('Failed to encode YuriGarden scramble payload:', error?.message || error);
    return null;
  }
}

function decodeYuriGardenScramblePayload(value) {
  if (typeof value !== 'string' || !value.startsWith(YURI_GARDEN_SCRAMBLE_PREFIX)) {
    return null;
  }

  try {
    return JSON.parse(atob(value.slice(YURI_GARDEN_SCRAMBLE_PREFIX.length)));
  } catch (error) {
    log('Failed to decode YuriGarden scramble payload:', error?.message || error);
    return null;
  }
}

function isYuriGardenChapterImageUrl(url) {
  if (typeof url !== 'string') return false;
  return /^https:\\/\\/(?:db\\.yurigarden\\.com|cdn\\.yurigarden\\.moe)\\/.+\\/chapters\\/\\d+\\/.+/i.test(url);
}

function extractYuriGardenChapterId(url) {
  const match = typeof url === 'string' ? url.match(/\\/chapters\\/(\\d+)\\//i) : null;
  return match ? match[1] : null;
}

function tryDecodeYuriGardenPageKey(encoded) {
  try {
    if (typeof encoded !== 'string' || !/^H[1-9A-HJ-NP-Za-km-z]+$/.test(encoded)) {
      return null;
    }

    const body = encoded.slice(1, -1);
    const checksum = encoded.slice(-1);
    let value = 0;

    for (const char of body) {
      const index = YURI_GARDEN_BASE58_ALPHABET.indexOf(char);
      if (index < 0) return null;
      value = value * 58 + index;
    }

    if (YURI_GARDEN_BASE58_ALPHABET[value % 58] !== checksum) {
      return null;
    }

    const pool = Array.from({ length: 10 }, (_, index) => index);
    const decoded = [];

    for (let index = 9; index >= 0; index--) {
      const factorial = YURI_GARDEN_FACTORIAL_TABLE[index] || 1;
      const pick = Math.floor(value / factorial);
      value = value % factorial;

      const item = pool.splice(pick, 1)[0];
      if (item === undefined) {
        return null;
      }

      decoded.push(item);
    }

    return decoded;
  } catch (error) {
    log('Failed to decode YuriGarden page key:', error?.message || error);
    return null;
  }
}

function normalizeYuriGardenPageUrl(url) {
  return typeof url === 'string' ? url.replace('_credit', '') : url;
}

function normalizeYuriGardenChapterPages(payload) {
  const pages = Array.isArray(payload?.pages)
    ? payload.pages
    : payload?.pages && typeof payload.pages === 'object'
      ? Object.values(payload.pages)
      : [];

  return pages
    .map((page) => {
      const url = normalizeYuriGardenPageUrl(page?.url);
      if (typeof url !== 'string' || !url) {
        return null;
      }

      const decoded = typeof page?.key === 'string'
        ? tryDecodeYuriGardenPageKey(page.key.replace(/^.{4}/, ''))
        : null;

      return {
        url,
        decoded,
      };
    })
    .filter(Boolean);
}

async function fetchYuriGardenScramblePayload(extension, imageUrl) {
  const chapterId = extractYuriGardenChapterId(imageUrl);
  if (!chapterId) {
    return null;
  }

  const response = await extension.requestManager.schedule(
    App.createRequest({
      url: 'https://api.yurigarden.moe/api/chapters/pages/' + chapterId,
      method: 'GET',
    }),
    1
  );

  const rawText = typeof response?.data === 'string' ? response.data : '';
  if (!rawText) {
    return null;
  }

  const payload = JSON.parse(rawText);
  const normalizedPages = normalizeYuriGardenChapterPages(payload);
  const normalizedUrl = normalizeYuriGardenPageUrl(imageUrl);

  return normalizedPages.find((page) => page.url === normalizedUrl && Array.isArray(page.decoded) && page.decoded.length > 0) || null;
}

function invertPermutation(order) {
  const inverted = new Array(order.length).fill(0);
  for (let index = 0; index < order.length; index++) {
    inverted[order[index]] = index;
  }
  return inverted;
}

function splitHeightEvenly(totalHeight, segmentCount) {
  const base = Math.floor(totalHeight / segmentCount);
  const remainder = totalHeight % segmentCount;
  const heights = [];

  for (let index = 0; index < segmentCount; index++) {
    heights.push(base + (index < remainder ? 1 : 0));
  }

  return heights;
}

async function rebuildYuriGardenImage(imageBytes, metadata) {
  const decodedOrder = Array.isArray(metadata?.decoded)
    ? metadata.decoded.filter((value) => Number.isInteger(value))
    : [];

  if (!decodedOrder.length) {
    throw new Error('Missing YuriGarden decode order');
  }

  const sourceImage = App.createPBImage({ data: imageBytes });
  const segmentCount = decodedOrder.length;
  const outputHeight = sourceImage.height - YURI_GARDEN_SEGMENT_GAP * (segmentCount - 1);

  if (outputHeight <= 0) {
    throw new Error('Invalid YuriGarden image height');
  }

  const destinationHeights = splitHeightEvenly(outputHeight, segmentCount);
  const sourceHeights = decodedOrder.map((value) => destinationHeights[value] || 0);
  const sourceOrder = invertPermutation(decodedOrder);
  const canvas = App.createPBCanvas();

  canvas.setSize(sourceImage.width, outputHeight);

  let destinationY = 0;
  for (let destinationIndex = 0; destinationIndex < sourceOrder.length; destinationIndex++) {
    const sourceIndex = sourceOrder[destinationIndex];
    const sourceY = sourceHeights
      .slice(0, sourceIndex)
      .reduce((sum, value) => sum + value, 0) + YURI_GARDEN_SEGMENT_GAP * sourceIndex;
    const sourceHeight = sourceHeights[sourceIndex];

    canvas.drawImage(
      sourceImage,
      0,
      sourceY,
      sourceImage.width,
      sourceHeight,
      0,
      destinationY
    );

    destinationY += sourceHeight;
  }

  return canvas.encode('image/jpeg');
}

function paperback09SectionType(type) {
  const value = typeof type === 'string' ? type : Number(type);
  if (value === 0 || value === 'featured') return 'featured';
  if (value === 2 || value === 'prominentCarousel') return 'prominent';
  if (value === 3 || value === 'chapterUpdates') return 'chapterUpdates';
  if (value === 4 || value === 'genres') return 'genres';
  return 'singleRowNormal';
}

function paperback09Item(item) {
  const fallbackId = item?.type === 'genresCarouselItem'
    ? 'genre-' + (item?.name || item?.title || '')
    : '';
  return {
    ...item,
    mangaId: item?.mangaId || item?.id || fallbackId,
    id: item?.mangaId || item?.id || fallbackId,
    image: item?.image || item?.imageUrl || item?.thumbnailUrl || '',
    title: item?.title || item?.name || '',
    subtitle: item?.subtitle || '',
  };
}

async function paperback09Manga(extension, meta, mangaId) {
  if (!meta.manga[mangaId]) {
    meta.manga[mangaId] = await extension.getMangaDetails(mangaId);
  }
  return meta.manga[mangaId];
}

async function paperback09Chapters(extension, meta, mangaId) {
  const sourceManga = await paperback09Manga(extension, meta, mangaId);
  const chapters = await extension.getChapters(sourceManga);
  for (const chapter of chapters || []) {
    meta.chapters[chapter.chapterId || chapter.id] = chapter;
  }
  return chapters || [];
}

async function paperback09SearchQuery(extension, rawQuery) {
  const filters = typeof extension.getSearchFilters === 'function'
    ? await extension.getSearchFilters()
    : [];
  const includedTags = rawQuery?.includedTags || [];

  for (const selectedTag of includedTags) {
    const filter = filters.find(candidate =>
      (candidate.options || candidate.items || []).some(option => option.id === selectedTag.id)
    );
    if (!filter) continue;
    if (filter.type === 'multiselect') {
      filter.value = { ...(filter.value || {}), [selectedTag.id]: 'included' };
    } else if (Array.isArray(filter.value)) {
      filter.value = [selectedTag.id];
    } else {
      filter.value = selectedTag.id;
    }
  }

  return {
    ...rawQuery,
    title: rawQuery?.title || '',
    filters: rawQuery?.filters || filters,
    metadata: rawQuery?.metadata ?? filters,
  };
}

async function resolvePaperback09SettingsForm(extension, meta) {
  const form = await extension.getSettingsForm();
  const sections = await form.getSections();
  meta.settingsActions = {};
  const rows = [];

  for (const section of sections || []) {
    for (const item of section.items || []) {
      const row = {
        id: item.id,
        label: item.title || item.subtitle || section.header || item.id,
        value: item.value,
      };

      if (item.onValueChange) meta.settingsActions[item.id] = item.onValueChange;
      if (item.onSelect) meta.settingsActions[item.id] = item.onSelect;

      if (item.type === 'toggleRow') row.type = 'switch';
      else if (item.type === 'inputRow') row.type = item.isSecureEntry ? 'secureInput' : 'input';
      else if (item.type === 'stepperRow') {
        row.type = 'stepper';
        row.minValue = item.minValue;
        row.maxValue = item.maxValue;
        row.step = item.stepValue;
      } else if (item.type === 'buttonRow') {
        row.type = 'button';
        row.hasOnTap = true;
      } else if (item.type === 'navigationRow') {
        row.type = 'navigation';
        const childSections = await item.form.getSections();
        row.form = childSections.map(child => ({
          id: child.id,
          header: child.header,
          footer: child.footer,
          rows: (child.items || []).map(childItem => ({
            id: childItem.id,
            label: childItem.title || childItem.id,
            type: childItem.type === 'labelRow' ? 'label' : 'button',
            value: childItem.value,
          })),
        }));
      } else {
        row.type = 'label';
      }
      rows.push(row);
    }
  }

  return { id: 'paperback09', header: 'Source Settings', rows };
}

async function runPaperback09Method(extensionId, extension, meta, method, args) {
  if (method === 'getHomePageSections') {
    let sections = typeof extension.getDiscoverSections === 'function'
      ? await extension.getDiscoverSections()
      : Application.registeredDiscoverSections();
    const output = [];

    for (const section of sections || []) {
      meta.sections[section.id] = section;
      let paged;
      if (section.selector) {
        paged = await Application.SelectorRegistry.selector(section.selector)(section, undefined);
      } else {
        paged = await extension.getDiscoverSectionItems(section, undefined);
      }
      output.push({
        id: section.id,
        title: section.title,
        type: paperback09SectionType(section.type),
        items: (paged?.items || []).map(paperback09Item),
        metadata: paged?.metadata,
        containsMoreItems: paged?.metadata != null,
      });
    }
    return output;
  }

  if (method === 'getViewMoreItems') {
    const [sectionId, metadata] = args;
    let section = meta.sections[sectionId];
    if (!section && typeof extension.getDiscoverSections === 'function') {
      const sections = await extension.getDiscoverSections();
      for (const item of sections || []) meta.sections[item.id] = item;
      section = meta.sections[sectionId];
    }
    if (!section) throw new Error('Discover section not found: ' + sectionId);
    const paged = section.selector
      ? await Application.SelectorRegistry.selector(section.selector)(section, metadata)
      : await extension.getDiscoverSectionItems(section, metadata);
    return {
      results: (paged?.items || []).map(paperback09Item),
      metadata: paged?.metadata,
    };
  }

  if (method === 'getSearchResults') {
    const [rawQuery, metadata] = args;
    const query = await paperback09SearchQuery(extension, rawQuery);
    return extension.getSearchResults(query, metadata, undefined);
  }

  if (method === 'getSearchTags') {
    const filters = typeof extension.getSearchFilters === 'function'
      ? await extension.getSearchFilters()
      : [];
    return filters.map(filter => ({
      id: filter.id,
      title: filter.title || filter.name || '',
      tags: (filter.options || filter.items || []).map(option => ({
        id: option.id,
        label: option.title || option.label || option.value || option.id,
      })),
    }));
  }

  if (method === 'getMangaDetails') {
    return paperback09Manga(extension, meta, args[0]);
  }

  if (method === 'getMangaShareUrl') {
    const manga = await paperback09Manga(extension, meta, args[0]);
    return manga?.mangaInfo?.shareUrl || null;
  }

  if (method === 'getChapters') {
    return paperback09Chapters(extension, meta, args[0]);
  }

  if (method === 'getChapterDetails') {
    const [mangaId, chapterId] = args;
    let chapter = meta.chapters[chapterId];
    if (!chapter) {
      await paperback09Chapters(extension, meta, mangaId);
      chapter = meta.chapters[chapterId];
    }
    if (!chapter) throw new Error('Chapter not found: ' + chapterId);
    const details = await extension.getChapterDetails(chapter);
    return { ...details, pages: details?.pages || [] };
  }

  if (method === 'getCloudflareBypassRequestAsync') {
    return extension.domain ? { url: extension.domain, method: 'GET' } : null;
  }

  if (method === 'getSourceMenu') {
    if (typeof extension.getSettingsForm !== 'function') return null;
    return resolvePaperback09SettingsForm(extension, meta);
  }

  if (method === 'setSettingValue' || method === 'invokeSettingAction') {
    if (!meta.settingsActions) await resolvePaperback09SettingsForm(extension, meta);
    const settingPath = args[0];
    const settingId = String(settingPath).split('/').pop();
    const selector = meta.settingsActions[settingId];
    if (!selector) return false;
    const callback = Application.SelectorRegistry.selector(selector);
    await callback(method === 'setSettingValue' ? args[1] : undefined);
    return true;
  }

  if (method === 'fetchImage') {
    const [, data] = await Application.scheduleRequest({ url: args[0], method: 'GET' });
    const bytes = new Uint8Array(data);
    let binary = '';
    for (let index = 0; index < bytes.length; index++) binary += String.fromCharCode(bytes[index]);
    return 'data:image/jpeg;base64,' + btoa(binary);
  }

  if (typeof extension[method] !== 'function') {
    throw new Error('Method not found: ' + method);
  }
  return extension[method](...args);
}

// Run a method on an extension
async function runExtensionMethod(extensionId, method, args, requestId) {
  try {
    const extension = loadedExtensions[extensionId];
    
    if (!extension) {
      throw new Error('Extension not loaded: ' + extensionId);
    }

    activeExtensionId = extensionId;
    const extensionMeta = loadedExtensionMeta[extensionId];
    if (extensionMeta?.apiVersion === '0.9') {
      const paperback09Result = await runPaperback09Method(
        extensionId,
        extension,
        extensionMeta,
        method,
        args
      );
      activeExtensionId = null;
      sendToRN({ requestId, result: paperback09Result });
      return;
    }
    
    // Special methods that don't need to exist on the extension object
    const specialMethods = ['setSettingValue', 'invokeSettingAction', 'decryptDrmImage', 'fetchImage'];
    
    if (typeof extension[method] !== 'function' && !specialMethods.includes(method)) {
      throw new Error('Method not found: ' + method);
    }
    
    log('Running method:', extensionId, method, 'args:', JSON.stringify(args));
    
    let result;
    
    if (method === 'getHomePageSections') {
      // Special handling for getHomePageSections which uses callbacks
      // Extensions call the callback multiple times - first with empty items, then with data
      const sectionsMap = new Map();
      log('Starting getHomePageSections...');
      try {
        await extension.getHomePageSections((section) => {
          log('Section callback:', section.id, 'type:', section.type, 'items:', (section.items || []).length);
          
          // Update or add section - always use the latest data
          sectionsMap.set(section.id, {
            id: section.id,
            title: section.title,
            items: (section.items || []).map(item => ({
              mangaId: item.mangaId,
              id: item.mangaId,
              title: item.title,
              image: item.image,
              subtitle: item.subtitle,
            })),
            containsMoreItems: section.containsMoreItems || false,
            type: section.type,
          });
        });
        log('getHomePageSections completed, sections found:', sectionsMap.size);
      } catch (innerError) {
        log('Error in getHomePageSections:', innerError.message, innerError.stack);
        throw innerError;
      }
      result = Array.from(sectionsMap.values());
    } else if (method === 'getChapterDetails') {
      // Special handling for getChapterDetails
      const rawResult = await extension[method](...args);
      log('getChapterDetails raw result keys:', Object.keys(rawResult || {}));
      
      // Extract pages from the result
      let pages = [];
      if (rawResult) {
        if (rawResult.pages && Array.isArray(rawResult.pages)) {
          pages = rawResult.pages;
        } else if (Array.isArray(rawResult)) {
          pages = rawResult;
        }
        
        log('getChapterDetails raw pages count:', pages.length);
        
        // Pages might be objects with url/image property
        const processedPages = [];
        for (let i = 0; i < pages.length; i++) {
          const p = pages[i];
          let url;
          if (typeof p === 'string') {
            url = p;
          } else if (p.url) {
            url = p.url;
          } else if (p.image) {
            url = p.image;
          } else if (p.imageUrl) {
            url = p.imageUrl;
          } else {
            url = p;
          }
          
          const yuriGardenPayload = (() => {
            if (p && typeof p === 'object' && Array.isArray(p.decoded) && p.decoded.length > 0) {
              return encodeYuriGardenScramblePayload({
                url,
                decoded: p.decoded,
              });
            }

            if (isYuriGardenChapterImageUrl(url)) {
              return encodeYuriGardenScramblePayload({ url });
            }

            return null;
          })();

          if (yuriGardenPayload) {
            url = 'drm://' + extensionId + '/' + yuriGardenPayload;
          }

          // Mark DRM URLs with special prefix so reader knows to decrypt on-demand
          if (url && url.includes('#drm_data=')) {
            // Add sourceId so we know which extension to use for decryption
            url = 'drm://' + extensionId + '/' + url;
          }
          
          processedPages.push(url);
        }
        pages = processedPages;
        
        // Log for debugging
        if (pages.length > 0) {
          log('First page URL type:', pages[0].substring(0, 20));
        }
      }
      
      log('getChapterDetails pages count:', pages.length);
      result = { pages };
    } else if (method === 'decryptDrmImage') {
      // On-demand DRM image decryption
      const [imageUrl] = args;
      log('Decrypting DRM image on-demand');
      
      try {
        let yuriGardenPayload = decodeYuriGardenScramblePayload(imageUrl);
        if (yuriGardenPayload && !Array.isArray(yuriGardenPayload.decoded) && isYuriGardenChapterImageUrl(yuriGardenPayload.url)) {
          const resolvedPayload = await fetchYuriGardenScramblePayload(extension, yuriGardenPayload.url);
          if (resolvedPayload) {
            yuriGardenPayload = resolvedPayload;
          }
        }

        const requestUrl = yuriGardenPayload?.url || imageUrl;
        const response = await extension.requestManager.schedule(
          App.createRequest({ url: requestUrl, method: 'GET' }),
          1
        );
        
        // If we got decrypted rawData, convert to base64 data URL
        if (response.rawData) {
          const bytes = response.rawData instanceof Uint8Array ? response.rawData : new Uint8Array(response.rawData);
          const outputBytes = yuriGardenPayload && Array.isArray(yuriGardenPayload.decoded)
            ? await rebuildYuriGardenImage(bytes, yuriGardenPayload)
            : bytes;

          if (!outputBytes) {
            throw new Error('Failed to rebuild image bytes');
          }

          let binary = '';
          for (let j = 0; j < outputBytes.length; j++) {
            binary += String.fromCharCode(outputBytes[j]);
          }
          const base64 = btoa(binary);
          result = 'data:image/jpeg;base64,' + base64;
          log('DRM image decrypted successfully, size:', outputBytes.length);
        } else {
          throw new Error('No rawData in response');
        }
      } catch (e) {
        log('Error decrypting DRM image:', e.message);
        throw e;
      }
    } else if (method === 'fetchImage') {
      // Fetch image through extension (for proper headers/cookies)
      const [imageUrl] = args;
      log('Fetching image through extension:', imageUrl);
      
      try {
        // Fetch through the extension's request manager
        const response = await extension.requestManager.schedule(
          App.createRequest({ url: imageUrl, method: 'GET' }),
          1
        );
        
        // Convert rawData to base64 data URL
        if (response.rawData) {
          let binary = '';
          const bytes = response.rawData instanceof Uint8Array ? response.rawData : new Uint8Array(response.rawData);
          for (let j = 0; j < bytes.length; j++) {
            binary += String.fromCharCode(bytes[j]);
          }
          const base64 = btoa(binary);
          result = 'data:image/jpeg;base64,' + base64;
          log('Image fetched successfully, size:', bytes.length);
        } else {
          throw new Error('No rawData in response');
        }
      } catch (e) {
        log('Error fetching image:', e.message);
        throw e;
      }
    } else if (method === 'getSourceMenu') {
      // Special handling for getSourceMenu - need to resolve async rows and bindings
      const menu = await extension.getSourceMenu();
      if (!menu) {
        result = null;
      } else {
        result = await resolveSourceMenu(menu, extensionId);
      }
    } else if (method === 'setSettingValue') {
      // Special handling to set a setting value through the binding
      const [settingPath, value] = args;
      const menu = await extension.getSourceMenu();
      const success = await setSettingValueInMenu(menu, settingPath, value);
      result = success;
    } else if (method === 'invokeSettingAction') {
      // Special handling to invoke a button's onTap action
      const [settingPath] = args;
      const menu = await extension.getSourceMenu();
      const success = await invokeSettingAction(menu, settingPath);
      result = success;
    } else {
      result = await extension[method](...args);
    }
    
    log('Method completed:', method);
    activeExtensionId = null;
    sendToRN({ requestId, result });
  } catch (e) {
    activeExtensionId = null;
    log('Method failed:', e.message);
    sendToRN({ requestId, error: e.message });
  }
}

// Helper to resolve the source menu structure
async function resolveSourceMenu(menu, extensionId) {
  if (!menu) return null;
  
  const resolved = {
    id: menu.id || 'main',
    header: menu.header || 'Source Settings',
    isHidden: menu.isHidden || false,
    rows: [],
  };
  
  // Resolve rows
  let rows = [];
  if (typeof menu.rows === 'function') {
    try {
      rows = await menu.rows();
    } catch (e) {
      log('Error resolving menu rows:', e.message);
    }
  } else if (Array.isArray(menu.rows)) {
    rows = menu.rows;
  }
  
  for (const row of rows) {
    const resolvedRow = await resolveRow(row, extensionId);
    if (resolvedRow) {
      resolved.rows.push(resolvedRow);
    }
  }
  
  return resolved;
}

// Helper to resolve a single row
async function resolveRow(row, extensionId) {
  if (!row) return null;
  
  const base = {
    id: row.id,
    label: row.label || '',
  };
  
  // Navigation button with form
  if (row.form) {
    base.type = 'navigation';
    base.form = await resolveForm(row.form, extensionId);
    return base;
  }
  
  // Button with onTap
  if (row.onTap) {
    base.type = 'button';
    base.hasOnTap = true;
    return base;
  }
  
  // Select with options
  if (row.options) {
    base.type = 'select';
    base.options = row.options;
    base.allowsMultiselect = row.allowsMultiselect || false;
    
    // Resolve current value
    if (row.value && typeof row.value.get === 'function') {
      try {
        base.value = await row.value.get();
      } catch (e) {
        log('Error getting select value:', e.message);
        base.value = [];
      }
    }
    
    // Resolve labels
    if (row.labelResolver) {
      base.optionLabels = {};
      for (const opt of row.options) {
        try {
          base.optionLabels[opt] = await row.labelResolver(opt);
        } catch (e) {
          base.optionLabels[opt] = opt;
        }
      }
    }
    
    return base;
  }
  
  // Label (explicit via _isLabel flag or no value binding)
  if (row._isLabel === true) {
    base.type = 'label';
    return base;
  }
  
  // Input field (text or secure/password)
  // DUIInputField and DUISecureInputField have value binding but no options/onTap/form
  if (row.value && typeof row.value.get === 'function' && !row.onValueChange && !row.options && !row.form && !row.onTap) {
    // Check if it's a secure input (password field)
    // Secure inputs typically have 'password' in their id or label, or are created with createDUISecureInputField
    const isSecure = row.id?.toLowerCase().includes('password') || 
                     row.label?.toLowerCase().includes('password') ||
                     row._isSecure === true;
    
    base.type = isSecure ? 'secureInput' : 'input';
    try {
      base.value = await row.value.get();
    } catch (e) {
      base.value = '';
    }
    return base;
  }
  
  // Switch
  if (row.value && typeof row.value.get === 'function' && row.onValueChange) {
    base.type = 'switch';
    try {
      base.value = await row.value.get();
    } catch (e) {
      base.value = false;
    }
    return base;
  }
  
  // Stepper
  if (row.minValue !== undefined || row.maxValue !== undefined) {
    base.type = 'stepper';
    base.minValue = row.minValue;
    base.maxValue = row.maxValue;
    base.step = row.step || 1;
    if (row.value && typeof row.value.get === 'function') {
      try {
        base.value = await row.value.get();
      } catch (e) {
        base.value = 0;
      }
    }
    return base;
  }
  
  // Default - label
  base.type = 'label';
  return base;
}

// Helper to resolve a form
async function resolveForm(form, extensionId) {
  if (!form) return [];
  
  let sections = [];
  if (typeof form.sections === 'function') {
    try {
      sections = await form.sections();
    } catch (e) {
      log('Error resolving form sections:', e.message);
    }
  } else if (Array.isArray(form.sections)) {
    sections = form.sections;
  }
  
  const resolved = [];
  for (const section of sections) {
    const resolvedSection = await resolveSection(section, extensionId);
    if (resolvedSection) {
      resolved.push(resolvedSection);
    }
  }
  
  return resolved;
}

// Helper to resolve a section
async function resolveSection(section, extensionId) {
  if (!section) return null;
  
  const resolved = {
    id: section.id || 'section',
    header: section.header,
    footer: section.footer,
    isHidden: section.isHidden || false,
    rows: [],
  };
  
  let rows = [];
  if (typeof section.rows === 'function') {
    try {
      rows = await section.rows();
    } catch (e) {
      log('Error resolving section rows:', e.message);
    }
  } else if (Array.isArray(section.rows)) {
    rows = section.rows;
  }
  
  for (const row of rows) {
    const resolvedRow = await resolveRow(row, extensionId);
    if (resolvedRow) {
      resolved.rows.push(resolvedRow);
    }
  }
  
  return resolved;
}

// Helper to find and set a setting value
async function setSettingValueInMenu(menu, settingPath, value) {
  // settingPath is like "domain_settings/content/domain"
  log('setSettingValueInMenu path:', settingPath, 'value:', value);
  const parts = settingPath.split('/');
  
  // Navigate to find the target row
  let rows = [];
  if (typeof menu.rows === 'function') {
    rows = await menu.rows();
  } else if (Array.isArray(menu.rows)) {
    rows = menu.rows;
  }
  log('Menu rows:', rows.map(r => r.id));
  
  // Find the row by traversing the path
  let currentRows = rows;
  let i = 0;
  
  while (i < parts.length - 1) {
    const partId = parts[i];
    log('Looking for part:', partId, 'in rows:', currentRows.map(r => r.id));
    const row = currentRows.find(r => r.id === partId);
    
    if (!row) {
      log('Row not found:', partId);
      // Try to find it in nested sections
      let found = false;
      for (const r of currentRows) {
        if (r.form) {
          let sections = [];
          if (typeof r.form.sections === 'function') {
            sections = await r.form.sections();
          } else if (Array.isArray(r.form.sections)) {
            sections = r.form.sections;
          }
          
          for (const section of sections) {
            if (section.id === partId) {
              if (typeof section.rows === 'function') {
                currentRows = await section.rows();
              } else if (Array.isArray(section.rows)) {
                currentRows = section.rows;
              }
              log('Found section:', partId, 'rows:', currentRows.map(r => r.id));
              found = true;
              break;
            }
          }
          if (found) break;
        }
      }
      if (!found) {
        log('Could not find:', partId);
        return false;
      }
      i++;
      continue;
    }
    
    // Navigate into form sections
    if (row.form) {
      let sections = [];
      if (typeof row.form.sections === 'function') {
        sections = await row.form.sections();
      } else if (Array.isArray(row.form.sections)) {
        sections = row.form.sections;
      }
      log('Form sections:', sections.map(s => s.id));
      
      // Check if next part is a section ID
      const nextPart = parts[i + 1];
      const section = sections.find(s => s.id === nextPart);
      
      if (section) {
        if (typeof section.rows === 'function') {
          currentRows = await section.rows();
        } else if (Array.isArray(section.rows)) {
          currentRows = section.rows;
        }
        log('Entered section:', nextPart, 'rows:', currentRows.map(r => r.id));
        i += 2; // Skip both row and section
        continue;
      } else {
        // Take first section if not found
        if (sections.length > 0) {
          const firstSection = sections[0];
          if (typeof firstSection.rows === 'function') {
            currentRows = await firstSection.rows();
          } else if (Array.isArray(firstSection.rows)) {
            currentRows = firstSection.rows;
          }
        }
      }
    }
    i++;
  }
  
  // Find the target row
  const targetId = parts[parts.length - 1];
  log('Looking for target row:', targetId, 'in:', currentRows.map(r => r.id));
  const targetRow = currentRows.find(r => r.id === targetId);
  
  if (!targetRow) {
    log('Target row not found:', targetId);
    return false;
  }
  
  if (!targetRow.value || typeof targetRow.value.set !== 'function') {
    log('Target row has no value.set function');
    return false;
  }
  
  try {
    log('Setting value:', value);
    await targetRow.value.set(value);
    log('Value set successfully');
    return true;
  } catch (e) {
    log('Error setting value:', e.message);
    return false;
  }
}

// Helper to invoke a button's onTap action
async function invokeSettingAction(menu, settingPath) {
  log('invokeSettingAction path:', settingPath);
  const parts = settingPath.split('/');
  
  // Navigate to find the target row
  let rows = [];
  if (typeof menu.rows === 'function') {
    rows = await menu.rows();
  } else if (Array.isArray(menu.rows)) {
    rows = menu.rows;
  }
  log('Menu rows:', rows.map(r => r.id));
  
  let currentRows = rows;
  let i = 0;
  
  while (i < parts.length - 1) {
    const partId = parts[i];
    log('Looking for part:', partId);
    const row = currentRows.find(r => r.id === partId);
    
    if (!row) {
      // Try to find in sections
      let found = false;
      for (const r of currentRows) {
        if (r.form) {
          let sections = [];
          if (typeof r.form.sections === 'function') {
            sections = await r.form.sections();
          } else if (Array.isArray(r.form.sections)) {
            sections = r.form.sections;
          }
          
          for (const section of sections) {
            if (section.id === partId) {
              if (typeof section.rows === 'function') {
                currentRows = await section.rows();
              } else if (Array.isArray(section.rows)) {
                currentRows = section.rows;
              }
              found = true;
              break;
            }
          }
          if (found) break;
        }
      }
      if (!found) {
        log('Could not find:', partId);
        return false;
      }
      i++;
      continue;
    }
    
    if (row.form) {
      let sections = [];
      if (typeof row.form.sections === 'function') {
        sections = await row.form.sections();
      } else if (Array.isArray(row.form.sections)) {
        sections = row.form.sections;
      }
      
      const nextPart = parts[i + 1];
      const section = sections.find(s => s.id === nextPart);
      
      if (section) {
        if (typeof section.rows === 'function') {
          currentRows = await section.rows();
        } else if (Array.isArray(section.rows)) {
          currentRows = section.rows;
        }
        i += 2;
        continue;
      } else if (sections.length > 0) {
        const firstSection = sections[0];
        if (typeof firstSection.rows === 'function') {
          currentRows = await firstSection.rows();
        } else if (Array.isArray(firstSection.rows)) {
          currentRows = firstSection.rows;
        }
      }
    }
    i++;
  }
  
  // Find the target button
  const targetId = parts[parts.length - 1];
  log('Looking for target button:', targetId, 'in:', currentRows.map(r => r.id));
  const targetRow = currentRows.find(r => r.id === targetId);
  
  if (!targetRow) {
    log('Target button not found:', targetId);
    return false;
  }
  
  if (typeof targetRow.onTap !== 'function') {
    log('Target row has no onTap function');
    return false;
  }
  
  try {
    log('Invoking onTap');
    await targetRow.onTap();
    log('onTap completed successfully');
    return true;
  } catch (e) {
    log('Error invoking onTap:', e.message);
    return false;
  }
}

log('Extension Runner initialized');
</script>
</body>
</html>
`;

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ html: webViewHtml }}
        onMessage={handleMessage}
        onLoad={handleLoad}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        originWhitelist={['*']}
        mixedContentMode="always"
        allowUniversalAccessFromFileURLs={true}
        allowFileAccess={true}
        sharedCookiesEnabled={true}
        thirdPartyCookiesEnabled={true}
        cacheEnabled={true}
        style={styles.webview}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    width: 0,
    height: 0,
    opacity: 0,
  },
  webview: {
    width: 1,
    height: 1,
  },
});
