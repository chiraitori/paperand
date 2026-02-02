import ExpoModulesCore
import SpotifyiOS

/**
 * App Delegate Subscriber for handling Spotify URL callbacks and app lifecycle
 * Based on Spotify iOS SDK demo patterns
 */
public class SpotifyAppDelegateSubscriber: ExpoAppDelegateSubscriber {
    
    // Handle URL callback from Spotify app after authorization
    public func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return SpotifyManager.shared.handleOpenURL(url)
    }
    
    // Reconnect to Spotify when app becomes active
    public func applicationDidBecomeActive(_ application: UIApplication) {
        if let appRemote = SpotifyManager.shared.appRemote,
           SpotifyManager.shared.accessToken != nil,
           !appRemote.isConnected {
            appRemote.connect()
        }
    }
    
    // Disconnect from Spotify when app resigns active
    public func applicationWillResignActive(_ application: UIApplication) {
        if let appRemote = SpotifyManager.shared.appRemote,
           appRemote.isConnected {
            appRemote.disconnect()
        }
    }
}
