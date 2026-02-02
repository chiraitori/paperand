import ExpoModulesCore

/**
 * App Delegate Subscriber for handling Spotify URL callbacks
 * This is called when Spotify app redirects back to our app after authorization
 */
public class SpotifyAppDelegateSubscriber: ExpoAppDelegateSubscriber {
    
    public func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Let SpotifyManager handle the URL
        return SpotifyManager.shared.handleOpenURL(url)
    }
    
    public func applicationDidBecomeActive(_ application: UIApplication) {
        // Reconnect to Spotify when app becomes active
        if let appRemote = SpotifyManager.shared.appRemote,
           SpotifyManager.shared.accessToken != nil,
           !appRemote.isConnected {
            appRemote.connect()
        }
    }
    
    public func applicationWillResignActive(_ application: UIApplication) {
        // Disconnect from Spotify when app resigns active
        if let appRemote = SpotifyManager.shared.appRemote,
           appRemote.isConnected {
            appRemote.disconnect()
        }
    }
}
