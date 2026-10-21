import { File, Directory, Paths } from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { NetInfoStateType } from '@react-native-community/netinfo';
import { Chapter, DownloadedChapter, DownloadJob } from '../types';
import { getChapterPages, decryptDrmImage, fetchImageThroughExtension } from './sourceService';
import { getGeneralSettings } from './settingsService';

const DOWNLOADS_DIR_NAME = 'downloads';
const METADATA_KEY = '@paperback_downloads';

// Parallel download settings based on network
const PARALLEL_CHAPTERS_WIFI = 3;
const PARALLEL_CHAPTERS_CELLULAR = 1;

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

const getJobKey = (mangaId: string, chapterId: string): string => `${mangaId}::${chapterId}`;

class DownloadService {
    private downloadQueue: DownloadJob[] = [];
    private pendingQueue: { manga: { id: string; title: string; coverImage: string; source?: string }; chapter: Chapter }[] = [];
    private activeDownloads: Record<string, boolean> = {};
    private cancelledDownloads: Set<string> = new Set();
    private isPaused = false;
    private listeners: ((queue: DownloadJob[]) => void)[] = [];
    private downloadsDir: Directory;
    private isProcessing = false;
    private metadataWriteChain: Promise<void> = Promise.resolve();

    constructor() {
        this.downloadsDir = new Directory(Paths.document, DOWNLOADS_DIR_NAME);
        this.ensureDirectoryExists();
    }

    private async getMaxParallelDownloads(): Promise<number> {
        try {
            const netInfo = await NetInfo.fetch();
            if (netInfo.type === NetInfoStateType.wifi) {
                try {
                    const settings = await getGeneralSettings();
                    if (settings?.parallelDownloads && settings.parallelDownloads > 0) {
                        return settings.parallelDownloads;
                    }
                } catch {}
                return PARALLEL_CHAPTERS_WIFI;
            }
            return PARALLEL_CHAPTERS_CELLULAR;
        } catch {
            return PARALLEL_CHAPTERS_CELLULAR;
        }
    }

    public async ensureDirectoryExists(): Promise<void> {
        try {
            if (!this.downloadsDir.exists) {
                this.downloadsDir.create();
            }
        } catch (e) {
            console.error('Failed to ensure downloads directory:', e);
        }
    }

    async getDownloadedChapters(mangaId?: string): Promise<DownloadedChapter[]> {
        try {
            const stored = await AsyncStorage.getItem(METADATA_KEY);
            const chapters: DownloadedChapter[] = stored ? JSON.parse(stored) : [];
            if (mangaId) {
                return chapters.filter(c => c.mangaId === mangaId);
            }
            return chapters;
        } catch (error) {
            console.error('Failed to load downloaded chapters:', error);
            return [];
        }
    }

    async isDownloaded(mangaId: string, chapterId: string): Promise<boolean> {
        const chapters = await this.getDownloadedChapters(mangaId);
        return chapters.some(c => c.chapterId === chapterId);
    }

    async clearQueue(): Promise<void> {
        this.pendingQueue = [];
        this.downloadQueue = [];
        this.notifyListeners();
    }

    async removeDownload(chapterId: string, mangaId?: string): Promise<void> {
        await this.deleteChapter(chapterId, mangaId);
    }

    getDownloadProgress(chapterId: string, mangaId?: string): number {
        const job = this.downloadQueue.find(
            j => j.chapterId === chapterId && (!mangaId || j.mangaId === mangaId)
        );
        if (!job || !job.total) return 0;
        return Math.min(100, Math.max(0, (job.progress / job.total) * 100));
    }

    onQueueChanged(listener: (queue: DownloadJob[]) => void) {
        return this.subscribe(listener);
    }

    async pauseDownloads(): Promise<void> {
        this.pauseAll();
    }

    async resumeDownloads(): Promise<void> {
        this.resumeAll();
    }

    async addToQueue(
        manga: { id: string; title: string; coverImage: string; source?: string },
        chapter: any,
        onProgress?: (progress: number) => void
    ): Promise<void> {
        return this.downloadChapter(manga, chapter, onProgress);
    }

    private async saveDownloadedChapters(chapters: DownloadedChapter[]) {
        try {
            await AsyncStorage.setItem(METADATA_KEY, JSON.stringify(chapters));
        } catch (error) {
            console.error('Failed to save downloaded chapters:', error);
        }
    }

    /**
     * Thread-safe serialized metadata update to prevent parallel downloads from overwriting each other
     */
    private enqueueMetadataUpdate(updater: (existing: DownloadedChapter[]) => DownloadedChapter[]): Promise<void> {
        this.metadataWriteChain = this.metadataWriteChain
            .then(async () => {
                const existing = await this.getDownloadedChapters();
                const updated = updater(existing);
                await this.saveDownloadedChapters(updated);
            })
            .catch((err) => {
                console.error('Metadata update error:', err);
            });
        return this.metadataWriteChain;
    }

    async downloadChapter(
        manga: { id: string; title: string; coverImage: string; source?: string },
        chapter: Chapter,
        onProgress?: (progress: number) => void
    ) {
        const key = getJobKey(manga.id, chapter.id);
        // Check if already downloading or queued
        if (this.activeDownloads[key] || this.activeDownloads[chapter.id]) return;
        if (this.pendingQueue.some(p => p.manga.id === manga.id && p.chapter.id === chapter.id)) return;
        if (this.downloadQueue.some(j => j.mangaId === manga.id && j.chapterId === chapter.id)) return;

        const sourceId = manga.source;
        if (!sourceId) {
            console.error('Cannot download chapter: no source ID');
            return;
        }

        // Clear any leftover cancellation flag for this chapter
        this.cancelledDownloads.delete(key);
        this.cancelledDownloads.delete(chapter.id);

        // Add to pending queue
        this.pendingQueue.push({ manga, chapter });
        
        // Add job to visible queue
        const job: DownloadJob = {
            chapterId: chapter.id,
            mangaId: manga.id,
            mangaTitle: manga.title,
            mangaCover: manga.coverImage,
            chapterTitle: chapter.title || `Chapter ${chapter.number}`,
            sourceId: sourceId,
            total: 0,
            progress: 0,
            status: this.isPaused ? 'paused' : 'queued',
        };
        this.updateQueue(job);

        // Start processing queue if not paused
        if (!this.isPaused) {
            this.processQueue();
        }
    }

    // Cancel a specific download
    async cancelDownload(chapterId: string, mangaId?: string): Promise<void> {
        if (!chapterId) return;
        this.cancelledDownloads.add(chapterId);
        if (mangaId) {
            this.cancelledDownloads.add(getJobKey(mangaId, chapterId));
            delete this.activeDownloads[getJobKey(mangaId, chapterId)];
        }
        delete this.activeDownloads[chapterId];
        
        // Remove from pending queue
        this.pendingQueue = this.pendingQueue.filter(
            p => !(p.chapter.id === chapterId && (!mangaId || p.manga.id === mangaId))
        );
        
        // Remove from visible queue
        const index = this.downloadQueue.findIndex(
            j => j.chapterId === chapterId && (!mangaId || j.mangaId === mangaId)
        );
        if (index >= 0) {
            const removed = this.downloadQueue[index];
            this.cancelledDownloads.add(getJobKey(removed.mangaId, removed.chapterId));
            delete this.activeDownloads[getJobKey(removed.mangaId, removed.chapterId)];
            this.downloadQueue.splice(index, 1);
            this.notifyListeners();
        }
    }

    getDownloadQueue(): DownloadJob[] {
        return this.downloadQueue;
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
        // Update all paused jobs back to downloading (if active) or queued
        this.downloadQueue.forEach(job => {
            if (job.status === 'paused') {
                const key = getJobKey(job.mangaId, job.chapterId);
                job.status = (this.activeDownloads[key] || this.activeDownloads[job.chapterId]) ? 'downloading' : 'queued';
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

    private isChapterCancelled(mangaId: string, chapterId: string): boolean {
        return this.cancelledDownloads.has(chapterId) || this.cancelledDownloads.has(getJobKey(mangaId, chapterId));
    }

    private clearCancelledFlag(mangaId: string, chapterId: string) {
        this.cancelledDownloads.delete(chapterId);
        this.cancelledDownloads.delete(getJobKey(mangaId, chapterId));
    }

    /**
     * Wait while downloads are paused (unless cancelled)
     */
    private async waitWhilePaused(mangaId: string, chapterId: string): Promise<boolean> {
        while (this.isPaused) {
            if (this.isChapterCancelled(mangaId, chapterId)) {
                return false;
            }
            await new Promise(resolve => setTimeout(resolve, 300));
        }
        return !this.isChapterCancelled(mangaId, chapterId);
    }

    private async processQueue() {
        if (this.isProcessing) return;
        if (this.isPaused) return;
        this.isProcessing = true;

        try {
            while (this.pendingQueue.length > 0 && !this.isPaused) {
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
        const key = getJobKey(manga.id, chapter.id);
        this.activeDownloads[key] = true;
        
        // Update job status to downloading (or paused if currently paused)
        const existingJob = this.downloadQueue.find(
            j => j.mangaId === manga.id && j.chapterId === chapter.id
        );
        const job: DownloadJob = {
            chapterId: chapter.id,
            mangaId: manga.id,
            mangaTitle: existingJob?.mangaTitle || manga.title,
            mangaCover: existingJob?.mangaCover || manga.coverImage,
            chapterTitle: existingJob?.chapterTitle || chapter.title || `Chapter ${chapter.number}`,
            sourceId: sourceId,
            total: 0,
            progress: 0,
            status: this.isPaused ? 'paused' : 'downloading',
        };
        this.updateQueue(job);

        try {
            // Wait if paused before starting
            if (!(await this.waitWhilePaused(manga.id, chapter.id))) {
                this.clearCancelledFlag(manga.id, chapter.id);
                return;
            }

            job.status = 'downloading';
            this.updateQueue({ ...job });

            // Fetch page URLs from the source
            console.log('[Download] Fetching pages for', chapter.id, 'from source', sourceId);
            const pageUrls = await getChapterPages(sourceId, manga.id, chapter.id);
            
            if (pageUrls.length === 0) {
                throw new Error('No pages found for chapter');
            }

            job.total = pageUrls.length;
            job.status = this.isPaused ? 'paused' : 'downloading';
            this.updateQueue({ ...job });

            // Create chapter directory: downloads/mangaId/chapterId/
            const chapterDir = new Directory(this.downloadsDir, manga.id, chapter.id);
            if (!chapterDir.exists) {
                chapterDir.create({ intermediates: true });
            }

            const localPages: string[] = [];
            let size = 0;

            for (let i = 0; i < pageUrls.length; i++) {
                // Wait if paused during page loop
                if (this.isPaused) {
                    job.status = 'paused';
                    this.updateQueue({ ...job });
                    const shouldContinue = await this.waitWhilePaused(manga.id, chapter.id);
                    if (!shouldContinue) {
                        this.clearCancelledFlag(manga.id, chapter.id);
                        if (chapterDir.exists) {
                            chapterDir.delete();
                        }
                        return;
                    }
                    job.status = 'downloading';
                    this.updateQueue({ ...job });
                }

                // Check for cancellation during download
                if (this.isChapterCancelled(manga.id, chapter.id)) {
                    this.clearCancelledFlag(manga.id, chapter.id);
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
                job.status = this.isPaused ? 'paused' : 'downloading';
                this.updateQueue({ ...job });
            }

            // Do not mark chapter as completed if pages failed to download
            if (localPages.length === 0 || localPages.length < pageUrls.length) {
                if (chapterDir.exists) {
                    try {
                        chapterDir.delete();
                    } catch {}
                }
                throw new Error(`Incomplete chapter download (${localPages.length}/${pageUrls.length} pages)`);
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

            await this.enqueueMetadataUpdate((existing) => {
                const filtered = existing.filter(
                    c => !(c.mangaId === manga.id && c.chapterId === chapter.id)
                );
                return [...filtered, downloadedChapter];
            });

            job.status = 'completed';
            this.updateQueue({ ...job });
        } catch (error) {
            console.error('Download failed:', error);
            job.status = 'failed';
            this.updateQueue({ ...job });
        } finally {
            delete this.activeDownloads[key];
            delete this.activeDownloads[chapter.id];
        }
    }

    async deleteChapter(chapterId: string, mangaId?: string) {
        try {
            await this.enqueueMetadataUpdate((chapters) => {
                const toDelete = chapters.filter(
                    c => c.chapterId === chapterId && (!mangaId || c.mangaId === mangaId)
                );
                for (const chapter of toDelete) {
                    try {
                        const chapterDir = new Directory(this.downloadsDir, chapter.mangaId, chapter.chapterId);
                        if (chapterDir.exists) {
                            chapterDir.delete();
                        }
                    } catch {}
                }
                return chapters.filter(
                    c => !(c.chapterId === chapterId && (!mangaId || c.mangaId === mangaId))
                );
            });
        } catch (error) {
            console.error('Failed to delete chapter:', error);
        }
    }

    private updateQueue(job: DownloadJob) {
        const index = this.downloadQueue.findIndex(
            j => j.mangaId === job.mangaId && j.chapterId === job.chapterId
        );
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
