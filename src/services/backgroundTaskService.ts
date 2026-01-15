import BackgroundService from 'react-native-background-actions';
import { Platform } from 'react-native';
import { downloadService } from './downloadService';
import {
    updateDownloadLiveActivity,
    updateMultipleDownloadLiveActivity,
    stopDownloadLiveActivity,
} from './liveActivityService';

// Background task options
const options = {
    taskName: 'PaperandDownload',
    taskTitle: 'Downloading manga...',
    taskDesc: 'Download in progress',
    taskIcon: {
        name: 'ic_launcher',
        type: 'mipmap',
    },
    color: '#FA6432',
    linkingURI: 'paperand://',
    progressBar: {
        max: 100,
        value: 0,
        indeterminate: false,
    },
    parameters: {
        delay: 300, // Check very frequently to keep JS thread alive
    },
};

// The actual background task that runs
const backgroundTask = async (taskData?: { delay: number }) => {
    const delay = taskData?.delay || 300;
    let iteration = 0;

    console.log('[BackgroundService] ===== BACKGROUND TASK FUNCTION CALLED =====');
    console.log('[BackgroundService] taskData:', JSON.stringify(taskData));
    console.log('[BackgroundService] isRunning:', BackgroundService.isRunning());

    // Keep running while there are active downloads
    while (BackgroundService.isRunning()) {
        try {
            iteration++;
            console.log(`[BackgroundService] ===== LOOP ITERATION ${iteration} =====`);

            const queue = downloadService.getQueue();
            const activeDownloads = queue.filter(j => j.status === 'downloading' || j.status === 'queued');

            console.log(`[BackgroundService] Queue length: ${queue.length}, Active: ${activeDownloads.length}`);

            if (activeDownloads.length === 0) {
                console.log('[BackgroundService] No more downloads, stopping service');
                await BackgroundService.stop();
                break;
            }

            // Get all actively downloading jobs
            const downloadingJobs = queue.filter(j => j.status === 'downloading');
            const queuedCount = queue.filter(j => j.status === 'queued').length;

            if (downloadingJobs.length > 0) {
                if (downloadingJobs.length === 1) {
                    // Single chapter - show progress bar
                    const job = downloadingJobs[0];
                    const progress = job.total > 0 ? Math.round((job.progress / job.total) * 100) : 0;
                    const desc = queuedCount > 0
                        ? `${job.chapterTitle}: ${job.progress}/${job.total} (${progress}%)\n+${queuedCount} more in queue`
                        : `${job.chapterTitle}: ${job.progress}/${job.total} (${progress}%)`;

                    // Android notification
                    if (Platform.OS === 'android') {
                        await BackgroundService.updateNotification({
                            taskTitle: job.mangaTitle,
                            taskDesc: desc,
                            progressBar: {
                                max: 100,
                                value: progress,
                                indeterminate: false,
                            },
                        });
                    }

                    // iOS Live Activity
                    if (Platform.OS === 'ios') {
                        updateDownloadLiveActivity(
                            job.mangaTitle,
                            `${job.chapterTitle}: ${job.progress}/${job.total}`,
                            progress,
                            queuedCount
                        );
                    }
                } else {
                    // Multiple chapters - show text lines only, no progress bar
                    const lines = downloadingJobs.map(job => {
                        const progress = job.total > 0 ? Math.round((job.progress / job.total) * 100) : 0;
                        return `${job.chapterTitle}: ${job.progress}/${job.total} (${progress}%)`;
                    });

                    if (queuedCount > 0) {
                        lines.push(`+${queuedCount} more in queue`);
                    }

                    // Android notification
                    if (Platform.OS === 'android') {
                        await BackgroundService.updateNotification({
                            taskTitle: `Downloading ${downloadingJobs.length} chapters...`,
                            taskDesc: lines.join('\n'),
                            progressBar: {
                                max: 100,
                                value: 0,
                                indeterminate: true,
                            },
                        });
                    }

                    // iOS Live Activity
                    if (Platform.OS === 'ios') {
                        updateMultipleDownloadLiveActivity(
                            downloadingJobs.length,
                            lines.slice(0, -1), // Remove the queue count line
                            queuedCount
                        );
                    }
                }
            } else {
                // No active downloads, just queued
                if (Platform.OS === 'android') {
                    await BackgroundService.updateNotification({
                        taskTitle: 'Downloading manga...',
                        taskDesc: `${queuedCount} chapters in queue`,
                        progressBar: {
                            max: 100,
                            value: 0,
                            indeterminate: true,
                        },
                    });
                }
            }

            // Process downloads - this starts new downloads if there's capacity
            const hasMore = await downloadService.processBackgroundDownloads();
            console.log(`[BackgroundService] processBackgroundDownloads returned: ${hasMore}`);

            // Wait before checking again
            await sleep(delay);
        } catch (error) {
            console.error('[BackgroundService] Error in background task:', error);
            await sleep(delay);
        }
    }

    console.log('[BackgroundService] Background task ended');
};

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Start the background download service (Android Foreground Service)
 */
export const startBackgroundService = async (): Promise<void> => {
    try {
        if (BackgroundService.isRunning()) {
            console.log('[BackgroundService] Already running');
            return;
        }

        console.log('[BackgroundService] Starting background service...');
        console.log('[BackgroundService] Options:', JSON.stringify(options));

        // Hide expo-notifications download progress notification to avoid duplicates
        const { hideDownloadNotification } = await import('./notificationService');
        await hideDownloadNotification();

        await BackgroundService.start(backgroundTask, options);

        console.log('[BackgroundService] Background service started, isRunning:', BackgroundService.isRunning());
    } catch (error) {
        console.error('[BackgroundService] Failed to start:', error);
    }
};

/**
 * Stop the background download service
 */
export const stopBackgroundService = async (): Promise<void> => {
    try {
        if (!BackgroundService.isRunning()) {
            return;
        }

        console.log('[BackgroundService] Stopping background service...');
        await BackgroundService.stop();
        console.log('[BackgroundService] Background service stopped');
    } catch (error) {
        console.error('[BackgroundService] Failed to stop:', error);
    }
};

/**
 * Check if background service is running
 */
export const isBackgroundServiceRunning = (): boolean => {
    return BackgroundService.isRunning();
};

/**
 * Update background notification
 */
export const updateBackgroundNotification = async (title: string, desc: string): Promise<void> => {
    if (BackgroundService.isRunning()) {
        await BackgroundService.updateNotification({
            taskTitle: title,
            taskDesc: desc,
        });
    }
};

// Legacy exports for compatibility (no longer used)
export const registerBackgroundDownloadTask = async (): Promise<void> => {
    console.log('[BackgroundService] Ready to start when downloads begin');
};

export const unregisterBackgroundDownloadTask = async (): Promise<void> => {
    await stopBackgroundService();
};

export const getBackgroundFetchStatus = async (): Promise<number> => {
    return BackgroundService.isRunning() ? 1 : 0;
};
