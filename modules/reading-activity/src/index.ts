/**
 * Reading Activity Module for React Native (iOS Only)
 * 
 * Provides enhanced iOS Live Activity functionality for reading progress
 * and download tracking on lock screen and Dynamic Island.
 * 
 * Requires iOS 16.2+ and native rebuild.
 */

import { Platform } from 'react-native';
import { NativeModule, requireNativeModule } from 'expo-modules-core';

// Types for Reading Activity
export interface ReadingActivityParams {
    mangaTitle: string;
    mangaCoverUrl?: string;
    chapterId: string;
    chapterTitle: string;
    currentPage: number;
    totalPages: number;
}

export interface DownloadActivityParams {
    mangaTitle: string;
    mangaCoverUrl?: string;
    totalCount: number;
}

export interface ActivityInfo {
    type: 'reading' | 'download';
    id: string;
    mangaTitle: string;
    currentPage?: number;
    totalPages?: number;
    downloadedCount?: number;
    totalCount?: number;
}

export interface SupportInfo {
    iosVersion: string;
    deviceModel: string;
    supportsLiveActivities: boolean;
    areActivitiesEnabled: boolean;
    frequentPushesEnabled?: boolean;
}

// Define the native module interface
interface ReadingActivityNativeModule extends NativeModule {
    isSupported(): boolean;
    getSupportInfo(): SupportInfo;
    startReadingActivity(
        mangaTitle: string,
        mangaCoverUrl: string | null,
        chapterId: string,
        chapterTitle: string,
        currentPage: number,
        totalPages: number
    ): Promise<{ activityId: string; started: boolean }>;
    updateReadingActivity(
        currentPage: number,
        totalPages: number,
        chapterTitle: string | null
    ): Promise<{ updated: boolean }>;
    endReadingActivity(): Promise<{ ended: boolean }>;
    startDownloadActivity(
        mangaTitle: string,
        mangaCoverUrl: string | null,
        totalCount: number
    ): Promise<{ activityId: string; started: boolean }>;
    updateDownloadActivity(
        currentChapter: string,
        downloadedCount: number,
        totalCount: number,
        queuedCount: number
    ): Promise<{ updated: boolean }>;
    completeDownloadActivity(message: string | null): Promise<{ completed: boolean }>;
    endDownloadActivity(): Promise<{ ended: boolean }>;
    getActiveActivities(): ActivityInfo[];
    endAllActivities(): Promise<{ ended: boolean }>;
}

// Get the native module (iOS only)
let ReadingActivityNative: ReadingActivityNativeModule | null = null;

if (Platform.OS === 'ios') {
    try {
        ReadingActivityNative = requireNativeModule<ReadingActivityNativeModule>('ReadingActivity');
    } catch (e) {
        console.warn('[ReadingActivity] Native module not available. Requires native rebuild.');
    }
}

/**
 * ReadingActivity - iOS Live Activity for reading progress and downloads
 */
export const ReadingActivity = {
    /**
     * Check if Live Activities are supported on this device
     */
    isSupported(): boolean {
        if (Platform.OS !== 'ios' || !ReadingActivityNative) {
            return false;
        }
        return ReadingActivityNative.isSupported();
    },

    /**
     * Get detailed support information for debugging
     */
    getSupportInfo(): SupportInfo | null {
        if (Platform.OS !== 'ios' || !ReadingActivityNative) {
            return null;
        }
        try {
            return ReadingActivityNative.getSupportInfo();
        } catch {
            return null;
        }
    },

    // MARK: - Reading Progress Activity

    /**
     * Start a reading progress activity on lock screen / Dynamic Island
     */
    async startReadingActivity(params: ReadingActivityParams): Promise<string | null> {
        if (Platform.OS !== 'ios' || !ReadingActivityNative) {
            return null;
        }

        try {
            const result = await ReadingActivityNative.startReadingActivity(
                params.mangaTitle,
                params.mangaCoverUrl ?? null,
                params.chapterId,
                params.chapterTitle,
                params.currentPage,
                params.totalPages
            );
            return result.started ? result.activityId : null;
        } catch (error) {
            console.debug('[ReadingActivity] Failed to start:', error);
            return null;
        }
    },

    /**
     * Update the reading progress activity
     */
    async updateReadingActivity(
        currentPage: number,
        totalPages: number,
        chapterTitle?: string
    ): Promise<boolean> {
        if (Platform.OS !== 'ios' || !ReadingActivityNative) {
            return false;
        }

        try {
            const result = await ReadingActivityNative.updateReadingActivity(
                currentPage,
                totalPages,
                chapterTitle ?? null
            );
            return result.updated;
        } catch (error) {
            console.debug('[ReadingActivity] Failed to update:', error);
            return false;
        }
    },

    /**
     * End the reading activity
     */
    async endReadingActivity(): Promise<boolean> {
        if (Platform.OS !== 'ios' || !ReadingActivityNative) {
            return true;
        }

        try {
            const result = await ReadingActivityNative.endReadingActivity();
            return result.ended;
        } catch (error) {
            console.debug('[ReadingActivity] Failed to end:', error);
            return false;
        }
    },

    // MARK: - Download Progress Activity

    /**
     * Start a download progress activity
     */
    async startDownloadActivity(params: DownloadActivityParams): Promise<string | null> {
        if (Platform.OS !== 'ios' || !ReadingActivityNative) {
            return null;
        }

        try {
            const result = await ReadingActivityNative.startDownloadActivity(
                params.mangaTitle,
                params.mangaCoverUrl ?? null,
                params.totalCount
            );
            return result.started ? result.activityId : null;
        } catch (error) {
            console.debug('[ReadingActivity] Failed to start download activity:', error);
            return null;
        }
    },

    /**
     * Update the download progress activity
     */
    async updateDownloadActivity(
        currentChapter: string,
        downloadedCount: number,
        totalCount: number,
        queuedCount: number = 0
    ): Promise<boolean> {
        if (Platform.OS !== 'ios' || !ReadingActivityNative) {
            return false;
        }

        try {
            const result = await ReadingActivityNative.updateDownloadActivity(
                currentChapter,
                downloadedCount,
                totalCount,
                queuedCount
            );
            return result.updated;
        } catch (error) {
            console.debug('[ReadingActivity] Failed to update download activity:', error);
            return false;
        }
    },

    /**
     * Complete the download activity with a success message
     */
    async completeDownloadActivity(message?: string): Promise<boolean> {
        if (Platform.OS !== 'ios' || !ReadingActivityNative) {
            return true;
        }

        try {
            const result = await ReadingActivityNative.completeDownloadActivity(message ?? null);
            return result.completed;
        } catch (error) {
            console.debug('[ReadingActivity] Failed to complete download activity:', error);
            return false;
        }
    },

    /**
     * End the download activity (cancel/fail)
     */
    async endDownloadActivity(): Promise<boolean> {
        if (Platform.OS !== 'ios' || !ReadingActivityNative) {
            return true;
        }

        try {
            const result = await ReadingActivityNative.endDownloadActivity();
            return result.ended;
        } catch (error) {
            console.debug('[ReadingActivity] Failed to end download activity:', error);
            return false;
        }
    },

    // MARK: - Utility Functions

    /**
     * Get all currently active activities
     */
    getActiveActivities(): ActivityInfo[] {
        if (Platform.OS !== 'ios' || !ReadingActivityNative) {
            return [];
        }

        try {
            return ReadingActivityNative.getActiveActivities();
        } catch (error) {
            return [];
        }
    },

    /**
     * End all active activities
     */
    async endAllActivities(): Promise<boolean> {
        if (Platform.OS !== 'ios' || !ReadingActivityNative) {
            return true;
        }

        try {
            const result = await ReadingActivityNative.endAllActivities();
            return result.ended;
        } catch (error) {
            console.debug('[ReadingActivity] Failed to end all activities:', error);
            return false;
        }
    },
};

// Default export
export default ReadingActivity;
