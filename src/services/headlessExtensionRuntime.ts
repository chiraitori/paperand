/**
 * Headless Extension Runtime
 * 
 * Runs Paperback extensions directly in the React Native JS engine
 * without requiring a WebView. Used as fallback for background downloads.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as jpeg from 'jpeg-js';
import { getInstalledExtensions, downloadSourceJs, InstalledExtension } from './extensionStorageService';

// Loaded extensions cache
const loadedExtensions: Record<string, any> = {};
const extensionStates: Record<string, any> = {};

// Cheerio-like HTML parser using regex (simplified for common patterns)
const createSimpleCheerio = () => {
    const load = (html: string) => {
        const $ = (selector: string) => {
            // Simplified selector support
            const elements: Element[] = [];

            const wrapElements = (els: any[]) => ({
                length: els.length,
                get: (i: number) => els[i],
                first: () => wrapElements(els.slice(0, 1)),
                last: () => wrapElements(els.slice(-1)),
                eq: (i: number) => wrapElements([els[i]]),
                each: (fn: (i: number, el: any) => void) => {
                    els.forEach((el, i) => fn(i, wrapElements([el])));
                    return wrapElements(els);
                },
                map: (fn: (i: number, el: any) => any) => ({
                    get: () => els.map((el, i) => fn(i, wrapElements([el]))),
                    toArray: () => els.map((el, i) => fn(i, wrapElements([el]))),
                }),
                toArray: () => els.map(el => wrapElements([el])),
                find: (sel: string) => wrapElements([]), // Simplified
                children: () => wrapElements([]),
                parent: () => wrapElements([]),
                text: () => els.map(el => el.textContent || '').join('').trim(),
                html: () => els[0]?.innerHTML || '',
                attr: (name: string) => els[0]?.getAttribute?.(name) || '',
                data: (name: string) => '',
                hasClass: (cls: string) => false,
            });

            return wrapElements(elements);
        };

        ($ as any).html = () => html;
        ($ as any).text = () => html.replace(/<[^>]+>/g, '');
        ($ as any).root = () => ({ html: () => html });

        return $;
    };

    return { load };
};

// Create mock App object that Paperback extensions expect
const createApp = (extensionId: string) => ({
    createRequest: (config: any) => config,

    createRequestManager: (config?: any) => {
        const interceptor = config?.interceptor;

        return {
            schedule: async (request: any, priority?: number) => {
                try {
                    // Apply request interceptor if present
                    let finalRequest = request;
                    if (interceptor?.interceptRequest) {
                        try {
                            finalRequest = await interceptor.interceptRequest(request);
                        } catch (e: any) {
                            console.log('[HeadlessRuntime] Interceptor error:', e.message);
                        }
                    }

                    // Make the actual fetch request
                    const headers: Record<string, string> = {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                        'Accept': 'application/json, text/plain, */*',
                        ...finalRequest.headers,
                    };

                    const isImageRequest = finalRequest.url.includes('drm_data=') ||
                        /\.(jpg|jpeg|png|gif|webp)(\?|#|$)/i.test(finalRequest.url);

                    const response = await fetch(finalRequest.url, {
                        method: finalRequest.method || 'GET',
                        headers,
                        body: finalRequest.body,
                    });

                    let result: any = {
                        data: '',
                        status: response.status,
                        rawData: null,
                        request: finalRequest,
                    };

                    if (isImageRequest) {
                        // For image requests, return as Uint8Array
                        const arrayBuffer = await response.arrayBuffer();
                        result.rawData = new Uint8Array(arrayBuffer);
                    } else {
                        result.data = await response.text();
                    }

                    // Apply response interceptor if present
                    if (interceptor?.interceptResponse) {
                        try {
                            result = await interceptor.interceptResponse(result);
                        } catch (e: any) {
                            console.log('[HeadlessRuntime] Response interceptor error:', e.message);
                        }
                    }

                    return result;
                } catch (error: any) {
                    console.log('[HeadlessRuntime] Request failed:', error.message);
                    return { data: '', status: 500 };
                }
            },
            getDefaultUserAgent: async () => 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36',
        };
    },

    createSourceStateManager: () => {
        const storeValue = async (key: string, value: any) => {
            try {
                const storageKey = `@extension_state_${extensionId}_${key}`;
                await AsyncStorage.setItem(storageKey, JSON.stringify(value));
            } catch (e) {
                extensionStates[key] = value;
            }
        };

        const retrieveValue = async (key: string) => {
            try {
                const storageKey = `@extension_state_${extensionId}_${key}`;
                const value = await AsyncStorage.getItem(storageKey);
                return value ? JSON.parse(value) : null;
            } catch (e) {
                return extensionStates[key] || null;
            }
        };

        return {
            store: storeValue,
            retrieve: retrieveValue,
            keychain: {
                store: async (key: string, value: any) => storeValue('keychain_' + key, value),
                retrieve: async (key: string) => retrieveValue('keychain_' + key),
            },
        };
    },

    createHomeSection: (config: any) => ({ ...config, items: config.items || [] }),
    createPartialSourceManga: (config: any) => ({
        mangaId: config.mangaId,
        id: config.mangaId,
        title: config.title,
        image: config.image,
        subtitle: config.subtitle,
    }),
    createSourceManga: (config: any) => ({
        id: config.id,
        mangaInfo: config.mangaInfo,
        ...config.mangaInfo,
    }),
    createMangaInfo: (config: any) => config,
    createChapter: (config: any) => config,
    createChapterDetails: (config: any) => config,
    createPagedResults: (config: any) => config,
    createTagSection: (config: any) => config,
    createTag: (config: any) => config,
    createDUISection: (config: any) => config,
    createDUINavigationButton: (config: any) => config,
    createDUIForm: (config: any) => config,
    createDUISelect: (config: any) => config,
    createDUIBinding: (config: any) => ({ get: config.get, set: config.set }),
    createDUIButton: (config: any) => config,
    createDUISwitch: (config: any) => config,
    createDUIInputField: (config: any) => config,
    createDUISecureInputField: (config: any) => ({ ...config, _isSecure: true }),
    createDUILabel: (config: any) => ({ ...config, _isLabel: true }),
    createDUIStepper: (config: any) => config,
    createDUILink: (config: any) => config,
    createDUIMultilineLabel: (config: any) => ({ ...config, _isLabel: true }),

    // PBImage with dimension parsing (needed for DRM unscrambling)
    createPBImage: (config: any) => {
        let bytes: Uint8Array;
        if (typeof config.data === 'string') {
            // Base64 decode
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
            console.log('[HeadlessRuntime] createPBImage: Unknown data type');
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
                // PNG IHDR chunk starts at offset 16
                width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
                height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
            }
        } catch (e: any) {
            console.log('[HeadlessRuntime] createPBImage: Error parsing dimensions:', e.message);
        }

        console.log('[HeadlessRuntime] createPBImage: parsed dimensions', width, 'x', height);

        return { width, height, _bytes: bytes };
    },

    // PBCanvas for DRM decryption with pure-JS image unscrambling
    createPBCanvas: () => {
        const drawQueue: { srcImg: any; sx: number; sy: number; sw: number; sh: number; dx: number; dy: number }[] = [];
        let canvasWidth = 0;
        let canvasHeight = 0;

        return {
            width: 0,
            height: 0,
            setSize: function (w: number, h: number) {
                this.width = w;
                this.height = h;
                canvasWidth = w;
                canvasHeight = h;
            },
            drawImage: function (srcImg: any, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number) {
                if (srcImg._bytes) {
                    drawQueue.push({ srcImg, sx, sy, sw, sh, dx, dy });
                }
            },
            encode: async (mimeType?: string): Promise<Uint8Array | null> => {
                if (drawQueue.length === 0) {
                    console.log('[HeadlessRuntime] PBCanvas.encode: no draw operations queued');
                    return null;
                }

                try {
                    // Get the source image from the first draw operation
                    const sourceImg = drawQueue[0].srcImg;
                    if (!sourceImg._bytes) {
                        console.log('[HeadlessRuntime] PBCanvas.encode: no source bytes');
                        return null;
                    }

                    console.log('[HeadlessRuntime] PBCanvas.encode: decoding JPEG, size:', sourceImg._bytes.length);

                    // Decode JPEG to raw pixels using jpeg-js
                    let decoded;
                    try {
                        decoded = jpeg.decode(sourceImg._bytes, { useTArray: true, formatAsRGBA: true });
                    } catch (decodeErr: any) {
                        console.error('[HeadlessRuntime] JPEG decode failed:', decodeErr.message);
                        return sourceImg._bytes; // Return original on error
                    }

                    const srcWidth = decoded.width;
                    const srcHeight = decoded.height;
                    const srcData = decoded.data; // RGBA format

                    console.log('[HeadlessRuntime] Decoded image:', srcWidth, 'x', srcHeight, 'canvas:', canvasWidth, 'x', canvasHeight);

                    // Create destination buffer (RGBA format)
                    const dstWidth = canvasWidth || srcWidth;
                    const dstHeight = canvasHeight || srcHeight;
                    const dstData = new Uint8Array(dstWidth * dstHeight * 4);

                    // Execute all draw operations (copy rows from source to destination)
                    for (const op of drawQueue) {
                        // op: { sx, sy, sw, sh, dx, dy }
                        // Copy a rectangle from (sx, sy) with size (sw, sh) to destination at (dx, dy)
                        const copyWidth = Math.min(op.sw, srcWidth - op.sx, dstWidth - op.dx);
                        const copyHeight = Math.min(op.sh, srcHeight - op.sy, dstHeight - op.dy);

                        if (copyWidth <= 0 || copyHeight <= 0) continue;

                        for (let row = 0; row < copyHeight; row++) {
                            const srcRowStart = ((op.sy + row) * srcWidth + op.sx) * 4;
                            const dstRowStart = ((op.dy + row) * dstWidth + op.dx) * 4;
                            const rowBytes = copyWidth * 4;

                            // Copy the row
                            for (let i = 0; i < rowBytes; i++) {
                                if (srcRowStart + i < srcData.length && dstRowStart + i < dstData.length) {
                                    dstData[dstRowStart + i] = srcData[srcRowStart + i];
                                }
                            }
                        }
                    }

                    console.log('[HeadlessRuntime] PBCanvas.encode: re-encoding to JPEG');

                    // Encode back to JPEG
                    const rawImageData = {
                        data: dstData,
                        width: dstWidth,
                        height: dstHeight,
                    };
                    const encodedJpeg = jpeg.encode(rawImageData, 85); // Quality 85

                    console.log('[HeadlessRuntime] PBCanvas.encode: complete, output size:', encodedJpeg.data.length);
                    return new Uint8Array(encodedJpeg.data);
                } catch (err: any) {
                    console.error('[HeadlessRuntime] PBCanvas.encode error:', err.message);
                    // On error, try to return original bytes
                    if (drawQueue[0]?.srcImg?._bytes) {
                        return drawQueue[0].srcImg._bytes;
                    }
                    return null;
                }
            },
        };
    },
});

/**
 * Load an extension into the headless runtime
 */
const loadExtension = async (ext: InstalledExtension): Promise<boolean> => {
    if (loadedExtensions[ext.id]) {
        console.log('[HeadlessRuntime] Extension loaded from cache:', ext.id);
        return true;
    }

    console.log('[HeadlessRuntime] Loading extension:', ext.id);

    let sourceJs = ext.sourceJs;
    if (!sourceJs) {
        sourceJs = await downloadSourceJs(ext);
        if (!sourceJs) {
            console.error('[HeadlessRuntime] Failed to download source.js for', ext.id);
            return false;
        }
    }

    try {
        // Create a sandbox environment for the extension
        const App = createApp(ext.id);
        const cheerio = createSimpleCheerio();

        // Store previous globals to restore later
        const prevApp = (globalThis as any).App;
        const prevCheerio = (globalThis as any).cheerio;
        const prevSources = (globalThis as any).Sources;

        // Inject globals that extensions expect
        (globalThis as any).App = App;
        (globalThis as any).cheerio = cheerio;
        (globalThis as any).Sources = undefined;

        // Also inject common Paperback SDK types if not present
        if (!(globalThis as any).ContentRating) {
            (globalThis as any).ContentRating = { EVERYONE: 0, MATURE: 1, ADULT: 2 };
        }
        if (!(globalThis as any).LanguageCode) {
            (globalThis as any).LanguageCode = {
                ENGLISH: 'en', VIETNAMESE: 'vi', JAPANESE: 'ja', CHINESE: 'zh',
                KOREAN: 'ko', SPANISH: 'es', PORTUGUESE: 'pt', FRENCH: 'fr',
                GERMAN: 'de', RUSSIAN: 'ru', INDONESIAN: 'id', THAI: 'th',
                UNKNOWN: '_unknown'
            };
        }
        if (!(globalThis as any).MangaStatus) {
            (globalThis as any).MangaStatus = {
                ONGOING: 0, COMPLETED: 1, UNKNOWN: 2, ABANDONED: 3, HIATUS: 4
            };
        }
        if (!(globalThis as any).HomeSectionType) {
            (globalThis as any).HomeSectionType = {
                singleRowNormal: 'singleRowNormal',
                singleRowLarge: 'singleRowLarge',
                doubleRow: 'doubleRow',
                featured: 'featured'
            };
        }
        if (!(globalThis as any).TagType) {
            (globalThis as any).TagType = {
                BLUE: 'default', GREEN: 'success', GREY: 'secondary',
                YELLOW: 'warning', RED: 'danger'
            };
        }
        // Source base class for extensions that need it
        if (!(globalThis as any).Source) {
            (globalThis as any).Source = class Source {
                cheerio: any;
                constructor(cheerio: any) {
                    this.cheerio = cheerio;
                }
            };
        }

        try {
            // Execute the source code in global context - this sets globalThis.Sources
            // eslint-disable-next-line no-eval
            const evalFunc = eval;
            evalFunc(sourceJs);
        } catch (evalError: any) {
            // Restore globals
            (globalThis as any).App = prevApp;
            (globalThis as any).cheerio = prevCheerio;
            (globalThis as any).Sources = prevSources;
            throw new Error(`Eval error: ${evalError.message}`);
        }

        // Get the Sources object that was created by the extension
        const Sources = (globalThis as any).Sources;

        // Restore previous globals
        (globalThis as any).App = prevApp;
        (globalThis as any).cheerio = prevCheerio;
        (globalThis as any).Sources = prevSources;

        if (!Sources) {
            throw new Error('No Sources found after loading extension');
        }

        // Find the extension class
        const availableKeys = Object.keys(Sources);
        let ExtensionClass = Sources[ext.id];

        if (!ExtensionClass) {
            // Try case-insensitive match
            const lowerExtId = ext.id.toLowerCase();
            for (const key of availableKeys) {
                if (key.toLowerCase() === lowerExtId) {
                    ExtensionClass = Sources[key];
                    break;
                }
            }
        }

        if (!ExtensionClass && availableKeys.length === 1) {
            ExtensionClass = Sources[availableKeys[0]];
        }

        if (!ExtensionClass) {
            throw new Error(`Extension class not found for ${ext.id}`);
        }

        // Instantiate
        let instance;
        if (typeof ExtensionClass === 'function') {
            try {
                instance = new ExtensionClass(cheerio);
            } catch (e) {
                instance = new ExtensionClass();
            }
        } else {
            instance = ExtensionClass;
        }

        if (instance && !instance.cheerio) {
            instance.cheerio = cheerio;
        }

        loadedExtensions[ext.id] = instance;
        console.log('[HeadlessRuntime] Extension loaded successfully:', ext.id);
        return true;
    } catch (error: any) {
        console.error('[HeadlessRuntime] Failed to load extension:', ext.id, error.message);
        return false;
    }
};

/**
 * Run a method on a loaded extension
 */
const runMethod = async (extensionId: string, method: string, args: any[]): Promise<any> => {
    const extension = loadedExtensions[extensionId];
    if (!extension) {
        throw new Error(`Extension not loaded: ${extensionId}`);
    }

    if (typeof extension[method] !== 'function') {
        throw new Error(`Method not found: ${method}`);
    }

    console.log('[HeadlessRuntime] Running method:', extensionId, method);

    if (method === 'getChapterDetails') {
        const rawResult = await extension[method](...args);
        let pages: string[] = [];

        if (rawResult) {
            if (rawResult.pages && Array.isArray(rawResult.pages)) {
                pages = rawResult.pages;
            } else if (Array.isArray(rawResult)) {
                pages = rawResult;
            }

            // Process pages
            pages = pages.map((p: any) => {
                let url: string;
                if (typeof p === 'string') {
                    url = p;
                } else if (p.url) {
                    url = p.url;
                } else if (p.image) {
                    url = p.image;
                } else if (p.imageUrl) {
                    url = p.imageUrl;
                } else {
                    url = String(p);
                }

                // Mark DRM URLs
                if (url && url.includes('#drm_data=')) {
                    url = 'drm://' + extensionId + '/' + url;
                }

                return url;
            });
        }

        return { pages };
    }

    return await extension[method](...args);
};

/**
 * The headless runtime interface
 */
export const headlessRuntime = {
    /**
     * Check if an extension can be loaded in headless mode
     */
    isAvailable: () => true,

    /**
     * Check if an extension is loaded
     */
    isLoaded: (extensionId: string) => !!loadedExtensions[extensionId],

    /**
     * Load an extension by ID
     */
    loadExtension: async (extensionId: string): Promise<boolean> => {
        const extensions = await getInstalledExtensions();
        const ext = extensions.find(e => e.id === extensionId);
        if (!ext) {
            console.error('[HeadlessRuntime] Extension not found:', extensionId);
            return false;
        }
        return loadExtension(ext);
    },

    /**
     * Run a method on an extension
     */
    runExtensionMethod: async (extensionId: string, method: string, args: any[]): Promise<any> => {
        // Ensure extension is loaded
        if (!loadedExtensions[extensionId]) {
            const loaded = await headlessRuntime.loadExtension(extensionId);
            if (!loaded) {
                throw new Error(`Failed to load extension: ${extensionId}`);
            }
        }
        return runMethod(extensionId, method, args);
    },

    /**
     * Clear loaded extensions cache
     */
    clearCache: () => {
        Object.keys(loadedExtensions).forEach(key => delete loadedExtensions[key]);
    },
};
