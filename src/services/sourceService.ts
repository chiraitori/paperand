/**
 * Source Service - WebView-based Extension Runtime
 * 
 * This service uses a hidden WebView to execute Paperback extension JavaScript.
 * This allows ALL extensions to work without hardcoding API configurations.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

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
  type?: string;
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

export interface InstalledExtension {
  id: string;
  name: string;
  author: string;
  desc: string;
  website: string;
  version: string;
  icon: string;
  tags?: { text: string; type: string }[];
  contentRating?: string;
  websiteBaseURL?: string;
  repositoryUrl?: string;
  repoBaseUrl?: string;
  sourceJs?: string;
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
 */
const waitForBridge = async (maxWaitMs: number = 5000): Promise<boolean> => {
  const startTime = Date.now();
  while (!extensionBridge && Date.now() - startTime < maxWaitMs) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return extensionBridge !== null;
};

/**
 * Get all installed extensions
 */
export const getInstalledExtensions = async (): Promise<InstalledExtension[]> => {
  try {
    const data = await AsyncStorage.getItem(INSTALLED_EXTENSIONS_KEY);
    if (!data) return [];
    return JSON.parse(data);
  } catch (error) {
    console.error('Error getting installed extensions:', error);
    return [];
  }
};

/**
 * Download source.js for an extension
 */
export const downloadSourceJs = async (ext: InstalledExtension): Promise<string | null> => {
  const baseUrl = ext.repositoryUrl || ext.repoBaseUrl;
  if (!baseUrl) {
    console.error(`No repository URL for extension ${ext.id}`);
    return null;
  }

  const sourceUrl = `${baseUrl}/${ext.id}/source.js`;
  
  try {
    console.log(`Downloading source.js from: ${sourceUrl}`);
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } catch (error) {
    console.error(`Failed to download source.js for ${ext.id}:`, error);
    return null;
  }
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

  // If still no bridge available, return webview fallback
  if (!extensionBridge) {
    return [{
      id: `${extensionId}-browse`,
      title: `Browse ${ext.name}`,
      items: [],
      containsMoreItems: false,
      type: 'webview',
    }];
  }

  const loaded = await ensureExtensionLoaded(ext);
  if (!loaded) {
    return [{
      id: `${extensionId}-browse`,
      title: `Browse ${ext.name}`,
      items: [],
      containsMoreItems: false,
      type: 'webview',
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
 */
export const getChapterPages = async (
  extensionId: string, 
  mangaId: string,
  chapterId: string
): Promise<string[]> => {
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
      'getChapterDetails',
      [mangaId, chapterId]
    );
    
    if (!result || !result.pages) return [];
    return result.pages;
  } catch (error) {
    console.error(`Error getting chapter pages:`, error);
    return [];
  }
};

/**
 * Clear extension cache
 */
export const clearExtensionCache = () => {
  // Will be implemented by the WebView bridge
};
