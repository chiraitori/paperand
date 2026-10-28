/*
 * Paperback Android — QuickJS <-> Kotlin bridge.
 *
 * Reverse engineered from Paperback iOS 0.8.11:
 *   the iOS build embeds JavaScriptCore (Models/AsyncJS/JSBridge.swift + AsyncJS.swift)
 *   and a browserified `bundles.js` that exposes `Modules.cheerio`.
 *   Sources (extensions) are plain JS bundles exposing a `Sources` global and are
 *   executed against an `App.*` bridge plus a native RequestManager.
 *
 * This file provides the same three primitives on Android:
 *   1. evaluate a source bundle inside a QuickJS context,
 *   2. drain the microtask/job queue so promises (async/await) make progress,
 *   3. marshal calls between JS and Kotlin as JSON.
 *
 * JS -> Kotlin   __paperbackNative(op, argsJson, id)
 *   Kotlin answers later through QuickJsCore.complete(id, json, isError), which
 *   evaluates `__paperbackResolve(id, json, isError)` on the JS thread.
 *
 * Kotlin -> JS   nativeEval / nativeCall (JSON in, JSON out) + nativeDrainJobs.
 *
 * All JS execution happens on the single thread that owns the context; callers
 * must serialise access (Kotlin side uses a dedicated looper thread).
 */

#include <jni.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <android/log.h>

#include "quickjs.h"

#define LOG_TAG "PaperbackJS"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

typedef struct {
    JavaVM *jvm;
    JSRuntime *rt;
    JSContext *ctx;
    jobject callback;          /* global ref to QuickJsCore.NativeCallback */
    jmethodID midNativeCall;   /* (Ljava/lang/String;Ljava/lang/String;J)V  */
    jmethodID midLog;          /* (Ljava/lang/String;Ljava/lang/String;)V   */
} PBHandle;

/* ------------------------------------------------------------------ strings */

/* UTF-8 (real, not modified) -> Java string, surrogate pairs included. */
static jstring pb_new_string_utf8(JNIEnv *env, const char *utf8) {
    if (!utf8) return NULL;
    size_t len = strlen(utf8);
    /* worst case: one UTF-16 unit per byte */
    jchar *out = (jchar *) malloc(sizeof(jchar) * (len + 1));
    if (!out) return NULL;
    size_t o = 0;
    const unsigned char *p = (const unsigned char *) utf8;
    while (*p) {
        unsigned int cp;
        if (p[0] < 0x80) {
            cp = *p++;
        } else if ((p[0] & 0xE0) == 0xC0 && (p[1] & 0xC0) == 0x80) {
            cp = ((p[0] & 0x1F) << 6) | (p[1] & 0x3F);
            p += 2;
        } else if ((p[0] & 0xF0) == 0xE0 && (p[1] & 0xC0) == 0x80 && (p[2] & 0xC0) == 0x80) {
            cp = ((p[0] & 0x0F) << 12) | ((p[1] & 0x3F) << 6) | (p[2] & 0x3F);
            p += 3;
        } else if ((p[0] & 0xF8) == 0xF0 && (p[1] & 0xC0) == 0x80 && (p[2] & 0xC0) == 0x80 &&
                   (p[3] & 0xC0) == 0x80) {
            cp = ((p[0] & 0x07) << 18) | ((p[1] & 0x3F) << 12) | ((p[2] & 0x3F) << 6) | (p[3] & 0x3F);
            p += 4;
        } else {
            cp = 0xFFFD;
            p += 1;
        }
        if (cp >= 0x10000) {
            cp -= 0x10000;
            out[o++] = (jchar) (0xD800 + (cp >> 10));
            out[o++] = (jchar) (0xDC00 + (cp & 0x3FF));
        } else {
            out[o++] = (jchar) cp;
        }
    }
    jstring res = (*env)->NewString(env, out, (jsize) o);
    free(out);
    return res;
}

/* Java string (UTF-16) -> freshly allocated real UTF-8. Caller frees. */
static char *pb_jstring_to_utf8(JNIEnv *env, jstring s) {
    if (!s) return NULL;
    jsize len = (*env)->GetStringLength(env, s);
    const jchar *chars = (*env)->GetStringChars(env, s, NULL);
    if (!chars) return NULL;
    size_t cap = (size_t) len * 4 + 1;
    char *out = (char *) malloc(cap);
    if (!out) {
        (*env)->ReleaseStringChars(env, s, chars);
        return NULL;
    }
    size_t o = 0;
    for (jsize i = 0; i < len; i++) {
        unsigned int c = chars[i];
        if (c >= 0xD800 && c <= 0xDBFF && i + 1 < len) {
            unsigned int lo = chars[i + 1];
            if (lo >= 0xDC00 && lo <= 0xDFFF) {
                c = 0x10000 + ((c - 0xD800) << 10) + (lo - 0xDC00);
                i++;
            }
        }
        if (c < 0x80) {
            out[o++] = (char) c;
        } else if (c < 0x800) {
            out[o++] = (char) (0xC0 | (c >> 6));
            out[o++] = (char) (0x80 | (c & 0x3F));
        } else if (c < 0x10000) {
            out[o++] = (char) (0xE0 | (c >> 12));
            out[o++] = (char) (0x80 | ((c >> 6) & 0x3F));
            out[o++] = (char) (0x80 | (c & 0x3F));
        } else {
            out[o++] = (char) (0xF0 | (c >> 18));
            out[o++] = (char) (0x80 | ((c >> 12) & 0x3F));
            out[o++] = (char) (0x80 | ((c >> 6) & 0x3F));
            out[o++] = (char) (0x80 | (c & 0x3F));
        }
    }
    out[o] = 0;
    (*env)->ReleaseStringChars(env, s, chars);
    return out;
}

static JNIEnv *pb_env(PBHandle *h, int *attached) {
    JNIEnv *env = NULL;
    *attached = 0;
    jint rc = (*h->jvm)->GetEnv(h->jvm, (void **) &env, JNI_VERSION_1_6);
    if (rc == JNI_EDETACHED) {
#if defined(_WIN32)
        /* The Windows JVM headers declare AttachCurrentThread with void**, the
         * Android NDK headers with JNIEnv**; both are the same pointer. */
        void *attached_env = NULL;
        if ((*h->jvm)->AttachCurrentThread(h->jvm, &attached_env, NULL) == JNI_OK) {
            env = (JNIEnv *) attached_env;
            *attached = 1;
        } else {
            return NULL;
        }
#else
        if ((*h->jvm)->AttachCurrentThread(h->jvm, &env, NULL) == JNI_OK) {
            *attached = 1;
        } else {
            return NULL;
        }
#endif
    } else if (rc != JNI_OK) {
        return NULL;
    }
    return env;
}

static void pb_log(PBHandle *h, const char *level, const char *message) {
    int attached;
    JNIEnv *env = pb_env(h, &attached);
    if (!env) return;
    jstring jl = pb_new_string_utf8(env, level);
    jstring jm = pb_new_string_utf8(env, message);
    (*env)->CallVoidMethod(env, h->callback, h->midLog, jl, jm);
    if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env);
    if (jl) (*env)->DeleteLocalRef(env, jl);
    if (jm) (*env)->DeleteLocalRef(env, jm);
    if (attached) (*h->jvm)->DetachCurrentThread(h->jvm);
}

/* ------------------------------------------------------------- JS -> Kotlin */

/* __paperbackNative(op, argsJson, id) */
static JSValue js_native_call(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    PBHandle *h = (PBHandle *) JS_GetContextOpaque(ctx);
    if (!h || argc < 3) return JS_UNDEFINED;

    const char *op_c = JS_ToCString(ctx, argv[0]);
    const char *args_c = JS_ToCString(ctx, argv[1]);
    int64_t id = 0;
    JS_ToInt64(ctx, &id, argv[2]);

    int attached;
    JNIEnv *env = pb_env(h, &attached);
    if (!env) {
        if (op_c) JS_FreeCString(ctx, op_c);
        if (args_c) JS_FreeCString(ctx, args_c);
        return JS_UNDEFINED;
    }

    jstring jop = pb_new_string_utf8(env, op_c ? op_c : "");
    jstring jargs = pb_new_string_utf8(env, args_c ? args_c : "null");
    (*env)->CallVoidMethod(env, h->callback, h->midNativeCall, jop, jargs, (jlong) id);
    if ((*env)->ExceptionCheck(env)) {
        (*env)->ExceptionDescribe(env);
        (*env)->ExceptionClear(env);
    }
    if (jop) (*env)->DeleteLocalRef(env, jop);
    if (jargs) (*env)->DeleteLocalRef(env, jargs);
    if (attached) (*h->jvm)->DetachCurrentThread(h->jvm);

    if (op_c) JS_FreeCString(ctx, op_c);
    if (args_c) JS_FreeCString(ctx, args_c);
    return JS_UNDEFINED;
}

/* ------------------------------------------------------------------ helpers */

static void pb_drain_jobs(PBHandle *h) {
    JSContext *job_ctx = NULL;
    int guard = 0;
    for (;;) {
        int rc = JS_ExecutePendingJob(h->rt, &job_ctx);
        if (rc == 0) break;                /* queue empty */
        if (rc < 0) {                       /* unhandled rejection / throw */
            JSValue exc = JS_GetException(job_ctx ? job_ctx : h->ctx);
            const char *msg = JS_ToCString(h->ctx, exc);
            if (msg) {
                char buf[1024];
                snprintf(buf, sizeof(buf), "unhandled job error: %s", msg);
                pb_log(h, "error", buf);
                JS_FreeCString(h->ctx, msg);
            }
            JS_FreeValue(h->ctx, exc);
            break;
        }
        if (++guard > 100000) {
            pb_log(h, "warn", "job drain guard hit");
            break;
        }
    }
}

static char *pb_value_to_json(JSContext *ctx, JSValueConst v) {
    JSValue json = JS_JSONStringify(ctx, v, JS_UNDEFINED, JS_UNDEFINED);
    if (JS_IsException(json)) {
        JSValue exc = JS_GetException(ctx);
        const char *m = JS_ToCString(ctx, exc);
        char *out = strdup(m ? m : "serialization failed");
        if (m) JS_FreeCString(ctx, m);
        JS_FreeValue(ctx, exc);
        JS_FreeValue(ctx, json);
        return out;
    }
    if (JS_IsUndefined(json)) {
        JS_FreeValue(ctx, json);
        return strdup("null");
    }
    const char *s = JS_ToCString(ctx, json);
    char *out = strdup(s ? s : "null");
    if (s) JS_FreeCString(ctx, s);
    JS_FreeValue(ctx, json);
    return out;
}

/* ------------------------------------------------------------- entry points */

JNIEXPORT jlong JNICALL
Java_expo_modules_paperbackquickjs_QuickJsCore_nativeCreate(JNIEnv *env, jobject thiz, jobject callback) {
    PBHandle *h = (PBHandle *) calloc(1, sizeof(PBHandle));
    if (!h) return 0;

    (*env)->GetJavaVM(env, &h->jvm);
    h->callback = (*env)->NewGlobalRef(env, callback);

    jclass cls = (*env)->GetObjectClass(env, callback);
    h->midNativeCall = (*env)->GetMethodID(env, cls, "onNativeCall",
                                           "(Ljava/lang/String;Ljava/lang/String;J)V");
    h->midLog = (*env)->GetMethodID(env, cls, "onLog", "(Ljava/lang/String;Ljava/lang/String;)V");
    (*env)->DeleteLocalRef(env, cls);
    if (!h->midNativeCall) return 0;

    h->rt = JS_NewRuntime();
    if (!h->rt) return 0;
    JS_SetMemoryLimit(h->rt, 256 * 1024 * 1024);
    JS_SetMaxStackSize(h->rt, 2 * 1024 * 1024);
    // QuickJS-NG: keep the default (zero) GC threshold to avoid excessive collection
    // on small heaps; correctness does not depend on it.

    h->ctx = JS_NewContext(h->rt);
    if (!h->ctx) return 0;
    JS_SetContextOpaque(h->ctx, h);

    JSValue global = JS_GetGlobalObject(h->ctx);
    JSValue fn = JS_NewCFunction(h->ctx, js_native_call, "__paperbackNative", 3);
    JS_SetPropertyStr(h->ctx, global, "__paperbackNative", fn);
    JS_FreeValue(h->ctx, global);

    LOGI("QuickJS runtime created (%s)", JS_GetVersion());
    return (jlong) (intptr_t) h;
}

JNIEXPORT void JNICALL
Java_expo_modules_paperbackquickjs_QuickJsCore_nativeDestroy(JNIEnv *env, jobject thiz, jlong handle) {
    PBHandle *h = (PBHandle *) (intptr_t) handle;
    if (!h) return;
    if (h->ctx) JS_FreeContext(h->ctx);
    if (h->rt) JS_FreeRuntime(h->rt);
    if (h->callback) (*env)->DeleteGlobalRef(env, h->callback);
    free(h);
}

/* Returns NULL on success, otherwise the error text. */
JNIEXPORT jstring JNICALL
Java_expo_modules_paperbackquickjs_QuickJsCore_nativeEval(JNIEnv *env, jobject thiz, jlong handle,
                                                         jstring code, jstring filename) {
    PBHandle *h = (PBHandle *) (intptr_t) handle;
    if (!h) return pb_new_string_utf8(env, "invalid handle");

    char *code_c = pb_jstring_to_utf8(env, code);
    char *name_c = pb_jstring_to_utf8(env, filename);
    JSValue v = JS_Eval(h->ctx, code_c ? code_c : "", code_c ? strlen(code_c) : 0,
                        name_c ? name_c : "<eval>", JS_EVAL_TYPE_GLOBAL);
    free(code_c);
    free(name_c);

    if (JS_IsException(v)) {
        JSValue exc = JS_GetException(h->ctx);
        const char *m = JS_ToCString(h->ctx, exc);
        char *stack = NULL;
        JSValue st = JS_GetPropertyStr(h->ctx, exc, "stack");
        if (!JS_IsUndefined(st)) {
            const char *s = JS_ToCString(h->ctx, st);
            if (s) stack = strdup(s);
            if (s) JS_FreeCString(h->ctx, s);
        }
        JS_FreeValue(h->ctx, st);
        char buf[4096];
        snprintf(buf, sizeof(buf), "%s\n%s", m ? m : "eval error", stack ? stack : "");
        if (m) JS_FreeCString(h->ctx, m);
        free(stack);
        JS_FreeValue(h->ctx, exc);
        JS_FreeValue(h->ctx, v);
        pb_drain_jobs(h);
        return pb_new_string_utf8(env, buf);
    }
    JS_FreeValue(h->ctx, v);
    pb_drain_jobs(h);
    return NULL;
}

/* Executes queued promise jobs; returns how many ran. */
JNIEXPORT jint JNICALL
Java_expo_modules_paperbackquickjs_QuickJsCore_nativeDrainJobs(JNIEnv *env, jobject thiz, jlong handle) {
    PBHandle *h = (PBHandle *) (intptr_t) handle;
    if (!h) return 0;
    JSContext *job_ctx = NULL;
    int ran = 0;
    for (;;) {
        int rc = JS_ExecutePendingJob(h->rt, &job_ctx);
        if (rc == 0) break;
        if (rc < 0) {
            JSValue exc = JS_GetException(job_ctx ? job_ctx : h->ctx);
            const char *msg = JS_ToCString(h->ctx, exc);
            if (msg) {
                char buf[1024];
                snprintf(buf, sizeof(buf), "job error: %s", msg);
                pb_log(h, "error", buf);
                JS_FreeCString(h->ctx, msg);
            }
            JS_FreeValue(h->ctx, exc);
            break;
        }
        ran++;
        if (ran > 100000) break;
    }
    return ran;
}

/*
 * Calls a global JS function with a JSON array of arguments.
 * Return value is JSON (or the string "null"); on error the string
 * "__PB_ERR__:<message>" is returned.
 */
JNIEXPORT jstring JNICALL
Java_expo_modules_paperbackquickjs_QuickJsCore_nativeCall(JNIEnv *env, jobject thiz, jlong handle,
                                                         jstring name, jstring args_json) {
    PBHandle *h = (PBHandle *) (intptr_t) handle;
    if (!h) return pb_new_string_utf8(env, "__PB_ERR__:invalid handle");

    char *name_c = pb_jstring_to_utf8(env, name);
    char *args_c = pb_jstring_to_utf8(env, args_json);

    JSValue global = JS_GetGlobalObject(h->ctx);
    JSValue fn = JS_GetPropertyStr(h->ctx, global, name_c ? name_c : "");
    JS_FreeValue(h->ctx, global);

    if (!JS_IsFunction(h->ctx, fn)) {
        char buf[512];
        snprintf(buf, sizeof(buf), "__PB_ERR__:no such function: %s", name_c ? name_c : "");
        JS_FreeValue(h->ctx, fn);
        free(name_c);
        free(args_c);
        return pb_new_string_utf8(env, buf);
    }

    JSValue args_arr = JS_ParseJSON(h->ctx, args_c ? args_c : "[]", args_c ? strlen(args_c) : 2, "<args>");
    if (JS_IsException(args_arr)) {
        JS_FreeValue(h->ctx, args_arr);
        JS_FreeValue(h->ctx, fn);
        free(name_c);
        free(args_c);
        return pb_new_string_utf8(env, "__PB_ERR__:invalid argument JSON");
    }

    int32_t argc = 0;
    JSValue lenv = JS_GetPropertyStr(h->ctx, args_arr, "length");
    JS_ToInt32(h->ctx, &argc, lenv);
    JS_FreeValue(h->ctx, lenv);

    JSValue *argv = NULL;
    if (argc > 0) {
        argv = (JSValue *) malloc(sizeof(JSValue) * argc);
        for (int32_t i = 0; i < argc; i++) {
            argv[i] = JS_GetPropertyUint32(h->ctx, args_arr, (uint32_t) i);
        }
    }

    JSValue ret = JS_Call(h->ctx, fn, JS_UNDEFINED, argc, argv);

    jstring result;
    if (JS_IsException(ret)) {
        JSValue exc = JS_GetException(h->ctx);
        const char *m = JS_ToCString(h->ctx, exc);
        char buf[2048];
        snprintf(buf, sizeof(buf), "__PB_ERR__:%s", m ? m : "call failed");
        if (m) JS_FreeCString(h->ctx, m);
        JS_FreeValue(h->ctx, exc);
        result = pb_new_string_utf8(env, buf);
    } else {
        char *json = pb_value_to_json(h->ctx, ret);
        result = pb_new_string_utf8(env, json);
        free(json);
    }

    JS_FreeValue(h->ctx, ret);
    if (argv) {
        for (int32_t i = 0; i < argc; i++) JS_FreeValue(h->ctx, argv[i]);
        free(argv);
    }
    JS_FreeValue(h->ctx, args_arr);
    JS_FreeValue(h->ctx, fn);
    free(name_c);
    free(args_c);
    pb_drain_jobs(h);
    return result;
}

/* Free-form GC trigger (used after tearing a source down). */
JNIEXPORT void JNICALL
Java_expo_modules_paperbackquickjs_QuickJsCore_nativeRunGC(JNIEnv *env, jobject thiz, jlong handle) {
    PBHandle *h = (PBHandle *) (intptr_t) handle;
    if (!h || !h->rt) return;
    JS_RunGC(h->rt);
}

JNIEXPORT jstring JNICALL
Java_expo_modules_paperbackquickjs_QuickJsCore_nativeVersion(JNIEnv *env, jobject thiz) {
    return pb_new_string_utf8(env, JS_GetVersion());
}
