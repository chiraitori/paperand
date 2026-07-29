package expo.modules.cloudflarebypass

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.TextUtils
import android.view.Gravity
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject
import java.net.URLDecoder

class CloudflareBypassActivity : Activity() {

    companion object {
        const val EXTRA_URL = "url"
        const val EXTRA_TITLE = "title"
        const val EXTRA_TOKEN_ID = "token_id"
        const val EXTRA_AUTH_CAPTURE_JSON = "auth_capture_json"
        const val PREFS_NAME = "cloudflare_bypass"

        private fun normalizeTokenId(tokenId: String): String {
            return tokenId.lowercase().replace(Regex("[^a-z0-9._-]"), "_").take(80)
        }

        fun tokenPreferenceKey(tokenId: String) = "auth_token_${normalizeTokenId(tokenId)}"
        fun hostsPreferenceKey(tokenId: String) = "auth_hosts_${normalizeTokenId(tokenId)}"

        fun createIntent(
            context: Context,
            url: String,
            title: String = "Verification",
            tokenId: String = "",
            authCaptureJson: String = ""
        ): Intent {
            return Intent(context, CloudflareBypassActivity::class.java).apply {
                putExtra(EXTRA_URL, url)
                putExtra(EXTRA_TITLE, title)
                putExtra(EXTRA_TOKEN_ID, tokenId)
                putExtra(EXTRA_AUTH_CAPTURE_JSON, authCaptureJson)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
        }
    }

    private data class AuthCaptureConfig(
        val database: String,
        val store: String,
        val key: String,
        val pageHosts: List<String>,
        val headerHosts: List<String>,
        val minimumLength: Int
    )

    private lateinit var webView: WebView
    private val handler = Handler(Looper.getMainLooper())
    private var tokenId: String = ""
    private var authCaptureConfig: AuthCaptureConfig? = null

    private fun dpToPx(dp: Int): Int {
        return (dp * resources.displayMetrics.density).toInt()
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val url = intent.getStringExtra(EXTRA_URL) ?: run { finish(); return }
        val title = intent.getStringExtra(EXTRA_TITLE) ?: "Verification"
        tokenId = intent.getStringExtra(EXTRA_TOKEN_ID).orEmpty()
        authCaptureConfig = parseAuthCaptureConfig(
            intent.getStringExtra(EXTRA_AUTH_CAPTURE_JSON).orEmpty()
        )

        // --- Root layout ---
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#16213e"))
            fitsSystemWindows = true
        }

        // --- Header bar ---
        val header = FrameLayout(this).apply {
            val padding = dpToPx(12)
            setPadding(padding, padding, padding, padding)
            setBackgroundColor(Color.parseColor("#16213e"))
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                elevation = dpToPx(4).toFloat()
            }
        }

        val closeBtn = ImageButton(this).apply {
            setImageResource(android.R.drawable.ic_menu_close_clear_cancel)
            setBackgroundColor(Color.TRANSPARENT)
            setColorFilter(Color.WHITE)
            val p = dpToPx(8)
            setPadding(p, p, p, p)
            setOnClickListener { finish() }
        }

        val titleView = TextView(this).apply {
            text = title
            textSize = 18f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
        }

        // Add views to FrameLayout
        header.addView(titleView, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER
        ))

        header.addView(closeBtn, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER_VERTICAL or Gravity.START
        ))

        root.addView(header, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ))

        // --- WebView (fills remaining space) ---
        webView = WebView(this)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            setSupportZoom(true)
            builtInZoomControls = false
            loadWithOverviewMode = true
            useWideViewPort = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            // Present the verification page as a regular mobile browser.
            userAgentString = userAgentString
                .replace("; wv", "")
                .replace("Version/4.0 ", "")
        }

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, true)
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, pageUrl: String?) {
                super.onPageFinished(view, pageUrl)
                CookieManager.getInstance().flush()
                if (view != null && pageUrl != null && shouldCaptureAuth(pageUrl)) {
                    captureConfiguredAccessToken(view, pageUrl)
                }
            }
        }

        root.addView(webView, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            0, 1f
        ))

        setContentView(root)
        webView.loadUrl(url)
    }

    private fun parseAuthCaptureConfig(raw: String): AuthCaptureConfig? {
        if (raw.isBlank() || tokenId.isBlank()) return null
        return runCatching {
            val json = JSONObject(raw)
            if (json.optString("type", "indexeddb") != "indexeddb") return@runCatching null

            fun stringList(name: String): List<String> {
                val array = json.optJSONArray(name) ?: return emptyList()
                return (0 until array.length())
                    .mapNotNull { array.optString(it).trim().lowercase().takeIf(String::isNotEmpty) }
            }

            val database = json.getString("database").trim()
            val store = json.getString("store").trim()
            val key = json.getString("key").trim()
            val pageHosts = stringList("pageHosts")
            val headerHosts = stringList("headerHosts")
            val minimumLength = json.optInt("minimumLength", 16).coerceIn(1, 4096)

            if (database.isEmpty() || store.isEmpty() || key.isEmpty() || pageHosts.isEmpty()) {
                null
            } else {
                AuthCaptureConfig(
                    database,
                    store,
                    key,
                    pageHosts,
                    headerHosts,
                    minimumLength
                )
            }
        }.getOrNull()
    }

    private fun shouldCaptureAuth(url: String): Boolean {
        val config = authCaptureConfig ?: return false
        val host = runCatching { Uri.parse(url).host.orEmpty().lowercase() }.getOrDefault("")
        return config.pageHosts.any { allowed ->
            host == allowed || host.endsWith(".$allowed")
        }
    }

    private fun captureConfiguredAccessToken(view: WebView, pageUrl: String) {
        val config = authCaptureConfig ?: return
        val cookieName = "pb_auth_${tokenId.lowercase().replace(Regex("[^a-z0-9]"), "_").take(32)}"
        val database = JSONObject.quote(config.database)
        val store = JSONObject.quote(config.store)
        val key = JSONObject.quote(config.key)
        val cookie = JSONObject.quote(cookieName)

        val script = """
            (() => {
              try {
                const openRequest = indexedDB.open($database);
                openRequest.onsuccess = () => {
                  try {
                    const db = openRequest.result;
                    if (!db.objectStoreNames.contains($store)) return;
                    const getRequest = db.transaction($store, 'readonly')
                      .objectStore($store)
                      .get($key);
                    getRequest.onsuccess = () => {
                      const stored = getRequest.result;
                      const token = typeof stored === 'string'
                        ? stored
                        : stored && typeof stored === 'object'
                          ? (stored.value || stored.token || stored.accessToken || '')
                          : '';
                      if (typeof token !== 'string' || token.length < ${config.minimumLength}) return;
                      document.cookie = $cookie + '=' + encodeURIComponent(token)
                        + '; Path=/; Max-Age=30; SameSite=Strict; Secure';
                    };
                  } catch (_) {}
                };
              } catch (_) {}
            })();
            true;
        """.trimIndent()

        view.evaluateJavascript(script, null)
        handler.postDelayed({
            val cookieManager = CookieManager.getInstance()
            val cookieHeader = cookieManager.getCookie(pageUrl).orEmpty()
            val encodedToken = cookieHeader
                .split(';')
                .map { it.trim() }
                .firstOrNull { it.startsWith("$cookieName=") }
                ?.substringAfter('=')

            if (!encodedToken.isNullOrBlank()) {
                val token = runCatching { URLDecoder.decode(encodedToken, "UTF-8") }.getOrNull()
                if (!token.isNullOrBlank()
                    && token.length >= config.minimumLength
                    && token.length <= 16384
                ) {
                    getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                        .edit()
                        .putString(tokenPreferenceKey(tokenId), token)
                        .putString(hostsPreferenceKey(tokenId), config.headerHosts.joinToString(","))
                        .apply()
                }
            }

            cookieManager.setCookie(
                pageUrl,
                "$cookieName=; Path=/; Max-Age=0; SameSite=Strict; Secure"
            )
            cookieManager.flush()
        }, 750)
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        CookieManager.getInstance().flush()
        webView.destroy()
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }
}
