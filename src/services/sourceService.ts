/**
 * Source Service - Extension Runtime
 * 
 * This service uses a hidden WebView to execute Paperback extension JavaScript.
 * When the WebView is unavailable (e.g., during background downloads), it falls back
 * to a headless runtime that executes extensions directly in the React Native JS engine.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { headlessRuntime } from './headlessExtensionRuntime';
import {
  getInstalledExtensions as getInstalledExtensionsFromStorage,
  saveInstalledExtensions,
  downloadSourceJs as downloadSourceJsFromStorage,
  InstalledExtension,
} from './extensionStorageService';

// Re-export types and functions for backward compatibility
export { InstalledExtension } from './extensionStorageService';
export const getInstalledExtensions = getInstalledExtensionsFromStorage;
export const downloadSourceJs = downloadSourceJsFromStorage;

// Types
export interface SourceManga {
  id: string;
  mangaId: string;
  title: string;
  image: string;
  subtitle?: string;
  extensionId: string;
}

export interface HomeSection {
  id: string;
  title: string;
  items: SourceManga[];
  containsMoreItems: boolean;
  type?: 'singleRowNormal' | 'singleRowLarge' | 'doubleRow' | 'featured';
}

export interface Chapter {
  id: string;
  chapNum: number;
  name: string;
  langCode: string;
  time?: string;
  group?: string;
}

export interface MangaDetails {
  id: string;
  titles: string[];
  image: string;
  author?: string;
  artist?: string;
  desc?: string;
  status?: string;
  tags?: { id: string; label: string }[];
}

export interface Tag {
  id: string;
  label: string;
}

const INSTALLED_EXTENSIONS_KEY = '@installed_extensions_data';

// Global reference to WebView bridge (will be set by ExtensionRunner component)
let extensionBridge: ExtensionBridge | null = null;

export interface ExtensionBridge {
  runExtensionMethod: (
    extensionId: string,
    method: string,
    args: any[]
  ) => Promise<any>;
  loadExtension: (extensionId: string, sourceJs: string) => Promise<boolean>;
  isLoaded: (extensionId: string) => boolean;
}

export const setExtensionBridge = (bridge: ExtensionBridge) => {
  extensionBridge = bridge;
};

export const getExtensionBridge = (): ExtensionBridge | null => {
  return extensionBridge;
};

/**
 * Wait for extension bridge to be available
 * Returns true if WebView bridge or headless runtime is available
 */
const waitForBridge = async (maxWaitMs: number = 5000): Promise<boolean> => {
  const startTime = Date.now();
  while (!extensionBridge && Date.now() - startTime < maxWaitMs) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // If WebView bridge is available, use it
  if (extensionBridge !== null) {
    return true;
  }

  // Fall back to headless runtime (for background downloads)
  console.log('[SourceService] WebView bridge unavailable, headless runtime available:', headlessRuntime.isAvailable());
  return headlessRuntime.isAvailable();
};





/**
 * Ensure extension is loaded in the WebView
 */
const ensureExtensionLoaded = async (ext: InstalledExtension): Promise<boolean> => {
  // Wait for bridge to be available
  if (!extensionBridge) {
    console.log('Waiting for extension bridge...');
    const bridgeReady = await waitForBridge(5000);
    if (!bridgeReady) {
      console.error('Extension bridge not initialized after waiting');
      return false;
    }
  }

  if (extensionBridge!.isLoaded(ext.id)) {
    return true;
  }

  let sourceJs: string | undefined = ext.sourceJs;

  if (!sourceJs) {
    const downloaded = await downloadSourceJs(ext);
    if (!downloaded) {
      return false;
    }
    sourceJs = downloaded;

    // Save the sourceJs for future use
    try {
      const extensions = await getInstalledExtensions();
      const updated = extensions.map(e =>
        e.id === ext.id ? { ...e, sourceJs } : e
      );
      await AsyncStorage.setItem(INSTALLED_EXTENSIONS_KEY, JSON.stringify(updated));
    } catch (e) {
      console.error('Failed to save sourceJs:', e);
    }
  }

  return await extensionBridge!.loadExtension(ext.id, sourceJs);
};

/**
 * Get home sections for an extension
 */
export const getHomeSections = async (extensionId: string): Promise<HomeSection[]> => {
  const extensions = await getInstalledExtensions();
  const ext = extensions.find(e => e.id === extensionId);

  if (!ext) {
    console.error(`Extension ${extensionId} not found`);
    return [];
  }

  // Wait for bridge if not available
  if (!extensionBridge) {
    console.log('Waiting for extension bridge in getHomeSections...');
    await waitForBridge(5000);
  }

  // If still no bridge available, return empty fallback
  if (!extensionBridge) {
    return [{
      id: `${extensionId}-browse`,
      title: `Browse ${ext.name}`,
      items: [],
      containsMoreItems: false,
    }];
  }

  const loaded = await ensureExtensionLoaded(ext);
  if (!loaded) {
    return [{
      id: `${extensionId}-browse`,
      title: `Browse ${ext.name}`,
      items: [],
      containsMoreItems: false,
    }];
  }

  try {
    const result = await extensionBridge.runExtensionMethod(
      extensionId,
      'getHomePageSections',
      []
    );

    if (!result || !Array.isArray(result)) {
      return [];
    }

    return result.map((section: any) => ({
      id: section.id, // Keep original section ID for getViewMoreItems
      title: section.title,
      items: (section.items || []).map((item: any) => ({
        id: item.mangaId || item.id,
        mangaId: item.mangaId || item.id,
        title: item.title || '',
        image: item.image || '',
        subtitle: item.subtitle || '',
        extensionId,
      })),
      containsMoreItems: section.containsMoreItems || false,
      type: section.type,
    }));
  } catch (error) {
    console.error(`Error getting home sections for ${extensionId}:`, error);
    return [];
  }
};

/**
 * Get more items for a home section (view more / pagination)
 */
export interface ViewMoreResult {
  results: SourceManga[];
  metadata: any;
}

export const getViewMoreItems = async (
  extensionId: string,
  sectionId: string,
  metadata?: any
): Promise<ViewMoreResult> => {
  const extensions = await getInstalledExtensions();
  const ext = extensions.find(e => e.id === extensionId);

  if (!ext) return { results: [], metadata: null };

  // Wait for bridge if not available
  if (!extensionBridge) {
    await waitForBridge(5000);
  }
  if (!extensionBridge) return { results: [], metadata: null };

  const loaded = await ensureExtensionLoaded(ext);
  if (!loaded) return { results: [], metadata: null };

  try {
    const result = await extensionBridge.runExtensionMethod(
      extensionId,
      'getViewMoreItems',
      [sectionId, metadata]
    );

    if (!result || !result.results) return { results: [], metadata: null };

    const mangaResults = result.results.map((item: any) => ({
      id: item.mangaId || item.id,
      mangaId: item.mangaId || item.id,
      title: item.title || '',
      image: item.image || '',
      subtitle: item.subtitle || '',
      extensionId,
    }));

    return {
      results: mangaResults,
      metadata: result.metadata || null,
    };
  } catch (error) {
    console.error(`getViewMoreItems error for ${extensionId}/${sectionId}:`, error);
    return { results: [], metadata: null };
  }
};

/**
 * Search manga with pagination support
 */
export interface SearchResult {
  results: SourceManga[];
  metadata: any;
}

export const searchManga = async (
  extensionId: string,
  query: string,
  metadata?: any
): Promise<SearchResult> => {
  const extensions = await getInstalledExtensions();
  const ext = extensions.find(e => e.id === extensionId);

  if (!ext) return { results: [], metadata: null };

  // Wait for bridge if not available
  if (!extensionBridge) {
    await waitForBridge(5000);
  }
  if (!extensionBridge) return { results: [], metadata: null };

  const loaded = await ensureExtensionLoaded(ext);
  if (!loaded) return { results: [], metadata: null };

  try {
    const result = await extensionBridge.runExtensionMethod(
      extensionId,
      'getSearchResults',
      [{ title: query, includedTags: [] }, metadata]
    );

    if (!result || !result.results) return { results: [], metadata: null };

    const mangaResults = result.results.map((item: any) => ({
      id: item.mangaId || item.id,
      mangaId: item.mangaId || item.id,
      title: item.title || '',
      image: item.image || '',
      subtitle: item.subtitle || '',
      extensionId,
    }));

    return {
      results: mangaResults,
      metadata: result.metadata || null,
    };
  } catch (error) {
    console.error(`Search error for ${extensionId}:`, error);
    return { results: [], metadata: null };
  }
};

/**
 * Get manga details
 */
export const getMangaDetails = async (extensionId: string, mangaId: string): Promise<MangaDetails | null> => {
  const extensions = await getInstalledExtensions();
  const ext = extensions.find(e => e.id === extensionId);

  if (!ext) return null;

  // Wait for bridge if not available
  if (!extensionBridge) {
    await waitForBridge(5000);
  }
  if (!extensionBridge) return null;

  const loaded = await ensureExtensionLoaded(ext);
  if (!loaded) return null;

  try {
    const result = await extensionBridge.runExtensionMethod(
      extensionId,
      'getMangaDetails',
      [mangaId]
    );

    if (!result) return null;

    return {
      id: mangaId,
      titles: result.titles || [result.title],
      image: result.image || '',
      author: result.author || '',
      artist: result.artist || '',
      desc: result.desc || '',
      status: result.status || '',
      tags: result.tags || [],
    };
  } catch (error) {
    console.error(`Error getting manga details:`, error);
    return null;
  }
};

/**
 * Get chapters
 */
export const getChapters = async (extensionId: string, mangaId: string): Promise<Chapter[]> => {
  const extensions = await getInstalledExtensions();
  const ext = extensions.find(e => e.id === extensionId);

  if (!ext) return [];

  // Wait for bridge if not available
  if (!extensionBridge) {
    await waitForBridge(5000);
  }
  if (!extensionBridge) return [];

  const loaded = await ensureExtensionLoaded(ext);
  if (!loaded) return [];

  try {
    const result = await extensionBridge.runExtensionMethod(
      extensionId,
      'getChapters',
      [mangaId]
    );

    if (!result || !Array.isArray(result)) return [];

    return result.map((ch: any) => ({
      id: String(ch.id),
      chapNum: ch.chapNum || 0,
      name: ch.name || '',
      langCode: ch.langCode || '',
      time: ch.time || '',
      group: ch.group || '',
    }));
  } catch (error) {
    console.error(`Error getting chapters:`, error);
    return [];
  }
};

/**
 * Get chapter pages
 * Uses WebView bridge when available, falls back to headless runtime for background downloads
 */
export const getChapterPages = async (
  extensionId: string,
  mangaId: string,
  chapterId: string
): Promise<string[]> => {
  const extensions = await getInstalledExtensions();
  const ext = extensions.find(e => e.id === extensionId);

  if (!ext) return [];

  // Try WebView bridge first
  if (extensionBridge) {
    const loaded = await ensureExtensionLoaded(ext);
    if (loaded) {
      try {
        const result = await extensionBridge.runExtensionMethod(
          extensionId,
          'getChapterDetails',
          [mangaId, chapterId]
        );

        if (result?.pages) return result.pages;
      } catch (error) {
        console.error(`[SourceService] Error getting chapter pages via WebView:`, error);
      }
    }
  }

  // Wait for WebView bridge if not available
  if (!extensionBridge) {
    console.log('[SourceService] WebView bridge not available, waiting...');
    await waitForBridge(3000); // Shorter wait for background
  }

  // If WebView bridge available now, use it
  if (extensionBridge) {
    const loaded = await ensureExtensionLoaded(ext);
    if (loaded) {
      try {
        const result = await extensionBridge.runExtensionMethod(
          extensionId,
          'getChapterDetails',
          [mangaId, chapterId]
        );

        if (result?.pages) return result.pages;
      } catch (error) {
        console.error(`[SourceService] Error getting chapter pages via WebView:`, error);
      }
    }
  }

  // Fall back to headless runtime (for background downloads)
  console.log('[SourceService] Using headless runtime for getChapterPages');
  try {
    const result = await headlessRuntime.runExtensionMethod(
      extensionId,
      'getChapterDetails',
      [mangaId, chapterId]
    );

    if (result?.pages) return result.pages;
    return [];
  } catch (error) {
    console.error(`[SourceService] Error getting chapter pages via headless runtime:`, error);
    return [];
  }
};

/**
 * Decrypt a DRM-protected image on-demand
 */
export const decryptDrmImage = async (
  extensionId: string,
  imageUrl: string
): Promise<string | null> => {
  const extensions = await getInstalledExtensions();
  const ext = extensions.find(e => e.id === extensionId);

  if (!ext) return null;

  // Wait for bridge if not available
  if (!extensionBridge) {
    await waitForBridge(5000);
  }
  if (!extensionBridge) return null;

  const loaded = await ensureExtensionLoaded(ext);
  if (!loaded) return null;

  try {
    const result = await extensionBridge.runExtensionMethod(
      extensionId,
      'decryptDrmImage',
      [imageUrl]
    );

    return result || null;
  } catch (error) {
    console.error(`Error decrypting DRM image:`, error);
    return null;
  }
};

/**
 * Fetch image through extension (for proper headers/cookies)
 * Uses WebView bridge when available, falls back to headless runtime for background downloads
 */
export const fetchImageThroughExtension = async (
  extensionId: string,
  imageUrl: string
): Promise<string | null> => {
  const extensions = await getInstalledExtensions();
  const ext = extensions.find(e => e.id === extensionId);

  if (!ext) return null;

  // Try WebView bridge first
  if (extensionBridge) {
    const loaded = await ensureExtensionLoaded(ext);
    if (loaded) {
      try {
        const result = await extensionBridge.runExtensionMethod(
          extensionId,
          'fetchImage',
          [imageUrl]
        );
        if (result) return result;
      } catch (error) {
        console.error(`[SourceService] Error fetching image via WebView:`, error);
      }
    }
  }

  // Wait for WebView bridge if not available
  if (!extensionBridge) {
    console.log('[SourceService] WebView bridge not available for fetchImage, waiting...');
    await waitForBridge(2000);
  }

  // If WebView bridge available now, use it
  if (extensionBridge) {
    const loaded = await ensureExtensionLoaded(ext);
    if (loaded) {
      try {
        const result = await extensionBridge.runExtensionMethod(
          extensionId,
          'fetchImage',
          [imageUrl]
        );
        if (result) return result;
      } catch (error) {
        console.error(`[SourceService] Error fetching image via WebView:`, error);
      }
    }
  }

  // Fall back to direct fetch with default headers (headless doesn't support fetchImage yet)
  console.log('[SourceService] Using direct fetch for image');
  try {
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'image/*,*/*',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    return 'data:image/jpeg;base64,' + base64;
  } catch (error) {
    console.error(`[SourceService] Error fetching image directly:`, error);
    return null;
  }
};

/**
 * Get tags/genres from extension
 */
export const getTags = async (extensionId: string): Promise<Tag[]> => {
  const extensions = await getInstalledExtensions();
  const ext = extensions.find(e => e.id === extensionId);

  if (!ext) return [];

  // Wait for bridge if not available
  if (!extensionBridge) {
    await waitForBridge(5000);
  }
  if (!extensionBridge) return [];

  const loaded = await ensureExtensionLoaded(ext);
  if (!loaded) return [];

  try {
    const result = await extensionBridge.runExtensionMethod(
      extensionId,
      'getSearchTags',
      []
    );

    if (!result || !Array.isArray(result)) return [];

    // Flatten tag sections into a single list
    const allTags: Tag[] = [];
    for (const section of result) {
      if (section.tags && Array.isArray(section.tags)) {
        for (const tag of section.tags) {
          allTags.push({
            id: tag.id || '',
            label: tag.label || tag.title || '',
          });
        }
      }
    }

    return allTags;
  } catch (error: any) {
    // Silently return empty array if method doesn't exist (not all extensions support tags)
    if (error?.message?.includes('Method not found')) {
      return [];
    }
    console.error(`Error getting tags for ${extensionId}:`, error);
    return [];
  }
};

/**
 * Search manga by tag/genre
 */
export const searchByTag = async (
  extensionId: string,
  tagId: string,
  metadata?: any
): Promise<SearchResult> => {
  const extensions = await getInstalledExtensions();
  const ext = extensions.find(e => e.id === extensionId);

  if (!ext) return { results: [], metadata: null };

  // Wait for bridge if not available
  if (!extensionBridge) {
    await waitForBridge(5000);
  }
  if (!extensionBridge) return { results: [], metadata: null };

  const loaded = await ensureExtensionLoaded(ext);
  if (!loaded) return { results: [], metadata: null };

  try {
    const result = await extensionBridge.runExtensionMethod(
      extensionId,
      'getSearchResults',
      [{ title: '', includedTags: [{ id: tagId, label: '' }] }, metadata]
    );

    if (!result || !result.results) return { results: [], metadata: null };

    const mangaResults = result.results.map((item: any) => ({
      id: item.mangaId || item.id,
      mangaId: item.mangaId || item.id,
      title: item.title || '',
      image: item.image || '',
      subtitle: item.subtitle || '',
      extensionId,
    }));

    return {
      results: mangaResults,
      metadata: result.metadata || null,
    };
  } catch (error) {
    console.error(`searchByTag error for ${extensionId}/${tagId}:`, error);
    return { results: [], metadata: null };
  }
};

/**
 * Clear extension cache
 */
export const clearExtensionCache = () => {
  // Will be implemented by the WebView bridge
};

// Extension Settings Types
export interface DUIRow {
  id: string;
  type: 'navigation' | 'button' | 'select' | 'switch' | 'input' | 'secureInput' | 'label' | 'stepper';
  label: string;
  value?: any;
  options?: string[];
  optionLabels?: string[]; // Resolved labels for select options
  form?: DUISection[];
  onTap?: () => Promise<void>;
  labelResolver?: (option: string) => Promise<string>;
  allowsMultiselect?: boolean;
  minValue?: number;
  maxValue?: number;
  step?: number;
  hasOnTap?: boolean; // For button rows
}

export interface DUISection {
  id: string;
  header?: string;
  footer?: string;
  rows: DUIRow[];
  isHidden?: boolean;
}

export interface ExtensionSettings {
  id: string;
  header?: string;
  sections: DUISection[];
}

const EXTENSION_STATE_PREFIX = '@extension_state_';

/**
 * Get extension state from storage
 */
export const getExtensionState = async (extensionId: string, key: string): Promise<any> => {
  try {
    const storageKey = `${EXTENSION_STATE_PREFIX}${extensionId}_${key}`;
    const value = await AsyncStorage.getItem(storageKey);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    console.error(`Error getting extension state for ${extensionId}/${key}:`, error);
    return null;
  }
};

/**
 * Set extension state to storage
 */
export const setExtensionState = async (extensionId: string, key: string, value: any): Promise<void> => {
  try {
    const storageKey = `${EXTENSION_STATE_PREFIX}${extensionId}_${key}`;
    await AsyncStorage.setItem(storageKey, JSON.stringify(value));
  } catch (error) {
    console.error(`Error setting extension state for ${extensionId}/${key}:`, error);
  }
};

/**
 * Check if extension has settings UI
 */
export const hasExtensionSettings = async (extensionId: string): Promise<boolean> => {
  const extensions = await getInstalledExtensions();
  const ext = extensions.find(e => e.id === extensionId);

  if (!ext) return false;

  // Wait for bridge if not available
  if (!extensionBridge) {
    await waitForBridge(5000);
  }
  if (!extensionBridge) return false;

  const loaded = await ensureExtensionLoaded(ext);
  if (!loaded) return false;

  try {
    // Try calling getSourceMenu - if it exists, the extension has settings
    const result = await extensionBridge.runExtensionMethod(
      extensionId,
      'getSourceMenu',
      []
    );
    return result !== null && result !== undefined;
  } catch (error: any) {
    // Method not found means no settings
    if (error?.message?.includes('Method not found')) {
      return false;
    }
    return false;
  }
};

/**
 * Get extension settings menu - the WebView already resolves all async functions
 */
export const getExtensionSettings = async (extensionId: string): Promise<ExtensionSettings | null> => {
  const extensions = await getInstalledExtensions();
  const ext = extensions.find(e => e.id === extensionId);

  if (!ext) return null;

  // Wait for bridge if not available
  if (!extensionBridge) {
    await waitForBridge(5000);
  }
  if (!extensionBridge) return null;

  const loaded = await ensureExtensionLoaded(ext);
  if (!loaded) return null;

  try {
    // The WebView's getSourceMenu handler resolves all async functions
    const result = await extensionBridge.runExtensionMethod(
      extensionId,
      'getSourceMenu',
      []
    );

    if (!result) return null;

    // Result is already resolved with structure like:
    // { id, header, isHidden, rows: [{ id, label, type, form?, value?, options?, optionLabels? }] }
    return {
      id: result.id || 'main',
      header: result.header || 'Source Settings',
      sections: [{
        id: result.id || 'main',
        header: result.header,
        rows: result.rows || [],
        isHidden: result.isHidden,
      }],
    };
  } catch (error: any) {
    if (error?.message?.includes('Method not found')) {
      return null;
    }
    console.error(`Error getting extension settings for ${extensionId}:`, error);
    return null;
  }
};

/**
 * Update extension setting value through the extension's binding
 */
export const updateExtensionSetting = async (
  extensionId: string,
  settingPath: string,
  value: any
): Promise<boolean> => {
  const extensions = await getInstalledExtensions();
  const ext = extensions.find(e => e.id === extensionId);

  if (!ext) return false;

  if (!extensionBridge) {
    await waitForBridge(5000);
  }
  if (!extensionBridge) return false;

  const loaded = await ensureExtensionLoaded(ext);
  if (!loaded) return false;

  try {
    const result = await extensionBridge.runExtensionMethod(
      extensionId,
      'setSettingValue',
      [settingPath, value]
    );
    return result === true;
  } catch (error) {
    console.error(`Error updating setting ${settingPath} for ${extensionId}:`, error);
    return false;
  }
};

/**
 * Invoke a button action in extension settings
 */
export const invokeExtensionSettingAction = async (
  extensionId: string,
  settingPath: string
): Promise<boolean> => {
  const extensions = await getInstalledExtensions();
  const ext = extensions.find(e => e.id === extensionId);

  if (!ext) return false;

  if (!extensionBridge) {
    await waitForBridge(5000);
  }
  if (!extensionBridge) return false;

  const loaded = await ensureExtensionLoaded(ext);
  if (!loaded) return false;

  try {
    const result = await extensionBridge.runExtensionMethod(
      extensionId,
      'invokeSettingAction',
      [settingPath]
    );
    return result === true;
  } catch (error) {
    console.error(`Error invoking setting action ${settingPath} for ${extensionId}:`, error);
    return false;
  }
};
