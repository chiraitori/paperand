package expo.modules.spotifyremote

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.util.Log
import com.spotify.sdk.android.auth.AuthorizationClient
import com.spotify.sdk.android.auth.AuthorizationRequest
import com.spotify.sdk.android.auth.AuthorizationResponse
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Expo module for Spotify Authentication on Android
 * Handles OAuth flow to get access tokens for Spotify API
 * Persists tokens so user only needs to authorize once
 */
class SpotifyAuthModule : Module() {
    companion object {
        private const val TAG = "SpotifyAuth"
        private const val REQUEST_CODE = 1337
        private const val PREFS_NAME = "SpotifyAuthPrefs"
        private const val KEY_ACCESS_TOKEN = "spotify_access_token"
        private const val KEY_TOKEN_EXPIRY = "spotify_token_expiry"
        
        // Pending auth promise - used to handle the auth response
        var pendingAuthPromise: Promise? = null
    }

    // Configuration
    private var clientId: String = ""
    private var redirectUri: String = ""

    private val currentActivity: Activity?
        get() = appContext.currentActivity
    
    private val context: Context
        get() = requireNotNull(appContext.reactContext)
    
    // SharedPreferences for token storage
    private val prefs: SharedPreferences
        get() = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    
    // Get stored access token
    private val storedAccessToken: String?
        get() = prefs.getString(KEY_ACCESS_TOKEN, null)
    
    // Get stored token expiry timestamp (milliseconds)
    private val storedTokenExpiry: Long
        get() = prefs.getLong(KEY_TOKEN_EXPIRY, 0)
    
    // Check if stored token is valid (exists and not expired)
    private val hasValidStoredToken: Boolean
        get() {
            val token = storedAccessToken
            val expiry = storedTokenExpiry
            if (token.isNullOrEmpty() || expiry == 0L) return false
            // Token is valid if it expires more than 5 minutes from now
            return expiry > System.currentTimeMillis() + 300_000
        }
    
    // Save token to storage
    private fun saveToken(accessToken: String, expiresIn: Int) {
        val expiryTime = System.currentTimeMillis() + (expiresIn * 1000L)
        prefs.edit()
            .putString(KEY_ACCESS_TOKEN, accessToken)
            .putLong(KEY_TOKEN_EXPIRY, expiryTime)
            .apply()
        Log.d(TAG, "Token saved, expires at $expiryTime")
    }
    
    // Clear stored token
    private fun clearToken() {
        prefs.edit()
            .remove(KEY_ACCESS_TOKEN)
            .remove(KEY_TOKEN_EXPIRY)
            .apply()
        Log.d(TAG, "Token cleared")
    }

    override fun definition() = ModuleDefinition {
        Name("SpotifyAuth")

        // Configure the module with Spotify credentials
        Function("configure") { clientId: String, redirectUri: String ->
            this@SpotifyAuthModule.clientId = clientId
            this@SpotifyAuthModule.redirectUri = redirectUri
        }

        // Authorize with Spotify - uses stored token if valid, otherwise opens auth flow
        AsyncFunction("authorize") { scopes: List<String>, promise: Promise ->
            // Check if we have a valid stored token - return it immediately!
            if (hasValidStoredToken) {
                val token = storedAccessToken
                val expiry = storedTokenExpiry
                val expiresIn = ((expiry - System.currentTimeMillis()) / 1000).toInt()
                Log.d(TAG, "Using stored token (đang ủy quyền...)")
                promise.resolve(mapOf(
                    "accessToken" to token,
                    "expiresIn" to expiresIn
                ))
                return@AsyncFunction
            }
            
            if (clientId.isEmpty() || redirectUri.isEmpty()) {
                promise.reject("NOT_CONFIGURED", "SpotifyAuth not configured. Call configure() first.", null)
                return@AsyncFunction
            }

            val activity = currentActivity
            if (activity == null) {
                promise.reject("NO_ACTIVITY", "No current activity available", null)
                return@AsyncFunction
            }

            // Store promise for later resolution in onActivityResult
            pendingAuthPromise = promise

            // Build auth request
            val builder = AuthorizationRequest.Builder(
                clientId,
                AuthorizationResponse.Type.TOKEN,
                redirectUri
            )

            builder.setScopes(scopes.toTypedArray())
            val request = builder.build()

            Log.d(TAG, "Starting Spotify auth flow with scopes: $scopes")

            // Open Spotify auth activity
            AuthorizationClient.openLoginActivity(activity, REQUEST_CODE, request)
        }

        // Check if we have a valid session (stored token)
        Function("isAuthorized") {
            hasValidStoredToken
        }
        
        // Get stored access token (if valid)
        Function("getAccessToken") {
            if (hasValidStoredToken) storedAccessToken else null
        }
        
        // Logout - clear stored token
        Function("logout") {
            clearToken()
        }

        // Handle activity result for auth callback
        OnActivityResult { _, payload ->
            val (requestCode, resultCode, data) = payload

            if (requestCode == REQUEST_CODE) {
                val response = AuthorizationClient.getResponse(resultCode, data)
                val promise = pendingAuthPromise
                pendingAuthPromise = null

                when (response.type) {
                    AuthorizationResponse.Type.TOKEN -> {
                        Log.d(TAG, "Auth successful, token received")
                        
                        // Save token for future use!
                        saveToken(response.accessToken, response.expiresIn)
                        
                        promise?.resolve(mapOf(
                            "accessToken" to response.accessToken,
                            "expiresIn" to response.expiresIn
                        ))
                    }
                    AuthorizationResponse.Type.ERROR -> {
                        Log.e(TAG, "Auth error: ${response.error}")
                        promise?.reject("AUTH_ERROR", response.error, null)
                    }
                    else -> {
                        Log.e(TAG, "Auth cancelled or unknown response")
                        promise?.reject("AUTH_CANCELLED", "Authorization was cancelled", null)
                    }
                }
            }
        }
    }
}
