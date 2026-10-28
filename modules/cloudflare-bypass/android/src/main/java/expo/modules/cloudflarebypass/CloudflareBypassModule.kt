package expo.modules.cloudflarebypass

import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.CookieManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class CloudflareBypassModule : Module() {
    /**
     * `CookieManager.getInstance()` initialises the WebView provider on first
     * use, which is only safe on the UI thread - calling it from the module
     * queue left the promise pending forever. Hop to the main thread with a
     * bounded wait so a wedged WebView can never hang an extension request.
     */
    private fun <T> onMainThreadBlocking(timeoutMs: Long = 4000, block: () -> T): T? {
        if (Looper.myLooper() == Looper.getMainLooper()) return block()
        var result: T? = null
        val latch = CountDownLatch(1)
        Handler(Looper.getMainLooper()).post {
            try {
                result = block()
            } catch (t: Throwable) {
                Log.w(TAG, "main-thread call failed", t)
            } finally {
                latch.countDown()
            }
        }
        if (!latch.await(timeoutMs, TimeUnit.MILLISECONDS)) {
            Log.w(TAG, "main-thread call timed out after ${timeoutMs}ms")
            return null
        }
        return result
    }

    override fun definition() = ModuleDefinition {
        Name("CloudflareBypass")

        // Get cookies for a specific URL from Android's native CookieManager
        AsyncFunction("getCookies") { url: String ->
            onMainThreadBlocking { CookieManager.getInstance().getCookie(url) } ?: ""
        }

        // Set cookies for a specific URL in the native CookieManager
        AsyncFunction("setCookies") { url: String, cookies: String ->
            onMainThreadBlocking {
                val cookieManager = CookieManager.getInstance()
                for (cookie in cookies.split(";")) {
                    cookieManager.setCookie(url, cookie.trim())
                }
                cookieManager.flush()
            }
            true
        }

        // Clear all cookies
        AsyncFunction("clearCookies") {
            onMainThreadBlocking {
                val cookieManager = CookieManager.getInstance()
                cookieManager.removeAllCookies(null)
                cookieManager.flush()
            }
            appContext.reactContext
                ?.getSharedPreferences(CloudflareBypassActivity.PREFS_NAME, android.content.Context.MODE_PRIVATE)
                ?.edit()
                ?.clear()
                ?.apply()
            true
        }

        AsyncFunction("getBrowserAuthToken") { tokenId: String ->
            appContext.reactContext
                ?.getSharedPreferences(CloudflareBypassActivity.PREFS_NAME, android.content.Context.MODE_PRIVATE)
                ?.getString(CloudflareBypassActivity.tokenPreferenceKey(tokenId), "")
                ?: ""
        }

        AsyncFunction("getBrowserAuthHosts") { tokenId: String ->
            appContext.reactContext
                ?.getSharedPreferences(CloudflareBypassActivity.PREFS_NAME, android.content.Context.MODE_PRIVATE)
                ?.getString(CloudflareBypassActivity.hostsPreferenceKey(tokenId), "")
                ?: ""
        }

        AsyncFunction("clearBrowserAuthToken") { tokenId: String ->
            appContext.reactContext
                ?.getSharedPreferences(CloudflareBypassActivity.PREFS_NAME, android.content.Context.MODE_PRIVATE)
                ?.edit()
                ?.remove(CloudflareBypassActivity.tokenPreferenceKey(tokenId))
                ?.remove(CloudflareBypassActivity.hostsPreferenceKey(tokenId))
                ?.apply()
            true
        }

        // Launch a generic native browser Activity. The extension supplies any
        // optional auth capture configuration; the app core has no site rules.
        AsyncFunction("launchBypassActivity") {
                url: String,
                title: String,
                tokenId: String,
                authCaptureJson: String ->
            val context = appContext.reactContext
                ?: throw Exception("React context not available")
            val intent = CloudflareBypassActivity.createIntent(
                context,
                url,
                title,
                tokenId,
                authCaptureJson
            )
            context.startActivity(intent)
            true
        }
    }

    private companion object {
        const val TAG = "CloudflareBypass"
    }
}
