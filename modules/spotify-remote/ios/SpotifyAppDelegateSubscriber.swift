import ExpoModulesCore
import SpotifyiOS

/**
 * App Delegate Subscriber for handling Spotify URL callbacks
 */
public class SpotifyAppDelegateSubscriber: ExpoAppDelegateSubscriber {
    public func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Handle Spotify auth callback URL
        if let sessionManager = getSessionManager() {
            if sessionManager.application(app, open: url, options: options) {
                return true
            }
        }
        
        // Handle Spotify App Remote callback
        if let appRemote = SpotifyManager.shared.appRemote {
            // Set access token from URL parameters if available
            if let parameters = appRemote.authorizationParameters(from: url) {
                if let accessToken = parameters[SPTAppRemoteAccessTokenKey] {
                    appRemote.connectionParameters.accessToken = accessToken
                    appRemote.connect()
                    return true
                } else if let errorDescription = parameters[SPTAppRemoteErrorDescriptionKey] {
                    print("[SpotifyRemote] Auth error: \(errorDescription)")
                    SpotifyManager.shared.pendingConnectionPromise?.reject("AUTH_ERROR", errorDescription)
                    SpotifyManager.shared.pendingConnectionPromise = nil
                    return true
                }
            }
        }
        
        return false
    }
    
    private func getSessionManager() -> SPTSessionManager? {
        // The session manager would be accessed from SpotifyAuthModule
        // This is a simplified approach - in production you'd use a shared manager
        return nil
    }
}
