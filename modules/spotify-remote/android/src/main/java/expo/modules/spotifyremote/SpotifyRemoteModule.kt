package expo.modules.spotifyremote

import android.content.Context
import android.graphics.Bitmap
import android.util.Base64
import android.util.Log
import com.spotify.android.appremote.api.ConnectionParams
import com.spotify.android.appremote.api.Connector
import com.spotify.android.appremote.api.SpotifyAppRemote
import com.spotify.protocol.client.Subscription
import com.spotify.protocol.types.ListItem
import com.spotify.protocol.types.ListItems
import com.spotify.protocol.types.PlayerState
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream

/**
 * Expo module for Spotify Remote control on Android
 * Provides playback control, player state observation, and connection management
 */
class SpotifyRemoteModule : Module() {
    companion object {
        private const val TAG = "SpotifyRemote"
    }

    // Spotify App Remote instance
    private var spotifyAppRemote: SpotifyAppRemote? = null
    private var isSubscribed: Boolean = false

    // Configuration
    private var clientId: String = ""
    private var redirectUri: String = ""

    // Pending connection promise
    private var pendingConnectionPromise: Promise? = null

    private val context: Context
        get() = requireNotNull(appContext.reactContext)

    override fun definition() = ModuleDefinition {
        Name("SpotifyRemote")

        // Events that can be sent to JavaScript
        Events("onPlayerStateChanged", "onConnectionStatusChanged", "onError")

        // Configure the module with Spotify credentials
        Function("configure") { clientId: String, redirectUri: String ->
            this@SpotifyRemoteModule.clientId = clientId
            this@SpotifyRemoteModule.redirectUri = redirectUri
        }

        // Connect to Spotify app
        AsyncFunction("connect") { promise: Promise ->
            if (clientId.isEmpty() || redirectUri.isEmpty()) {
                promise.reject("NOT_CONFIGURED", "SpotifyRemote not configured. Call configure() first.", null)
                return@AsyncFunction
            }

            spotifyAppRemote?.let {
                if (it.isConnected) {
                    promise.resolve(mapOf("connected" to true))
                    return@AsyncFunction
                }
            }

            pendingConnectionPromise = promise

            // Check if Spotify is installed before attempting connection
            if (!SpotifyAppRemote.isSpotifyInstalled(context)) {
                Log.e(TAG, "Spotify app is not installed")
                promise.reject("SPOTIFY_NOT_INSTALLED", "Spotify app is not installed on this device", null)
                pendingConnectionPromise = null
                return@AsyncFunction
            }

            val connectionParams = ConnectionParams.Builder(clientId)
                .setRedirectUri(redirectUri)
                .showAuthView(true)
                .build()

            Log.d(TAG, "Connecting to Spotify with clientId: $clientId, redirectUri: $redirectUri")

            SpotifyAppRemote.connect(context, connectionParams, object : Connector.ConnectionListener {
                override fun onConnected(appRemote: SpotifyAppRemote) {
                    spotifyAppRemote = appRemote
                    Log.d(TAG, "Connected to Spotify!")

                    sendEvent("onConnectionStatusChanged", mapOf(
                        "connected" to true,
                        "status" to "connected"
                    ))

                    pendingConnectionPromise?.resolve(mapOf("connected" to true))
                    pendingConnectionPromise = null
                }

                override fun onFailure(throwable: Throwable) {
                    Log.e(TAG, "Connection failed: ${throwable.message}", throwable)

                    sendEvent("onConnectionStatusChanged", mapOf(
                        "connected" to false,
                        "status" to "failed",
                        "error" to (throwable.message ?: "Unknown error")
                    ))

                    pendingConnectionPromise?.reject("CONNECTION_FAILED", throwable.message, throwable)
                    pendingConnectionPromise = null
                }
            })
        }

        // Connect silently to Spotify app (without opening Spotify)
        // On Android, this attempts to connect to an already-running Spotify instance
        AsyncFunction("connectSilent") { promise: Promise ->
            if (clientId.isEmpty() || redirectUri.isEmpty()) {
                promise.reject("NOT_CONFIGURED", "SpotifyRemote not configured. Call configure() first.", null)
                return@AsyncFunction
            }

            spotifyAppRemote?.let {
                if (it.isConnected) {
                    promise.resolve(mapOf("connected" to true))
                    return@AsyncFunction
                }
            }

            // Check if Spotify is installed
            if (!SpotifyAppRemote.isSpotifyInstalled(context)) {
                Log.e(TAG, "Spotify app is not installed")
                promise.reject("SPOTIFY_NOT_INSTALLED", "Spotify app is not installed on this device", null)
                return@AsyncFunction
            }

            // Try to connect silently without showing auth view
            val connectionParams = ConnectionParams.Builder(clientId)
                .setRedirectUri(redirectUri)
                .showAuthView(false)
                .build()

            Log.d(TAG, "Attempting silent connection to Spotify...")

            SpotifyAppRemote.connect(context, connectionParams, object : Connector.ConnectionListener {
                override fun onConnected(appRemote: SpotifyAppRemote) {
                    spotifyAppRemote = appRemote
                    Log.d(TAG, "Silent connection to Spotify successful!")

                    sendEvent("onConnectionStatusChanged", mapOf(
                        "connected" to true,
                        "status" to "connected"
                    ))

                    promise.resolve(mapOf("connected" to true))
                }

                override fun onFailure(throwable: Throwable) {
                    Log.d(TAG, "Silent connection failed: ${throwable.message}")
                    // Silent connection failed - this is expected if Spotify isn't running
                    // Don't emit error event for silent failures
                    promise.resolve(mapOf("connected" to false))
                }
            })
        }

        // Disconnect from Spotify app
        AsyncFunction("disconnect") { promise: Promise ->
            spotifyAppRemote?.let {
                SpotifyAppRemote.disconnect(it)
                spotifyAppRemote = null
            }

            sendEvent("onConnectionStatusChanged", mapOf(
                "connected" to false,
                "status" to "disconnected"
            ))

            promise.resolve(mapOf("disconnected" to true))
        }

        // Check if connected
        Function("isConnected") {
            spotifyAppRemote?.isConnected ?: false
        }

        // Resume playback
        AsyncFunction("resume") { promise: Promise ->
            val remote = spotifyAppRemote
            if (remote == null || !remote.isConnected) {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify", null)
                return@AsyncFunction
            }

            remote.playerApi.resume()
                .setResultCallback { promise.resolve(mapOf("success" to true)) }
                .setErrorCallback { throwable ->
                    promise.reject("PLAYBACK_ERROR", throwable.message, throwable)
                }
        }

        // Pause playback
        AsyncFunction("pause") { promise: Promise ->
            val remote = spotifyAppRemote
            if (remote == null || !remote.isConnected) {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify", null)
                return@AsyncFunction
            }

            remote.playerApi.pause()
                .setResultCallback { promise.resolve(mapOf("success" to true)) }
                .setErrorCallback { throwable ->
                    promise.reject("PLAYBACK_ERROR", throwable.message, throwable)
                }
        }

        // Skip to next track
        AsyncFunction("skipToNext") { promise: Promise ->
            val remote = spotifyAppRemote
            if (remote == null || !remote.isConnected) {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify", null)
                return@AsyncFunction
            }

            remote.playerApi.skipNext()
                .setResultCallback { promise.resolve(mapOf("success" to true)) }
                .setErrorCallback { throwable ->
                    promise.reject("PLAYBACK_ERROR", throwable.message, throwable)
                }
        }

        // Skip to previous track
        AsyncFunction("skipToPrevious") { promise: Promise ->
            val remote = spotifyAppRemote
            if (remote == null || !remote.isConnected) {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify", null)
                return@AsyncFunction
            }

            remote.playerApi.skipPrevious()
                .setResultCallback { promise.resolve(mapOf("success" to true)) }
                .setErrorCallback { throwable ->
                    promise.reject("PLAYBACK_ERROR", throwable.message, throwable)
                }
        }

        // Seek to position (in milliseconds)
        AsyncFunction("seekTo") { positionMs: Long, promise: Promise ->
            val remote = spotifyAppRemote
            if (remote == null || !remote.isConnected) {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify", null)
                return@AsyncFunction
            }

            remote.playerApi.seekTo(positionMs)
                .setResultCallback { promise.resolve(mapOf("success" to true)) }
                .setErrorCallback { throwable ->
                    promise.reject("PLAYBACK_ERROR", throwable.message, throwable)
                }
        }

        // Play a specific track, album, or playlist by URI
        AsyncFunction("play") { uri: String, promise: Promise ->
            val remote = spotifyAppRemote
            if (remote == null || !remote.isConnected) {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify", null)
                return@AsyncFunction
            }

            remote.playerApi.play(uri)
                .setResultCallback { promise.resolve(mapOf("success" to true)) }
                .setErrorCallback { throwable ->
                    promise.reject("PLAYBACK_ERROR", throwable.message, throwable)
                }
        }

        // Enqueue a track (add to queue)
        AsyncFunction("enqueue") { uri: String, promise: Promise ->
            val remote = spotifyAppRemote
            if (remote == null || !remote.isConnected) {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify", null)
                return@AsyncFunction
            }

            remote.playerApi.queue(uri)
                .setResultCallback { promise.resolve(mapOf("success" to true)) }
                .setErrorCallback { throwable ->
                    promise.reject("PLAYBACK_ERROR", throwable.message, throwable)
                }
        }

        // Get current player state
        AsyncFunction("getPlayerState") { promise: Promise ->
            val remote = spotifyAppRemote
            if (remote == null || !remote.isConnected) {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify", null)
                return@AsyncFunction
            }

            remote.playerApi.playerState
                .setResultCallback { playerState ->
                    promise.resolve(playerStateToMap(playerState))
                }
                .setErrorCallback { throwable ->
                    promise.reject("PLAYBACK_ERROR", throwable.message, throwable)
                }
        }

        // Subscribe to player state changes
        AsyncFunction("subscribeToPlayerState") { promise: Promise ->
            val remote = spotifyAppRemote
            if (remote == null || !remote.isConnected) {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify", null)
                return@AsyncFunction
            }

            if (isSubscribed) {
                // Already subscribed
                promise.resolve(mapOf("subscribed" to true))
                return@AsyncFunction
            }

            remote.playerApi.subscribeToPlayerState()
                .setEventCallback { playerState ->
                    sendEvent("onPlayerStateChanged", playerStateToMap(playerState))
                }
                .setLifecycleCallback(object : Subscription.LifecycleCallback {
                    override fun onStart() {
                        isSubscribed = true
                        Log.d(TAG, "Player state subscription started")
                    }
                    override fun onStop() {
                        isSubscribed = false
                        Log.d(TAG, "Player state subscription stopped")
                    }
                })
                .setErrorCallback { throwable ->
                    sendEvent("onError", mapOf("error" to (throwable.message ?: "Unknown error")))
                }

            isSubscribed = true
            promise.resolve(mapOf("subscribed" to true))
        }

        // Unsubscribe from player state changes
        AsyncFunction("unsubscribeFromPlayerState") { promise: Promise ->
            isSubscribed = false
            // Note: The subscription is managed internally by SpotifyAppRemote
            // and will be cancelled when we disconnect
            promise.resolve(mapOf("unsubscribed" to true))
        }

        // Set shuffle mode
        AsyncFunction("setShuffle") { enabled: Boolean, promise: Promise ->
            val remote = spotifyAppRemote
            if (remote == null || !remote.isConnected) {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify", null)
                return@AsyncFunction
            }

            remote.playerApi.setShuffle(enabled)
                .setResultCallback { promise.resolve(mapOf("success" to true)) }
                .setErrorCallback { throwable ->
                    promise.reject("PLAYBACK_ERROR", throwable.message, throwable)
                }
        }

        // Set repeat mode: 0 = off, 1 = context, 2 = track
        AsyncFunction("setRepeatMode") { mode: Int, promise: Promise ->
            val remote = spotifyAppRemote
            if (remote == null || !remote.isConnected) {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify", null)
                return@AsyncFunction
            }

            remote.playerApi.setRepeat(mode)
                .setResultCallback { promise.resolve(mapOf("success" to true)) }
                .setErrorCallback { throwable ->
                    promise.reject("PLAYBACK_ERROR", throwable.message, throwable)
                }
        }

        // ==================== Content API ====================

        // Get recommended content items (playlists, albums, etc.)
        AsyncFunction("getRecommendedContentItems") { promise: Promise ->
            val remote = spotifyAppRemote
            if (remote == null || !remote.isConnected) {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify", null)
                return@AsyncFunction
            }

            remote.contentApi.getRecommendedContentItems("default")
                .setResultCallback { listItems: ListItems ->
                    val items = listItems.items.map { listItemToMap(it) }
                    promise.resolve(items)
                }
                .setErrorCallback { throwable ->
                    Log.e(TAG, "Failed to get recommended content: ${throwable.message}", throwable)
                    promise.reject("CONTENT_ERROR", throwable.message, throwable)
                }
        }

        // Get children of a content item (e.g., tracks in a playlist)
        AsyncFunction("getChildrenOfContentItem") { uri: String, promise: Promise ->
            val remote = spotifyAppRemote
            if (remote == null || !remote.isConnected) {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify", null)
                return@AsyncFunction
            }

            // Create a ListItem to get children from
            remote.contentApi.getChildrenOfItem(ListItem(uri, uri, null, null, null, false, true), 50, 0)
                .setResultCallback { listItems: ListItems ->
                    val items = listItems.items.map { listItemToMap(it) }
                    promise.resolve(items)
                }
                .setErrorCallback { throwable ->
                    Log.e(TAG, "Failed to get children of content: ${throwable.message}", throwable)
                    promise.reject("CONTENT_ERROR", throwable.message, throwable)
                }
        }

        // Get image for a content item as base64 (pass the imageUri from the content item)
        AsyncFunction("getContentItemImage") { imageUri: String, promise: Promise ->
            val remote = spotifyAppRemote
            if (remote == null || !remote.isConnected) {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify", null)
                return@AsyncFunction
            }

            // On Android, we receive the imageUri directly from the ListItem
            // Create an ImageUri and fetch the image
            val spotifyImageUri = com.spotify.protocol.types.ImageUri(imageUri)
            
            remote.imagesApi.getImage(spotifyImageUri)
                .setResultCallback { bitmap: Bitmap ->
                    // Convert bitmap to base64
                    val outputStream = ByteArrayOutputStream()
                    bitmap.compress(Bitmap.CompressFormat.JPEG, 80, outputStream)
                    val base64String = Base64.encodeToString(outputStream.toByteArray(), Base64.NO_WRAP)
                    promise.resolve("data:image/jpeg;base64,$base64String")
                }
                .setErrorCallback { throwable ->
                    Log.e(TAG, "Failed to get content image: ${throwable.message}", throwable)
                    promise.reject("IMAGE_ERROR", throwable.message, throwable)
                }
        }

        // Handle app lifecycle
        OnActivityEntersForeground {
            // Attempt reconnection when app comes to foreground
            spotifyAppRemote?.let {
                if (!it.isConnected && clientId.isNotEmpty()) {
                    // Could auto-reconnect here if needed
                }
            }
        }

        OnDestroy {
            isSubscribed = false
            spotifyAppRemote?.let { SpotifyAppRemote.disconnect(it) }
        }
    }

    // Convert PlayerState to Map for JavaScript
    private fun playerStateToMap(playerState: PlayerState): Map<String, Any?> {
        val track = playerState.track
        return mapOf(
            "track" to if (track != null) mapOf(
                "uri" to track.uri,
                "name" to track.name,
                "artist" to track.artist?.name,
                "album" to track.album?.name,
                "duration" to track.duration,
                "imageUri" to track.imageUri?.raw
            ) else null,
            "playbackPosition" to playerState.playbackPosition,
            "playbackSpeed" to playerState.playbackSpeed,
            "isPaused" to playerState.isPaused,
            "playbackOptions" to mapOf(
                "isShuffling" to playerState.playbackOptions.isShuffling,
                "repeatMode" to playerState.playbackOptions.repeatMode
            ),
            "playbackRestrictions" to mapOf(
                "canSkipNext" to playerState.playbackRestrictions.canSkipNext,
                "canSkipPrevious" to playerState.playbackRestrictions.canSkipPrev,
                "canSeek" to playerState.playbackRestrictions.canSeek,
                "canToggleShuffle" to playerState.playbackRestrictions.canToggleShuffle,
                "canRepeatTrack" to playerState.playbackRestrictions.canRepeatTrack,
                "canRepeatContext" to playerState.playbackRestrictions.canRepeatContext
            )
        )
    }

    // Convert ListItem to Map for JavaScript (Content API)
    private fun listItemToMap(item: ListItem): Map<String, Any?> {
        return mapOf(
            "uri" to item.uri,
            "title" to item.title,
            "subtitle" to item.subtitle,
            "imageUri" to item.imageUri?.raw,
            "isPlayable" to item.playable,
            "isContainer" to item.hasChildren
        )
    }
}
