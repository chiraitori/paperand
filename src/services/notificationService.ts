import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Notification channel ID for Android
const DOWNLOAD_CHANNEL_ID = 'download-progress';
const DOWNLOAD_NOTIFICATION_ID = 'download-progress-notification';

// Configure how notifications are handled when app is in foreground
Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowBanner: true, // Show banner notifications in foreground
        shouldShowList: true,   // Show in notification list
        shouldPlaySound: false,
        shouldSetBadge: false,
    }),
});

/**
 * Initialize notification settings and request permissions
 */
export const initNotifications = async (): Promise<boolean> => {
    try {
        // Request permissions
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;

        if (existingStatus !== 'granted') {
            const { status } = await Notifications.requestPermissionsAsync();
            finalStatus = status;
        }

        if (finalStatus !== 'granted') {
            console.log('[Notifications] Permission not granted');
            return false;
        }

        // Set up Android notification channel
        if (Platform.OS === 'android') {
            await Notifications.setNotificationChannelAsync(DOWNLOAD_CHANNEL_ID, {
                name: 'Download Progress',
                importance: Notifications.AndroidImportance.DEFAULT, // Changed to DEFAULT so it shows
                vibrationPattern: [0],
                lightColor: '#FA6432',
                lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
                bypassDnd: false,
                showBadge: true,
                sound: null, // No sound for download progress
            });

            console.log('[Notifications] Android channel created:', DOWNLOAD_CHANNEL_ID);
        }

        console.log('[Notifications] Initialized successfully');
        return true;
    } catch (error) {
        console.error('[Notifications] Failed to initialize:', error);
        return false;
    }
};

/**
 * Show or update download progress notification
 */
export const showDownloadNotification = async (
    mangaTitle: string,
    currentPage: number,
    totalPages: number,
    chapterTitle?: string
): Promise<void> => {
    try {
        const progress = totalPages > 0 ? Math.round((currentPage / totalPages) * 100) : 0;

        // Format: "Manga Title - Chapter Title" 
        // Body: "Downloading: 9/52 pages (17%)"
        const title = chapterTitle ? `${mangaTitle} - ${chapterTitle}` : mangaTitle;
        const body = `Downloading: ${currentPage}/${totalPages} pages (${progress}%)`;

        if (Platform.OS === 'android') {
            await Notifications.scheduleNotificationAsync({
                identifier: DOWNLOAD_NOTIFICATION_ID,
                content: {
                    title: title,
                    body: body,
                    data: { type: 'download-progress' },
                    sticky: true,
                    autoDismiss: false,
                    priority: Notifications.AndroidNotificationPriority.LOW,
                    color: '#FA6432',
                },
                trigger: null,
            });
        } else if (Platform.OS === 'ios') {
            // For iOS, we use regular notifications since Live Activity requires native code
            // Live Activity would need a separate native module implementation
            await Notifications.scheduleNotificationAsync({
                identifier: DOWNLOAD_NOTIFICATION_ID,
                content: {
                    title: title,
                    body: body,
                    data: { type: 'download-progress' },
                },
                trigger: null,
            });
        }
    } catch (error) {
        console.error('[Notifications] Failed to show download notification:', error);
    }
};

/**
 * Update download notification with new progress
 */
export const updateDownloadNotification = async (
    title: string,
    currentPage: number,
    totalPages: number,
    chapterTitle?: string
): Promise<void> => {
    // On Android, calling scheduleNotificationAsync with same identifier updates it
    await showDownloadNotification(title, currentPage, totalPages, chapterTitle);
};

/**
 * Show download complete notification
 */
export const showDownloadCompleteNotification = async (
    title: string,
    chapterCount: number = 1
): Promise<void> => {
    try {
        // First dismiss the progress notification
        await hideDownloadNotification();

        // Show completion notification
        await Notifications.scheduleNotificationAsync({
            identifier: 'download-complete',
            content: {
                title: 'Download Complete',
                body: chapterCount > 1
                    ? `${chapterCount} chapters from "${title}" downloaded`
                    : `"${title}" downloaded successfully`,
                data: { type: 'download-complete' },
                sound: 'default',
                color: '#FA6432',
            },
            trigger: null,
        });
    } catch (error) {
        console.error('[Notifications] Failed to show complete notification:', error);
    }
};

/**
 * Hide/dismiss download progress notification
 */
export const hideDownloadNotification = async (): Promise<void> => {
    try {
        await Notifications.dismissNotificationAsync(DOWNLOAD_NOTIFICATION_ID);
    } catch (error) {
        console.error('[Notifications] Failed to hide notification:', error);
    }
};

/**
 * Cancel all download-related notifications
 */
export const cancelAllDownloadNotifications = async (): Promise<void> => {
    try {
        await Notifications.dismissNotificationAsync(DOWNLOAD_NOTIFICATION_ID);
        await Notifications.dismissNotificationAsync('download-complete');
    } catch (error) {
        console.error('[Notifications] Failed to cancel notifications:', error);
    }
};

export default {
    initNotifications,
    showDownloadNotification,
    updateDownloadNotification,
    showDownloadCompleteNotification,
    hideDownloadNotification,
    cancelAllDownloadNotifications,
};
