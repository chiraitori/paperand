/**
 * Extension Runner - WebView-based Extension Execution
 * 
 * This component runs Paperback extensions in a hidden WebView,
 * allowing ALL extensions to work without hardcoding.
 */

import React, { useRef, useEffect, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { setExtensionBridge, ExtensionBridge } from '../services/sourceService';

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

      // Timeout after 30 seconds
      setTimeout(() => {
        if (pendingRequestsRef.current.has(requestId)) {
          pendingRequestsRef.current.delete(requestId);
          reject(new Error('Request timeout'));
        }
      }, 30000);
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
        const { url, options } = data;
        console.log('[ExtensionRunner] Proxying fetch:', url, 'method:', options?.method);

        // Support both body and data (some extensions use data for form data)
        let requestBody = options?.body || options?.data;

        // Merge default headers with request headers (request headers take priority)
        const defaultHeaders: Record<string, string> = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
        };
        const headers: Record<string, string> = { ...defaultHeaders, ...options?.headers };

        // Check if this is likely an image request (for DRM handling)
        const isImageRequest = url.includes('drm_data=') ||
          url.match(/\.(jpg|jpeg|png|gif|webp)(\?|#|$)/i) ||
          options?.responseType === 'arraybuffer';

        // Log the request details for debugging
        if (!isImageRequest) {
          console.log('[ExtensionRunner] Request method:', options?.method || 'GET');
          console.log('[ExtensionRunner] Request headers:', JSON.stringify(headers, null, 2));
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

          if (isImageRequest) {
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
            };
          } else {
            // For text/JSON requests
            const text = await response.text();
            console.log('[ExtensionRunner] Response text length:', text.length);

            responseData = {
              requestId,
              data: text,
              status: response.status,
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
      loadExtension: async (extensionId: string, sourceJs: string) => {
        try {
          await sendMessage('loadExtension', { extensionId, sourceJs });
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
          elements.forEach((el, i) => fn(i, wrapElements([el])));
          return obj;
        },
        map: (fn) => {
          return {
            get: () => elements.map((el, i) => fn(i, wrapElements([el]))),
            toArray: () => elements.map((el, i) => fn(i, wrapElements([el]))),
          };
        },
        toArray: () => elements.map(el => wrapElements([el])),
        find: (sel) => wrapElements(elements.flatMap(el => Array.from(el.querySelectorAll ? el.querySelectorAll(sel) : []))),
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
const extensionStates = {};

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
      url,
      options: {
        method: options?.method || 'GET',
        headers: options?.headers || {},
        body: options?.body,
        data: options?.data, // For form data (used by some extensions)
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

// Mock App object that Paperback extensions expect
const App = {
  createRequest: (config) => config,
  
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
    // This will be set when an extension is loaded
    let currentExtensionId = null;
    
    const storeValue = async (key, value) => {
      if (!currentExtensionId) {
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
          extensionId: currentExtensionId,
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
      if (!currentExtensionId) {
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
          extensionId: currentExtensionId,
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
    const { type, requestId, extensionId, sourceJs, method, args } = message;

    if (type === 'loadExtension') {
      loadExtension(extensionId, sourceJs, requestId);
    } else if (type === 'runMethod') {
      runExtensionMethod(extensionId, method, args, requestId);
    }
  } catch (e) {
    log('Error handling message:', e.message);
  }
};

// Load an extension from source.js
function loadExtension(extensionId, sourceJs, requestId) {
  try {
    log('Loading extension:', extensionId);
    
    // IMPORTANT: Clear window.Sources BEFORE loading to ensure we get a fresh object
    // This prevents cross-contamination between extensions (e.g., Cuutruyen showing Pixiv data)
    const originalSources = window.Sources;
    window.Sources = undefined;
    
    // Execute the source code - this will set window.Sources
    eval(sourceJs);
    
    // Get the Sources object that was just created by this extension
    const Sources = window.Sources;
    
    if (!Sources) {
      window.Sources = originalSources; // Restore
      throw new Error('No Sources found after loading extension');
    }
    
    // Log available sources for debugging
    const availableKeys = Object.keys(Sources);
    log('Available source classes:', availableKeys.join(', '));
    
    // Find the extension class - try exact match first, then case-insensitive match
    let ExtensionClass = Sources[extensionId];
    
    if (!ExtensionClass) {
      // Try case-insensitive match
      const lowerExtId = extensionId.toLowerCase();
      for (const key of availableKeys) {
        if (key.toLowerCase() === lowerExtId) {
          ExtensionClass = Sources[key];
          log('Found extension via case-insensitive match:', key);
          break;
        }
      }
    }
    
    if (!ExtensionClass) {
      // Only use first key if there's exactly ONE source in the bundle
      // This prevents picking the wrong extension when multiple are cached
      if (availableKeys.length === 1) {
        ExtensionClass = Sources[availableKeys[0]];
        log('Using single available source:', availableKeys[0]);
      } else {
        window.Sources = originalSources; // Restore
        throw new Error('Extension class not found for ' + extensionId + '. Available: ' + availableKeys.join(', '));
      }
    }
    
    if (!ExtensionClass) {
      window.Sources = originalSources; // Restore
      throw new Error('No extension class found for ' + extensionId);
    }
    
    // Instantiate it - some extensions expect cheerio to be passed
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
    
    log('Extension loaded successfully:', extensionId);
    sendToRN({ requestId, result: true });
    
    // Restore original Sources (though we might want to keep it cleared)
    window.Sources = originalSources;
  } catch (e) {
    log('Failed to load extension:', e.message);
    sendToRN({ requestId, error: e.message });
  }
}

// Run a method on an extension
async function runExtensionMethod(extensionId, method, args, requestId) {
  try {
    const extension = loadedExtensions[extensionId];
    
    if (!extension) {
      throw new Error('Extension not loaded: ' + extensionId);
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
        // Fetch through the extension's request manager (which has the DRM interceptor)
        const response = await extension.requestManager.schedule(
          App.createRequest({ url: imageUrl, method: 'GET' }),
          1
        );
        
        // If we got decrypted rawData, convert to base64 data URL
        if (response.rawData) {
          let binary = '';
          const bytes = response.rawData instanceof Uint8Array ? response.rawData : new Uint8Array(response.rawData);
          for (let j = 0; j < bytes.length; j++) {
            binary += String.fromCharCode(bytes[j]);
          }
          const base64 = btoa(binary);
          result = 'data:image/jpeg;base64,' + base64;
          log('DRM image decrypted successfully, size:', bytes.length);
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
    sendToRN({ requestId, result });
  } catch (e) {
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
