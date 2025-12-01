import { Image } from 'expo-image';
import { Directory, File, Paths } from 'expo-file-system';

/**
 * Service for managing image cache in the app
 */

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
