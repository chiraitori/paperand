import { Image } from 'expo-image';
import { Directory, File, Paths } from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Service for managing image cache in the app
 */

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

const CACHE_LIMIT_KEY = '@paperand_cache_limit';

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
