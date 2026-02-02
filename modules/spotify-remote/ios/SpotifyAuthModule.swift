import ExpoModulesCore
import SpotifyiOS

// Keys for storing tokens
private let kSpotifyAccessToken = "spotify_access_token"
private let kSpotifyTokenExpiry = "spotify_token_expiry"

/**
 * Expo module for Spotify Authentication on iOS
 * Handles OAuth flow to get access tokens for Spotify API
 * Persists tokens so user only needs to authorize once
 */
public class SpotifyAuthModule: Module {
    private var sessionManager: SPTSessionManager?
    private var pendingAuthPromise: Promise?
    private var configuration: SPTConfiguration?
    
    // UserDefaults for token storage
    private var defaults: UserDefaults {
        return UserDefaults.standard
    }
    
    // Get stored access token
    private var storedAccessToken: String? {
        return defaults.string(forKey: kSpotifyAccessToken)
    }
    
    // Get stored token expiry date
    private var storedTokenExpiry: Date? {
        let timestamp = defaults.double(forKey: kSpotifyTokenExpiry)
        return timestamp > 0 ? Date(timeIntervalSince1970: timestamp) : nil
    }
    
    // Check if stored token is valid (exists and not expired)
    private var hasValidStoredToken: Bool {
        guard let token = storedAccessToken, !token.isEmpty,
              let expiry = storedTokenExpiry else {
            return false
        }
        // Token is valid if it expires more than 5 minutes from now
        return expiry.timeIntervalSinceNow > 300
    }
    
    // Save token to storage
    private func saveToken(accessToken: String, expiresIn: Int) {
        defaults.set(accessToken, forKey: kSpotifyAccessToken)
        let expiryDate = Date().addingTimeInterval(TimeInterval(expiresIn))
        defaults.set(expiryDate.timeIntervalSince1970, forKey: kSpotifyTokenExpiry)
        defaults.synchronize()
        print("[SpotifyAuth] Token saved, expires at \(expiryDate)")
    }
    
    // Clear stored token
    private func clearToken() {
        defaults.removeObject(forKey: kSpotifyAccessToken)
        defaults.removeObject(forKey: kSpotifyTokenExpiry)
        defaults.synchronize()
        print("[SpotifyAuth] Token cleared")
    }
    
    public func definition() -> ModuleDefinition {
        Name("SpotifyAuth")
        
        // Configure the module with Spotify credentials
        Function("configure") { (clientId: String, redirectUri: String) in
            guard let url = URL(string: redirectUri) else {
                print("[SpotifyAuth] Invalid redirect URI: \(redirectUri)")
                return
            }
            
            self.configuration = SPTConfiguration(clientID: clientId, redirectURL: url)
            self.sessionManager = SPTSessionManager(configuration: self.configuration!, delegate: self)
        }
        
        // Authorize with Spotify - uses stored token if valid, otherwise opens auth flow
        AsyncFunction("authorize") { (scopes: [String], promise: Promise) in
            // Check if we have a valid stored token - return it immediately!
            if self.hasValidStoredToken, let token = self.storedAccessToken, let expiry = self.storedTokenExpiry {
                print("[SpotifyAuth] Using stored token (đang ủy quyền...)")
                let expiresIn = Int(expiry.timeIntervalSinceNow)
                promise.resolve([
                    "accessToken": token,
                    "expiresIn": expiresIn
                ])
                return
            }
            
            guard let sessionManager = self.sessionManager else {
                promise.reject("NOT_CONFIGURED", "SpotifyAuth not configured. Call configure() first.")
                return
            }
            
            // Check if Spotify is installed
            guard let spotifyURL = URL(string: "spotify:"),
                  UIApplication.shared.canOpenURL(spotifyURL) else {
                promise.reject("SPOTIFY_NOT_INSTALLED", "Spotify app is not installed on this device")
                return
            }
            
            self.pendingAuthPromise = promise
            
            // Convert string scopes to SPTScope
            var sptScope: SPTScope = []
            for scope in scopes {
                switch scope {
                case "streaming":
                    sptScope.insert(.streaming)
                case "user-read-playback-state":
                    sptScope.insert(.userReadPlaybackState)
                case "user-modify-playback-state":
                    sptScope.insert(.userModifyPlaybackState)
                case "user-read-currently-playing":
                    sptScope.insert(.userReadCurrentlyPlaying)
                case "user-read-email":
                    sptScope.insert(.userReadEmail)
                case "user-read-private":
                    sptScope.insert(.userReadPrivate)
                case "playlist-read-private":
                    sptScope.insert(.playlistReadPrivate)
                case "playlist-read-collaborative":
                    sptScope.insert(.playlistReadCollaborative)
                case "playlist-modify-public":
                    sptScope.insert(.playlistModifyPublic)
                case "playlist-modify-private":
                    sptScope.insert(.playlistModifyPrivate)
                case "user-library-read":
                    sptScope.insert(.userLibraryRead)
                case "user-library-modify":
                    sptScope.insert(.userLibraryModify)
                case "user-top-read":
                    sptScope.insert(.userTopRead)
                case "user-follow-read":
                    sptScope.insert(.userFollowRead)
                case "user-follow-modify":
                    sptScope.insert(.userFollowModify)
                default:
                    print("[SpotifyAuth] Unknown scope: \(scope)")
                }
            }
            
            // Initiate the auth flow - opens Spotify app
            DispatchQueue.main.async {
                sessionManager.initiateSession(with: sptScope, options: .default, campaign: nil)
            }
        }
        
        // Check if we have a valid session (stored token)
        Function("isAuthorized") { () -> Bool in
            return self.hasValidStoredToken
        }
        
        // Get stored access token (if valid)
        Function("getAccessToken") { () -> String? in
            if self.hasValidStoredToken {
                return self.storedAccessToken
            }
            return nil
        }
        
        // Logout - clear stored token
        Function("logout") { () in
            self.clearToken()
        }
        
        // Handle URL callback from Spotify app
        OnAppEnterForeground {
            // Handle app coming back from Spotify auth
        }
    }
}

extension SpotifyAuthModule: SPTSessionManagerDelegate {
    public func sessionManager(manager: SPTSessionManager, didInitiate session: SPTSession) {
        print("[SpotifyAuth] Auth successful, token received")
        
        let expiresIn = Int(session.expirationDate.timeIntervalSinceNow)
        
        // Save token for future use!
        saveToken(accessToken: session.accessToken, expiresIn: expiresIn)
        
        pendingAuthPromise?.resolve([
            "accessToken": session.accessToken,
            "expiresIn": expiresIn
        ])
        pendingAuthPromise = nil
    }
    
    public func sessionManager(manager: SPTSessionManager, didFailWith error: Error) {
        print("[SpotifyAuth] Auth error: \(error.localizedDescription)")
        
        pendingAuthPromise?.reject("AUTH_ERROR", error.localizedDescription)
        pendingAuthPromise = nil
    }
    
    public func sessionManager(manager: SPTSessionManager, didRenew session: SPTSession) {
        print("[SpotifyAuth] Session renewed")
        
        // Save renewed token
        let expiresIn = Int(session.expirationDate.timeIntervalSinceNow)
        saveToken(accessToken: session.accessToken, expiresIn: expiresIn)
    }
}
