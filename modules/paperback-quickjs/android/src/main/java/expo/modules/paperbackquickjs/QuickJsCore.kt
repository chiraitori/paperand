package expo.modules.paperbackquickjs

import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Owns one QuickJS runtime (see `cpp/paperback_bridge.c`) and confines every
 * JavaScript call to a single dedicated thread - QuickJS contexts are not thread
 * safe, so everything (eval, invoke, resolve) is funnelled through
 * [onJsThread].
 *
 * This is the same engine the Kotlin port uses; the only difference is that the
 * device side of the bridge (network, storage, timers) is answered by the React
 * Native layer instead of Kotlin, so extensions keep the cookies, Cloudflare
 * handoff and per-source storage the app already implements.
 */
class QuickJsCore(private val delegate: Delegate) {

    /** Callbacks raised from JavaScript. Invoked on the JS thread - never block inside them. */
    interface Delegate {
        /** `__paperbackNative(op, argsJson, id)`. Answer with [complete]. */
        fun dispatch(op: String, args: JSONObject, callId: Long, raw: String)

        /** `__paperbackResult(id, json, isError)` - result of a host initiated source call. */
        fun onInvokeResult(invokeId: Long, json: String?, isError: Boolean)

        fun onLog(level: String, message: String)
    }

    private val thread = HandlerThread("paperback-js").apply { start() }
    private val handler = Handler(thread.looper)

    private val started = AtomicBoolean(false)
    private val closed = AtomicBoolean(false)
    private var handle: Long = 0L

    private val invokeLock = Any()
    private val invokeHandlers = HashMap<Long, (String?, Boolean) -> Unit>()
    private val earlyResults = HashMap<Long, Pair<String?, Boolean>>()

    /** Queues work onto the JS thread. Safe from any thread; never blocks. */
    fun post(block: () -> Unit) {
        if (closed.get()) return
        handler.post(block)
    }

    /** Runs [block] on the JS thread and waits for it. Must not be called from the JS thread. */
    fun <T> onJsThread(block: () -> T): T {
        if (Thread.currentThread() === thread) return block()
        val latch = CountDownLatch(1)
        var value: T? = null
        var error: Throwable? = null
        handler.post {
            try {
                value = block()
            } catch (t: Throwable) {
                error = t
            } finally {
                latch.countDown()
            }
        }
        if (!latch.await(120, TimeUnit.SECONDS)) throw IllegalStateException("JS thread timeout")
        error?.let { throw it }
        @Suppress("UNCHECKED_CAST")
        return value as T
    }

    fun start() {
        if (!started.compareAndSet(false, true)) return
        onJsThread {
            handle = nativeCreate(this)
            if (handle == 0L) throw IllegalStateException("could not create QuickJS runtime")
            handle
        }
    }

    val isRunning: Boolean get() = started.get() && !closed.get()

    fun shutdown() {
        if (!started.get() || !closed.compareAndSet(false, true)) return
        try {
            onJsThread {
                if (handle != 0L) {
                    nativeDestroy(handle)
                    handle = 0L
                }
            }
        } catch (t: Throwable) {
            Log.w(TAG, "shutdown failed", t)
        } finally {
            thread.quitSafely()
        }
    }

    /** Evaluates [code]. Returns null on success, otherwise the error text. Blocking. */
    fun eval(code: String, filename: String): String? = onJsThread {
        if (handle == 0L) return@onJsThread "runtime not started"
        nativeEval(handle, code, filename)
    }

    /** Calls `globalThis[name](...argsJson)` and returns the JSON result. Blocking. */
    fun call(name: String, argsJson: String): String = onJsThread {
        if (handle == 0L) throw IllegalStateException("runtime not started")
        val res = nativeCall(handle, name, argsJson)
        if (res.startsWith(ERR_PREFIX)) throw JsException(res.removePrefix(ERR_PREFIX))
        res
    }

    fun version(): String = nativeVersion()

    fun drainJobs(): Int = onJsThread { if (handle == 0L) 0 else nativeDrainJobs(handle) }

    /**
     * Resolves a promise created by `__paperbackCall` inside the prelude.
     * Called from any thread once the device-side operation finished.
     */
    fun complete(callId: Long, json: String?, isError: Boolean) {
        if (closed.get()) return
        val encoded = JSONArray().put(callId).put(JSONObject.NULL).put(isError).toString()
        val real = if (json == null) {
            encoded
        } else {
            JSONArray().put(callId).put(json).put(isError).toString()
        }
        post {
            if (handle == 0L) return@post
            try {
                val res = nativeCall(handle, "__paperbackResolve", real)
                if (res.startsWith(ERR_PREFIX)) Log.w(TAG, "resolve failed: $res")
            } catch (t: Throwable) {
                Log.w(TAG, "resolve failed", t)
            }
        }
    }

    /**
     * Calls an async source method. [streamId] is non-zero for methods that push
     * partial results through a callback (`getHomePageSections`).
     */
    fun invokeBlocking(
        method: String,
        argsJson: String,
        streamId: Long = 0L,
        timeoutSeconds: Long = 120,
    ): String {
        val args = JSONArray().put(method).put(argsJson).put(streamId).toString()
        val invokeId = beginInvoke("__paperbackInvoke", args)
        if (invokeId < 0) throw JsException("could not start invoke for $method")
        var result: String? = null
        var failed = false
        val latch = CountDownLatch(1)
        awaitResult(invokeId) { json, isError ->
            result = json
            failed = isError
            latch.countDown()
        }
        if (!latch.await(timeoutSeconds, TimeUnit.SECONDS)) {
            throw IllegalStateException("source call timed out: $method")
        }
        if (failed) throw JsException(result ?: "source call failed: $method")
        return result ?: "null"
    }

    fun invokeNamedBlocking(functionName: String, argsJson: String, timeoutSeconds: Long = 120): String {
        val invokeId = beginInvoke(functionName, argsJson)
        if (invokeId < 0) throw JsException("could not start $functionName")
        var result: String? = null
        var failed = false
        val latch = CountDownLatch(1)
        awaitResult(invokeId) { json, isError ->
            result = json
            failed = isError
            latch.countDown()
        }
        if (!latch.await(timeoutSeconds, TimeUnit.SECONDS)) {
            throw IllegalStateException("$functionName timed out")
        }
        if (failed) throw JsException(result ?: "$functionName failed")
        return result ?: "null"
    }

    private fun beginInvoke(functionName: String, argsJson: String): Long = try {
        onJsThread {
            if (handle == 0L) throw IllegalStateException("runtime not started")
            val res = nativeCall(handle, functionName, argsJson)
            if (res.startsWith(ERR_PREFIX)) throw JsException(res.removePrefix(ERR_PREFIX))
            res.trim().toLongOrNull() ?: -1L
        }
    } catch (t: Throwable) {
        Log.w(TAG, "could not start $functionName", t)
        -1L
    }

    /** Registers interest in an already started invoke, replaying an early answer if needed. */
    private fun awaitResult(invokeId: Long, onResult: (String?, Boolean) -> Unit) {
        val early: Pair<String?, Boolean>?
        synchronized(invokeLock) {
            early = earlyResults.remove(invokeId)
            if (early == null) invokeHandlers[invokeId] = onResult
        }
        if (early != null) onResult(early.first, early.second)
    }

    // -------------------------------------------------------------- JNI hooks --

    /** Called from C while JavaScript runs - must return immediately. */
    fun onNativeCall(op: String, argsJson: String, id: Long) {
        try {
            when (op) {
                "log" -> {
                    val args = JSONObject(argsJson)
                    delegate.onLog(args.optString("level", "info"), args.optString("message", ""))
                }

                "__result" -> {
                    val args = JSONObject(argsJson)
                    val invokeId = args.optLong("id", -1L)
                    val json = if (args.isNull("json")) null else args.optString("json")
                    val isError = args.optBoolean("isError", false)
                    deliverInvokeResult(invokeId, json, isError)
                    delegate.onInvokeResult(invokeId, json, isError)
                }

                else -> {
                    val args = if (argsJson.isBlank() || argsJson == "null") JSONObject() else JSONObject(argsJson)
                    delegate.dispatch(op, args, id, argsJson)
                }
            }
        } catch (t: Throwable) {
            Log.w(TAG, "onNativeCall($op) failed", t)
        }
    }

    fun onLog(level: String, message: String) {
        try {
            delegate.onLog(level, message)
        } catch (t: Throwable) {
            Log.w(TAG, "log callback failed", t)
        }
    }

    internal fun deliverInvokeResult(invokeId: Long, json: String?, isError: Boolean) {
        val handlerFn: ((String?, Boolean) -> Unit)?
        synchronized(invokeLock) {
            handlerFn = invokeHandlers.remove(invokeId)
            if (handlerFn == null) {
                earlyResults[invokeId] = json to isError
                if (earlyResults.size > 64) {
                    val oldest = earlyResults.keys.minOrNull()
                    if (oldest != null) earlyResults.remove(oldest)
                }
            }
        }
        handlerFn?.invoke(json, isError)
    }

    class JsException(message: String) : Exception(message)

    // ------------------------------------------------------------- native API --

    private external fun nativeCreate(callback: Any): Long

    private external fun nativeDestroy(handle: Long)

    /** Returns null on success, else the error message. */
    private external fun nativeEval(handle: Long, code: String, filename: String): String?

    private external fun nativeDrainJobs(handle: Long): Int

    private external fun nativeCall(handle: Long, name: String, argsJson: String): String

    private external fun nativeRunGC(handle: Long)

    companion object {
        private const val TAG = "QuickJsCore"
        private const val ERR_PREFIX = "__PB_ERR__:"

        /** Version of the embedded QuickJS engine (`JS_GetVersion`). */
        @JvmStatic
        external fun nativeVersion(): String

        init {
            System.loadLibrary("paperback")
        }
    }
}
