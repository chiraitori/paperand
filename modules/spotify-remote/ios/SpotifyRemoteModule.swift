import ExpoModulesCore
import SpotifyiOS

// Keys for storing access token
private let kAccessTokenKey = "spotify_remote_access_token"

/**
 * Shared Spotify manager singleton for iOS
 * Manages SPTAppRemote connection and delegates
 */
class SpotifyManager: NSObject {
    static let shared = SpotifyManager()
    
    var appRemote: SPTAppRemote?
    var pendingConnectionPromise: Promise?
    var playerStateSubscription: Bool = false
    var playURI: String = ""
    
    // Event emitter reference
    weak var remoteModule: SpotifyRemoteModule?
    
    // Auth module reference for callbacks
    weak var authModule: SpotifyAuthModule?
    
    // Store playerState for reference
    private var playerState: (any SPTAppRemotePlayerState)?
    
    // Access token with UserDefaults persistence
    var accessToken: String? {
        get {
            return UserDefaults.standard.string(forKey: kAccessTokenKey)
        }
        set {
            UserDefaults.standard.set(newValue, forKey: kAccessTokenKey)
        }
    }
    
    private override init() {
        super.init()
    }
    
    func configure(clientId: String, redirectUri: String) {
        guard let url = URL(string: redirectUri) else {
            print("[SpotifyRemote] Invalid redirect URI: \(redirectUri)")
            return
        }
        
        let configuration = SPTConfiguration(clientID: clientId, redirectURL: url)
        appRemote = SPTAppRemote(configuration: configuration, logLevel: .debug)
        appRemote?.connectionParameters.accessToken = accessToken
        appRemote?.delegate = self
        
        print("[SpotifyRemote] Configured with clientId: \(clientId)")
    }
    
    func clearAccessToken() {
        accessToken = nil
        print("[SpotifyRemote] Access token cleared")
    }
    
    var isConnected: Bool {
        return appRemote?.isConnected ?? false
    }
    
    /// Handle URL callback from Spotify app
    func handleOpenURL(_ url: URL) -> Bool {
        guard let appRemote = appRemote else { return false }
        
        let parameters = appRemote.authorizationParameters(from: url)
        
        if let token = parameters?[SPTAppRemoteAccessTokenKey] {
            appRemote.connectionParameters.accessToken = token
            accessToken = token
            
            // Notify auth module about successful authorization
            authModule?.onAuthorizationComplete(accessToken: token)
            
            appRemote.connect()
            return true
        } else if let errorDescription = parameters?[SPTAppRemoteErrorDescriptionKey] {
            print("[SpotifyRemote] Auth error: \(errorDescription)")
            
            // Notify auth module about failed authorization
            authModule?.onAuthorizationFailed(error: errorDescription)
            
            pendingConnectionPromise?.reject("AUTH_ERROR", errorDescription)
            pendingConnectionPromise = nil
            return true
        }
        
        return false
    }
    
    // Helper to convert player state to dictionary
    func playerStateToDict(_ state: any SPTAppRemotePlayerState) -> [String: Any] {
        let track = state.track
        return [
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
    }
}

// MARK: - SPTAppRemoteDelegate
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
    
    func appRemote(_ appRemote: SPTAppRemote, didFailConnectionAttemptWithError error: (any Error)?) {
        print("[SpotifyRemote] Connection failed: \(error?.localizedDescription ?? "Unknown error")")
        
        remoteModule?.sendEvent("onConnectionStatusChanged", [
            "connected": false,
            "status": "failed",
            "error": error?.localizedDescription ?? "Unknown error"
        ])
        
        pendingConnectionPromise?.reject("CONNECTION_FAILED", error?.localizedDescription ?? "Connection failed")
        pendingConnectionPromise = nil
    }
    
    func appRemote(_ appRemote: SPTAppRemote, didDisconnectWithError error: (any Error)?) {
        print("[SpotifyRemote] Disconnected: \(error?.localizedDescription ?? "No error")")
        
        remoteModule?.sendEvent("onConnectionStatusChanged", [
            "connected": false,
            "status": "disconnected",
            "error": error?.localizedDescription as Any
        ])
    }
}

// MARK: - SPTAppRemotePlayerStateDelegate
extension SpotifyManager: SPTAppRemotePlayerStateDelegate {
    func playerStateDidChange(_ playerState: SPTAppRemotePlayerState) {
        self.playerState = playerState
        
        guard playerStateSubscription else { return }
        
        let stateDict = playerStateToDict(playerState)
        remoteModule?.sendEvent("onPlayerStateChanged", stateDict)
    }
}

// MARK: - SpotifyRemoteModule
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
            self.manager.configure(clientId: clientId, redirectUri: redirectUri)
        }
        
        AsyncFunction("connect") { (promise: Promise) in
            guard let appRemote = self.manager.appRemote else {
                promise.reject("NOT_CONFIGURED", "SpotifyRemote not configured. Call configure() first.")
                return
            }
            
            if appRemote.isConnected {
                promise.resolve(["connected": true])
                return
            }
            
            self.manager.pendingConnectionPromise = promise
            
            // Check if Spotify is installed
            guard let spotifyURL = URL(string: "spotify:"),
                  UIApplication.shared.canOpenURL(spotifyURL) else {
                promise.reject("SPOTIFY_NOT_INSTALLED", "Spotify app is not installed on this device")
                self.manager.pendingConnectionPromise = nil
                return
            }
            
            // If we have an access token, try to connect directly
            if self.manager.accessToken != nil {
                appRemote.connect()
            } else {
                // Need to authorize first - this opens Spotify app
                appRemote.authorizeAndPlayURI(self.manager.playURI)
            }
        }
        
        AsyncFunction("disconnect") { (promise: Promise) in
            if let appRemote = self.manager.appRemote, appRemote.isConnected {
                appRemote.disconnect()
            }
            
            self.sendEvent("onConnectionStatusChanged", [
                "connected": false,
                "status": "disconnected"
            ])
            
            promise.resolve(["disconnected": true])
        }
        
        Function("isConnected") { () -> Bool in
            return self.manager.isConnected
        }
        
        AsyncFunction("resume") { (promise: Promise) in
            guard let appRemote = self.manager.appRemote, appRemote.isConnected else {
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
            guard let appRemote = self.manager.appRemote, appRemote.isConnected else {
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
            guard let appRemote = self.manager.appRemote, appRemote.isConnected else {
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
            guard let appRemote = self.manager.appRemote, appRemote.isConnected else {
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
            guard let appRemote = self.manager.appRemote, appRemote.isConnected else {
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
            guard let appRemote = self.manager.appRemote, appRemote.isConnected else {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify")
                return
            }
            
            appRemote.playerAPI?.play(uri, callback: { _, error in
                if let error = error {
                    promise.reject("PLAYBACK_ERROR", error.localizedDescription)
                } else {
                    promise.resolve(["success": true])
                }
            })
        }
        
        AsyncFunction("enqueue") { (uri: String, promise: Promise) in
            guard let appRemote = self.manager.appRemote, appRemote.isConnected else {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify")
                return
            }
            
            appRemote.playerAPI?.enqueueTrackUri(uri, callback: { _, error in
                if let error = error {
                    promise.reject("PLAYBACK_ERROR", error.localizedDescription)
                } else {
                    promise.resolve(["success": true])
                }
            })
        }
        
        AsyncFunction("getPlayerState") { (promise: Promise) in
            guard let appRemote = self.manager.appRemote, appRemote.isConnected else {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify")
                return
            }
            
            appRemote.playerAPI?.getPlayerState { result, error in
                if let error = error {
                    promise.reject("PLAYBACK_ERROR", error.localizedDescription)
                    return
                }
                
                guard let state = result as? any SPTAppRemotePlayerState else {
                    promise.reject("PLAYBACK_ERROR", "Failed to get player state")
                    return
                }
                
                let stateDict = self.manager.playerStateToDict(state)
                promise.resolve(stateDict)
            }
        }
        
        AsyncFunction("subscribeToPlayerState") { (promise: Promise) in
            guard let appRemote = self.manager.appRemote, appRemote.isConnected else {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify")
                return
            }
            
            appRemote.playerAPI?.delegate = self.manager
            appRemote.playerAPI?.subscribe(toPlayerState: { _, error in
                if let error = error {
                    promise.reject("SUBSCRIPTION_ERROR", error.localizedDescription)
                } else {
                    SpotifyManager.shared.playerStateSubscription = true
                    promise.resolve(["subscribed": true])
                }
            })
        }
        
        AsyncFunction("unsubscribeFromPlayerState") { (promise: Promise) in
            SpotifyManager.shared.playerStateSubscription = false
            
            if let appRemote = self.manager.appRemote, appRemote.isConnected {
                appRemote.playerAPI?.unsubscribe(toPlayerState: { _, _ in })
            }
            
            promise.resolve(["unsubscribed": true])
        }
        
        AsyncFunction("setShuffle") { (enabled: Bool, promise: Promise) in
            guard let appRemote = self.manager.appRemote, appRemote.isConnected else {
                promise.reject("NOT_CONNECTED", "Not connected to Spotify")
                return
            }
            
            appRemote.playerAPI?.setShuffle(enabled, callback: { _, error in
                if let error = error {
                    promise.reject("PLAYBACK_ERROR", error.localizedDescription)
                } else {
                    promise.resolve(["success": true])
                }
            })
        }
        
        AsyncFunction("setRepeatMode") { (mode: Int, promise: Promise) in
            guard let appRemote = self.manager.appRemote, appRemote.isConnected else {
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
            
            appRemote.playerAPI?.setRepeatMode(repeatMode, callback: { _, error in
                if let error = error {
                    promise.reject("PLAYBACK_ERROR", error.localizedDescription)
                } else {
                    promise.resolve(["success": true])
                }
            })
        }
    }
}
