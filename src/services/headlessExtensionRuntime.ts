/**
 * Headless Extension Runtime
 * 
 * Runs Paperback extensions directly in the React Native JS engine
 * without requiring a WebView. Used as fallback for background downloads.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as jpeg from 'jpeg-js';
import { getBrowserAuthHosts, getBrowserAuthToken } from 'cloudflare-bypass';
import { getInstalledExtensions, downloadSourceJs, InstalledExtension } from './extensionStorageService';
import { appendPaperbackRequestParams } from './paperbackRequestUtils';

// Loaded extensions cache
const loadedExtensions: Record<string, any> = {};
const loadedExtensionMeta: Record<string, {
    apiVersion: '0.8' | '0.9';
    manga: Record<string, any>;
    chapters: Record<string, any>;
}> = {};
const extensionStates: Record<string, any> = {};
const paperback09States: Record<string, Record<string, any>> = {};
const paperback09Interceptors: Record<string, { id: string; request: string; response: string }[]> = {};
const paperback09Selectors = new Map<string, (...args: any[]) => any>();
let paperback09SelectorSequence = 0;
let activePaperback09Extension: string | null = null;
let headlessRunQueue: Promise<any> = Promise.resolve();
const YURI_GARDEN_SCRAMBLE_PREFIX = 'yg-scramble:';

const addNativeBrowserAuth = async (
    extensionId: string,
    url: string,
    headers: Record<string, string>,
): Promise<void> => {
    if (Object.keys(headers).some(key => key.toLowerCase() === 'authorization')) return;

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
        // The native module or an auth session may not exist in background tests.
    }
};

const paperbackMd5 = (value: string | ArrayBuffer): string => {
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
            let f: number;
            let wordIndex: number;
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
};

const createPaperback09Application = () => ({
    isResourceLimited: false,
    filterAdultTitles: false,
    filterMatureTitles: false,
    decodeHTMLEntities: (value: string) => value
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'"),
    sleep: (seconds: number) => new Promise(resolve => setTimeout(resolve, Math.max(0, seconds * 1000))),
    getDefaultUserAgent: async () => 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36',
    Selector: (object: any, symbol: string) => {
        const id = `selector-${++paperback09SelectorSequence}`;
        paperback09Selectors.set(id, object[symbol].bind(object));
        return id;
    },
    SelectorRegistry: {
        selector: (id: string) => {
            const callback = paperback09Selectors.get(id);
            if (!callback) throw new Error(`Selector not found: ${id}`);
            return callback;
        },
    },
    registerInterceptor: (id: string, request: string, response: string) => {
        if (!activePaperback09Extension) return;
        const list = paperback09Interceptors[activePaperback09Extension] || [];
        const next = list.filter(item => item.id !== id);
        next.push({ id, request, response });
        paperback09Interceptors[activePaperback09Extension] = next;
    },
    unregisterInterceptor: (id: string) => {
        if (!activePaperback09Extension) return;
        paperback09Interceptors[activePaperback09Extension] =
            (paperback09Interceptors[activePaperback09Extension] || []).filter(item => item.id !== id);
    },
    setRedirectHandler: () => undefined,
    scheduleRequest: async (request: any) => {
        const extensionId = activePaperback09Extension;
        const interceptors = paperback09Interceptors[extensionId || ''] || [];
        let finalRequest = { ...request, headers: { ...(request.headers || {}) } };

        for (const interceptor of interceptors) {
            const callback = paperback09Selectors.get(interceptor.request);
            if (callback) finalRequest = await callback(finalRequest);
        }

        if (finalRequest.cookies) {
            const cookieHeader = Object.entries(finalRequest.cookies)
                .map(([name, value]) => `${name}=${value}`)
                .join('; ');
            if (cookieHeader) finalRequest.headers.Cookie = cookieHeader;
        }

        let body = finalRequest.body;
        if (body && typeof body === 'object' && !(body instanceof ArrayBuffer) && !ArrayBuffer.isView(body)) {
            body = JSON.stringify(body);
            finalRequest.headers['Content-Type'] ||= 'application/json';
        }

        const response = await fetch(finalRequest.url, {
            method: finalRequest.method || 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36',
                ...finalRequest.headers,
            },
            body,
        });
        let data = await response.arrayBuffer();
        const responseInfo = {
            url: response.url || finalRequest.url,
            headers: Object.fromEntries(response.headers.entries()),
            status: response.status,
            mimeType: response.headers.get('content-type') || undefined,
            cookies: [],
        };

        for (const interceptor of [...interceptors].reverse()) {
            const callback = paperback09Selectors.get(interceptor.response);
            if (callback) data = await callback(finalRequest, responseInfo, data);
        }
        return [responseInfo, data];
    },
    arrayBufferToUTF8String: (buffer: ArrayBuffer) => new TextDecoder('utf-8').decode(buffer),
    arrayBufferToASCIIString: (buffer: ArrayBuffer) =>
        Array.from(new Uint8Array(buffer)).map(value => String.fromCharCode(value & 0x7f)).join(''),
    arrayBufferToUTF16String: (buffer: ArrayBuffer) => new TextDecoder('utf-16').decode(buffer),
    base64Encode: (value: string | ArrayBuffer) => {
        const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
        return btoa(Array.from(bytes).map(byte => String.fromCharCode(byte)).join(''));
    },
    base64Decode: (value: string) => {
        const binary = atob(value);
        const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
        return new TextDecoder('utf-8').decode(bytes);
    },
    crypto_md5Hash: paperbackMd5,
    getState: (key: string) => paperback09States[activePaperback09Extension || '']?.[key],
    setState: (value: any, key: string) => {
        if (!activePaperback09Extension) return;
        const extensionId = activePaperback09Extension;
        const state = paperback09States[extensionId] || {};
        state[key] = value;
        paperback09States[extensionId] = state;
        void AsyncStorage.setItem(`@extension_state_${extensionId}_paperback09`, JSON.stringify(state));
    },
    getSecureState: (key: string) => paperback09States[activePaperback09Extension || '']?.[`secure:${key}`],
    setSecureState: (value: any, key: string) => {
        if (!activePaperback09Extension) return;
        const extensionId = activePaperback09Extension;
        const state = paperback09States[extensionId] || {};
        state[`secure:${key}`] = value;
        paperback09States[extensionId] = state;
        void AsyncStorage.setItem(`@extension_state_${extensionId}_paperback09`, JSON.stringify(state));
    },
    resetAllState: () => {
        if (activePaperback09Extension) paperback09States[activePaperback09Extension] = {};
    },
    registerDiscoverSection: () => undefined,
    unregisterDiscoverSection: () => undefined,
    registeredDiscoverSections: () => [],
    invalidateDiscoverSections: () => undefined,
    executeInWebView: async () => {
        throw new Error('executeInWebView requires the foreground extension runtime');
    },
    formDidChange: () => undefined,
});

const paperback09Application = createPaperback09Application();

const encodeYuriGardenScramblePayload = (payload: { url: string; decoded?: number[] }): string | null => {
    try {
        return YURI_GARDEN_SCRAMBLE_PREFIX + btoa(JSON.stringify(payload));
    } catch (error: any) {
        console.log('[HeadlessRuntime] Failed to encode YuriGarden scramble payload:', error?.message || error);
        return null;
    }
};

const isYuriGardenChapterImageUrl = (url: string): boolean => {
    if (typeof url !== 'string') return false;
    return /^https:\/\/(?:db\.yurigarden\.com|cdn\.yurigarden\.moe)\/.+\/chapters\/\d+\/.+/i.test(url);
};

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

                    const requestUrl = appendPaperbackRequestParams(finalRequest.url, finalRequest.param);
                    if (requestUrl !== finalRequest.url) {
                        finalRequest = { ...finalRequest, url: requestUrl };
                    }

                    // Make the actual fetch request
                    const headers: Record<string, string> = {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                        'Accept': 'application/json, text/plain, */*',
                        ...finalRequest.headers,
                    };
                    await addNativeBrowserAuth(extensionId, finalRequest.url, headers);

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

    let sourceJs: string | undefined = ext.sourceJs;
    if (!sourceJs) {
        const downloaded = await downloadSourceJs(ext);
        if (!downloaded) {
            console.error('[HeadlessRuntime] Failed to download extension bundle for', ext.id);
            return false;
        }
        sourceJs = downloaded;
    }

    try {
        // Create a sandbox environment for the extension
        const App = createApp(ext.id);
        const cheerio = createSimpleCheerio();

        // Store previous globals to restore later
        const prevApp = (globalThis as any).App;
        const prevCheerio = (globalThis as any).cheerio;
        const prevSources = (globalThis as any).Sources;
        const prevSource = (globalThis as any).source;
        const prevApplication = (globalThis as any).Application;
        const isPaperback09 = ext.apiVersion === '0.9'
            || (sourceJs.includes('var source=') && !sourceJs.includes('Sources='));

        if (isPaperback09) {
            const savedState = await AsyncStorage.getItem(`@extension_state_${ext.id}_paperback09`);
            paperback09States[ext.id] = savedState ? JSON.parse(savedState) : {};
            activePaperback09Extension = ext.id;
        }

        // Inject globals that extensions expect
        (globalThis as any).App = App;
        (globalThis as any).cheerio = cheerio;
        (globalThis as any).Sources = undefined;
        (globalThis as any).source = undefined;
        (globalThis as any).Application = paperback09Application;

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
            (globalThis as any).source = prevSource;
            (globalThis as any).Application = prevApplication;
            activePaperback09Extension = null;
            throw new Error(`Eval error: ${evalError.message}`);
        }

        // Get the export container created by the extension.
        const Sources = (globalThis as any).Sources;
        const paperback09Exports = (globalThis as any).source;
        const exportContainer = isPaperback09 ? paperback09Exports : Sources;

        // Restore previous globals
        (globalThis as any).App = prevApp;
        (globalThis as any).cheerio = prevCheerio;
        (globalThis as any).Sources = prevSources;
        (globalThis as any).source = prevSource;
        (globalThis as any).Application = prevApplication;

        if (!exportContainer) {
            activePaperback09Extension = null;
            throw new Error('No Paperback exports found after loading extension');
        }

        // Find the extension class
        const availableKeys = Object.keys(exportContainer);
        let ExtensionClass = exportContainer[ext.id];

        if (!ExtensionClass) {
            // Try case-insensitive match
            const lowerExtId = ext.id.toLowerCase();
            for (const key of availableKeys) {
                if (key.toLowerCase() === lowerExtId) {
                    ExtensionClass = exportContainer[key];
                    break;
                }
            }
        }

        if (!ExtensionClass) {
            const usableKeys = availableKeys.filter(key =>
                !/Extension$/.test(key)
                && exportContainer[key]
                && typeof exportContainer[key] === 'object'
            );
            if (usableKeys.length === 1) ExtensionClass = exportContainer[usableKeys[0]];
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
        loadedExtensionMeta[ext.id] = {
            apiVersion: isPaperback09 ? '0.9' : '0.8',
            manga: {},
            chapters: {},
        };

        if (isPaperback09 && typeof instance.initialise === 'function') {
            (globalThis as any).Application = paperback09Application;
            await instance.initialise();
            (globalThis as any).Application = prevApplication;
        }
        activePaperback09Extension = null;
        console.log('[HeadlessRuntime] Extension loaded successfully:', ext.id);
        return true;
    } catch (error: any) {
        activePaperback09Extension = null;
        console.error('[HeadlessRuntime] Failed to load extension:', ext.id, error.message);
        return false;
    }
};

/**
 * Run a method on a loaded extension
 */
const runMethod = async (extensionId: string, method: string, args: any[]): Promise<any> => {
    const extension = loadedExtensions[extensionId];
    const meta = loadedExtensionMeta[extensionId];
    if (!extension) {
        throw new Error(`Extension not loaded: ${extensionId}`);
    }

    if (typeof extension[method] !== 'function') {
        throw new Error(`Method not found: ${method}`);
    }

    console.log('[HeadlessRuntime] Running method:', extensionId, method);

    const invoke = async (): Promise<any> => {
        const previousApplication = (globalThis as any).Application;
        if (meta?.apiVersion === '0.9') {
            activePaperback09Extension = extensionId;
            (globalThis as any).Application = paperback09Application;
        }

        try {
            if (meta?.apiVersion === '0.9' && method === 'getChapterDetails') {
                const [mangaId, chapterId] = args;
                let sourceManga = meta.manga[mangaId];
                if (!sourceManga) {
                    sourceManga = await extension.getMangaDetails(mangaId);
                    meta.manga[mangaId] = sourceManga;
                }

                let chapter = meta.chapters[chapterId];
                if (!chapter) {
                    const chapters = await extension.getChapters(sourceManga);
                    for (const item of chapters || []) {
                        meta.chapters[item.chapterId || item.id] = item;
                    }
                    chapter = meta.chapters[chapterId];
                }
                if (!chapter) throw new Error(`Chapter not found: ${chapterId}`);
                return extension.getChapterDetails(chapter);
            }

            return extension[method](...args);
        } finally {
            activePaperback09Extension = null;
            (globalThis as any).Application = previousApplication;
        }
    };

    if (method === 'getChapterDetails') {
        const rawResult = await invoke();
        let pages: any[] = [];

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

                // Mark DRM URLs
                if (url && url.includes('#drm_data=')) {
                    url = 'drm://' + extensionId + '/' + url;
                }

                return url;
            });
        }

        return { pages };
    }

    return invoke();
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
        const execute = async () => {
            // Ensure extension is loaded
            if (!loadedExtensions[extensionId]) {
                const loaded = await headlessRuntime.loadExtension(extensionId);
                if (!loaded) {
                    throw new Error(`Failed to load extension: ${extensionId}`);
                }
            }
            return runMethod(extensionId, method, args);
        };

        const queued = headlessRunQueue.then(execute, execute);
        headlessRunQueue = queued.catch(() => undefined);
        return queued;
    },

    /**
     * Clear loaded extensions cache
     */
    clearCache: (extensionId?: string) => {
        const keys = extensionId ? [extensionId] : Object.keys(loadedExtensions);
        keys.forEach(key => {
            delete loadedExtensions[key];
            delete loadedExtensionMeta[key];
        });
    },
};
