/**
 * Dynamic Expo Config
 * 
 * Supports different build variants:
 * - Production (default): APP_VARIANT=production or unset
 * - Development: APP_VARIANT=dev
 * 
 * Usage:
 *   APP_VARIANT=dev npx expo prebuild --clean
 *   APP_VARIANT=dev eas build --profile development
 */

const IS_DEV = process.env.APP_VARIANT === 'dev';

const getAppName = () => {
    if (IS_DEV) return 'Paperand Dev';
    return 'Paperand';
};

const getBundleIdentifier = (platform) => {
    const base = platform === 'ios'
        ? 'com.chiraitori.paperand.ios'
        : 'com.chiraitori.paperand.android';

    if (IS_DEV) return `${base}.dev`;
    return base;
};

const getScheme = () => {
    if (IS_DEV) return 'paperand-dev';
    return 'paperand';
};

module.exports = {
    expo: {
        name: getAppName(),
        slug: IS_DEV ? 'paperback-android-dev' : 'paperback-android',
        version: '0.0.13',
        scheme: getScheme(),
        orientation: 'default',
        icon: './assets/icon.png',
        userInterfaceStyle: 'automatic',
        splash: {
            image: './assets/splash-icon.png',
            resizeMode: 'contain',
            backgroundColor: '#ffffff',
            dark: {
                image: './assets/splash-icon.png',
                resizeMode: 'contain',
                backgroundColor: '#1a1a2e'
            }
        },
        notification: {
            icon: './assets/notification-icon.png',
            color: '#FA6432'
        },
        ios: {
            supportsTablet: true,
            bundleIdentifier: getBundleIdentifier('ios'),
            buildNumber: '13',
            infoPlist: {
                ITSAppUsesNonExemptEncryption: false,
                CFBundleAllowMixedLocalizations: true,
                UIBackgroundModes: ['fetch'],
                NSSupportsLiveActivities: true,
                CFBundleLocalizations: [
                    'en', 'vi', 'ja', 'zh-Hans', 'ko', 'es', 'pt-BR', 'fr', 'de', 'ru',
                    'id', 'th', 'ar', 'hi', 'ms', 'fil', 'tr', 'it', 'pl', 'uk',
                    'nl', 'cs', 'el', 'hu', 'ro', 'sv', 'da', 'fi', 'nb', 'he',
                    'bn', 'ta', 'te', 'mr', 'gu', 'kn', 'ml', 'pa', 'ur', 'am',
                    'sw', 'zu', 'af'
                ],
                CFBundleDevelopmentRegion: 'en'
            },
            splash: {
                image: './assets/splash-icon.png',
                resizeMode: 'contain',
                backgroundColor: '#ffffff',
                dark: {
                    image: './assets/splash-icon.png',
                    resizeMode: 'contain',
                    backgroundColor: '#1a1a2e'
                }
            }
        },
        android: {
            adaptiveIcon: {
                foregroundImage: './assets/adaptive-icon.png',
                backgroundColor: '#ffffff'
            },
            package: getBundleIdentifier('android'),
            versionCode: 13,
            permissions: [
                'android.permission.REQUEST_INSTALL_PACKAGES',
                'android.permission.FOREGROUND_SERVICE',
                'android.permission.FOREGROUND_SERVICE_DATA_SYNC'
            ],
            intentFilters: [
                {
                    action: 'VIEW',
                    autoVerify: true,
                    data: [{ scheme: getScheme() }],
                    category: ['BROWSABLE', 'DEFAULT']
                }
            ]
        },
        web: {
            favicon: './assets/favicon.png'
        },
        extra: {
            eas: {
                projectId: 'd81f095b-137d-4900-8215-15280679f3ca'
            },
            isDevBuild: IS_DEV
        },
        owner: 'chiraitori',
        plugins: [
            'expo-asset',
            'expo-localization',
            ['expo-notifications', { icon: './assets/icon.png', color: '#FA6432' }],
            'expo-quick-actions',
            'expo-font',
            ['expo-live-activity', { enablePushNotifications: true }],
            './plugins/withBackgroundActionsServiceType',
            // Spotify Remote SDK - Add your client ID from https://developer.spotify.com/dashboard
            ['./plugins/withSpotifySDK', {
                clientId: process.env.SPOTIFY_CLIENT_ID || 'YOUR_SPOTIFY_CLIENT_ID',
                redirectScheme: 'paperand-spotify'
            }],
            // Dev client for development builds - allows connecting to local Expo server
            ...(IS_DEV ? ['expo-dev-client'] : [])
        ]
    }
};
