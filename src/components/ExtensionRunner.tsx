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

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      const { requestId, type, result, error } = data;

      if (type === 'log') {
        console.log('[ExtensionRunner]', result);
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
    
    const $ = (selector) => {
      if (typeof selector === 'string') {
        if (selector.startsWith('<')) {
          // It's HTML string
          const temp = document.createElement('div');
          temp.innerHTML = selector;
          return wrapElements(Array.from(temp.childNodes));
        }
        const elements = Array.from(doc.querySelectorAll(selector));
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

// Mock App object that Paperback extensions expect
const App = {
  createRequest: (config) => config,
  
  createRequestManager: (config) => ({
    schedule: async (request, priority) => {
      try {
        const response = await fetch(request.url, {
          method: request.method || 'GET',
          headers: request.headers || {},
          body: request.body,
        });
        const data = await response.text();
        return { data, status: response.status, rawData: null };
      } catch (error) {
        console.error('Request failed:', error);
        return { data: null, status: 500 };
      }
    },
    getDefaultUserAgent: async () => 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36',
  }),
  
  createSourceStateManager: () => {
    const state = {};
    return {
      store: async (key, value) => { state[key] = value; },
      retrieve: async (key) => state[key] || null,
      keychain: {
        store: async (key, value) => { state['keychain_' + key] = value; },
        retrieve: async (key) => state['keychain_' + key] || null,
      },
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
    
    // The source.js sets Sources on window/this/global
    // We need to capture it
    const originalSources = window.Sources;
    
    // Execute the source code
    eval(sourceJs);
    
    // Get the Sources object
    const Sources = window.Sources || this.Sources;
    
    if (!Sources) {
      throw new Error('No Sources found after loading extension');
    }
    
    // Find the extension class
    const ExtensionClass = Sources[extensionId] || Sources[Object.keys(Sources)[0]];
    
    if (!ExtensionClass) {
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
    
    loadedExtensions[extensionId] = instance;
    
    log('Extension loaded successfully:', extensionId);
    sendToRN({ requestId, result: true });
    
    // Restore original Sources
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
    
    if (typeof extension[method] !== 'function') {
      throw new Error('Method not found: ' + method);
    }
    
    log('Running method:', extensionId, method, 'args:', JSON.stringify(args));
    
    let result;
    
    if (method === 'getHomePageSections') {
      // Special handling for getHomePageSections which uses callbacks
      const sections = [];
      await extension.getHomePageSections((section) => {
        sections.push({
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
      result = sections;
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
        
        // Pages might be objects with url/image property
        pages = pages.map(p => {
          if (typeof p === 'string') return p;
          if (p.url) return p.url;
          if (p.image) return p.image;
          if (p.imageUrl) return p.imageUrl;
          return p;
        });
      }
      
      log('getChapterDetails pages count:', pages.length);
      result = { pages };
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
