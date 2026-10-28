package expo.modules.paperbackquickjs

import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * React Native host for the vendored QuickJS-NG engine.
 *
 * The Kotlin port runs each source in its own QuickJS runtime and answers the
 * engine's device calls itself. Here the engine is the same (`cpp/`), but the
 * device side - network, cookies, Cloudflare handoff, storage - stays in the
 * React Native layer that already implements it, so extensions keep working
 * exactly as they do today while running on a real JavaScript engine instead of
 * a hidden WebView.
 *
 * One runtime per source, so two extensions can stream in parallel without
 * sharing `globalThis`. Bundles are evaluated once and reused until the source
 * is invalidated.
 */
class PaperbackQuickJsModule : Module() {

    private inner class Engine(val sourceId: String) {
        val core = QuickJsCore(object : QuickJsCore.Delegate {
            override fun dispatch(op: String, args: JSONObject, callId: Long, raw: String) {
                when (op) {
                    "timer.set" -> {
                        scheduleTimer(this@Engine, args.optLong("id"), args.optLong("ms", 0L), args.optBoolean("repeat"))
                        return
                    }

                    "timer.clear" -> {
                        timers.remove(timerKey(this@Engine, args.optLong("id")))?.cancel(false)
                        return
                    }
                }
                runCatching {
                    sendEvent(
                        "onNativeCall",
                        mapOf(
                            "sourceId" to sourceId,
                            "op" to op,
                            "id" to callId,
                            "args" to raw,
                        )
                    )
                }
            }

            override fun onInvokeResult(invokeId: Long, json: String?, isError: Boolean) {
                if (!isError) return
                val message = json ?: ""
                // 0.8 sources have no `initialise` at all; that probe is expected to fail.
                if (message.contains("does not implement")) return
                Log.w(TAG, "[$sourceId] invoke $invokeId failed: ${message.take(200)}")
            }

            override fun onLog(level: String, message: String) {
                Log.println(levelToPriority(level), TAG, "[$sourceId] $message")
            }
        })

        @Volatile
        var booted = false

        val loaded: Boolean get() = booted && core.isRunning
    }

    private val engines = ConcurrentHashMap<String, Engine>()
    private val timers = ConcurrentHashMap<String, ScheduledFuture<*>>()
    private val scheduler = Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "paperback-timer").apply { isDaemon = true }
    }

    override fun definition() = ModuleDefinition {
        Name("PaperbackQuickJs")
        Events("onNativeCall", "onLog")

        /** QuickJS build version, e.g. `2025-04-26`. */
        Function("version") { QuickJsCore.nativeVersion() }

        /** Evaluates `1 + 1`; used by the developer screen as a smoke test. */
        Function("selfTest") {
            val engine = engineFor("__selftest__")
            engine.core.start()
            val error = engine.core.eval("(1 + 1).toString()", "selftest.js")
            if (error != null) throw QuickJsCore.JsException(error)
            "2"
        }

        /**
         * Boots (or reuses) the runtime of [sourceId] and evaluates its bundle.
         * Returns the capabilities JSON reported by the prelude.
         */
        Function("loadSource") { sourceId: String, code: String, apiVersion: String ->
            val engine = engineFor(sourceId)
            bootEngine(engine)
            evalIn(engine, code, "$sourceId/index.js")
            evalIn(engine, exportShim(sourceId), "$sourceId/exports.js")
            val capabilities = engine.core.call("__paperbackLoadSource", JSONArray().put(sourceId).toString())
            // Helpers the React Native side calls through the same invoke channel.
            evalIn(engine, SOURCE_HELPERS, "$sourceId/helpers.js")
            // Paperback 0.9 sources set up their state in `initialise()`; 0.8
            // sources do not have the method at all.
            try {
                engine.core.invokeBlocking("initialise", "[]", 0L, 60L)
            } catch (t: Throwable) {
                val message = t.message ?: ""
                if (!message.contains("does not implement initialise")) {
                    Log.w(TAG, "[$sourceId] initialise failed: $message")
                }
            }
            capabilities
        }

        /** Evaluates a script in the runtime of [sourceId] (debugging aid). */
        Function("evalScript") { sourceId: String, code: String, filename: String ->
            val engine = engineFor(sourceId)
            bootEngine(engine)
            evalIn(engine, code, filename)
        }

        /**
         * Calls an async source method and waits for its promise. Runs off the
         * React Native JS thread, so the extension can hit the network through
         * [complete] while this is pending.
         */
        AsyncFunction("invoke") { sourceId: String, method: String, argsJson: String, streamId: Double, timeoutSeconds: Double ->
            val engine = engines[sourceId] ?: throw IllegalStateException("source $sourceId is not loaded")
            engine.core.invokeBlocking(method, argsJson, streamId.toLong(), timeoutSeconds.toLong().coerceAtLeast(1L))
        }

        /** Resolves a `__paperbackCall` promise (network, storage, ...). */
        Function("complete") { sourceId: String, callId: Double, json: String?, isError: Boolean ->
            val engine = engines[sourceId] ?: return@Function false
            engine.core.complete(callId.toLong(), json, isError)
            true
        }

        /** Drops one runtime (extension update / uninstall). */
        Function("unloadSource") { sourceId: String ->
            engines.remove(sourceId)?.let { runCatching { it.core.shutdown() } }
            true
        }

        Function("shutdown") {
            engines.keys.toList().forEach { id ->
                engines.remove(id)?.let { runCatching { it.core.shutdown() } }
            }
            scheduler.shutdownNow()
            true
        }

        OnDestroy {
            engines.keys.toList().forEach { id ->
                engines.remove(id)?.let { runCatching { it.core.shutdown() } }
            }
        }
    }

    // ------------------------------------------------------------------ setup --

    private fun engineFor(sourceId: String): Engine =
        engines.getOrPut(sourceId) { Engine(sourceId) }

    private fun bootEngine(engine: Engine) {
        if (engine.booted) return
        synchronized(engine) {
            if (engine.booted) return
            engine.core.start()
            evalAsset(engine, "js/prelude.js")
            evalAsset(engine, "js/bundles.js")
            engine.booted = true
        }
    }

    private fun evalAsset(engine: Engine, path: String) {
        val assets = appContext.reactContext?.assets
            ?: throw IllegalStateException("no Android context for extension assets")
        val code = assets.open(path).bufferedReader().use { it.readText() }
        evalIn(engine, code, path)
    }

    /** [QuickJsCore.eval] returns the error text instead of throwing. */
    private fun evalIn(engine: Engine, code: String, filename: String) {
        val error = engine.core.eval(code, filename)
        if (error != null) throw QuickJsCore.JsException("$filename: $error")
    }

    private fun timerKey(engine: Engine, id: Long) = "${engine.sourceId}:$id"

    private fun scheduleTimer(engine: Engine, id: Long, ms: Long, repeat: Boolean) {
        if (id <= 0L) return
        val key = timerKey(engine, id)
        val task = Runnable {
            runCatching { engine.core.call("__paperbackFireTimer", JSONArray().put(id).toString()) }
            if (!repeat) timers.remove(key)
        }
        val delay = ms.coerceAtLeast(16L)
        val future = if (repeat) {
            scheduler.scheduleAtFixedRate(task, delay, delay, TimeUnit.MILLISECONDS)
        } else {
            scheduler.schedule(task, ms.coerceAtLeast(0L), TimeUnit.MILLISECONDS)
        }
        timers[key]?.cancel(false)
        timers[key] = future
    }

    private fun levelToPriority(level: String) = when (level.lowercase()) {
        "error" -> Log.ERROR
        "warn" -> Log.WARN
        "debug" -> Log.DEBUG
        else -> Log.INFO
    }

    companion object {
        private const val TAG = "PaperbackQuickJS"

        /**
         * Helpers installed on the source instance after it loads. They run in
         * the source runtime (so they use its request manager and cookies) and
         * are called through the normal `invoke` channel.
         */
        private val SOURCE_HELPERS = """
(function () {
  var inst = globalThis.__paperbackSourceInstance;
  if (!inst) return;
  inst.__paperbackFetchImage = async function (url) {
    var res = await inst.requestManager.schedule(App.createRequest({ url: url, method: 'GET' }), 1);
    if (!res || !res.rawData) return null;
    return 'data:image/jpeg;base64,' + res.rawData;
  };
})();
""".trimStart()

        /**
         * 0.9 bundles export `source` (a `Source` subclass or a ready instance)
         * instead of the `Sources` map the 0.8 SDK publishes. Normalise both
         * shapes into `Sources[sourceId]` so the prelude finds the constructor:
         * instances are wrapped in a factory because the prelude uses `new`.
         */
        private fun exportShim(sourceId: String): String {
            val quoted = JSONObject.quote(sourceId)
            return """
(function () {
  var id = $quoted;
  var existing = globalThis.Sources;
  if (existing && typeof existing === 'object' && existing[id]) return;
  var single = globalThis.source;
  var candidates = [single, single && single.default];
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    if (!c) continue;
    if (typeof c === 'function') {
      globalThis.Sources = {}; globalThis.Sources[id] = c; return;
    }
    if (typeof c === 'object') {
      globalThis.Sources = {}; globalThis.Sources[id] = function () { return c; }; return;
    }
  }
})();
""".trimStart()
        }
    }
}
