import ExpoModulesCore

#if canImport(SpotifyiOS)
import SpotifyiOS
#endif

public class SpotifyRemoteModule: Module {
    #if canImport(SpotifyiOS)
    private var appRemote: SPTAppRemote?
    private var playerStateSubscription: Bool = false
    private var pendingConnectionPromise: Promise?
    
    private var clientId: String = ""
    private var redirectUri: String = ""
    #endif
    
    public func definition() -> ModuleDefinition {
        Name("SpotifyRemote")
        
        Events("onPlayerStateChanged", "onConnectionStatusChanged", "onError")
        
        Function("configure") { (clientId: String, redirectUri: String) in
            #if canImport(SpotifyiOS)
            self.clientId = clientId
            self.redirectUri = redirectUri
            self.setupAppRemote()
            #endif
        }
        
        AsyncFunction("connect") { (promise: Promise) in
            #if canImport(SpotifyiOS)
            guard let appRemote = self.appRemote else {
                promise.reject("NOT_CONFIGURED", "SpotifyRemote not configured")
                return
            }
            
            if appRemote.isConnected {
                promise.resolve(["connected": true])
                return
            }
            
            self.pendingConnectionPromise = promise
            appRemote.connect()
            #else
            promise.reject("NOT_AVAILABLE", "SpotifyiOS SDK not available")
            #endif
        }
        
        AsyncFunction("disconnect") { (promise: Promise) in
            #if canImport(SpotifyiOS)
            if let appRemote = self.appRemote, appRemote.isConnected {
                appRemote.disconnect()
            }
            #endif
            promise.resolve(["disconnected": true])
        }
        
        Function("isConnected") { () -> Bool in
            #if canImport(SpotifyiOS)
            return self.appRemote?.isConnected ?? false
            #else
            return false
            #endif
        }
        
        AsyncFunction("resume") { (promise: Promise) in
            #if canImport(SpotifyiOS)
            guard let playerAPI = self.appRemote?.playerAPI else {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify")
                return
            }
            
            playerAPI.resume { _, error in
                if let error = error {
                    promise.reject("PLAYBACK_ERROR", error.localizedDescription)
                } else {
                    promise.resolve(["success": true])
                }
            }
            #else
            promise.reject("NOT_AVAILABLE", "SpotifyiOS SDK not available")
            #endif
        }
        
        AsyncFunction("pause") { (promise: Promise) in
            #if canImport(SpotifyiOS)
            guard let playerAPI = self.appRemote?.playerAPI else {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify")
                return
            }
            
            playerAPI.pause { _, error in
                if let error = error {
                    promise.reject("PLAYBACK_ERROR", error.localizedDescription)
                } else {
                    promise.resolve(["success": true])
                }
            }
            #else
            promise.reject("NOT_AVAILABLE", "SpotifyiOS SDK not available")
            #endif
        }
        
        AsyncFunction("skipToNext") { (promise: Promise) in
            #if canImport(SpotifyiOS)
            guard let playerAPI = self.appRemote?.playerAPI else {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify")
                return
            }
            
            playerAPI.skip(toNext: { _, error in
                if let error = error {
                    promise.reject("PLAYBACK_ERROR", error.localizedDescription)
                } else {
                    promise.resolve(["success": true])
                }
            })
            #else
            promise.reject("NOT_AVAILABLE", "SpotifyiOS SDK not available")
            #endif
        }
        
        AsyncFunction("skipToPrevious") { (promise: Promise) in
            #if canImport(SpotifyiOS)
            guard let playerAPI = self.appRemote?.playerAPI else {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify")
                return
            }
            
            playerAPI.skip(toPrevious: { _, error in
                if let error = error {
                    promise.reject("PLAYBACK_ERROR", error.localizedDescription)
                } else {
                    promise.resolve(["success": true])
                }
            })
            #else
            promise.reject("NOT_AVAILABLE", "SpotifyiOS SDK not available")
            #endif
        }
        
        AsyncFunction("seekTo") { (positionMs: Int, promise: Promise) in
            #if canImport(SpotifyiOS)
            guard let playerAPI = self.appRemote?.playerAPI else {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify")
                return
            }
            
            playerAPI.seek(toPosition: positionMs) { _, error in
                if let error = error {
                    promise.reject("PLAYBACK_ERROR", error.localizedDescription)
                } else {
                    promise.resolve(["success": true])
                }
            }
            #else
            promise.reject("NOT_AVAILABLE", "SpotifyiOS SDK not available")
            #endif
        }
        
        AsyncFunction("play") { (uri: String, promise: Promise) in
            #if canImport(SpotifyiOS)
            guard let playerAPI = self.appRemote?.playerAPI else {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify")
                return
            }
            
            playerAPI.play(uri) { _, error in
                if let error = error {
                    promise.reject("PLAYBACK_ERROR", error.localizedDescription)
                } else {
                    promise.resolve(["success": true])
                }
            }
            #else
            promise.reject("NOT_AVAILABLE", "SpotifyiOS SDK not available")
            #endif
        }
        
        AsyncFunction("enqueue") { (uri: String, promise: Promise) in
            #if canImport(SpotifyiOS)
            guard let playerAPI = self.appRemote?.playerAPI else {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify")
                return
            }
            
            playerAPI.enqueueTrackUri(uri) { _, error in
                if let error = error {
                    promise.reject("PLAYBACK_ERROR", error.localizedDescription)
                } else {
                    promise.resolve(["success": true])
                }
            }
            #else
            promise.reject("NOT_AVAILABLE", "SpotifyiOS SDK not available")
            #endif
        }
        
        AsyncFunction("getPlayerState") { (promise: Promise) in
            #if canImport(SpotifyiOS)
            guard let playerAPI = self.appRemote?.playerAPI else {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify")
                return
            }
            
            playerAPI.getPlayerState { result, error in
                if let error = error {
                    promise.reject("PLAYBACK_ERROR", error.localizedDescription)
                } else if let playerState = result as? SPTAppRemotePlayerState {
                    promise.resolve(self.playerStateToDict(playerState))
                } else {
                    promise.reject("UNKNOWN_ERROR", "Failed to get player state")
                }
            }
            #else
            promise.reject("NOT_AVAILABLE", "SpotifyiOS SDK not available")
            #endif
        }
        
        AsyncFunction("subscribeToPlayerState") { (promise: Promise) in
            #if canImport(SpotifyiOS)
            guard let playerAPI = self.appRemote?.playerAPI else {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify")
                return
            }
            
            if self.playerStateSubscription {
                promise.resolve(["subscribed": true])
                return
            }
            
            playerAPI.delegate = self
            playerAPI.subscribe { _, error in
                if let error = error {
                    promise.reject("SUBSCRIPTION_ERROR", error.localizedDescription)
                } else {
                    self.playerStateSubscription = true
                    promise.resolve(["subscribed": true])
                }
            }
            #else
            promise.reject("NOT_AVAILABLE", "SpotifyiOS SDK not available")
            #endif
        }
        
        AsyncFunction("unsubscribeFromPlayerState") { (promise: Promise) in
            #if canImport(SpotifyiOS)
            self.playerStateSubscription = false
            #endif
            promise.resolve(["unsubscribed": true])
        }
        
        AsyncFunction("setShuffle") { (enabled: Bool, promise: Promise) in
            #if canImport(SpotifyiOS)
            guard let playerAPI = self.appRemote?.playerAPI else {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify")
                return
            }
            
            playerAPI.setShuffle(enabled) { _, error in
                if let error = error {
                    promise.reject("PLAYBACK_ERROR", error.localizedDescription)
                } else {
                    promise.resolve(["success": true])
                }
            }
            #else
            promise.reject("NOT_AVAILABLE", "SpotifyiOS SDK not available")
            #endif
        }
        
        AsyncFunction("setRepeatMode") { (mode: Int, promise: Promise) in
            #if canImport(SpotifyiOS)
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
            
            playerAPI.setRepeatMode(repeatMode) { _, error in
                if let error = error {
                    promise.reject("PLAYBACK_ERROR", error.localizedDescription)
                } else {
                    promise.resolve(["success": true])
                }
            }
            #else
            promise.reject("NOT_AVAILABLE", "SpotifyiOS SDK not available")
            #endif
        }
        
        OnAppEntersForeground {
            #if canImport(SpotifyiOS)
            if self.appRemote?.isConnected == false && !self.clientId.isEmpty {
                self.appRemote?.connect()
            }
            #endif
        }
    }
    
    #if canImport(SpotifyiOS)
    private func setupAppRemote() {
        guard !clientId.isEmpty, !redirectUri.isEmpty else { return }
        
        guard let redirectURL = URL(string: redirectUri) else { return }
        let configuration = SPTConfiguration(clientID: clientId, redirectURL: redirectURL)
        appRemote = SPTAppRemote(configuration: configuration, logLevel: .none)
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
    #endif
}

#if canImport(SpotifyiOS)
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
            "error": error?.localizedDescription as Any
        ])
    }
}

extension SpotifyRemoteModule: SPTAppRemotePlayerStateDelegate {
    public func playerStateDidChange(_ playerState: SPTAppRemotePlayerState) {
        let state = playerStateToDict(playerState)
        sendEvent("onPlayerStateChanged", state)
    }
}
#endif
