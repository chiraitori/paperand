import { File, Directory, Paths } from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { NetInfoStateType } from '@react-native-community/netinfo';
import { Chapter, DownloadedChapter, DownloadJob } from '../types';
import { getChapterPages, decryptDrmImage, fetchImageThroughExtension } from './sourceService';

const DOWNLOADS_DIR_NAME = 'downloads';
const METADATA_KEY = '@paperback_downloads';

// Parallel download settings based on network
const PARALLEL_CHAPTERS_WIFI = 3;
const PARALLEL_CHAPTERS_CELLULAR = 1;
const PARALLEL_PAGES_PER_CHAPTER = 2;

// Parse DRM URL to get extensionId and actual URL
const parseDrmUrl = (url: string): { extensionId: string; actualUrl: string } | null => {
    if (!url.startsWith('drm://')) return null;
    const withoutScheme = url.substring(6);
    const slashIndex = withoutScheme.indexOf('/');
    if (slashIndex === -1) return null;
    return {
        extensionId: withoutScheme.substring(0, slashIndex),
        actualUrl: withoutScheme.substring(slashIndex + 1),
    };
};

// Convert base64 data URL to blob for saving
const base64ToArrayBuffer = (base64: string): Uint8Array => {
    // Remove data URL prefix if present
    const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
};

class DownloadService {
    private downloadQueue: DownloadJob[] = [];
    private pendingQueue: { manga: { id: string; title: string; coverImage: string; source?: string }; chapter: Chapter }[] = [];
    private activeDownloads: Record<string, boolean> = {};
    private cancelledDownloads: Set<string> = new Set();
    private pausedDownloads: Set<string> = new Set();
    private isPaused = false;
    private listeners: ((queue: DownloadJob[]) => void)[] = [];
    private downloadsDir: Directory;
    private isProcessing = false;

    constructor() {
        this.downloadsDir = new Directory(Paths.document, DOWNLOADS_DIR_NAME);
        this.ensureDirectoryExists();
    }

    private async getMaxParallelDownloads(): Promise<number> {
        try {
            const netInfo = await NetInfo.fetch();
            if (netInfo.type === NetInfoStateType.wifi) {
                return PARALLEL_CHAPTERS_WIFI;
            }
            return PARALLEL_CHAPTERS_CELLULAR;
        } catch {
            return PARALLEL_CHAPTERS_CELLULAR;
        }
    }

    private ensureDirectoryExists() {
        if (!this.downloadsDir.exists) {
            this.downloadsDir.create();
        }
    }

    async getDownloadedChapters(): Promise<DownloadedChapter[]> {
        try {
            const stored = await AsyncStorage.getItem(METADATA_KEY);
            return stored ? JSON.parse(stored) : [];
        } catch (error) {
            console.error('Failed to load downloaded chapters:', error);
            return [];
        }
    }

    private async saveDownloadedChapters(chapters: DownloadedChapter[]) {
        try {
            await AsyncStorage.setItem(METADATA_KEY, JSON.stringify(chapters));
        } catch (error) {
            console.error('Failed to save downloaded chapters:', error);
        }
    }

    async downloadChapter(
        manga: { id: string; title: string; coverImage: string; source?: string },
        chapter: Chapter,
        onProgress?: (progress: number) => void
    ) {
        // Check if already downloading or queued
        if (this.activeDownloads[chapter.id]) return;
        if (this.pendingQueue.some(p => p.chapter.id === chapter.id)) return;
        if (this.downloadQueue.some(j => j.chapterId === chapter.id)) return;

        const sourceId = manga.source;
        if (!sourceId) {
            console.error('Cannot download chapter: no source ID');
            return;
        }

        // Add to pending queue
        this.pendingQueue.push({ manga, chapter });
        
        // Add job to visible queue with 'queued' status
        const job: DownloadJob = {
            chapterId: chapter.id,
            mangaId: manga.id,
            mangaTitle: manga.title,
            mangaCover: manga.coverImage,
            chapterTitle: chapter.title || `Chapter ${chapter.number}`,
            sourceId: sourceId,
            total: 0,
            progress: 0,
            status: 'queued',
        };
        this.updateQueue(job);

        // Start processing queue
        this.processQueue();
    }

    // Cancel a specific download
    cancelDownload(chapterId: string) {
        // Mark as cancelled
        this.cancelledDownloads.add(chapterId);
        
        // Remove from pending queue
        this.pendingQueue = this.pendingQueue.filter(p => p.chapter.id !== chapterId);
        
        // Remove from visible queue
        const index = this.downloadQueue.findIndex(j => j.chapterId === chapterId);
        if (index >= 0) {
            this.downloadQueue.splice(index, 1);
            this.notifyListeners();
        }
    }

    // Pause all downloads
    pauseAll() {
        this.isPaused = true;
        // Update all queued/downloading jobs to paused
        this.downloadQueue.forEach(job => {
            if (job.status === 'queued' || job.status === 'downloading') {
                job.status = 'paused';
            }
        });
        this.notifyListeners();
    }

    // Resume all downloads
    resumeAll() {
        this.isPaused = false;
        // Update all paused jobs back to queued
        this.downloadQueue.forEach(job => {
            if (job.status === 'paused') {
                job.status = 'queued';
            }
        });
        this.notifyListeners();
        // Restart processing
        this.processQueue();
    }

    // Check if downloads are paused
    isAllPaused(): boolean {
        return this.isPaused;
    }

    // Get queue
    getQueue(): DownloadJob[] {
        return [...this.downloadQueue];
    }

    private async processQueue() {
        if (this.isProcessing) return;
        if (this.isPaused) return;
        this.isProcessing = true;

        try {
            while (this.pendingQueue.length > 0) {
                const maxParallel = await this.getMaxParallelDownloads();
                const activeCount = Object.keys(this.activeDownloads).length;
                const slotsAvailable = maxParallel - activeCount;

                if (slotsAvailable <= 0) {
                    // Wait a bit and check again
                    await new Promise(resolve => setTimeout(resolve, 500));
                    continue;
                }

                // Start downloads for available slots
                const toStart = this.pendingQueue.splice(0, slotsAvailable);
                await Promise.all(toStart.map(item => this.executeDownload(item.manga, item.chapter)));
            }
        } finally {
            this.isProcessing = false;
        }
    }

    private async executeDownload(
        manga: { id: string; title: string; coverImage: string; source?: string },
        chapter: Chapter
    ) {
        const sourceId = manga.source!;
        this.activeDownloads[chapter.id] = true;
        
        // Update job status to downloading
        const existingJob = this.downloadQueue.find(j => j.chapterId === chapter.id);
        const job: DownloadJob = {
            chapterId: chapter.id,
            mangaId: manga.id,
            mangaTitle: existingJob?.mangaTitle || manga.title,
            mangaCover: existingJob?.mangaCover || manga.coverImage,
            chapterTitle: existingJob?.chapterTitle || chapter.title || `Chapter ${chapter.number}`,
            sourceId: sourceId,
            total: 0,
            progress: 0,
            status: 'downloading',
        };
        this.updateQueue(job);

        try {
            // Check if cancelled
            if (this.cancelledDownloads.has(chapter.id)) {
                this.cancelledDownloads.delete(chapter.id);
                console.log('[Download] Download was cancelled before starting');
                return; // Exit silently without error
            }

            // Fetch page URLs from the source
            console.log('[Download] Fetching pages for', chapter.id, 'from source', sourceId);
            const pageUrls = await getChapterPages(sourceId, manga.id, chapter.id);
            
            if (pageUrls.length === 0) {
                throw new Error('No pages found for chapter');
            }

            job.total = pageUrls.length;
            this.updateQueue({ ...job });

            // Create chapter directory: downloads/mangaId/chapterId/
            const chapterDir = new Directory(this.downloadsDir, manga.id, chapter.id);
            if (!chapterDir.exists) {
                chapterDir.create({ intermediates: true });
            }

            const localPages: string[] = [];
            let size = 0;

            for (let i = 0; i < pageUrls.length; i++) {
                // Check for cancellation during download
                if (this.cancelledDownloads.has(chapter.id)) {
                    this.cancelledDownloads.delete(chapter.id);
                    // Clean up partial download
                    if (chapterDir.exists) {
                        chapterDir.delete();
                    }
                    console.log('[Download] Download cancelled during progress');
                    return; // Exit silently without error
                }

                const pageUrl = pageUrls[i];
                const filename = `${i}.jpg`; // Use jpg as default extension
                const targetFile = new File(chapterDir, filename);

                // Check if this is a DRM URL that needs decryption
                const drmInfo = parseDrmUrl(pageUrl);
                
                try {
                    let imageDataUrl: string | null = null;
                    
                    if (drmInfo) {
                        // DRM protected image - decrypt through extension
                        console.log('[Download] Decrypting DRM page', i + 1);
                        imageDataUrl = await decryptDrmImage(drmInfo.extensionId, drmInfo.actualUrl);
                    } else {
                        // Normal URL - still fetch through extension for proper headers/cookies
                        console.log('[Download] Fetching page', i + 1, 'through extension');
                        imageDataUrl = await fetchImageThroughExtension(sourceId, pageUrl);
                    }
                    
                    if (imageDataUrl) {
                        // Convert base64 data URL to file
                        const imageData = base64ToArrayBuffer(imageDataUrl);
                        targetFile.write(imageData);
                        
                        if (targetFile.exists) {
                            localPages.push(targetFile.uri);
                            size += targetFile.size;
                        }
                    } else {
                        console.warn('[Download] Failed to fetch page', i + 1);
                    }
                } catch (error) {
                    console.error('[Download] Error downloading page', i + 1, error);
                }

                job.progress = i + 1;
                this.updateQueue({ ...job });
            }

            const downloadedChapter: DownloadedChapter = {
                mangaId: manga.id,
                chapterId: chapter.id,
                chapterNumber: chapter.number,
                chapterTitle: chapter.title,
                mangaTitle: manga.title,
                mangaCover: manga.coverImage,
                sourceId: sourceId,
                pages: localPages,
                downloadedAt: new Date().toISOString(),
                size,
            };

            const existing = await this.getDownloadedChapters();
            await this.saveDownloadedChapters([...existing, downloadedChapter]);

            job.status = 'completed';
            this.updateQueue({ ...job });
        } catch (error) {
            console.error('Download failed:', error);
            job.status = 'failed';
            this.updateQueue({ ...job });
        } finally {
            delete this.activeDownloads[chapter.id];
        }
    }

    async deleteChapter(chapterId: string) {
        try {
            const chapters = await this.getDownloadedChapters();
            const chapter = chapters.find(c => c.chapterId === chapterId);

            if (chapter) {
                // Delete chapter directory (synchronous method)
                const chapterDir = new Directory(this.downloadsDir, chapter.mangaId, chapter.chapterId);
                if (chapterDir.exists) {
                    chapterDir.delete();
                }

                // Update metadata
                const newChapters = chapters.filter(c => c.chapterId !== chapterId);
                await this.saveDownloadedChapters(newChapters);
            }
        } catch (error) {
            console.error('Failed to delete chapter:', error);
        }
    }

    private updateQueue(job: DownloadJob) {
        const index = this.downloadQueue.findIndex(j => j.chapterId === job.chapterId);
        if (index >= 0) {
            if (job.status === 'completed' || job.status === 'failed') {
                this.downloadQueue.splice(index, 1);
            } else {
                this.downloadQueue[index] = job;
            }
        } else if (job.status !== 'completed' && job.status !== 'failed') {
            this.downloadQueue.push(job);
        }

        this.notifyListeners();
    }

    subscribe(listener: (queue: DownloadJob[]) => void) {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    private notifyListeners() {
        this.listeners.forEach(l => l(this.downloadQueue));
    }

    /**
     * Process downloads in background task
     * Returns true if there are more downloads to process
     */
    async processBackgroundDownloads(): Promise<boolean> {
        if (this.isPaused) {
            return false;
        }

        const maxParallel = await this.getMaxParallelDownloads();
        const activeCount = Object.keys(this.activeDownloads).length;
        
        console.log(`[Download] Background process: active=${activeCount}, pending=${this.pendingQueue.length}, maxParallel=${maxParallel}`);

        // Start new downloads if we have capacity
        if (activeCount < maxParallel && this.pendingQueue.length > 0) {
            const slotsAvailable = maxParallel - activeCount;
            const toStart = this.pendingQueue.splice(0, slotsAvailable);
            
            console.log(`[Download] Starting ${toStart.length} downloads in background`);
            
            // Don't await - let them run, we just need to start them
            for (const item of toStart) {
                this.executeDownload(item.manga, item.chapter);
            }
        }

        // Return true if there are still active downloads or pending items
        const hasActiveDownloads = Object.keys(this.activeDownloads).length > 0;
        const hasPending = this.pendingQueue.length > 0;
        const hasQueued = this.downloadQueue.some(j => j.status === 'downloading' || j.status === 'queued');
        
        return hasActiveDownloads || hasPending || hasQueued;
    }
}

export const downloadService = new DownloadService();
