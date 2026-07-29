/**
 * Expo Config Plugin for Spotify SDK
 * 
 * Configures the native projects for Spotify SDK integration:
 * - Configures Android manifest for Spotify app queries
 * - Packages the Spotify App Remote AAR in the Android application
 * - Adds required permissions
 */

const { withAndroidManifest, withInfoPlist, withDangerousMod, withAppBuildGradle } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Add Spotify SDK configuration to Android manifest
 */
const withSpotifyAndroid = (config, { clientId, redirectScheme }) => {
    return withAndroidManifest(config, async (config) => {
        const manifest = config.modResults.manifest;

        // Add queries for Spotify app
        if (!manifest.queries) {
            manifest.queries = [];
        }

        // Add Spotify app query to check if Spotify is installed
        const spotifyQuery = {
            package: [{ $: { 'android:name': 'com.spotify.music' } }],
        };

        // Check if already exists
        const hasSpotifyQuery = manifest.queries.some(
            (q) => q.package?.some((p) => p.$?.['android:name'] === 'com.spotify.music')
        );

        if (!hasSpotifyQuery) {
            manifest.queries.push(spotifyQuery);
        }

        return config;
    });
};

/**
 * Add Spotify SDK configuration to iOS Info.plist
 */
const withSpotifyIOS = (config, { clientId, redirectScheme }) => {
    return withInfoPlist(config, (config) => {
        // Add URL scheme for Spotify auth callback
        if (redirectScheme) {
            const urlTypes = config.modResults.CFBundleURLTypes || [];

            // Check if scheme already exists
            const hasScheme = urlTypes.some(
                (type) => type.CFBundleURLSchemes?.includes(redirectScheme)
            );

            if (!hasScheme) {
                urlTypes.push({
                    CFBundleURLName: 'spotify-auth',
                    CFBundleURLSchemes: [redirectScheme],
                });
            }

            config.modResults.CFBundleURLTypes = urlTypes;
        }

        // Add Spotify app to LSApplicationQueriesSchemes
        const querySchemes = config.modResults.LSApplicationQueriesSchemes || [];

        if (!querySchemes.includes('spotify')) {
            querySchemes.push('spotify');
        }

        config.modResults.LSApplicationQueriesSchemes = querySchemes;

        return config;
    });
};

/**
 * Add manifest placeholders for Spotify Auth SDK to app build.gradle
 */
const withSpotifyBuildGradle = (config, { redirectScheme }) => {
    return withAppBuildGradle(config, (config) => {
        if (config.modResults.language === 'groovy') {
            let buildGradle = config.modResults.contents;

            // Check if manifest placeholders already exist
            if (!buildGradle.includes('redirectSchemeName')) {
                // Find defaultConfig block and add manifest placeholders
                const defaultConfigRegex = /(defaultConfig\s*\{[^}]*)(buildConfigField[^\n]*\n)/;
                const replacement = `$1$2
        // Spotify Auth SDK manifest placeholders
        manifestPlaceholders = [
            redirectSchemeName: "${redirectScheme}",
            redirectHostName: "callback"
        ]
`;
                buildGradle = buildGradle.replace(defaultConfigRegex, replacement);
            }

            // The native Expo module compiles against App Remote with compileOnly.
            // Package the local AAR at the application level so its classes are
            // present in the final APK without trying to embed an AAR inside an AAR.
            const appRemoteAar = '../../modules/spotify-remote/android/libs/spotify-app-remote-release-0.8.0.aar';
            if (!buildGradle.includes(appRemoteAar)) {
                buildGradle = buildGradle.replace(
                    /dependencies\s*\{/,
                    `dependencies {
    // Spotify App Remote runtime (the native module uses compileOnly)
    implementation files("${appRemoteAar}")`
                );
            }

            config.modResults.contents = buildGradle;
        }
        return config;
    });
};

/**
 * Main plugin function
 * 
 * @param {object} config - Expo config
 * @param {object} options - Plugin options
 * @param {string} options.clientId - Spotify app client ID
 * @param {string} options.redirectScheme - URL scheme for auth callback (e.g., 'paperand-spotify')
 */
const withSpotifySDK = (config, options = {}) => {
    const { clientId = '', redirectScheme = '' } = options;

    if (!clientId) {
        console.warn('[withSpotifySDK] No clientId provided. Some features may not work.');
    }

    // Apply Android modifications
    config = withSpotifyAndroid(config, { clientId, redirectScheme });

    // Apply Android build.gradle modifications for manifest placeholders
    config = withSpotifyBuildGradle(config, { redirectScheme });

    // Apply iOS modifications
    config = withSpotifyIOS(config, { clientId, redirectScheme });

    return config;
};

module.exports = withSpotifySDK;
