/**
 * Expo Config Plugin for Spotify SDK
 * 
 * Configures the native projects for Spotify SDK integration:
 * - Adds URL scheme for Spotify auth callback
 * - Configures Android manifest for Spotify app queries
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

        // Add intent filter for Spotify auth callback
        const mainApplication = manifest.application?.[0];
        if (mainApplication) {
            const mainActivity = mainApplication.activity?.find(
                (activity) => activity.$?.['android:name'] === '.MainActivity'
            );

            if (mainActivity) {
                if (!mainActivity['intent-filter']) {
                    mainActivity['intent-filter'] = [];
                }

                // Check if redirect scheme filter already exists
                const hasRedirectFilter = mainActivity['intent-filter'].some(
                    (filter) =>
                        filter.data?.some((d) => d.$?.['android:scheme'] === redirectScheme)
                );

                if (!hasRedirectFilter && redirectScheme) {
                    mainActivity['intent-filter'].push({
                        action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
                        category: [
                            { $: { 'android:name': 'android.intent.category.DEFAULT' } },
                            { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
                        ],
                        data: [{ $: { 'android:scheme': redirectScheme } }],
                    });
                }
            }
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
            const buildGradle = config.modResults.contents;

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
                config.modResults.contents = buildGradle.replace(defaultConfigRegex, replacement);
            }
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
