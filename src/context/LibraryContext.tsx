import React, { createContext, useContext, useState, useEffect, useRef, ReactNode, useCallback } from 'react';
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
  reloadLibrary: () => Promise<void>;
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

  const libraryRef = useRef<LibraryEntry[]>([]);
  const historyRef = useRef<LibraryEntry[]>([]);

  useEffect(() => {
    loadLibrary();
  }, []);

  const isValidEntry = (entry: any): boolean => {
    if (!entry || !entry.manga || !entry.manga.id) return false;
    const title = entry.manga.title?.trim();
    if (!title || title.toLowerCase() === 'unknown manga') return false;
    return true;
  };

  const loadLibrary = useCallback(async () => {
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
          libraryRef.current = validEntries;
          setLibrary(validEntries);
          if (validEntries.length !== parsed.length) {
            await AsyncStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(validEntries));
          }
        }
      } else {
        libraryRef.current = [];
        setLibrary([]);
      }

      if (storedHistory) {
        const parsedHist = JSON.parse(storedHistory);
        if (Array.isArray(parsedHist)) {
          const validHist = parsedHist.filter(isValidEntry).map((entry: any) => ({
            ...entry,
            readChapters: entry.readChapters || [],
          }));
          historyRef.current = validHist;
          setHistory(validHist);
          if (validHist.length !== parsedHist.length) {
            await AsyncStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(validHist));
          }
        }
      } else if (validEntries.length > 0) {
        // Fallback: seed history from existing library entries that have reading progress
        const initialHistory = validEntries.filter(e => e.progress !== null);
        if (initialHistory.length > 0) {
          historyRef.current = initialHistory;
          setHistory(initialHistory);
          await AsyncStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(initialHistory));
        } else {
          historyRef.current = [];
          setHistory([]);
        }
      } else {
        historyRef.current = [];
        setHistory([]);
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
  }, []);

  const saveLibrary = async (newLibrary: LibraryEntry[]) => {
    try {
      libraryRef.current = newLibrary;
      setLibrary(newLibrary);
      await AsyncStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(newLibrary));
    } catch (error) {
      console.error('Failed to save library:', error);
    }
  };

  const saveHistory = async (newHistory: LibraryEntry[]) => {
    try {
      historyRef.current = newHistory;
      setHistory(newHistory);
      await AsyncStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(newHistory));
    } catch (error) {
      console.error('Failed to save history:', error);
    }
  };

  const mergeMangaMetadata = (existingManga: Manga, incomingManga: Manga): Manga => {
    return {
      ...existingManga,
      ...incomingManga,
      author: incomingManga.author || existingManga.author,
      description: incomingManga.description || existingManga.description,
      coverImage: incomingManga.coverImage || existingManga.coverImage,
      genres: incomingManga.genres && incomingManga.genres.length > 0 ? incomingManga.genres : existingManga.genres,
      chapters: incomingManga.chapters && incomingManga.chapters.length > 0 ? incomingManga.chapters : existingManga.chapters,
    };
  };

  const addToLibrary = async (manga: Manga) => {
    if (!manga?.id || !manga.title || manga.title.toLowerCase() === 'unknown manga') return;
    const currentLib = libraryRef.current;
    const existingEntry = currentLib.find(e => e.manga.id === manga.id);
    if (existingEntry) return;

    // Carry over any readChapters/progress already tracked in history for this manga
    const existingHistory = historyRef.current.find(e => e.manga.id === manga.id);

    const entry: LibraryEntry = {
      manga: existingHistory ? mergeMangaMetadata(existingHistory.manga, manga) : manga,
      addedAt: new Date().toISOString(),
      progress: existingHistory?.progress || null,
      lastReadChapter: existingHistory?.lastReadChapter,
      isFavorite: false,
      readChapters: existingHistory?.readChapters ? [...existingHistory.readChapters] : [],
    };
    await saveLibrary([...currentLib, entry]);
  };

  const removeFromLibrary = async (mangaId: string) => {
    const newLibrary = libraryRef.current.filter(entry => entry.manga.id !== mangaId);
    await saveLibrary(newLibrary);
  };

  const toggleFavorite = async (mangaId: string) => {
    const newLibrary = libraryRef.current.map(entry =>
      entry.manga.id === mangaId
        ? { ...entry, isFavorite: !entry.isFavorite }
        : entry
    );
    await saveLibrary(newLibrary);
  };

  const updateProgress = async (progress: ReadingProgress, manga?: Manga) => {
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

    const currentLib = libraryRef.current;
    const existingEntry = currentLib.find(entry => entry.manga.id === progress.mangaId);

    // Only update library entry if this manga is already in the user's library
    if (existingEntry) {
      const alreadyRead = existingEntry.readChapters.includes(progress.chapterId);
      const shouldMarkRead = isCompleted && !alreadyRead;
      const mergedManga = manga ? mergeMangaMetadata(existingEntry.manga, manga) : existingEntry.manga;
      const newLibrary = currentLib.map(entry =>
        entry.manga.id === progress.mangaId
          ? {
            ...entry,
            manga: mergedManga,
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

    // Paperback Incognito Mode: Do not save reading history when hideReadHistory is enabled
    if (settings.hideReadHistory) {
      return;
    }

    // Update reading history (separate from library entries)
    const currentHist = historyRef.current;
    const existingHistoryEntry = currentHist.find(e => e.manga.id === progress.mangaId);
    const baseManga = existingEntry?.manga || existingHistoryEntry?.manga;
    const targetManga = baseManga && manga ? mergeMangaMetadata(baseManga, manga) : (manga || baseManga);

    if (targetManga && targetManga.id && targetManga.title && targetManga.title.toLowerCase() !== 'unknown manga') {
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
        updatedHistory = [updatedEntry, ...currentHist.filter(e => e.manga.id !== progress.mangaId)].slice(0, 100);
      } else {
        const newHistoryEntry: LibraryEntry = {
          manga: targetManga,
          addedAt: new Date().toISOString(),
          progress,
          lastReadChapter: progress.chapterId,
          isFavorite: false,
          readChapters: isCompleted ? [progress.chapterId] : [],
        };
        updatedHistory = [newHistoryEntry, ...currentHist].slice(0, 100);
      }
      await saveHistory(updatedHistory);
    }
  };

  const markChapterAsRead = async (mangaId: string, chapterId: string, manga?: Manga) => {
    const currentLib = libraryRef.current;
    const existingEntry = currentLib.find(entry => entry.manga.id === mangaId);

    if (existingEntry) {
      if (!existingEntry.readChapters.includes(chapterId)) {
        const newLibrary = currentLib.map(entry =>
          entry.manga.id === mangaId
            ? { ...entry, readChapters: [...entry.readChapters, chapterId] }
            : entry
        );
        await saveLibrary(newLibrary);
      }
    }

    // Also keep history entry in sync (or create one if non-library manga was passed)
    const currentHist = historyRef.current;
    const existingHist = currentHist.find(entry => entry.manga.id === mangaId);
    if (existingHist) {
      if (!existingHist.readChapters.includes(chapterId)) {
        const newHistory = currentHist.map(entry =>
          entry.manga.id === mangaId
            ? { ...entry, readChapters: [...entry.readChapters, chapterId] }
            : entry
        );
        await saveHistory(newHistory);
      }
    } else if (!existingEntry && manga && manga.id && manga.title) {
      const newHistEntry: LibraryEntry = {
        manga,
        addedAt: new Date().toISOString(),
        progress: null,
        isFavorite: false,
        readChapters: [chapterId],
      };
      await saveHistory([newHistEntry, ...currentHist].slice(0, 100));
    }
  };

  const markChapterAsUnread = async (mangaId: string, chapterId: string) => {
    const currentLib = libraryRef.current;
    if (currentLib.some(entry => entry.manga.id === mangaId)) {
      const newLibrary = currentLib.map(entry =>
        entry.manga.id === mangaId
          ? { ...entry, readChapters: entry.readChapters.filter(id => id !== chapterId) }
          : entry
      );
      await saveLibrary(newLibrary);
    }

    const currentHist = historyRef.current;
    if (currentHist.some(entry => entry.manga.id === mangaId)) {
      const newHistory = currentHist.map(entry =>
        entry.manga.id === mangaId
          ? { ...entry, readChapters: entry.readChapters.filter(id => id !== chapterId) }
          : entry
      );
      await saveHistory(newHistory);
    }
  };

  const markAllAboveAsRead = async (mangaId: string, chapterId: string, allChapterIds: string[]) => {
    const chapterIndex = allChapterIds.indexOf(chapterId);
    if (chapterIndex === -1) return;

    // Mark all chapters from index 0 to current (inclusive) - "above" in current sorted list
    const chaptersToMark = allChapterIds.slice(0, chapterIndex + 1);

    const currentLib = libraryRef.current;
    const existingEntry = currentLib.find(entry => entry.manga.id === mangaId);
    if (existingEntry) {
      const newReadChapters = [...new Set([...existingEntry.readChapters, ...chaptersToMark])];
      const newLibrary = currentLib.map(entry =>
        entry.manga.id === mangaId
          ? { ...entry, readChapters: newReadChapters }
          : entry
      );
      await saveLibrary(newLibrary);
    }

    const currentHist = historyRef.current;
    const existingHist = currentHist.find(entry => entry.manga.id === mangaId);
    if (existingHist) {
      const newReadChapters = [...new Set([...existingHist.readChapters, ...chaptersToMark])];
      const newHistory = currentHist.map(entry =>
        entry.manga.id === mangaId
          ? { ...entry, readChapters: newReadChapters }
          : entry
      );
      await saveHistory(newHistory);
    }
  };

  const markAllBelowAsRead = async (mangaId: string, chapterId: string, allChapterIds: string[]) => {
    const chapterIndex = allChapterIds.indexOf(chapterId);
    if (chapterIndex === -1) return;

    // Mark all chapters from current to end - "below" in current sorted list
    const chaptersToMark = allChapterIds.slice(chapterIndex);

    const currentLib = libraryRef.current;
    const existingEntry = currentLib.find(entry => entry.manga.id === mangaId);
    if (existingEntry) {
      const newReadChapters = [...new Set([...existingEntry.readChapters, ...chaptersToMark])];
      const newLibrary = currentLib.map(entry =>
        entry.manga.id === mangaId
          ? { ...entry, readChapters: newReadChapters }
          : entry
      );
      await saveLibrary(newLibrary);
    }

    const currentHist = historyRef.current;
    const existingHist = currentHist.find(entry => entry.manga.id === mangaId);
    if (existingHist) {
      const newReadChapters = [...new Set([...existingHist.readChapters, ...chaptersToMark])];
      const newHistory = currentHist.map(entry =>
        entry.manga.id === mangaId
          ? { ...entry, readChapters: newReadChapters }
          : entry
      );
      await saveHistory(newHistory);
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
    const libEntry = library.find(e => e.manga.id === mangaId);
    const histEntry = history.find(e => e.manga.id === mangaId);
    return Boolean(libEntry?.readChapters?.includes(chapterId) || histEntry?.readChapters?.includes(chapterId));
  }, [library, history]);

  const getReadChapters = useCallback((mangaId: string): string[] => {
    const libEntry = library.find(e => e.manga.id === mangaId);
    const histEntry = history.find(e => e.manga.id === mangaId);
    if (libEntry && histEntry) {
      return [...new Set([...(libEntry.readChapters || []), ...(histEntry.readChapters || [])])];
    }
    return libEntry?.readChapters || histEntry?.readChapters || [];
  }, [library, history]);

  const clearHistory = async () => {
    await saveHistory([]);
    const newLibrary = libraryRef.current.map(entry => ({
      ...entry,
      progress: null,
      lastReadChapter: undefined,
      // Preserve readChapters on library items so clearing reading history doesn't wipe completed chapters
      readChapters: entry.readChapters || [],
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
    const updatedLib = libraryRef.current.map(entry =>
      entry.category === name ? { ...entry, category: undefined } : entry
    );
    await saveLibrary(updatedLib);
  };

  const setMangaCategory = async (mangaId: string, category: string | undefined) => {
    const updatedLib = libraryRef.current.map(entry =>
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
    const snapshot = [...libraryRef.current];
    const updatedChaptersMap = new Map<string, Chapter[]>();

    for (let i = 0; i < snapshot.length; i++) {
      const entry = snapshot[i];
      if (onProgress) {
        onProgress(i + 1, snapshot.length, entry.manga.title);
      }

      const sourceId = entry.manga.source;
      if (!sourceId) continue;

      try {
        const fetchedChapters = await getChapters(sourceId, entry.manga.id);
        if (fetchedChapters && fetchedChapters.length > 0) {
          const existingChapters = Array.isArray(entry.manga.chapters) ? entry.manga.chapters : [];
          const existingIds = new Set(existingChapters.map(c => c.id));
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

            const latestEntry = libraryRef.current.find(e => e.manga.id === entry.manga.id) || entry;
            const mappedChapters: Chapter[] = fetchedChapters.map(ch => ({
              id: ch.id,
              mangaId: entry.manga.id,
              number: ch.chapNum,
              title: ch.name,
              pages: [],
              releaseDate: ch.time || new Date().toISOString(),
              isRead: latestEntry.readChapters.includes(ch.id),
            }));

            updatedChaptersMap.set(entry.manga.id, mappedChapters);
          }
        }
      } catch (e) {
        console.warn(`[LibraryUpdate] Failed to update ${entry.manga.title}:`, e);
      }
    }

    if (updatedChaptersMap.size > 0) {
      // Apply updates onto the latest libraryRef.current so concurrent edits are never lost
      const mergedLibrary = libraryRef.current.map(entry => {
        const mappedChapters = updatedChaptersMap.get(entry.manga.id);
        if (!mappedChapters) return entry;
        return {
          ...entry,
          manga: {
            ...entry.manga,
            chapters: mappedChapters.map(ch => ({
              ...ch,
              isRead: entry.readChapters.includes(ch.id),
            })),
            lastUpdated: new Date().toISOString(),
          },
        };
      });
      await saveLibrary(mergedLibrary);
    }

    return { updatedMangaCount, newChaptersCount, details };
  };

  const migrateManga = async (oldMangaId: string, newManga: Manga) => {
    const currentLib = libraryRef.current;
    const existingEntry = currentLib.find(e => e.manga.id === oldMangaId);
    if (!existingEntry) return;

    const oldChapters = Array.isArray(existingEntry.manga.chapters) ? existingEntry.manga.chapters : [];
    const newChapters = Array.isArray(newManga.chapters) ? newManga.chapters : [];

    // Map read chapters from old manga by chapter number (or ID fallback)
    const oldReadNumbers = new Set<number>();
    const oldReadIds = new Set<string>(existingEntry.readChapters);
    for (const ch of oldChapters) {
      if (oldReadIds.has(ch.id)) {
        oldReadNumbers.add(ch.number);
      }
    }

    let newReadChapterIds: string[] = [];
    if (newChapters.length > 0) {
      for (const ch of newChapters) {
        if (oldReadNumbers.has(ch.number) || oldReadIds.has(ch.id)) {
          newReadChapterIds.push(ch.id);
        }
      }
      // If oldChapters was empty so oldReadNumbers couldn't map, preserve existing readChapters if newReadChapterIds is empty
      if (newReadChapterIds.length === 0 && oldChapters.length === 0 && existingEntry.readChapters.length > 0) {
        newReadChapterIds = [...existingEntry.readChapters];
      }
    } else {
      // Target chapters failed to load - preserve old readChapters rather than wiping them
      newReadChapterIds = [...existingEntry.readChapters];
    }

    const updatedNewManga: Manga = {
      ...newManga,
      chapters: newChapters.map(ch => ({
        ...ch,
        isRead: newReadChapterIds.includes(ch.id),
      })),
    };

    const matchedProgressChapterId = existingEntry.progress
      ? newChapters.find(
          c => c.number === oldChapters.find(oc => oc.id === existingEntry.progress?.chapterId)?.number
        )?.id ||
        newChapters.find(c => c.id === existingEntry.progress?.chapterId)?.id ||
        existingEntry.progress.chapterId
      : undefined;

    const newEntry: LibraryEntry = {
      manga: updatedNewManga,
      addedAt: existingEntry.addedAt,
      isFavorite: existingEntry.isFavorite,
      category: existingEntry.category,
      readChapters: newReadChapterIds,
      lastReadChapter: matchedProgressChapterId || existingEntry.lastReadChapter,
      progress: existingEntry.progress
        ? {
            ...existingEntry.progress,
            mangaId: newManga.id,
            chapterId: matchedProgressChapterId || '',
          }
        : null,
    };

    const newLibrary = libraryRef.current.map(e => (e.manga.id === oldMangaId ? newEntry : e));
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
      reloadLibrary: loadLibrary,
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
