import React, { createContext, useContext, useState, useEffect, useRef, ReactNode, useCallback } from 'react';
import { Alert, Platform } from 'react-native';
import NetInfo, { NetInfoStateType } from '@react-native-community/netinfo';
import { DownloadedChapter, DownloadJob, Manga, Chapter } from '../types';
import { downloadService } from '../services/downloadService';
import { t } from '../services/i18nService';
import {
    initNotifications,
    showDownloadNotification,
    showDownloadCompleteNotification,
    hideDownloadNotification,
} from '../services/notificationService';
import {
    isBackgroundServiceRunning,
    stopBackgroundService,
} from '../services/backgroundTaskService';

interface DownloadContextType {
    downloads: DownloadedChapter[];
    queue: DownloadJob[];
    downloadChapter: (manga: Manga, chapter: Chapter) => Promise<void>;
    deleteDownload: (chapterId: string, mangaId?: string) => Promise<void>;
    cancelDownload: (chapterId: string, mangaId?: string) => void;
    pauseAll: () => void;
    resumeAll: () => void;
    isPaused: boolean;
    isChapterDownloaded: (chapterId: string, mangaId?: string) => boolean;
    isDownloading: (chapterId: string, mangaId?: string) => boolean;
    isQueued: (chapterId: string, mangaId?: string) => boolean;
    getDownloadProgress: (chapterId: string, mangaId?: string) => number;
    isOnWifi: () => Promise<boolean>;
}

const DownloadContext = createContext<DownloadContextType | undefined>(undefined);

export const DownloadProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [downloads, setDownloads] = useState<DownloadedChapter[]>([]);
    const [queue, setQueue] = useState<DownloadJob[]>([]);
    const [isPaused, setIsPaused] = useState<boolean>(downloadService.isAllPaused());
    const prevQueueRef = useRef<DownloadJob[]>([]);
    const currentMangaTitleRef = useRef<string>('');
    const cellularPromptPromiseRef = useRef<Promise<boolean> | null>(null);
    const cellularConfirmedUntilRef = useRef<number>(0);

    useEffect(() => {
        // Initialize notifications
        initNotifications();
        loadDownloads();

        // Subscribe to queue updates
        const unsubscribe = downloadService.subscribe((updatedQueue) => {
            const prevQueue = prevQueueRef.current;
            setIsPaused(downloadService.isAllPaused());

            // Check if any job was removed (completed or failed)
            const currentJobKeys = new Set(updatedQueue.map(j => `${j.mangaId}::${j.chapterId}`));

            // Find jobs that were in prev but not in current (completed/failed)
            const completedJobs = prevQueue.filter(j =>
                j.status === 'downloading' && !currentJobKeys.has(`${j.mangaId}::${j.chapterId}`)
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
                        stopBackgroundService().catch((err: any) => {
                            console.error('[DownloadContext] Failed to stop background service:', err);
                        });
                    }
                }
            }

            // Update download notification with progress (only if background service is not running)
            // Background service handles its own notifications
            const activeJob = updatedQueue.find(j => j.status === 'downloading');
            if (!isBackgroundServiceRunning()) {
                if (activeJob && activeJob.total > 0) {
                    showDownloadNotification(
                        activeJob.mangaTitle,
                        activeJob.progress,
                        activeJob.total,
                        activeJob.chapterTitle
                    );
                } else if (updatedQueue.length === 0 && prevQueue.length > 0) {
                    // All downloads done, hide progress notification
                    hideDownloadNotification();
                }
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
        // If user recently confirmed cellular download (within 60s), don't spam alerts for batch downloads
        if (Date.now() < cellularConfirmedUntilRef.current) {
            return Promise.resolve(true);
        }
        // Coalesce concurrent cellular prompts into a single Alert
        if (cellularPromptPromiseRef.current) {
            return cellularPromptPromiseRef.current;
        }

        const promptPromise = new Promise<boolean>((resolve) => {
            Alert.alert(
                t('downloadManager.cellularTitle') || 'Download on Cellular?',
                t('downloadManager.cellularMessage') || 'You are on cellular data. Downloading may use significant data. Continue?',
                [
                    {
                        text: t('common.cancel') || 'Cancel',
                        style: 'cancel',
                        onPress: () => {
                            cellularPromptPromiseRef.current = null;
                            resolve(false);
                        },
                    },
                    {
                        text: t('downloadManager.continue') || 'Download',
                        onPress: () => {
                            cellularConfirmedUntilRef.current = Date.now() + 60000;
                            cellularPromptPromiseRef.current = null;
                            resolve(true);
                        },
                    },
                ],
                {
                    cancelable: true,
                    onDismiss: () => {
                        cellularPromptPromiseRef.current = null;
                        resolve(false);
                    },
                }
            );
        });

        cellularPromptPromiseRef.current = promptPromise;
        return promptPromise;
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

    const deleteDownload = async (chapterId: string, mangaId?: string) => {
        await downloadService.deleteChapter(chapterId, mangaId);
        await loadDownloads();
    };

    const isChapterDownloaded = (chapterId: string, mangaId?: string) => {
        return downloads.some(d => d.chapterId === chapterId && (!mangaId || d.mangaId === mangaId));
    };

    const isDownloading = (chapterId: string, mangaId?: string) => {
        return queue.some(
            j => j.chapterId === chapterId && (!mangaId || j.mangaId === mangaId) && j.status === 'downloading'
        );
    };

    const isQueued = (chapterId: string, mangaId?: string) => {
        return queue.some(
            j => j.chapterId === chapterId && (!mangaId || j.mangaId === mangaId) && (j.status === 'queued' || j.status === 'paused')
        );
    };

    const getDownloadProgress = (chapterId: string, mangaId?: string) => {
        const job = queue.find(j => j.chapterId === chapterId && (!mangaId || j.mangaId === mangaId));
        return job && job.total > 0 ? Math.min(1, Math.max(0, job.progress / job.total)) : 0;
    };

    const cancelDownload = (chapterId: string, mangaId?: string) => {
        downloadService.cancelDownload(chapterId, mangaId);
    };

    const pauseAll = () => {
        downloadService.pauseAll();
        setIsPaused(true);
    };

    const resumeAll = () => {
        downloadService.resumeAll();
        setIsPaused(false);
    };

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
