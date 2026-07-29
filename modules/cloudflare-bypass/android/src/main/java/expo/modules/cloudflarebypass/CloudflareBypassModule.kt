package expo.modules.cloudflarebypass

import android.webkit.CookieManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class CloudflareBypassModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("CloudflareBypass")

        // Get cookies for a specific URL from Android's native CookieManager
        AsyncFunction("getCookies") { url: String ->
            val cookieManager = CookieManager.getInstance()
            cookieManager.getCookie(url) ?: ""
        }

        // Set cookies for a URL in the native CookieManager
        AsyncFunction("setCookies") { url: String, cookies: String ->
            val cookieManager = CookieManager.getInstance()
            for (cookie in cookies.split(";")) {
                cookieManager.setCookie(url, cookie.trim())
            }
            cookieManager.flush()
            true
        }

        // Clear all cookies
        AsyncFunction("clearCookies") {
            val cookieManager = CookieManager.getInstance()
            cookieManager.removeAllCookies(null)
            cookieManager.flush()
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
}
