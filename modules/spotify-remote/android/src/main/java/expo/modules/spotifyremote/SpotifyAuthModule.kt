package expo.modules.spotifyremote

import android.app.Activity
import android.content.Intent
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
 */
class SpotifyAuthModule : Module() {
    companion object {
        private const val TAG = "SpotifyAuth"
        private const val REQUEST_CODE = 1337
        
        // Pending auth promise - used to handle the auth response
        var pendingAuthPromise: Promise? = null
    }

    // Configuration
    private var clientId: String = ""
    private var redirectUri: String = ""

    private val currentActivity: Activity?
        get() = appContext.currentActivity

    override fun definition() = ModuleDefinition {
        Name("SpotifyAuth")

        // Configure the module with Spotify credentials
        Function("configure") { clientId: String, redirectUri: String ->
            this@SpotifyAuthModule.clientId = clientId
            this@SpotifyAuthModule.redirectUri = redirectUri
        }

        // Authorize with Spotify - opens auth flow
        AsyncFunction("authorize") { scopes: List<String>, promise: Promise ->
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

        // Check if we have a valid session
        Function("isAuthorized") {
            // For now, we don't store tokens persistently
            // In a production app, you'd check stored tokens here
            false
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
