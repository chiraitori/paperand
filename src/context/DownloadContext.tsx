import React, { createContext, useContext, useState, useEffect, useRef, ReactNode, useCallback } from 'react';
import { Alert, Platform } from 'react-native';
import NetInfo, { NetInfoStateType } from '@react-native-community/netinfo';
import { DownloadedChapter, DownloadJob, Manga, Chapter } from '../types';
import { downloadService } from '../services/downloadService';
import { t } from '../services/i18nService';
import {
    initNotifications,
    showDownloadCompleteNotification,
    hideDownloadNotification,
} from '../services/notificationService';
import { stopBackgroundService } from '../services/backgroundTaskService';

interface DownloadContextType {
    downloads: DownloadedChapter[];
    queue: DownloadJob[];
    downloadChapter: (manga: Manga, chapter: Chapter) => Promise<void>;
    deleteDownload: (chapterId: string) => Promise<void>;
    cancelDownload: (chapterId: string) => void;
    pauseAll: () => void;
    resumeAll: () => void;
    isPaused: boolean;
    isChapterDownloaded: (chapterId: string) => boolean;
    isDownloading: (chapterId: string) => boolean;
    isQueued: (chapterId: string) => boolean;
    getDownloadProgress: (chapterId: string) => number;
    isOnWifi: () => Promise<boolean>;
}

const DownloadContext = createContext<DownloadContextType | undefined>(undefined);

export const DownloadProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [downloads, setDownloads] = useState<DownloadedChapter[]>([]);
    const [queue, setQueue] = useState<DownloadJob[]>([]);
    const prevQueueRef = useRef<DownloadJob[]>([]);
    const currentMangaTitleRef = useRef<string>('');

    useEffect(() => {
        // Initialize notifications
        initNotifications();
        loadDownloads();

        // Subscribe to queue updates
        const unsubscribe = downloadService.subscribe((updatedQueue) => {
            const prevQueue = prevQueueRef.current;

            // Check if any job was removed (completed or failed)
            const currentChapterIds = new Set(updatedQueue.map(j => j.chapterId));

            // Find jobs that were in prev but not in current (completed/failed)
            const completedJobs = prevQueue.filter(j =>
                j.status === 'downloading' && !currentChapterIds.has(j.chapterId)
            );

            // Reload downloads if any job completed
            if (completedJobs.length > 0) {
                console.log('[DownloadContext] Jobs completed:', completedJobs.map(j => j.chapterId));
                loadDownloads();

                // Show completion notification if queue is now empty
                if (updatedQueue.length === 0 && completedJobs.length > 0) {
                    const lastJob = completedJobs[0];
                    showDownloadCompleteNotification(
                        lastJob.mangaTitle,
                        completedJobs.length
                    );

                    // Stop background service when all downloads complete
                    if (Platform.OS === 'android') {
                        stopBackgroundService().catch(err => {
                            console.error('[DownloadContext] Failed to stop background service:', err);
                        });
                    }

                    // Stop iOS Live Activity
                    if (Platform.OS === 'ios') {
                        const { stopDownloadLiveActivity } = require('../services/liveActivityService');
                        stopDownloadLiveActivity('Download Complete');
                    }
                }
            }

            // Note: Download progress notifications are handled by the background service
            // We only need to clean up when all downloads are done
            if (updatedQueue.length === 0 && prevQueue.length > 0) {
                hideDownloadNotification();
            }

            // Update refs and state
            prevQueueRef.current = [...updatedQueue];
            setQueue([...updatedQueue]);
        });

        return unsubscribe;
    }, []);

    const loadDownloads = async () => {
        const loaded = await downloadService.getDownloadedChapters();
        setDownloads(loaded);
    };

    const isOnWifi = useCallback(async (): Promise<boolean> => {
        try {
            const netInfo = await NetInfo.fetch();
            return netInfo.type === NetInfoStateType.wifi;
        } catch {
            return false;
        }
    }, []);

    const showCellularConfirmation = (): Promise<boolean> => {
        return new Promise((resolve) => {
            Alert.alert(
                t('downloadManager.cellularTitle') || 'Download on Cellular?',
                t('downloadManager.cellularMessage') || 'You are on cellular data. Downloading may use significant data. Continue?',
                [
                    {
                        text: t('common.cancel') || 'Cancel',
                        style: 'cancel',
                        onPress: () => resolve(false),
                    },
                    {
                        text: t('downloadManager.continue') || 'Download',
                        onPress: () => resolve(true),
                    },
                ],
                { cancelable: true, onDismiss: () => resolve(false) }
            );
        });
    };

    const downloadChapter = async (manga: Manga, chapter: Chapter) => {
        // Check if on cellular and ask for confirmation
        const onWifi = await isOnWifi();
        if (!onWifi) {
            const confirmed = await showCellularConfirmation();
            if (!confirmed) return;
        }

        // Store manga title for notifications
        currentMangaTitleRef.current = manga.title;

        await downloadService.downloadChapter(
            { id: manga.id, title: manga.title, coverImage: manga.coverImage, source: manga.source },
            chapter,
            (progress) => {
                // Progress is handled by queue subscription
            }
        );
        await loadDownloads(); // Refresh list after download
    };

    const deleteDownload = async (chapterId: string) => {
        await downloadService.deleteChapter(chapterId);
        await loadDownloads();
    };

    const isChapterDownloaded = (chapterId: string) => {
        return downloads.some(d => d.chapterId === chapterId);
    };

    const isDownloading = (chapterId: string) => {
        return queue.some(j => j.chapterId === chapterId && j.status === 'downloading');
    };

    const isQueued = (chapterId: string) => {
        return queue.some(j => j.chapterId === chapterId && j.status === 'queued');
    };

    const getDownloadProgress = (chapterId: string) => {
        const job = queue.find(j => j.chapterId === chapterId);
        return job && job.total > 0 ? job.progress / job.total : 0;
    };

    const cancelDownload = (chapterId: string) => {
        downloadService.cancelDownload(chapterId);
    };

    const pauseAll = () => {
        downloadService.pauseAll();
    };

    const resumeAll = () => {
        downloadService.resumeAll();
    };

    const isPaused = downloadService.isAllPaused();

    return (
        <DownloadContext.Provider value={{
            downloads,
            queue,
            downloadChapter,
            deleteDownload,
            cancelDownload,
            pauseAll,
            resumeAll,
            isPaused,
            isChapterDownloaded,
            isDownloading,
            isQueued,
            getDownloadProgress,
            isOnWifi,
        }}>
            {children}
        </DownloadContext.Provider>
    );
};

export const useDownloads = (): DownloadContextType => {
    const context = useContext(DownloadContext);
    if (!context) {
        throw new Error('useDownloads must be used within a DownloadProvider');
    }
    return context;
};
