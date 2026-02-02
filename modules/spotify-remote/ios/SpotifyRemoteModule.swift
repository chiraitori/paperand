import ExpoModulesCore

public class SpotifyRemoteModule: Module {
    public func definition() -> ModuleDefinition {
        Name("SpotifyRemote")
        
        Events("onPlayerStateChanged", "onConnectionStatusChanged", "onError")
        
        Function("configure") { (clientId: String, redirectUri: String) in
            // iOS Spotify SDK not configured yet
        }
        
        AsyncFunction("connect") { (promise: Promise) in
            promise.reject("NOT_AVAILABLE", "Spotify Remote not available on iOS yet")
        }
        
        AsyncFunction("disconnect") { (promise: Promise) in
            promise.resolve(["disconnected": true])
        }
        
        Function("isConnected") { () -> Bool in
            return false
        }
        
        AsyncFunction("resume") { (promise: Promise) in
            promise.reject("NOT_AVAILABLE", "Spotify Remote not available on iOS yet")
        }
        
        AsyncFunction("pause") { (promise: Promise) in
            promise.reject("NOT_AVAILABLE", "Spotify Remote not available on iOS yet")
        }
        
        AsyncFunction("skipToNext") { (promise: Promise) in
            promise.reject("NOT_AVAILABLE", "Spotify Remote not available on iOS yet")
        }
        
        AsyncFunction("skipToPrevious") { (promise: Promise) in
            promise.reject("NOT_AVAILABLE", "Spotify Remote not available on iOS yet")
        }
        
        AsyncFunction("seekTo") { (positionMs: Int, promise: Promise) in
            promise.reject("NOT_AVAILABLE", "Spotify Remote not available on iOS yet")
        }
        
        AsyncFunction("play") { (uri: String, promise: Promise) in
            promise.reject("NOT_AVAILABLE", "Spotify Remote not available on iOS yet")
        }
        
        AsyncFunction("enqueue") { (uri: String, promise: Promise) in
            promise.reject("NOT_AVAILABLE", "Spotify Remote not available on iOS yet")
        }
        
        AsyncFunction("getPlayerState") { (promise: Promise) in
            promise.reject("NOT_AVAILABLE", "Spotify Remote not available on iOS yet")
        }
        
        AsyncFunction("subscribeToPlayerState") { (promise: Promise) in
            promise.reject("NOT_AVAILABLE", "Spotify Remote not available on iOS yet")
        }
        
        AsyncFunction("unsubscribeFromPlayerState") { (promise: Promise) in
            promise.resolve(["unsubscribed": true])
        }
        
        AsyncFunction("setShuffle") { (enabled: Bool, promise: Promise) in
            promise.reject("NOT_AVAILABLE", "Spotify Remote not available on iOS yet")
        }
        
        AsyncFunction("setRepeatMode") { (mode: Int, promise: Promise) in
            promise.reject("NOT_AVAILABLE", "Spotify Remote not available on iOS yet")
        }
    }
}
