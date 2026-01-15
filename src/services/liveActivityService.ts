/**
 * Live Activity Service - iOS
 * 
 * Manages iOS Live Activities for download progress display on lock screen
 * and Dynamic Island. Uses expo-live-activity library.
 * 
 * Requires iOS 16.2+ and expo prebuild.
 */

import { Platform } from 'react-native';
import * as LiveActivity from 'expo-live-activity';

// Store current activity ID for updates
let currentActivityId: string | undefined;

/**
 * Start a Live Activity for download progress
 */
export const startDownloadLiveActivity = (
    mangaTitle: string,
    chapterTitle: string,
    progress: number, // 0-100
    queuedCount: number = 0
): void => {
    if (Platform.OS !== 'ios') return;

    try {
        const subtitle = queuedCount > 0
            ? `${chapterTitle}\n+${queuedCount} more in queue`
            : chapterTitle;

        const state: LiveActivity.LiveActivityState = {
            title: mangaTitle,
            subtitle: subtitle,
            progressBar: {
                progress: progress / 100, // 0-1 range
            },
        };

        const config: LiveActivity.LiveActivityConfig = {
            backgroundColor: '#1a1a2e',
            titleColor: '#FFFFFF',
            subtitleColor: '#888888',
            progressViewTint: '#FA6432',
            progressViewLabelColor: '#FFFFFF',
        };

        const result = LiveActivity.startActivity(state, config);
        if (typeof result === 'string') {
            currentActivityId = result;
        }
        console.log('[LiveActivity] Started activity:', currentActivityId);
    } catch (error) {
        console.error('[LiveActivity] Failed to start:', error);
    }
};

/**
 * Update existing Live Activity with new progress
 */
export const updateDownloadLiveActivity = (
    mangaTitle: string,
    chapterTitle: string,
    progress: number, // 0-100
    queuedCount: number = 0,
    isMultiple: boolean = false
): void => {
    if (Platform.OS !== 'ios') return;

    // Start new activity if not exists
    if (!currentActivityId) {
        startDownloadLiveActivity(mangaTitle, chapterTitle, progress, queuedCount);
        return;
    }

    try {
        const subtitle = queuedCount > 0
            ? `${chapterTitle}\n+${queuedCount} more in queue`
            : chapterTitle;

        const state: LiveActivity.LiveActivityState = {
            title: isMultiple ? `Downloading ${mangaTitle}...` : mangaTitle,
            subtitle: subtitle,
            progressBar: isMultiple
                ? { progress: 0 } // Indeterminate-like for multiple (minimal progress)
                : { progress: progress / 100 },
        };

        LiveActivity.updateActivity(currentActivityId, state);
    } catch (error) {
        console.error('[LiveActivity] Failed to update:', error);
    }
};

/**
 * Update Live Activity for multiple parallel downloads
 */
export const updateMultipleDownloadLiveActivity = (
    downloadingCount: number,
    chapterLines: string[],
    queuedCount: number = 0
): void => {
    if (Platform.OS !== 'ios') return;

    // Start new activity if not exists
    if (!currentActivityId) {
        const state: LiveActivity.LiveActivityState = {
            title: `Downloading ${downloadingCount} chapters...`,
            subtitle: chapterLines.slice(0, 3).join('\n'), // Max 3 lines
            progressBar: { progress: 0 },
        };

        const config: LiveActivity.LiveActivityConfig = {
            backgroundColor: '#1a1a2e',
            titleColor: '#FFFFFF',
            subtitleColor: '#888888',
            progressViewTint: '#FA6432',
        };

        const result = LiveActivity.startActivity(state, config);
        if (typeof result === 'string') {
            currentActivityId = result;
        }
        return;
    }

    try {
        let subtitle = chapterLines.slice(0, 3).join('\n');
        if (queuedCount > 0) {
            subtitle += `\n+${queuedCount} more`;
        }

        LiveActivity.updateActivity(currentActivityId, {
            title: `Downloading ${downloadingCount} chapters...`,
            subtitle: subtitle,
            progressBar: { progress: 0 }, // No progress bar for multiple
        });
    } catch (error) {
        console.error('[LiveActivity] Failed to update multiple:', error);
    }
};

/**
 * Stop the Live Activity (download complete or cancelled)
 */
export const stopDownloadLiveActivity = (message: string = 'Download Complete'): void => {
    if (Platform.OS !== 'ios' || !currentActivityId) return;

    try {
        LiveActivity.stopActivity(currentActivityId, {
            title: message,
            subtitle: '',
            progressBar: { progress: 1 },
        });
        console.log('[LiveActivity] Stopped activity:', currentActivityId);
        currentActivityId = undefined;
    } catch (error) {
        console.error('[LiveActivity] Failed to stop:', error);
    }
};

/**
 * Check if Live Activity is currently active
 */
export const isLiveActivityActive = (): boolean => {
    return Platform.OS === 'ios' && currentActivityId !== undefined;
};

/**
 * Check if Live Activities are supported on this device
 */
export const isLiveActivitySupported = (): boolean => {
    if (Platform.OS !== 'ios') return false;
    // iOS 16.2+ required - expo-live-activity handles version check internally
    return true;
};
