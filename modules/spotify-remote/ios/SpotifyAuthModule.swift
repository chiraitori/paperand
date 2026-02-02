import ExpoModulesCore
import SpotifyiOS

// Keys for storing tokens
private let kSpotifyAuthAccessToken = "spotify_auth_access_token"
private let kSpotifyAuthTokenExpiry = "spotify_auth_token_expiry"

/**
 * Expo module for Spotify Authentication on iOS
 * Works together with SpotifyRemoteModule for token management
 */
public class SpotifyAuthModule: Module {
    // UserDefaults for token storage
    private var defaults: UserDefaults {
        return UserDefaults.standard
    }
    
    // Get stored access token
    private var storedAccessToken: String? {
        return defaults.string(forKey: kSpotifyAuthAccessToken)
    }
    
    // Get stored token expiry date
    private var storedTokenExpiry: Date? {
        let timestamp = defaults.double(forKey: kSpotifyAuthTokenExpiry)
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
        defaults.set(accessToken, forKey: kSpotifyAuthAccessToken)
        let expiryDate = Date().addingTimeInterval(TimeInterval(expiresIn))
        defaults.set(expiryDate.timeIntervalSince1970, forKey: kSpotifyAuthTokenExpiry)
        print("[SpotifyAuth] Token saved, expires at \(expiryDate)")
    }
    
    // Clear stored token
    private func clearToken() {
        defaults.removeObject(forKey: kSpotifyAuthAccessToken)
        defaults.removeObject(forKey: kSpotifyAuthTokenExpiry)
        print("[SpotifyAuth] Token cleared")
    }
    
    public func definition() -> ModuleDefinition {
        Name("SpotifyAuth")
        
        // Configure the module with Spotify credentials
        Function("configure") { (clientId: String, redirectUri: String) in
            // Configuration is handled by SpotifyRemoteModule
            print("[SpotifyAuth] Configured")
        }
        
        // Authorize with Spotify - uses stored token if valid
        AsyncFunction("authorize") { (scopes: [String], promise: Promise) in
            // Check if we have a valid stored token - return it immediately!
            if self.hasValidStoredToken, let token = self.storedAccessToken, let expiry = self.storedTokenExpiry {
                print("[SpotifyAuth] Using stored token")
                let expiresIn = Int(expiry.timeIntervalSinceNow)
                promise.resolve([
                    "accessToken": token,
                    "expiresIn": expiresIn
                ])
                return
            }
            
            // Check if SpotifyManager has an access token from Remote connection
            if let token = SpotifyManager.shared.accessToken {
                // Token from App Remote - save it with 1 hour expiry (tokens typically last 1 hour)
                let expiresIn = 3600
                self.saveToken(accessToken: token, expiresIn: expiresIn)
                promise.resolve([
                    "accessToken": token,
                    "expiresIn": expiresIn
                ])
                return
            }
            
            // No stored token - need to connect via SpotifyRemote first
            promise.reject("NOT_AUTHORIZED", "Not authorized. Call SpotifyRemote.connect() first to authorize.")
        }
        
        // Check if we have a valid session (stored token)
        Function("isAuthorized") { () -> Bool in
            return self.hasValidStoredToken || SpotifyManager.shared.accessToken != nil
        }
        
        // Get stored access token (if valid)
        Function("getAccessToken") { () -> String? in
            if self.hasValidStoredToken {
                return self.storedAccessToken
            }
            return SpotifyManager.shared.accessToken
        }
        
        // Logout - clear stored token
        Function("logout") { () in
            self.clearToken()
            SpotifyManager.shared.clearAccessToken()
        }
    }
}
