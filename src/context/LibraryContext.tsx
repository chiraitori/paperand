import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Manga, LibraryEntry, ReadingProgress } from '../types';

interface LibraryContextType {
  library: LibraryEntry[];
  favorites: LibraryEntry[];
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
}

const LibraryContext = createContext<LibraryContextType | undefined>(undefined);

const LIBRARY_STORAGE_KEY = '@paperback_library';

export const LibraryProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [library, setLibrary] = useState<LibraryEntry[]>([]);

  useEffect(() => {
    loadLibrary();
  }, []);

  const loadLibrary = async () => {
    try {
      const stored = await AsyncStorage.getItem(LIBRARY_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Migrate old entries that don't have readChapters
        const migrated = parsed.map((entry: any) => ({
          ...entry,
          readChapters: entry.readChapters || [],
        }));
        setLibrary(migrated);
      }
    } catch (error) {
      console.error('Failed to load library:', error);
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

  const addToLibrary = async (manga: Manga) => {
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
    const existingEntry = library.find(entry => entry.manga.id === progress.mangaId);

    if (existingEntry) {
      const newLibrary = library.map(entry =>
        entry.manga.id === progress.mangaId
          ? {
            ...entry,
            progress,
            lastReadChapter: progress.chapterId,
            readChapters: entry.readChapters.includes(progress.chapterId)
              ? entry.readChapters
              : [...entry.readChapters, progress.chapterId],
          }
          : entry
      );
      await saveLibrary(newLibrary);
    } else if (manga) {
      const entry: LibraryEntry = {
        manga,
        addedAt: new Date().toISOString(),
        progress,
        isFavorite: false,
        readChapters: [progress.chapterId],
      };
      await saveLibrary([...library, entry]);
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
    } else if (manga) {
      const entry: LibraryEntry = {
        manga,
        addedAt: new Date().toISOString(),
        progress: null,
        isFavorite: false,
        readChapters: [chapterId],
      };
      await saveLibrary([...library, entry]);
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
    const entry = library.find(e => e.manga.id === mangaId);
    return entry?.progress || null;
  }, [library]);

  const isInLibrary = useCallback((mangaId: string): boolean => {
    return library.some(entry => entry.manga.id === mangaId);
  }, [library]);

  const isFavorite = useCallback((mangaId: string): boolean => {
    const entry = library.find(e => e.manga.id === mangaId);
    return entry?.isFavorite || false;
  }, [library]);

  const isChapterRead = useCallback((mangaId: string, chapterId: string): boolean => {
    const entry = library.find(e => e.manga.id === mangaId);
    return entry?.readChapters?.includes(chapterId) || false;
  }, [library]);

  const getReadChapters = useCallback((mangaId: string): string[] => {
    const entry = library.find(e => e.manga.id === mangaId);
    return entry?.readChapters || [];
  }, [library]);

  const clearHistory = async () => {
    const newLibrary = library
      .map(entry => ({ ...entry, progress: null, lastReadChapter: undefined, readChapters: [] }))
      .filter(entry => entry.isFavorite);
    await saveLibrary(newLibrary);
  };

  const clearLibrary = async () => {
    await saveLibrary([]);
  };

  const favorites = library.filter(entry => entry.isFavorite);

  return (
    <LibraryContext.Provider value={{
      library,
      favorites,
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
