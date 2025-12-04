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
  clearHistory: () => Promise<void>;
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
        setLibrary(JSON.parse(stored));
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
    console.log('[Library] updateProgress called:', progress.mangaId, 'library size:', library.length);
    
    // Check if manga is in library
    const existingEntry = library.find(entry => entry.manga.id === progress.mangaId);
    
    if (existingEntry) {
      console.log('[Library] Updating existing entry');
      // Update existing entry
      const newLibrary = library.map(entry =>
        entry.manga.id === progress.mangaId
          ? { ...entry, progress, lastReadChapter: progress.chapterId }
          : entry
      );
      await saveLibrary(newLibrary);
    } else if (manga) {
      console.log('[Library] Adding new entry with progress');
      // Add new entry with progress
      const entry: LibraryEntry = {
        manga,
        addedAt: new Date().toISOString(),
        progress,
        isFavorite: false,
      };
      await saveLibrary([...library, entry]);
    } else {
      console.log('[Library] No existing entry and no manga provided!');
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

  const clearHistory = async () => {
    // Clear progress from all entries but keep favorites in library
    const newLibrary = library
      .map(entry => ({ ...entry, progress: null, lastReadChapter: undefined }))
      .filter(entry => entry.isFavorite); // Only keep favorites
    await saveLibrary(newLibrary);
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
      clearHistory,
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
