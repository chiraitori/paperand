import ExpoModulesCore
import SpotifyiOS

/// Shared Spotify manager for iOS
class SpotifyManager: NSObject {
    static let shared = SpotifyManager()
    
    var appRemote: SPTAppRemote?
    var configuration: SPTConfiguration?
    var pendingConnectionPromise: Promise?
    var playerStateSubscription: Bool = false
    
    // Event emitter reference
    weak var remoteModule: SpotifyRemoteModule?
    
    private override init() {
        super.init()
    }
    
    func configure(clientId: String, redirectUri: String) {
        configuration = SPTConfiguration(clientID: clientId, redirectURL: URL(string: redirectUri)!)
        appRemote = SPTAppRemote(configuration: configuration!, logLevel: .debug)
        appRemote?.delegate = self
    }
    
    var isConnected: Bool {
        return appRemote?.isConnected ?? false
    }
}

extension SpotifyManager: SPTAppRemoteDelegate {
    func appRemoteDidEstablishConnection(_ appRemote: SPTAppRemote) {
        print("[SpotifyRemote] Connected to Spotify!")
        
        remoteModule?.sendEvent("onConnectionStatusChanged", [
            "connected": true,
            "status": "connected"
        ])
        
        pendingConnectionPromise?.resolve(["connected": true])
        pendingConnectionPromise = nil
    }
    
    func appRemote(_ appRemote: SPTAppRemote, didFailConnectionAttemptWithError error: Error?) {
        print("[SpotifyRemote] Connection failed: \(error?.localizedDescription ?? "Unknown error")")
        
        remoteModule?.sendEvent("onConnectionStatusChanged", [
            "connected": false,
            "status": "failed",
            "error": error?.localizedDescription ?? "Unknown error"
        ])
        
        pendingConnectionPromise?.reject("CONNECTION_FAILED", error?.localizedDescription ?? "Connection failed")
        pendingConnectionPromise = nil
    }
    
    func appRemote(_ appRemote: SPTAppRemote, didDisconnectWithError error: Error?) {
        print("[SpotifyRemote] Disconnected: \(error?.localizedDescription ?? "No error")")
        
        remoteModule?.sendEvent("onConnectionStatusChanged", [
            "connected": false,
            "status": "disconnected",
            "error": error?.localizedDescription as Any
        ])
    }
}

extension SpotifyManager: SPTAppRemotePlayerStateDelegate {
    func playerStateDidChange(_ playerState: SPTAppRemotePlayerState) {
        guard playerStateSubscription else { return }
        
        let track = playerState.track
        let stateDict: [String: Any] = [
            "track": [
                "uri": track.uri,
                "name": track.name,
                "artist": track.artist.name,
                "album": track.album.name,
                "duration": track.duration,
                "imageUri": track.imageIdentifier ?? ""
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
        
        remoteModule?.sendEvent("onPlayerStateChanged", stateDict)
    }
}

public class SpotifyRemoteModule: Module {
    private var manager: SpotifyManager {
        return SpotifyManager.shared
    }
    
    public func definition() -> ModuleDefinition {
        Name("SpotifyRemote")
        
        Events("onPlayerStateChanged", "onConnectionStatusChanged", "onError")
        
        OnCreate {
            SpotifyManager.shared.remoteModule = self
        }
        
        Function("configure") { (clientId: String, redirectUri: String) in
            manager.configure(clientId: clientId, redirectUri: redirectUri)
        }
        
        AsyncFunction("connect") { (promise: Promise) in
            guard let appRemote = manager.appRemote else {
                promise.reject("NOT_CONFIGURED", "SpotifyRemote not configured. Call configure() first.")
                return
            }
            
            if appRemote.isConnected {
                promise.resolve(["connected": true])
                return
            }
            
            manager.pendingConnectionPromise = promise
            
            // Check if Spotify is installed
            guard let spotifyURL = URL(string: "spotify:"),
                  UIApplication.shared.canOpenURL(spotifyURL) else {
                promise.reject("SPOTIFY_NOT_INSTALLED", "Spotify app is not installed on this device")
                manager.pendingConnectionPromise = nil
                return
            }
            
            // Authorize and connect
            appRemote.authorizeAndPlayURI("")
        }
        
        AsyncFunction("disconnect") { (promise: Promise) in
            if let appRemote = manager.appRemote, appRemote.isConnected {
                appRemote.disconnect()
            }
            
            self.sendEvent("onConnectionStatusChanged", [
                "connected": false,
                "status": "disconnected"
            ])
            
            promise.resolve(["disconnected": true])
        }
        
        Function("isConnected") { () -> Bool in
            return manager.isConnected
        }
        
        AsyncFunction("resume") { (promise: Promise) in
            guard let appRemote = manager.appRemote, appRemote.isConnected else {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify")
                return
            }
            
            appRemote.playerAPI?.resume { _, error in
                if let error = error {
                    promise.reject("PLAYBACK_ERROR", error.localizedDescription)
                } else {
                    promise.resolve(["success": true])
                }
            }
        }
        
        AsyncFunction("pause") { (promise: Promise) in
            guard let appRemote = manager.appRemote, appRemote.isConnected else {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify")
                return
            }
            
            appRemote.playerAPI?.pause { _, error in
                if let error = error {
                    promise.reject("PLAYBACK_ERROR", error.localizedDescription)
                } else {
                    promise.resolve(["success": true])
                }
            }
        }
        
        AsyncFunction("skipToNext") { (promise: Promise) in
            guard let appRemote = manager.appRemote, appRemote.isConnected else {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify")
                return
            }
            
            appRemote.playerAPI?.skip(toNext: { _, error in
                if let error = error {
                    promise.reject("PLAYBACK_ERROR", error.localizedDescription)
                } else {
                    promise.resolve(["success": true])
                }
            })
        }
        
        AsyncFunction("skipToPrevious") { (promise: Promise) in
            guard let appRemote = manager.appRemote, appRemote.isConnected else {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify")
                return
            }
            
            appRemote.playerAPI?.skip(toPrevious: { _, error in
                if let error = error {
                    promise.reject("PLAYBACK_ERROR", error.localizedDescription)
                } else {
                    promise.resolve(["success": true])
                }
            })
        }
        
        AsyncFunction("seekTo") { (positionMs: Int, promise: Promise) in
            guard let appRemote = manager.appRemote, appRemote.isConnected else {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify")
                return
            }
            
            appRemote.playerAPI?.seek(toPosition: positionMs) { _, error in
                if let error = error {
                    promise.reject("PLAYBACK_ERROR", error.localizedDescription)
                } else {
                    promise.resolve(["success": true])
                }
            }
        }
        
        AsyncFunction("play") { (uri: String, promise: Promise) in
            guard let appRemote = manager.appRemote, appRemote.isConnected else {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify")
                return
            }
            
            appRemote.playerAPI?.play(uri) { _, error in
                if let error = error {
                    promise.reject("PLAYBACK_ERROR", error.localizedDescription)
                } else {
                    promise.resolve(["success": true])
                }
            }
        }
        
        AsyncFunction("enqueue") { (uri: String, promise: Promise) in
            guard let appRemote = manager.appRemote, appRemote.isConnected else {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify")
                return
            }
            
            appRemote.playerAPI?.enqueueTrackUri(uri) { _, error in
                if let error = error {
                    promise.reject("PLAYBACK_ERROR", error.localizedDescription)
                } else {
                    promise.resolve(["success": true])
                }
            }
        }
        
        AsyncFunction("getPlayerState") { (promise: Promise) in
            guard let appRemote = manager.appRemote, appRemote.isConnected else {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify")
                return
            }
            
            appRemote.playerAPI?.getPlayerState { playerState, error in
                if let error = error {
                    promise.reject("PLAYBACK_ERROR", error.localizedDescription)
                    return
                }
                
                guard let state = playerState else {
                    promise.reject("PLAYBACK_ERROR", "Failed to get player state")
                    return
                }
                
                let track = state.track
                let stateDict: [String: Any] = [
                    "track": [
                        "uri": track.uri,
                        "name": track.name,
                        "artist": track.artist.name,
                        "album": track.album.name,
                        "duration": track.duration,
                        "imageUri": track.imageIdentifier ?? ""
                    ],
                    "playbackPosition": state.playbackPosition,
                    "playbackSpeed": state.playbackSpeed,
                    "isPaused": state.isPaused,
                    "playbackOptions": [
                        "isShuffling": state.playbackOptions.isShuffling,
                        "repeatMode": state.playbackOptions.repeatMode.rawValue
                    ],
                    "playbackRestrictions": [
                        "canSkipNext": state.playbackRestrictions.canSkipNext,
                        "canSkipPrevious": state.playbackRestrictions.canSkipPrevious,
                        "canSeek": state.playbackRestrictions.canSeek,
                        "canToggleShuffle": state.playbackRestrictions.canToggleShuffle,
                        "canRepeatTrack": state.playbackRestrictions.canRepeatTrack,
                        "canRepeatContext": state.playbackRestrictions.canRepeatContext
                    ]
                ]
                
                promise.resolve(stateDict)
            }
        }
        
        AsyncFunction("subscribeToPlayerState") { (promise: Promise) in
            guard let appRemote = manager.appRemote, appRemote.isConnected else {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify")
                return
            }
            
            appRemote.playerAPI?.delegate = manager
            appRemote.playerAPI?.subscribe { _, error in
                if let error = error {
                    promise.reject("SUBSCRIPTION_ERROR", error.localizedDescription)
                } else {
                    SpotifyManager.shared.playerStateSubscription = true
                    promise.resolve(["subscribed": true])
                }
            }
        }
        
        AsyncFunction("unsubscribeFromPlayerState") { (promise: Promise) in
            SpotifyManager.shared.playerStateSubscription = false
            
            if let appRemote = manager.appRemote, appRemote.isConnected {
                appRemote.playerAPI?.unsubscribe { _, _ in }
            }
            
            promise.resolve(["unsubscribed": true])
        }
        
        AsyncFunction("setShuffle") { (enabled: Bool, promise: Promise) in
            guard let appRemote = manager.appRemote, appRemote.isConnected else {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify")
                return
            }
            
            appRemote.playerAPI?.setShuffle(enabled) { _, error in
                if let error = error {
                    promise.reject("PLAYBACK_ERROR", error.localizedDescription)
                } else {
                    promise.resolve(["success": true])
                }
            }
        }
        
        AsyncFunction("setRepeatMode") { (mode: Int, promise: Promise) in
            guard let appRemote = manager.appRemote, appRemote.isConnected else {
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
            
            appRemote.playerAPI?.setRepeatMode(repeatMode) { _, error in
                if let error = error {
                    promise.reject("PLAYBACK_ERROR", error.localizedDescription)
                } else {
                    promise.resolve(["success": true])
                }
            }
        }
    }
}
