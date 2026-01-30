import ExpoModulesCore
import SpotifyiOS

/// Expo module for Spotify Remote control on iOS
/// Provides playback control, player state observation, and connection management
public class SpotifyRemoteModule: Module {
    // MARK: - Properties
    
    private var appRemote: SPTAppRemote?
    private var connectionParams: SPTAppRemoteConnectionParams?
    private var playerStateSubscription: Bool = false
    private var pendingConnectionPromise: Promise?
    
    // MARK: - Configuration
    
    private var clientId: String = ""
    private var redirectUri: String = ""
    
    // MARK: - Module Definition
    
    public func definition() -> ModuleDefinition {
        Name("SpotifyRemote")
        
        // Events that can be sent to JavaScript
        Events("onPlayerStateChanged", "onConnectionStatusChanged", "onError")
        
        // Configure the module with Spotify credentials
        Function("configure") { (clientId: String, redirectUri: String) in
            self.clientId = clientId
            self.redirectUri = redirectUri
            self.setupAppRemote()
        }
        
        // Connect to Spotify app
        AsyncFunction("connect") { (promise: Promise) in
            guard let appRemote = self.appRemote else {
                promise.reject("NOT_CONFIGURED", "SpotifyRemote not configured. Call configure() first.")
                return
            }
            
            if appRemote.isConnected {
                promise.resolve(["connected": true])
                return
            }
            
            self.pendingConnectionPromise = promise
            appRemote.connect()
        }
        
        // Disconnect from Spotify app
        AsyncFunction("disconnect") { (promise: Promise) in
            guard let appRemote = self.appRemote else {
                promise.resolve(["disconnected": true])
                return
            }
            
            if appRemote.isConnected {
                appRemote.disconnect()
            }
            promise.resolve(["disconnected": true])
        }
        
        // Check if connected
        Function("isConnected") { () -> Bool in
            return self.appRemote?.isConnected ?? false
        }
        
        // Resume playback
        AsyncFunction("resume") { (promise: Promise) in
            guard let playerAPI = self.appRemote?.playerAPI else {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify")
                return
            }
            
            playerAPI.resume { result, error in
                if let error = error {
                    promise.reject("PLAYBACK_ERROR", error.localizedDescription)
                } else {
                    promise.resolve(["success": true])
                }
            }
        }
        
        // Pause playback
        AsyncFunction("pause") { (promise: Promise) in
            guard let playerAPI = self.appRemote?.playerAPI else {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify")
                return
            }
            
            playerAPI.pause { result, error in
                if let error = error {
                    promise.reject("PLAYBACK_ERROR", error.localizedDescription)
                } else {
                    promise.resolve(["success": true])
                }
            }
        }
        
        // Skip to next track
        AsyncFunction("skipToNext") { (promise: Promise) in
            guard let playerAPI = self.appRemote?.playerAPI else {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify")
                return
            }
            
            playerAPI.skip(toNext: { result, error in
                if let error = error {
                    promise.reject("PLAYBACK_ERROR", error.localizedDescription)
                } else {
                    promise.resolve(["success": true])
                }
            })
        }
        
        // Skip to previous track
        AsyncFunction("skipToPrevious") { (promise: Promise) in
            guard let playerAPI = self.appRemote?.playerAPI else {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify")
                return
            }
            
            playerAPI.skip(toPrevious: { result, error in
                if let error = error {
                    promise.reject("PLAYBACK_ERROR", error.localizedDescription)
                } else {
                    promise.resolve(["success": true])
                }
            })
        }
        
        // Seek to position (in milliseconds)
        AsyncFunction("seekTo") { (positionMs: Int, promise: Promise) in
            guard let playerAPI = self.appRemote?.playerAPI else {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify")
                return
            }
            
            playerAPI.seek(toPosition: positionMs) { result, error in
                if let error = error {
                    promise.reject("PLAYBACK_ERROR", error.localizedDescription)
                } else {
                    promise.resolve(["success": true])
                }
            }
        }
        
        // Play a specific track, album, or playlist by URI
        AsyncFunction("play") { (uri: String, promise: Promise) in
            guard let playerAPI = self.appRemote?.playerAPI else {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify")
                return
            }
            
            playerAPI.play(uri) { result, error in
                if let error = error {
                    promise.reject("PLAYBACK_ERROR", error.localizedDescription)
                } else {
                    promise.resolve(["success": true])
                }
            }
        }
        
        // Enqueue a track (add to queue)
        AsyncFunction("enqueue") { (uri: String, promise: Promise) in
            guard let playerAPI = self.appRemote?.playerAPI else {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify")
                return
            }
            
            playerAPI.enqueueTrackUri(uri) { result, error in
                if let error = error {
                    promise.reject("PLAYBACK_ERROR", error.localizedDescription)
                } else {
                    promise.resolve(["success": true])
                }
            }
        }
        
        // Get current player state
        AsyncFunction("getPlayerState") { (promise: Promise) in
            guard let playerAPI = self.appRemote?.playerAPI else {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify")
                return
            }
            
            playerAPI.getPlayerState { result, error in
                if let error = error {
                    promise.reject("PLAYBACK_ERROR", error.localizedDescription)
                } else if let playerState = result as? SPTAppRemotePlayerState {
                    let state = self.playerStateToDict(playerState)
                    promise.resolve(state)
                } else {
                    promise.reject("UNKNOWN_ERROR", "Failed to get player state")
                }
            }
        }
        
        // Subscribe to player state changes
        AsyncFunction("subscribeToPlayerState") { (promise: Promise) in
            guard let playerAPI = self.appRemote?.playerAPI else {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify")
                return
            }
            
            playerAPI.delegate = self
            playerAPI.subscribe { result, error in
                if let error = error {
                    promise.reject("SUBSCRIPTION_ERROR", error.localizedDescription)
                } else {
                    self.playerStateSubscription = true
                    promise.resolve(["subscribed": true])
                }
            }
        }
        
        // Unsubscribe from player state changes
        AsyncFunction("unsubscribeFromPlayerState") { (promise: Promise) in
            guard let playerAPI = self.appRemote?.playerAPI else {
                promise.resolve(["unsubscribed": true])
                return
            }
            
            playerAPI.unsubscribe { result, error in
                self.playerStateSubscription = false
                promise.resolve(["unsubscribed": true])
            }
        }
        
        // Set shuffle mode
        AsyncFunction("setShuffle") { (enabled: Bool, promise: Promise) in
            guard let playerAPI = self.appRemote?.playerAPI else {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify")
                return
            }
            
            playerAPI.setShuffle(enabled) { result, error in
                if let error = error {
                    promise.reject("PLAYBACK_ERROR", error.localizedDescription)
                } else {
                    promise.resolve(["success": true])
                }
            }
        }
        
        // Set repeat mode: 0 = off, 1 = context, 2 = track
        AsyncFunction("setRepeatMode") { (mode: Int, promise: Promise) in
            guard let playerAPI = self.appRemote?.playerAPI else {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify")
                return
            }
            
            let repeatMode: SPTAppRemotePlaybackOptionsRepeatMode
            switch mode {
            case 1:
                repeatMode = .context
            case 2:
                repeatMode = .track
            default:
                repeatMode = .off
            }
            
            playerAPI.setRepeatMode(repeatMode) { result, error in
                if let error = error {
                    promise.reject("PLAYBACK_ERROR", error.localizedDescription)
                } else {
                    promise.resolve(["success": true])
                }
            }
        }
        
        // Handle app becoming active (for reconnection)
        OnAppEntersForeground {
            if self.appRemote?.isConnected == false {
                self.appRemote?.connect()
            }
        }
        
        // Handle app going to background
        OnAppEntersBackground {
            // Optionally disconnect when app goes to background
            // self.appRemote?.disconnect()
        }
    }
    
    // MARK: - Private Methods
    
    private func setupAppRemote() {
        guard !clientId.isEmpty, !redirectUri.isEmpty else { return }
        
        let configuration = SPTConfiguration(clientID: clientId, redirectURL: URL(string: redirectUri)!)
        appRemote = SPTAppRemote(configuration: configuration, logLevel: .debug)
        appRemote?.delegate = self
    }
    
    private func playerStateToDict(_ playerState: SPTAppRemotePlayerState) -> [String: Any] {
        return [
            "track": [
                "uri": playerState.track.uri,
                "name": playerState.track.name,
                "artist": playerState.track.artist.name,
                "album": playerState.track.album.name,
                "duration": playerState.track.duration,
                "imageUri": playerState.track.imageIdentifier
            ],
            "playbackPosition": playerState.playbackPosition,
            "playbackSpeed": playerState.playbackSpeed,
            "isPaused": playerState.isPaused,
            "playbackOptions": [
                "isShuffling": playerState.playbackOptions.isShuffling,
                "repeatMode": playerState.playbackOptions.repeatMode.rawValue
            ],
            "playbackRestrictions": [
                "canSkipNext": playerState.playbackRestrictions.canSkipNext,
                "canSkipPrevious": playerState.playbackRestrictions.canSkipPrevious,
                "canSeek": playerState.playbackRestrictions.canSeek,
                "canToggleShuffle": playerState.playbackRestrictions.canToggleShuffle,
                "canRepeatTrack": playerState.playbackRestrictions.canRepeatTrack,
                "canRepeatContext": playerState.playbackRestrictions.canRepeatContext
            ]
        ]
    }
}

// MARK: - SPTAppRemoteDelegate

extension SpotifyRemoteModule: SPTAppRemoteDelegate {
    public func appRemoteDidEstablishConnection(_ appRemote: SPTAppRemote) {
        sendEvent("onConnectionStatusChanged", [
            "connected": true,
            "status": "connected"
        ])
        
        pendingConnectionPromise?.resolve(["connected": true])
        pendingConnectionPromise = nil
    }
    
    public func appRemote(_ appRemote: SPTAppRemote, didFailConnectionAttemptWithError error: Error?) {
        sendEvent("onConnectionStatusChanged", [
            "connected": false,
            "status": "failed",
            "error": error?.localizedDescription ?? "Unknown error"
        ])
        
        pendingConnectionPromise?.reject("CONNECTION_FAILED", error?.localizedDescription ?? "Connection failed")
        pendingConnectionPromise = nil
    }
    
    public func appRemote(_ appRemote: SPTAppRemote, didDisconnectWithError error: Error?) {
        sendEvent("onConnectionStatusChanged", [
            "connected": false,
            "status": "disconnected",
            "error": error?.localizedDescription
        ])
    }
}

// MARK: - SPTAppRemotePlayerStateDelegate

extension SpotifyRemoteModule: SPTAppRemotePlayerStateDelegate {
    public func playerStateDidChange(_ playerState: SPTAppRemotePlayerState) {
        let state = playerStateToDict(playerState)
        sendEvent("onPlayerStateChanged", state)
    }
}
