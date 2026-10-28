/*
 * Paperback Android — source runtime prelude.
 *
 * Reconstructed from Paperback iOS 0.8.11 (Models/AsyncJS/JSBridge.swift,
 * Models/Sources/RequestManager.swift and the @paperback/types 0.8 contract
 * that shipped extensions compile against).
 *
 * The iOS app exposes an `App` object built out of Swift `@objc` exporters whose
 * selectors are visible in the shipped binary, e.g.
 *
 *   _createExportWithId:chapNum:volume:name:group:time:langCode:sortingIndex:   -> App.createChapter
 *   _createExportWithId:imageUrl:title:subtitle:error:                          -> App.createPartialSourceManga
 *   _createExportWithSourceId:id:mangaId:pages:                                 -> App.createChapterDetails
 *   _createExportWithSourceId:title:type:items:containsMoreItems:               -> App.createHomeSection
 *   _createExportWithUrl:method:headers:param:data:cookies:                     -> App.createRequest
 *   _createExportWith_cookieStoreId:interceptor:requestsPerSecond:requestTimeout: -> App.createRequestManager
 *
 * Every data object below is created as a plain JavaScript value so it can cross
 * the JSON boundary to Kotlin cheaply; only the operations that need the device
 * (network, storage, keychain, timers) round-trip through __paperbackNative().
 */

(function () {
    'use strict';

    var __seq = 1;
    var __pending = Object.create(null);
    var __timerFns = Object.create(null);

    function __nextId() {
        return __seq++;
    }

    // ---------------------------------------------------------------- bridge --

    // Fire-and-forget call into Kotlin; the answer arrives through
    // __paperbackResolve(id, json, isError).
    function __paperbackCall(op, args) {
        return new Promise(function (resolve, reject) {
            var id = __nextId();
            __pending[id] = { resolve: resolve, reject: reject };
            var payload;
            try {
                payload = JSON.stringify(args === undefined ? null : args);
            } catch (e) {
                payload = 'null';
            }
            __paperbackNative(op, payload, id);
        });
    }

    // Called by Kotlin (QuickJsCore.complete) on the JS thread.
    globalThis.__paperbackResolve = function (id, json, isError) {
        var entry = __pending[id];
        if (!entry) return;
        delete __pending[id];
        var value;
        try {
            value = (json === null || json === undefined || json === '') ? null : JSON.parse(json);
        } catch (e) {
            value = json;
        }
        if (isError) {
            var err = new Error(typeof value === 'string' ? value : (value && value.message) || 'source error');
            if (value && typeof value === 'object') {
                for (var k in value) { try { err[k] = value[k]; } catch (e2) {} }
            }
            entry.reject(err);
        } else {
            entry.resolve(value);
        }
    };

    // Reports the outcome of a Kotlin initiated source call (`__paperbackInvoke`
    // and friends) back to the host. Defined here, forwarded through
    // __paperbackNative so no extra JNI entry point is required.
    globalThis.__paperbackResult = function (id, json, isError) {
        __paperbackNative('__result', JSON.stringify({
            id: id,
            json: json === undefined ? null : json,
            isError: !!isError
        }), 0);
    };

    // Implemented in C: __paperbackNative(op, argsJson, id)

    // ------------------------------------------------------------- utilities --

    function __log(level, args) {
        var parts = [];
        for (var i = 0; i < args.length; i++) {
            var a = args[i];
            if (typeof a === 'string') parts.push(a);
            else {
                try { parts.push(JSON.stringify(a)); } catch (e) { parts.push(String(a)); }
            }
        }
        __paperbackNative('log', JSON.stringify({ level: level, message: parts.join(' ') }), __nextId());
    }

    globalThis.console = {
        log: function () { __log('info', arguments); },
        info: function () { __log('info', arguments); },
        debug: function () { __log('debug', arguments); },
        warn: function () { __log('warn', arguments); },
        error: function () { __log('error', arguments); },
        trace: function () { __log('debug', arguments); },
        group: function () { __log('info', arguments); },
        groupEnd: function () {},
        assert: function (cond) { if (!cond) __log('error', Array.prototype.slice.call(arguments, 1)); }
    };

    globalThis.setTimeout = function (fn, ms) {
        var id = __nextId();
        __timerFns[id] = fn;
        __paperbackNative('timer.set', JSON.stringify({ id: id, ms: ms || 0, repeat: false }), __nextId());
        return id;
    };

    globalThis.setInterval = function (fn, ms) {
        var id = __nextId();
        __timerFns[id] = fn;
        __paperbackNative('timer.set', JSON.stringify({ id: id, ms: ms || 1000, repeat: true }), __nextId());
        return id;
    };

    function __clearTimer(id) {
        delete __timerFns[id];
        __paperbackNative('timer.clear', JSON.stringify({ id: id, ms: 0, repeat: false }), __nextId());
    }
    globalThis.clearTimeout = __clearTimer;
    globalThis.clearInterval = __clearTimer;

    globalThis.__paperbackFireTimer = function (id) {
        var fn = __timerFns[id];
        if (typeof fn !== 'function') return;
        try { fn(); } catch (e) { __log('error', ['[timer] ' + (e && e.message ? e.message : e)]); }
    };

    globalThis.__paperbackClearTimerFn = function (id) { delete __timerFns[id]; };

    var __b64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    globalThis.btoa = function (input) {
        var str = String(input), out = '', i;
        for (i = 0; i < str.length; i += 3) {
            var c1 = str.charCodeAt(i), c2 = i + 1 < str.length ? str.charCodeAt(i + 1) : NaN,
                c3 = i + 2 < str.length ? str.charCodeAt(i + 2) : NaN;
            out += __b64.charAt(c1 >> 2);
            out += __b64.charAt(((c1 & 3) << 4) | (isNaN(c2) ? 0 : c2 >> 4));
            out += isNaN(c2) ? '=' : __b64.charAt(((c2 & 15) << 2) | (isNaN(c3) ? 0 : c3 >> 6));
            out += isNaN(c3) ? '=' : __b64.charAt(c3 & 63);
        }
        return out;
    };
    globalThis.atob = function (input) {
        var str = String(input).replace(/=+$/, ''), out = '', i, bc = 0, bs, buffer;
        for (i = 0; i < str.length; i++) {
            buffer = __b64.indexOf(str.charAt(i));
            if (buffer === -1) continue;
            bs = bc % 4 ? bs * 64 + buffer : buffer;
            if (bc++ % 4) out += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6)));
        }
        return out;
    };

    // ------------------------------------------------------------ data types --

    // Marks the "kind" of a bridge object the way the iOS exporters do with real
    // ObjC classes. Non enumerable so the marker never leaks into JSON payloads.
    function __tag(o, type) {
        if (o && typeof o === 'object') {
            var kind = o.__pb || type || 'Object';
            if (!Object.prototype.hasOwnProperty.call(o, '__pb')) {
                try {
                    Object.defineProperty(o, '__pb', { value: kind, enumerable: false, configurable: true });
                } catch (e) {
                    o.__pb = kind;
                }
            }
        }
        return o;
    }

    var App = {
        // -- plain data constructors (mirror the @objc exporters in the binary)
        createTag: function (o) { return __tag({ id: o.id, label: o.label }, 'Tag'); },
        createTagSection: function (o) { return __tag({ id: o.id, label: o.label, tags: o.tags || [] }, 'TagSection'); },
        createSearchField: function (o) { return __tag({ id: o.id, name: o.name, placeholder: o.placeholder }, 'SearchField'); },

        createMangaInfo: function (o) {
            return __tag({
                image: o.image, artist: o.artist, author: o.author, desc: o.desc,
                status: o.status, hentai: o.hentai === undefined ? false : !!o.hentai,
                tags: o.tags || [], banner: o.banner, rating: o.rating === undefined ? 0 : o.rating,
                titles: o.titles || [], covers: o.covers || [], additionalInfo: o.additionalInfo || {}
            }, 'MangaInfo');
        },
        createSourceManga: function (o) {
            return __tag({ id: o.id, mangaInfo: o.mangaInfo }, 'SourceManga');
        },
        createPartialSourceManga: function (o) {
            return __tag({ mangaId: o.mangaId, image: o.image, title: o.title, subtitle: o.subtitle }, 'PartialSourceManga');
        },
        createChapter: function (o) {
            return __tag({
                id: o.id, chapNum: o.chapNum === undefined ? 0 : o.chapNum,
                volume: o.volume, name: o.name, group: o.group, time: o.time,
                langCode: o.langCode, sortingIndex: o.sortingIndex === undefined ? 0 : o.sortingIndex
            }, 'Chapter');
        },
        createChapterDetails: function (o) {
            return __tag({ id: o.id, mangaId: o.mangaId, pages: o.pages || [] }, 'ChapterDetails');
        },
        createHomeSection: function (o) {
            return __tag({
                id: o.id, title: o.title, type: o.type, items: o.items,
                containsMoreItems: o.containsMoreItems === undefined ? false : !!o.containsMoreItems
            }, 'HomeSection');
        },
        createPagedResults: function (o) {
            return __tag({ results: o.results || [], metadata: o.metadata }, 'PagedResults');
        },
        createMangaUpdates: function (o) { return __tag({ ids: o.ids || [] }, 'MangaUpdates'); },
        createMangaProgress: function (o) { return __tag(o, 'MangaProgress'); },
        createRequest: function (o) {
            return __tag({
                url: o.url, method: o.method || 'GET', headers: o.headers || {},
                param: o.param, data: o.data, cookies: o.cookies || []
            }, 'Request');
        },
        createCookie: function (o) {
            return __tag({
                name: o.name, value: o.value, domain: o.domain, path: o.path,
                created: o.created, expires: o.expires
            }, 'Cookie');
        },
        createRawData: function (o) { return __tag({ data: o }, 'RawData'); },
        createByteArray: function (o) { return __tag({ bytes: o }, 'ByteArray'); },
        createIconText: function (o) { return __tag({ icon: o.icon, text: o.text }, 'IconText'); },

        createRequestManager: function (o) { return __newRequestManager(o || {}); },
        createSourceStateManager: function () { return __newStateManager(false); },

        // -- Dynamic UI (settings menus) -------------------------------------
        createDUIBinding: function (o) { return __tag({ get: o.get, set: o.set }, 'DUIBinding'); },
        createDUIForm: function (o) {
            return __tag({ sections: o.sections, onSubmit: o.onSubmit, validator: o.validator }, 'DUIForm');
        },
        createDUISection: function (o) {
            return __tag({
                id: o.id, header: o.header, footer: o.footer,
                rows: o.rows, isHidden: !!o.isHidden
            }, 'DUISection');
        },
        createDUIButton: function (o) { return __tag({ id: o.id, label: o.label, onTap: o.onTap }, 'DUIButton'); },
        createDUIHeader: function (o) {
            return __tag({
                id: o.id,
                imageUrl: o.imageUrl,
                title: o.title !== undefined ? o.title : o.label,
                subtitle: o.subtitle !== undefined ? o.subtitle : o.value
            }, 'DUIHeader');
        },
        createDUILabel: function (o) { return __tag({ id: o.id, label: o.label, value: o.value }, 'DUILabel'); },
        createDUIMultilineLabel: function (o) { return __tag({ id: o.id, label: o.label, value: o.value }, 'DUIMultilineLabel'); },
        createDUILink: function (o) { return __tag({ id: o.id, label: o.label, url: o.url }, 'DUILink'); },
        createDUIInputField: function (o) {
            return __tag({ id: o.id, label: o.label, value: o.value, placeholder: o.placeholder }, 'DUIInputField');
        },
        createDUISecureInputField: function (o) {
            return __tag({ id: o.id, label: o.label, value: o.value, placeholder: o.placeholder }, 'DUISecureInputField');
        },
        createDUISwitch: function (o) { return __tag({ id: o.id, label: o.label, value: o.value }, 'DUISwitch'); },
        createDUISelect: function (o) {
            return __tag({ id: o.id, label: o.label, options: o.options || [], value: o.value }, 'DUISelect');
        },
        createDUIStepper: function (o) {
            return __tag({ id: o.id, label: o.label, value: o.value, min: o.min, max: o.max, step: o.step }, 'DUIStepper');
        },
        createDUINavigationButton: function (o) {
            return __tag({ id: o.id, label: o.label, form: o.form }, 'DUINavigationButton');
        },
        createDUIOAuthButton: function (o) {
            return __tag({ id: o.id, label: o.label, oauth: o.oauth }, 'DUIOAuthButton');
        }
    };

    globalThis.App = App;

    // ------------------------------------------------------- request manager --

    function __newRequestManager(opts) {
        var mgr = {
            __pb: 'RequestManager',
            requestsPerSecond: opts.requestsPerSecond === undefined ? 5 : opts.requestsPerSecond,
            requestTimeout: opts.requestTimeout === undefined ? 20000 : opts.requestTimeout,
            interceptor: opts.interceptor,
            cookieStoreId: opts.cookieStoreId,
            getDefaultUserAgent: function () {
                return 'Paperback/0.8.11 (Android)';
            },
            getCloudflareBypassRequestAsync: function () {
                return Promise.resolve(null);
            },
            schedule: async function (request, retries) {
                var req = request;
                if (this.interceptor && typeof this.interceptor.interceptRequest === 'function') {
                    var intercepted = await this.interceptor.interceptRequest(req);
                    if (intercepted) req = intercepted;
                }
                var response = await __paperbackCall('request', {
                    managerId: this.__id,
                    requestsPerSecond: this.requestsPerSecond,
                    requestTimeout: this.requestTimeout,
                    url: req.url,
                    method: req.method || 'GET',
                    headers: req.headers || {},
                    param: req.param,
                    data: req.data,
                    cookies: req.cookies || [],
                    retries: retries === undefined ? 0 : retries
                });
                if (this.interceptor && typeof this.interceptor.interceptResponse === 'function') {
                    var interceptedResponse = await this.interceptor.interceptResponse(response);
                    if (interceptedResponse) response = interceptedResponse;
                }
                return response;
            }
        };
        // register with Kotlin so per-source cookies/rate limits can be tracked
        var id = __nextId();
        mgr.__id = id;
        __paperbackNative('requestManager.create', JSON.stringify({
            id: id,
            requestsPerSecond: mgr.requestsPerSecond,
            requestTimeout: mgr.requestTimeout,
            cookieStoreId: opts.cookieStoreId
        }), __nextId());
        return mgr;
    }

    // ---------------------------------------------------------- state manager --

    function __newStateManager() {
        function make(secure) {
            return {
                retrieve: function (key) {
                    return __paperbackCall('state.get', { key: key, secure: secure });
                },
                store: function (key, value) {
                    return __paperbackCall('state.set', { key: key, value: value, secure: secure });
                },
                remove: function (key) {
                    return __paperbackCall('state.remove', { key: key, secure: secure });
                },
                list: function () {
                    return __paperbackCall('state.list', { secure: secure });
                },
                // older 0.7-era names still used by some bundles
                get: function (key) { return this.retrieve(key); },
                set: function (key, value) { return this.store(key, value); }
            };
        }
        var manager = make(false);
        manager.keychain = make(true);
        return manager;
    }

    // ----------------------------------------------------------- serialisation --

    // Resolve a value that may be a DUIBinding or a plain value.
    async function __resolveValue(value) {
        if (value && typeof value === 'object') {
            if (typeof value.get === 'function') return await value.get();
            if (value.__pb === 'DUIBinding') return await value.get();
        }
        return value;
    }

    async function __serializeRow(row) {
        var type = row.__pb || 'DUILabel';
        var out = { id: row.id, type: type };
        switch (type) {
            case 'DUIButton':
            case 'DUIOAuthButton':
            case 'DUINavigationButton':
                out.label = row.label;
                break;
            case 'DUIHeader':
                out.label = row.title !== undefined ? row.title : row.label;
                out.value = await __resolveValue(
                    row.subtitle !== undefined ? row.subtitle : row.value
                );
                out.imageUrl = typeof row.imageUrl === 'function'
                    ? await row.imageUrl()
                    : row.imageUrl;
                break;
            case 'DUISwitch':
                out.label = row.label;
                out.value = !!await __resolveValue(row.value);
                break;
            case 'DUIInputField':
            case 'DUISecureInputField':
                out.label = row.label;
                out.value = await __resolveValue(row.value);
                out.placeholder = row.placeholder;
                out.secure = type === 'DUISecureInputField';
                break;
            case 'DUISelect':
                out.label = row.label;
                out.options = ((await row.options) || []).map(function (o) {
                    return { id: o.id, label: o.label, value: o.value };
                });
                out.value = await __resolveValue(row.value);
                break;
            case 'DUIStepper':
                out.label = row.label;
                out.value = await __resolveValue(row.value);
                out.min = row.min; out.max = row.max; out.step = row.step;
                break;
            case 'DUILink':
                out.label = row.label;
                out.url = typeof row.url === 'function' ? await row.url() : row.url;
                break;
            default:
                out.label = row.label;
                out.value = await __resolveValue(row.value);
                break;
        }
        return out;
    }

    // `sections` / `rows` / `options` are functions in @paperback/types but
    // extensions are free to hand in plain arrays.
    async function __resolveCollection(value) {
        if (typeof value === 'function') return await value();
        if (value && typeof value.then === 'function') return await value;
        return value;
    }

    // A source menu may be a DUIForm, a bare DUISection, or a list of sections.
    function __asForm(value) {
        if (!value) return null;
        if (Array.isArray(value)) {
            return __tag({ sections: async function () { return value; } }, 'DUIForm');
        }
        if (value.__pb === 'DUISection') {
            return __tag({ sections: async function () { return [value]; } }, 'DUIForm');
        }
        return value;
    }

    async function __serializeForm(formJson) {
        var form = __forms[formJson];
        if (!form) return { sections: [] };
        var sections = await __resolveCollection(form.sections);
        var out = [];
        for (var i = 0; i < (sections || []).length; i++) {
            var s = sections[i];
            if (!s) continue;
            var hidden = await __resolveValue(s.isHidden);
            if (hidden) continue;
            var rows = await __resolveCollection(s.rows);
            var serializedRows = [];
            for (var j = 0; j < (rows || []).length; j++) {
                if (!rows[j]) continue;
                serializedRows.push(await __serializeRow(rows[j]));
            }
            out.push({
                id: s.id,
                header: await __resolveValue(s.header),
                footer: await __resolveValue(s.footer),
                rows: serializedRows
            });
        }
        return {
            sections: out,
            hasSubmit: typeof form.onSubmit === 'function' || typeof form.validator === 'function'
        };
    }

    var __forms = Object.create(null);
    var __formSeq = 1;
    var __formRows = Object.create(null);

    function __registerForm(form) {
        var id = 'f' + (__formSeq++);
        __forms[id] = form;
        return id;
    }

    async function __paperbackFormForMenu() {
        var inst = globalThis.__paperbackSourceInstance;
        if (!inst) return { sections: [] };
        var form = null;
        if (typeof inst.getSourceMenu === 'function') {
            form = __asForm(await inst.getSourceMenu());
        }
        if (!form) return { sections: [] };
        var id = __registerForm(form);
        await __indexForm(id);
        var json = await __serializeForm(id);
        json.formId = id;
        return json;
    }

    async function __paperbackFormForProgress(mangaId) {
        var inst = globalThis.__paperbackSourceInstance;
        if (!inst || typeof inst.getMangaProgressManagementForm !== 'function') return { sections: [] };
        var form = __asForm(await inst.getMangaProgressManagementForm(mangaId));
        if (!form) return { sections: [] };
        var id = __registerForm(form);
        await __indexForm(id);
        var json = await __serializeForm(id);
        json.formId = id;
        return json;
    }

    // Re-serialize a form after a tap / edit so the UI can refresh.
    globalThis.__paperbackSerializeForm = __serializeForm;

    globalThis.__paperbackDuiTap = async function (formId, rowId) {
        var form = __forms[formId];
        var row = form ? __findRow(formId, rowId) : null;
        if (!row) return { handled: false };
        if (typeof row.onTap === 'function') { await row.onTap(); return { handled: true }; }
        if (row.form) {
            // Navigation rows (DUINavigationButton) open a nested form.
            var navId = __registerForm(__asForm(row.form));
            await __indexForm(navId);
            return { handled: true, navFormId: navId };
        }
        if (typeof row.onValueChange === 'function') { await row.onValueChange(); return { handled: true }; }
        return { handled: false };
    };

    globalThis.__paperbackDuiSet = async function (formId, rowId, value) {
        var form = __forms[formId];
        var row = form ? __findRow(formId, rowId) : null;
        if (!row) return false;
        if (row.value && typeof row.value.set === 'function') { await row.value.set(value); return true; }
        if (typeof row.onValueChange === 'function') { await row.onValueChange(value); return true; }
        row.value = value;
        return true;
    };

    globalThis.__paperbackDuiSelect = async function (formId, rowId, optionId) {
        var form = __forms[formId];
        var row = form ? __findRow(formId, rowId) : null;
        if (!row) return false;
        if (typeof row.onValueChange === 'function') { await row.onValueChange(optionId); return true; }
        if (row.value && typeof row.value.set === 'function') { await row.value.set(optionId); return true; }
        return false;
    };

    globalThis.__paperbackDuiSubmit = async function (formId) {
        var form = __forms[formId];
        if (!form) return { handled: false };
        if (typeof form.onSubmit === 'function') {
            await form.onSubmit();
            return { handled: true };
        }
        if (typeof form.validator === 'function') {
            await form.validator();
            return { handled: true };
        }
        return { handled: false };
    };

    // Row handles are cached per form id: `rows()` is an async function and the
    // rows it returns are recreated on every call, so interactions need a stable
    // handle.
    function __findRow(formId, rowId) {
        var flat = __formRows[formId];
        if (flat && flat[rowId]) return flat[rowId];
        return null;
    }

    async function __indexForm(formId) {
        var form = __forms[formId];
        if (!form) return;
        var flat = Object.create(null);
        var sections = await __resolveCollection(form.sections);
        for (var i = 0; i < (sections || []).length; i++) {
            var s = sections[i];
            if (!s) continue;
            var rows = await __resolveCollection(s.rows);
            for (var j = 0; j < (rows || []).length; j++) {
                var r = rows[j];
                if (r && r.id) flat[r.id] = r;
            }
        }
        __formRows[formId] = flat;
    }

    // ------------------------------------------------------- source invoking --

    globalThis.__paperbackLoadSource = function (sourceId) {
        var container = globalThis.Sources;
        if (!container) throw new Error('source bundle did not expose `Sources`');
        var ctor = container[sourceId];
        if (typeof ctor !== 'function') {
            var keys = Object.keys(container);
            for (var i = 0; i < keys.length; i++) {
                if (typeof container[keys[i]] === 'function') { ctor = container[keys[i]]; break; }
            }
        }
        if (typeof ctor !== 'function') throw new Error('no source constructor found for ' + sourceId);
        var cheerio = globalThis.Modules && globalThis.Modules.cheerio ? globalThis.Modules.cheerio : undefined;
        var instance = new ctor(cheerio);
        globalThis.__paperbackSourceInstance = instance;

        var out = {
            hasChapters: typeof instance.getChapters === 'function',
            hasChapterDetails: typeof instance.getChapterDetails === 'function',
            hasHomeSections: typeof instance.getHomePageSections === 'function',
            hasSearch: typeof instance.getSearchResults === 'function',
            hasTags: typeof instance.getTags === 'function' || typeof instance.getSearchTags === 'function',
            hasViewMore: typeof instance.getViewMoreItems === 'function',
            hasProgress: typeof instance.getMangaProgressManagementForm === 'function',
            hasSourceMenu: typeof instance.getSourceMenu === 'function',
            hasCloudflare: typeof instance.getCloudflareBypassRequestAsync === 'function',
            hasShareUrl: typeof instance.getMangaShareUrl === 'function',
            hasMangaUpdates: typeof instance.getMangaUpdates === 'function'
        };
        return out;
    };

    // Methods whose callback argument streams results to Kotlin.
    var __streamingMethods = ['getHomePageSections'];

    async function __invokeRaw(method, args) {
        var inst = globalThis.__paperbackSourceInstance;
        if (!inst) throw new Error('source not loaded');
        var fn = inst[method];
        if (typeof fn !== 'function') {
            if (method === 'getTags' && typeof inst.getSearchTags === 'function') fn = inst.getSearchTags;
            else if (method === 'getSearchResults' && typeof inst.searchRequest === 'function') fn = inst.searchRequest;
        }
        if (typeof fn !== 'function') throw new Error('source does not implement ' + method);
        return await fn.apply(inst, args);
    }

    var __invokeSeq = 1;
    var __invokes = Object.create(null);

    globalThis.__paperbackInvoke = function (method, argsJson, streamId) {
        var id = __invokeSeq++;
        __invokes[id] = { method: method, streamId: streamId };

        // The argument list arrives in one of two shapes: `nativeCall` already
        // parses the outer JSON array, so a caller that embeds the arguments as
        // a nested array delivers an array, while the Kotlin runtime passes the
        // argument list as a JSON string. Accept both instead of silently
        // running with no arguments.
        var args;
        if (Array.isArray(argsJson)) {
            args = argsJson;
        } else if (typeof argsJson === 'string' && argsJson !== '') {
            try { args = JSON.parse(argsJson); } catch (e) { args = null; }
        }
        if (!Array.isArray(args)) {
            if (argsJson !== undefined && argsJson !== null && argsJson !== '') {
                __log('warn', ['unreadable arguments for ' + method + ':', String(argsJson)]);
            }
            args = [];
        }

        if (method === 'getHomePageSections') {
            args = [function (section) {
                var payload;
                try { payload = JSON.stringify(section); } catch (e) { return; }
                __paperbackNative('home.section', payload, streamId);
            }];
        }

        __invokeRaw(method, args).then(function (result) {
            var json;
            try { json = JSON.stringify(result === undefined ? null : result); }
            catch (e) { json = 'null'; }
            __paperbackResult(id, json, false);
        }, function (err) {
            var message = err && err.message ? err.message : String(err);
            __paperbackResult(id, message, true);
        });
        return id;
    };

    globalThis.__paperbackFormMenu = function () {
        var id = __invokeSeq++;
        __paperbackFormForMenu().then(function (json) {
            __paperbackResult(id, JSON.stringify(json), false);
        }, function (err) {
            __paperbackResult(id, err && err.message ? err.message : String(err), true);
        });
        return id;
    };

    globalThis.__paperbackFormProgress = function (mangaId) {
        var id = __invokeSeq++;
        __paperbackFormForProgress(mangaId).then(function (json) {
            __paperbackResult(id, JSON.stringify(json), false);
        }, function (err) {
            __paperbackResult(id, err && err.message ? err.message : String(err), true);
        });
        return id;
    };

    globalThis.__paperbackFormRefresh = function (formId) {
        var id = __invokeSeq++;
        __indexForm(formId).then(function () {
            return __serializeForm(formId);
        }).then(function (json) {
            json.formId = formId;
            __paperbackResult(id, JSON.stringify(json), false);
        }, function (err) {
            __paperbackResult(id, err && err.message ? err.message : String(err), true);
        });
        return id;
    };

    globalThis.__paperbackDuiAction = function (action, formId, rowId, value) {
        var id = __invokeSeq++;
        var step;
        if (action === 'tap') step = globalThis.__paperbackDuiTap(formId, rowId);
        else if (action === 'set') step = globalThis.__paperbackDuiSet(formId, rowId, value);
        else if (action === 'select') step = globalThis.__paperbackDuiSelect(formId, rowId, value);
        else if (action === 'submit') step = globalThis.__paperbackDuiSubmit(formId);
        else step = Promise.resolve({ handled: false });

        Promise.resolve(step).then(function (outcome) {
            var navFormId = outcome && outcome.navFormId;
            var targetForm = navFormId || formId;
            return __indexForm(targetForm).then(function () {
                return __serializeForm(targetForm).then(function (json) {
                    json.formId = targetForm;
                    json.parentFormId = navFormId ? formId : null;
                    json.navigated = !!navFormId;
                    __paperbackResult(id, JSON.stringify(json), false);
                });
            });
        }, function (err) {
            __paperbackResult(id, err && err.message ? err.message : String(err), true);
        });
        return id;
    };
})();
