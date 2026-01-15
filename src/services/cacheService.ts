import { Image } from 'expo-image';
import { Directory, File, Paths } from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { 
  Manga, 
  Chapter, 
  CachedMangaMetadata, 
  CachedChapterList, 
  CachedChapterInfo,
  CachedPageInfo 
} from '../types';

/**
 * Service for managing image cache and manga metadata cache in the app
 */

// Storage keys
const CACHE_LIMIT_KEY = '@paperand_cache_limit';
const MANGA_METADATA_KEY = '@paperand_manga_metadata';
const CHAPTER_LIST_KEY = '@paperand_chapter_lists';
const PAGE_CACHE_KEY = '@paperand_page_cache';

// Cache expiration times
const METADATA_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
const CHAPTER_LIST_CACHE_DURATION = 1 * 60 * 60 * 1000; // 1 hour (chapters update more frequently)

// Cache limit options in bytes
export const CACHE_LIMIT_OPTIONS = {
  'No Cache': 0,
  '300MB': 300 * 1024 * 1024,
  '500MB': 500 * 1024 * 1024,
  '1GB': 1024 * 1024 * 1024,
  '3GB': 3 * 1024 * 1024 * 1024,
  '5GB': 5 * 1024 * 1024 * 1024,
  '10GB': 10 * 1024 * 1024 * 1024,
} as const;

export type CacheLimitOption = keyof typeof CACHE_LIMIT_OPTIONS;

// Get the current cache limit setting
export const getCacheLimit = async (): Promise<CacheLimitOption> => {
  try {
    const limit = await AsyncStorage.getItem(CACHE_LIMIT_KEY);
    if (limit && limit in CACHE_LIMIT_OPTIONS) {
      return limit as CacheLimitOption;
    }
    return '500MB'; // Default to 500MB
  } catch {
    return '500MB';
  }
};

// Set the cache limit
export const setCacheLimit = async (limit: CacheLimitOption): Promise<void> => {
  try {
    await AsyncStorage.setItem(CACHE_LIMIT_KEY, limit);
    // Check and enforce the new limit
    await enforceCacheLimit();
  } catch (error) {
    console.error('Error setting cache limit:', error);
  }
};

// Enforce the cache limit by clearing old files if over limit
export const enforceCacheLimit = async (): Promise<void> => {
  try {
    const limitOption = await getCacheLimit();
    const limitBytes = CACHE_LIMIT_OPTIONS[limitOption];
    
    // If No Cache, always clear
    if (limitBytes === 0) {
      await clearImageCache();
      return;
    }
    
    const currentSize = await getImageCacheSize();
    
    // If under limit, no action needed
    if (currentSize <= limitBytes) return;
    
    console.log(`[Cache] Current size ${formatCacheSize(currentSize)} exceeds limit ${limitOption}, clearing...`);
    
    // Clear cache to enforce limit
    await clearImageCache();
  } catch (error) {
    console.error('Error enforcing cache limit:', error);
  }
};

// Get the size of the image cache directory
export const getImageCacheSize = async (): Promise<number> => {
  try {
    const cacheDir = Paths.cache;
    
    // Check if cache directory exists
    if (!cacheDir || !cacheDir.exists) {
      return 0;
    }
    
    // Calculate total size of cache directory
    return calculateDirectorySize(cacheDir);
  } catch (error) {
    // If the new API fails, return 0 and let user try clearing anyway
    console.warn('Could not calculate cache size:', error);
    return 0;
  }
};

// Recursively calculate directory size using new File/Directory API
const calculateDirectorySize = (directory: Directory): number => {
  let totalSize = 0;
  
  try {
    const items = directory.list();
    
    for (const item of items) {
      try {
        if (item instanceof Directory) {
          totalSize += calculateDirectorySize(item);
        } else if (item instanceof File && item.size) {
          totalSize += item.size;
        }
      } catch {
        // Skip items we can't read
        continue;
      }
    }
  } catch {
    // If we can't list, return what we have
  }
  
  return totalSize;
};

// Format bytes to human readable string
export const formatCacheSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  
  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${units[i]}`;
};

// Clear both memory and disk cache
export const clearImageCache = async (): Promise<boolean> => {
  try {
    // Clear expo-image caches
    const diskCleared = await Image.clearDiskCache();
    const memoryCleared = await Image.clearMemoryCache();
    
    // Also try to clear cache directory files
    try {
      const cacheDir = Paths.cache;
      if (cacheDir && cacheDir.exists) {
        const items = cacheDir.list();
        for (const item of items) {
          try {
            item.delete();
          } catch {
            // Skip files we can't delete
          }
        }
      }
    } catch (e) {
      console.warn('Could not clear cache directory:', e);
    }
    
    console.log(`[Cache] Disk cache cleared: ${diskCleared}, Memory cache cleared: ${memoryCleared}`);
    
    return true; // Return true since we attempted to clear
  } catch (error) {
    console.error('Error clearing image cache:', error);
    return false;
  }
};

// Clear only memory cache (faster, for low memory situations)
export const clearMemoryCache = async (): Promise<boolean> => {
  try {
    return await Image.clearMemoryCache();
  } catch (error) {
    console.error('Error clearing memory cache:', error);
    return false;
  }
};

// Clear only disk cache
export const clearDiskCache = async (): Promise<boolean> => {
  try {
    return await Image.clearDiskCache();
  } catch (error) {
    console.error('Error clearing disk cache:', error);
    return false;
  }
};

// Check if an image is cached
export const isImageCached = async (url: string): Promise<boolean> => {
  try {
    const cachePath = await Image.getCachePathAsync(url);
    return cachePath !== null;
  } catch (error) {
    console.error('Error checking image cache:', error);
    return false;
  }
};

// Prefetch images for offline use
export const prefetchImages = async (urls: string[]): Promise<boolean> => {
  try {
    return await Image.prefetch(urls, { cachePolicy: 'disk' });
  } catch (error) {
    console.error('Error prefetching images:', error);
    return false;
  }
};

// ============================================
// MANGA METADATA CACHE
// ============================================

// Get all cached manga metadata
const getMangaMetadataCache = async (): Promise<Record<string, CachedMangaMetadata>> => {
  try {
    const stored = await AsyncStorage.getItem(MANGA_METADATA_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
};

// Save manga metadata cache
const saveMangaMetadataCache = async (cache: Record<string, CachedMangaMetadata>): Promise<void> => {
  try {
    await AsyncStorage.setItem(MANGA_METADATA_KEY, JSON.stringify(cache));
  } catch (error) {
    console.error('Error saving manga metadata cache:', error);
  }
};

// Cache manga metadata
export const cacheMangaMetadata = async (manga: Manga, sourceId: string): Promise<void> => {
  try {
    const cache = await getMangaMetadataCache();
    const cacheKey = `${sourceId}:${manga.id}`;
    const now = new Date();
    
    cache[cacheKey] = {
      mangaId: manga.id,
      sourceId,
      title: manga.title,
      author: manga.author,
      artist: manga.artist,
      description: manga.description,
      coverImage: manga.coverImage,
      genres: manga.genres,
      status: manga.status,
      cachedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + METADATA_CACHE_DURATION).toISOString(),
    };
    
    await saveMangaMetadataCache(cache);
    
    // Also prefetch the cover image
    if (manga.coverImage) {
      prefetchImages([manga.coverImage]).catch(() => {});
    }
  } catch (error) {
    console.error('Error caching manga metadata:', error);
  }
};

// Get cached manga metadata
export const getCachedMangaMetadata = async (
  mangaId: string, 
  sourceId: string
): Promise<CachedMangaMetadata | null> => {
  try {
    const cache = await getMangaMetadataCache();
    const cacheKey = `${sourceId}:${mangaId}`;
    const cached = cache[cacheKey];
    
    if (!cached) return null;
    
    // Check if expired
    if (new Date(cached.expiresAt) < new Date()) {
      // Expired but still return it - caller can decide to refresh
      console.log(`[Cache] Manga metadata expired for ${mangaId}`);
    }
    
    return cached;
  } catch {
    return null;
  }
};

// Check if manga metadata is cached and not expired
export const isMangaMetadataCached = async (mangaId: string, sourceId: string): Promise<boolean> => {
  try {
    const cached = await getCachedMangaMetadata(mangaId, sourceId);
    if (!cached) return false;
    return new Date(cached.expiresAt) > new Date();
  } catch {
    return false;
  }
};

// ============================================
// CHAPTER LIST CACHE
// ============================================

// Get all cached chapter lists
const getChapterListCache = async (): Promise<Record<string, CachedChapterList>> => {
  try {
    const stored = await AsyncStorage.getItem(CHAPTER_LIST_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
};

// Save chapter list cache
const saveChapterListCache = async (cache: Record<string, CachedChapterList>): Promise<void> => {
  try {
    await AsyncStorage.setItem(CHAPTER_LIST_KEY, JSON.stringify(cache));
  } catch (error) {
    console.error('Error saving chapter list cache:', error);
  }
};

// Cache chapter list for a manga
export const cacheChapterList = async (
  mangaId: string, 
  sourceId: string, 
  chapters: Chapter[]
): Promise<void> => {
  try {
    const cache = await getChapterListCache();
    const cacheKey = `${sourceId}:${mangaId}`;
    const now = new Date();
    
    const cachedChapters: CachedChapterInfo[] = chapters.map(ch => ({
      id: ch.id,
      number: ch.number,
      title: ch.title,
      releaseDate: ch.releaseDate,
      pageCount: ch.pages?.length || undefined,
    }));
    
    cache[cacheKey] = {
      mangaId,
      sourceId,
      chapters: cachedChapters,
      cachedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + CHAPTER_LIST_CACHE_DURATION).toISOString(),
    };
    
    await saveChapterListCache(cache);
  } catch (error) {
    console.error('Error caching chapter list:', error);
  }
};

// Get cached chapter list
export const getCachedChapterList = async (
  mangaId: string, 
  sourceId: string
): Promise<CachedChapterList | null> => {
  try {
    const cache = await getChapterListCache();
    const cacheKey = `${sourceId}:${mangaId}`;
    const cached = cache[cacheKey];
    
    if (!cached) return null;
    
    if (new Date(cached.expiresAt) < new Date()) {
      console.log(`[Cache] Chapter list expired for ${mangaId}`);
    }
    
    return cached;
  } catch {
    return null;
  }
};

// Check if chapter list is cached and not expired
export const isChapterListCached = async (mangaId: string, sourceId: string): Promise<boolean> => {
  try {
    const cached = await getCachedChapterList(mangaId, sourceId);
    if (!cached) return false;
    return new Date(cached.expiresAt) > new Date();
  } catch {
    return false;
  }
};

// ============================================
// PAGE CACHE (Per-page tracking with chapter association)
// ============================================

// Get all cached page info
const getPageCache = async (): Promise<Record<string, CachedPageInfo[]>> => {
  try {
    const stored = await AsyncStorage.getItem(PAGE_CACHE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
};

// Save page cache
const savePageCache = async (cache: Record<string, CachedPageInfo[]>): Promise<void> => {
  try {
    await AsyncStorage.setItem(PAGE_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.error('Error saving page cache:', error);
  }
};

// Cache pages for a chapter (called when reading a chapter)
export const cacheChapterPages = async (
  mangaId: string,
  chapterId: string,
  pages: { pageNumber: number; imageUrl: string }[]
): Promise<void> => {
  try {
    const cache = await getPageCache();
    const cacheKey = `${mangaId}:${chapterId}`;
    const now = new Date().toISOString();
    
    cache[cacheKey] = pages.map(page => ({
      mangaId,
      chapterId,
      pageNumber: page.pageNumber,
      imageUrl: page.imageUrl,
      cachedAt: now,
    }));
    
    await savePageCache(cache);
    
    // Prefetch images for smoother reading
    const urls = pages.map(p => p.imageUrl);
    prefetchImages(urls).catch(() => {});
  } catch (error) {
    console.error('Error caching chapter pages:', error);
  }
};

// Get cached pages for a chapter
export const getCachedChapterPages = async (
  mangaId: string,
  chapterId: string
): Promise<CachedPageInfo[] | null> => {
  try {
    const cache = await getPageCache();
    const cacheKey = `${mangaId}:${chapterId}`;
    return cache[cacheKey] || null;
  } catch {
    return null;
  }
};

// Update page with local path (when downloaded)
export const updatePageLocalPath = async (
  mangaId: string,
  chapterId: string,
  pageNumber: number,
  localPath: string
): Promise<void> => {
  try {
    const cache = await getPageCache();
    const cacheKey = `${mangaId}:${chapterId}`;
    
    if (cache[cacheKey]) {
      const pageIndex = cache[cacheKey].findIndex(p => p.pageNumber === pageNumber);
      if (pageIndex >= 0) {
        cache[cacheKey][pageIndex].localPath = localPath;
        await savePageCache(cache);
      }
    }
  } catch (error) {
    console.error('Error updating page local path:', error);
  }
};

// ============================================
// CACHE CLEANUP
// ============================================

// Clear all metadata caches (manga, chapters, pages)
export const clearMetadataCache = async (): Promise<void> => {
  try {
    await AsyncStorage.multiRemove([
      MANGA_METADATA_KEY,
      CHAPTER_LIST_KEY,
      PAGE_CACHE_KEY,
    ]);
    console.log('[Cache] Metadata cache cleared');
  } catch (error) {
    console.error('Error clearing metadata cache:', error);
  }
};

// Clear expired entries from all caches
export const cleanupExpiredCache = async (): Promise<void> => {
  try {
    const now = new Date();
    
    // Clean manga metadata
    const mangaCache = await getMangaMetadataCache();
    const cleanedMangaCache: Record<string, CachedMangaMetadata> = {};
    for (const [key, value] of Object.entries(mangaCache)) {
      // Keep entries for 7 days even if expired (for offline use)
      const expiresPlus7Days = new Date(new Date(value.expiresAt).getTime() + 7 * 24 * 60 * 60 * 1000);
      if (expiresPlus7Days > now) {
        cleanedMangaCache[key] = value;
      }
    }
    await saveMangaMetadataCache(cleanedMangaCache);
    
    // Clean chapter lists
    const chapterCache = await getChapterListCache();
    const cleanedChapterCache: Record<string, CachedChapterList> = {};
    for (const [key, value] of Object.entries(chapterCache)) {
      const expiresPlus7Days = new Date(new Date(value.expiresAt).getTime() + 7 * 24 * 60 * 60 * 1000);
      if (expiresPlus7Days > now) {
        cleanedChapterCache[key] = value;
      }
    }
    await saveChapterListCache(cleanedChapterCache);
    
    console.log('[Cache] Expired cache entries cleaned up');
  } catch (error) {
    console.error('Error cleaning up expired cache:', error);
  }
};

// Get cache statistics
export const getCacheStats = async (): Promise<{
  mangaCount: number;
  chapterListCount: number;
  pageEntriesCount: number;
  imageCacheSize: number;
}> => {
  try {
    const mangaCache = await getMangaMetadataCache();
    const chapterCache = await getChapterListCache();
    const pageCache = await getPageCache();
    const imageCacheSize = await getImageCacheSize();
    
    let pageEntriesCount = 0;
    for (const pages of Object.values(pageCache)) {
      pageEntriesCount += pages.length;
    }
    
    return {
      mangaCount: Object.keys(mangaCache).length,
      chapterListCount: Object.keys(chapterCache).length,
      pageEntriesCount,
      imageCacheSize,
    };
  } catch {
    return {
      mangaCount: 0,
      chapterListCount: 0,
      pageEntriesCount: 0,
      imageCacheSize: 0,
    };
  }
};
