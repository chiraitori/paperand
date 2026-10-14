import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Manga, LibraryEntry, ReadingProgress, Chapter, LibraryUpdateResult } from '../types';
import { getChapters } from '../services/sourceService';
import { getGeneralSettings } from '../services/settingsService';

interface LibraryContextType {
  library: LibraryEntry[];
  favorites: LibraryEntry[];
  history: LibraryEntry[];
  addToLibrary: (manga: Manga) => Promise<void>;
  removeFromLibrary: (mangaId: string) => Promise<void>;
  toggleFavorite: (mangaId: string) => Promise<void>;
  updateProgress: (progress: ReadingProgress, manga?: Manga) => Promise<void>;
  getProgress: (mangaId: string) => ReadingProgress | null;
  isInLibrary: (mangaId: string) => boolean;
  isFavorite: (mangaId: string) => boolean;
  isChapterRead: (mangaId: string, chapterId: string) => boolean;
  getReadChapters: (mangaId: string) => string[];
  markChapterAsRead: (mangaId: string, chapterId: string, manga?: Manga) => Promise<void>;
  markChapterAsUnread: (mangaId: string, chapterId: string) => Promise<void>;
  markAllAboveAsRead: (mangaId: string, chapterId: string, allChapterIds: string[]) => Promise<void>;
  markAllBelowAsRead: (mangaId: string, chapterId: string, allChapterIds: string[]) => Promise<void>;
  clearHistory: () => Promise<void>;
  clearLibrary: () => Promise<void>;
  categories: string[];
  addCategory: (name: string) => Promise<void>;
  removeCategory: (name: string) => Promise<void>;
  setMangaCategory: (mangaId: string, category: string | undefined) => Promise<void>;
  updateLibraryChapters: (
    onProgress?: (current: number, total: number, currentTitle: string) => void
  ) => Promise<LibraryUpdateResult>;
  migrateManga: (oldMangaId: string, newManga: Manga) => Promise<void>;
}

const LibraryContext = createContext<LibraryContextType | undefined>(undefined);

const LIBRARY_STORAGE_KEY = '@paperback_library';
const CATEGORIES_STORAGE_KEY = '@paperback_library_categories';
const HISTORY_STORAGE_KEY = '@reading_history';
const DEFAULT_CATEGORIES = ['Reading', 'Plan to Read', 'Completed', 'On Hold', 'Dropped'];

export const LibraryProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [library, setLibrary] = useState<LibraryEntry[]>([]);
  const [history, setHistory] = useState<LibraryEntry[]>([]);
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);

  useEffect(() => {
    loadLibrary();
  }, []);

  const isValidEntry = (entry: any): boolean => {
    if (!entry || !entry.manga || !entry.manga.id) return false;
    const title = entry.manga.title?.trim();
    if (!title || title.toLowerCase() === 'unknown manga') return false;
    return true;
  };

  const loadLibrary = async () => {
    try {
      const [storedLib, storedCats, storedHistory] = await Promise.all([
        AsyncStorage.getItem(LIBRARY_STORAGE_KEY),
        AsyncStorage.getItem(CATEGORIES_STORAGE_KEY),
        AsyncStorage.getItem(HISTORY_STORAGE_KEY),
      ]);

      let validEntries: LibraryEntry[] = [];
      if (storedLib) {
        const parsed = JSON.parse(storedLib);
        if (Array.isArray(parsed)) {
          validEntries = parsed.filter(isValidEntry).map((entry: any) => ({
            ...entry,
            readChapters: entry.readChapters || [],
          }));
          setLibrary(validEntries);
          if (validEntries.length !== parsed.length) {
            await AsyncStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(validEntries));
          }
        }
      }

      if (storedHistory) {
        const parsedHist = JSON.parse(storedHistory);
        if (Array.isArray(parsedHist)) {
          const validHist = parsedHist.filter(isValidEntry).map((entry: any) => ({
            ...entry,
            readChapters: entry.readChapters || [],
          }));
          setHistory(validHist);
          if (validHist.length !== parsedHist.length) {
            await AsyncStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(validHist));
          }
        }
      } else if (validEntries.length > 0) {
        // Fallback: seed history from existing library entries that have reading progress
        const initialHistory = validEntries.filter(e => e.progress !== null);
        if (initialHistory.length > 0) {
          setHistory(initialHistory);
          await AsyncStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(initialHistory));
        }
      }

      if (storedCats) {
        const parsedCats = JSON.parse(storedCats);
        if (Array.isArray(parsedCats) && parsedCats.length > 0) {
          setCategories(parsedCats);
        }
      }
    } catch (error) {
      console.error('Failed to load library or categories:', error);
    }
  };

  const saveLibrary = async (newLibrary: LibraryEntry[]) => {
    try {
      await AsyncStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(newLibrary));
      setLibrary(newLibrary);
    } catch (error) {
      console.error('Failed to save library:', error);
    }
  };

  const saveHistory = async (newHistory: LibraryEntry[]) => {
    try {
      await AsyncStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(newHistory));
      setHistory(newHistory);
    } catch (error) {
      console.error('Failed to save history:', error);
    }
  };

  const addToLibrary = async (manga: Manga) => {
    if (!manga?.id || !manga.title || manga.title.toLowerCase() === 'unknown manga') return;
    const existingEntry = library.find(e => e.manga.id === manga.id);
    if (existingEntry) return;

    const entry: LibraryEntry = {
      manga,
      addedAt: new Date().toISOString(),
      progress: null,
      isFavorite: false,
      readChapters: [],
    };
    await saveLibrary([...library, entry]);
  };

  const removeFromLibrary = async (mangaId: string) => {
    const newLibrary = library.filter(entry => entry.manga.id !== mangaId);
    await saveLibrary(newLibrary);
  };

  const toggleFavorite = async (mangaId: string) => {
    const newLibrary = library.map(entry =>
      entry.manga.id === mangaId
        ? { ...entry, isFavorite: !entry.isFavorite }
        : entry
    );
    await saveLibrary(newLibrary);
  };

  const updateProgress = async (progress: ReadingProgress, manga?: Manga) => {
    // Paperback Incognito Mode: Chapter progress is still tracked even when hideReadHistory is enabled
    const settings = await getGeneralSettings();

    // Paperback ChapterProgressCompletionCondition: onReachingEnd | onChapterOpen | onReaching80Percent
    const isCompleted = (() => {
      switch (settings.chapterCompletionCondition) {
        case 'onChapterOpen':
          return true;
        case 'onReaching80Percent':
          return progress.percentage >= 80;
        case 'onReachingEnd':
        default:
          return progress.pageNumber >= progress.totalPages || progress.percentage >= 100;
      }
    })();

    const existingEntry = library.find(entry => entry.manga.id === progress.mangaId);

    // Only update library entry if this manga is already in the user's library
    if (existingEntry) {
      const alreadyRead = existingEntry.readChapters.includes(progress.chapterId);
      const shouldMarkRead = isCompleted && !alreadyRead;
      const newLibrary = library.map(entry =>
        entry.manga.id === progress.mangaId
          ? {
            ...entry,
            progress,
            lastReadChapter: progress.chapterId,
            readChapters: shouldMarkRead
              ? [...entry.readChapters, progress.chapterId]
              : entry.readChapters,
          }
          : entry
      );
      await saveLibrary(newLibrary);
    }

    // Update reading history (separate from library entries)
    const targetManga = existingEntry?.manga || manga;
    if (targetManga && targetManga.id && targetManga.title && targetManga.title.toLowerCase() !== 'unknown manga') {
      const existingHistoryEntry = history.find(e => e.manga.id === progress.mangaId);
      let updatedHistory: LibraryEntry[];
      if (existingHistoryEntry) {
        const alreadyRead = existingHistoryEntry.readChapters.includes(progress.chapterId);
        const shouldMarkRead = isCompleted && !alreadyRead;
        const updatedEntry: LibraryEntry = {
          ...existingHistoryEntry,
          manga: targetManga,
          progress,
          lastReadChapter: progress.chapterId,
          readChapters: shouldMarkRead
            ? [...existingHistoryEntry.readChapters, progress.chapterId]
            : existingHistoryEntry.readChapters,
        };
        updatedHistory = [updatedEntry, ...history.filter(e => e.manga.id !== progress.mangaId)].slice(0, 100);
      } else {
        const newHistoryEntry: LibraryEntry = {
          manga: targetManga,
          addedAt: new Date().toISOString(),
          progress,
          isFavorite: false,
          readChapters: isCompleted ? [progress.chapterId] : [],
        };
        updatedHistory = [newHistoryEntry, ...history].slice(0, 100);
      }
      await saveHistory(updatedHistory);
    }
  };

  const markChapterAsRead = async (mangaId: string, chapterId: string, manga?: Manga) => {
    const existingEntry = library.find(entry => entry.manga.id === mangaId);

    if (existingEntry) {
      if (!existingEntry.readChapters.includes(chapterId)) {
        const newLibrary = library.map(entry =>
          entry.manga.id === mangaId
            ? { ...entry, readChapters: [...entry.readChapters, chapterId] }
            : entry
        );
        await saveLibrary(newLibrary);
      }
    }
  };

  const markChapterAsUnread = async (mangaId: string, chapterId: string) => {
    const newLibrary = library.map(entry =>
      entry.manga.id === mangaId
        ? { ...entry, readChapters: entry.readChapters.filter(id => id !== chapterId) }
        : entry
    );
    await saveLibrary(newLibrary);
  };

  const markAllAboveAsRead = async (mangaId: string, chapterId: string, allChapterIds: string[]) => {
    const chapterIndex = allChapterIds.indexOf(chapterId);
    if (chapterIndex === -1) return;

    // Mark all chapters from index 0 to current (inclusive) - "above" in descending list
    const chaptersToMark = allChapterIds.slice(0, chapterIndex + 1);

    const existingEntry = library.find(entry => entry.manga.id === mangaId);
    if (existingEntry) {
      const newReadChapters = [...new Set([...existingEntry.readChapters, ...chaptersToMark])];
      const newLibrary = library.map(entry =>
        entry.manga.id === mangaId
          ? { ...entry, readChapters: newReadChapters }
          : entry
      );
      await saveLibrary(newLibrary);
    }
  };

  const markAllBelowAsRead = async (mangaId: string, chapterId: string, allChapterIds: string[]) => {
    const chapterIndex = allChapterIds.indexOf(chapterId);
    if (chapterIndex === -1) return;

    // Mark all chapters from current to end - "below" in descending list
    const chaptersToMark = allChapterIds.slice(chapterIndex);

    const existingEntry = library.find(entry => entry.manga.id === mangaId);
    if (existingEntry) {
      const newReadChapters = [...new Set([...existingEntry.readChapters, ...chaptersToMark])];
      const newLibrary = library.map(entry =>
        entry.manga.id === mangaId
          ? { ...entry, readChapters: newReadChapters }
          : entry
      );
      await saveLibrary(newLibrary);
    }
  };

  const getProgress = useCallback((mangaId: string): ReadingProgress | null => {
    const entry = library.find(e => e.manga.id === mangaId) || history.find(e => e.manga.id === mangaId);
    return entry?.progress || null;
  }, [library, history]);

  const isInLibrary = useCallback((mangaId: string): boolean => {
    return library.some(entry => entry.manga.id === mangaId);
  }, [library]);

  const isFavorite = useCallback((mangaId: string): boolean => {
    const entry = library.find(e => e.manga.id === mangaId);
    return entry?.isFavorite || false;
  }, [library]);

  const isChapterRead = useCallback((mangaId: string, chapterId: string): boolean => {
    const entry = library.find(e => e.manga.id === mangaId) || history.find(e => e.manga.id === mangaId);
    return entry?.readChapters?.includes(chapterId) || false;
  }, [library, history]);

  const getReadChapters = useCallback((mangaId: string): string[] => {
    const entry = library.find(e => e.manga.id === mangaId) || history.find(e => e.manga.id === mangaId);
    return entry?.readChapters || [];
  }, [library, history]);

  const clearHistory = async () => {
    await saveHistory([]);
    const newLibrary = library.map(entry => ({
      ...entry,
      progress: null,
      lastReadChapter: undefined,
      readChapters: [],
    }));
    await saveLibrary(newLibrary);
  };

  const clearLibrary = async () => {
    await saveLibrary([]);
  };

  const addCategory = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || categories.includes(trimmed)) return;
    const updated = [...categories, trimmed];
    setCategories(updated);
    await AsyncStorage.setItem(CATEGORIES_STORAGE_KEY, JSON.stringify(updated));
  };

  const removeCategory = async (name: string) => {
    const updated = categories.filter(c => c !== name);
    setCategories(updated);
    await AsyncStorage.setItem(CATEGORIES_STORAGE_KEY, JSON.stringify(updated));

    // Clear category on manga that had this category
    const updatedLib = library.map(entry =>
      entry.category === name ? { ...entry, category: undefined } : entry
    );
    await saveLibrary(updatedLib);
  };

  const setMangaCategory = async (mangaId: string, category: string | undefined) => {
    const updatedLib = library.map(entry =>
      entry.manga.id === mangaId ? { ...entry, category } : entry
    );
    await saveLibrary(updatedLib);
  };

  const updateLibraryChapters = async (
    onProgress?: (current: number, total: number, currentTitle: string) => void
  ): Promise<LibraryUpdateResult> => {
    let updatedMangaCount = 0;
    let newChaptersCount = 0;
    const details: LibraryUpdateResult['details'] = [];
    const currentLibrary = [...library];
    const updatedLibrary = [...library];

    for (let i = 0; i < currentLibrary.length; i++) {
      const entry = currentLibrary[i];
      if (onProgress) {
        onProgress(i + 1, currentLibrary.length, entry.manga.title);
      }

      const sourceId = entry.manga.source;
      if (!sourceId) continue;

      try {
        const fetchedChapters = await getChapters(sourceId, entry.manga.id);
        if (fetchedChapters && fetchedChapters.length > 0) {
          const existingIds = new Set(entry.manga.chapters.map(c => c.id));
          const newChapters = fetchedChapters.filter(c => !existingIds.has(c.id));

          if (newChapters.length > 0) {
            updatedMangaCount++;
            newChaptersCount += newChapters.length;
            details.push({
              mangaId: entry.manga.id,
              title: entry.manga.title,
              newChapters: newChapters.length,
              latestChapter: fetchedChapters[0]?.name || `Ch. ${fetchedChapters[0]?.chapNum}`,
            });

            const mappedChapters: Chapter[] = fetchedChapters.map(ch => ({
              id: ch.id,
              mangaId: entry.manga.id,
              number: ch.chapNum,
              title: ch.name,
              pages: [],
              releaseDate: ch.time || new Date().toISOString(),
              isRead: entry.readChapters.includes(ch.id),
            }));

            updatedLibrary[i] = {
              ...entry,
              manga: {
                ...entry.manga,
                chapters: mappedChapters,
                lastUpdated: new Date().toISOString(),
              },
            };
          }
        }
      } catch (e) {
        console.warn(`[LibraryUpdate] Failed to update ${entry.manga.title}:`, e);
      }
    }

    if (updatedMangaCount > 0) {
      await saveLibrary(updatedLibrary);
    }

    return { updatedMangaCount, newChaptersCount, details };
  };

  const migrateManga = async (oldMangaId: string, newManga: Manga) => {
    const existingEntry = library.find(e => e.manga.id === oldMangaId);
    if (!existingEntry) return;

    // Map read chapters from old manga by chapter number
    const oldReadNumbers = new Set<number>();
    for (const ch of existingEntry.manga.chapters) {
      if (existingEntry.readChapters.includes(ch.id)) {
        oldReadNumbers.add(ch.number);
      }
    }

    const newReadChapterIds: string[] = [];
    for (const ch of newManga.chapters) {
      if (oldReadNumbers.has(ch.number)) {
        newReadChapterIds.push(ch.id);
      }
    }

    const newEntry: LibraryEntry = {
      manga: newManga,
      addedAt: existingEntry.addedAt,
      isFavorite: existingEntry.isFavorite,
      category: existingEntry.category,
      readChapters: newReadChapterIds,
      progress: existingEntry.progress
        ? {
            ...existingEntry.progress,
            mangaId: newManga.id,
            chapterId: newManga.chapters.find(c => c.number === (existingEntry.manga.chapters.find(oc => oc.id === existingEntry.progress?.chapterId)?.number))?.id || newManga.chapters[0]?.id || '',
          }
        : null,
    };

    const newLibrary = library.map(e => (e.manga.id === oldMangaId ? newEntry : e));
    await saveLibrary(newLibrary);
  };

  const favorites = library.filter(entry => entry.isFavorite);

  return (
    <LibraryContext.Provider value={{
      library,
      favorites,
      history,
      addToLibrary,
      removeFromLibrary,
      toggleFavorite,
      updateProgress,
      getProgress,
      isInLibrary,
      isFavorite,
      isChapterRead,
      getReadChapters,
      markChapterAsRead,
      markChapterAsUnread,
      markAllAboveAsRead,
      markAllBelowAsRead,
      clearHistory,
      clearLibrary,
      categories,
      addCategory,
      removeCategory,
      setMangaCategory,
      updateLibraryChapters,
      migrateManga,
    }}>
      {children}
    </LibraryContext.Provider>
  );
};

export const useLibrary = (): LibraryContextType => {
  const context = useContext(LibraryContext);
  if (!context) {
    throw new Error('useLibrary must be used within a LibraryProvider');
  }
  return context;
};
