import React from 'react';
import { render, waitFor, act } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Manga, ReadingProgress } from '../types';

// In-memory mock for AsyncStorage
const memoryStore: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(async (key: string, value: string) => {
    memoryStore[key] = value;
  }),
  getItem: jest.fn(async (key: string) => {
    return memoryStore[key] || null;
  }),
  removeItem: jest.fn(async (key: string) => {
    delete memoryStore[key];
  }),
}));

jest.mock('../services/sourceService', () => ({
  getChapters: jest.fn().mockResolvedValue([]),
}));

jest.mock('../services/settingsService', () => ({
  getGeneralSettings: jest.fn().mockResolvedValue({
    chapterCompletionCondition: 'onReachingEnd',
  }),
}));

import { LibraryProvider, useLibrary } from '../context/LibraryContext';

const mockManga1: Manga = {
  id: 'manga-1',
  title: 'One Piece',
  author: 'Oda',
  description: 'Pirates',
  coverImage: 'https://example.com/op.jpg',
  genres: ['Action'],
  status: 'ongoing',
  chapters: [
    { id: 'ch1', mangaId: 'manga-1', number: 1, title: 'Romance Dawn', pages: [], releaseDate: '2020-01-01', isRead: false },
  ],
  lastUpdated: '2020-01-01',
  source: 'source-1',
};

const mockManga2: Manga = {
  id: 'manga-2',
  title: 'Naruto',
  author: 'Kishimoto',
  description: 'Ninja',
  coverImage: 'https://example.com/naruto.jpg',
  genres: ['Action'],
  status: 'completed',
  chapters: [
    { id: 'ch1-n', mangaId: 'manga-2', number: 1, title: 'Uzumaki', pages: [], releaseDate: '2020-01-01', isRead: false },
  ],
  lastUpdated: '2020-01-01',
  source: 'source-1',
};

describe('LibraryContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(memoryStore).forEach((k) => delete memoryStore[k]);
  });

  it('sanitizes corrupt or Unknown Manga entries from storage on load', async () => {
    const corruptEntries = [
      {
        manga: { id: 'bad-1', title: 'Unknown Manga', coverImage: '' },
        addedAt: new Date().toISOString(),
        progress: null,
        isFavorite: false,
        readChapters: [],
      },
      {
        manga: mockManga1,
        addedAt: new Date().toISOString(),
        progress: null,
        isFavorite: false,
        readChapters: [],
      },
      {
        manga: { id: '', title: '   ' },
        addedAt: new Date().toISOString(),
        progress: null,
        isFavorite: false,
        readChapters: [],
      },
    ];

    memoryStore['@paperback_library'] = JSON.stringify(corruptEntries);

    let contextVal: any = null;
    const TestConsumer = () => {
      contextVal = useLibrary();
      return null;
    };

    render(
      <LibraryProvider>
        <TestConsumer />
      </LibraryProvider>
    );

    await waitFor(() => {
      expect(contextVal.library).toBeDefined();
      expect(contextVal.library.length).toBe(1);
      expect(contextVal.library[0].manga.id).toBe('manga-1');
      expect(contextVal.library[0].manga.title).toBe('One Piece');
    });

    // Check that AsyncStorage was cleaned up
    const stored = memoryStore['@paperback_library'];
    const parsed = JSON.parse(stored || '[]');
    expect(parsed.length).toBe(1);
    expect(parsed[0].manga.id).toBe('manga-1');
  });

  it('does NOT add non-library manga to library when reading or updating progress', async () => {
    let contextVal: any = null;
    const TestConsumer = () => {
      contextVal = useLibrary();
      return null;
    };

    render(
      <LibraryProvider>
        <TestConsumer />
      </LibraryProvider>
    );

    await waitFor(() => expect(contextVal).toBeTruthy());

    // Progress on non-library manga
    const progress: ReadingProgress = {
      mangaId: mockManga2.id,
      chapterId: 'ch1-n',
      pageNumber: 5,
      totalPages: 20,
      percentage: 25,
      lastRead: new Date().toISOString(),
    };

    await act(async () => {
      await contextVal.updateProgress(progress, mockManga2);
    });

    // Manga must NOT be in library!
    expect(contextVal.library.length).toBe(0);
    expect(contextVal.isInLibrary(mockManga2.id)).toBe(false);

    // But it MUST be in history!
    expect(contextVal.history.length).toBe(1);
    expect(contextVal.history[0].manga.id).toBe(mockManga2.id);
    expect(contextVal.history[0].progress?.pageNumber).toBe(5);
  });

  it('updates progress on existing library manga and records in history', async () => {
    let contextVal: any = null;
    const TestConsumer = () => {
      contextVal = useLibrary();
      return null;
    };

    render(
      <LibraryProvider>
        <TestConsumer />
      </LibraryProvider>
    );

    await waitFor(() => expect(contextVal).toBeTruthy());

    // Explicitly add to library
    await act(async () => {
      await contextVal.addToLibrary(mockManga1);
    });

    expect(contextVal.library.length).toBe(1);
    expect(contextVal.isInLibrary(mockManga1.id)).toBe(true);

    const progress: ReadingProgress = {
      mangaId: mockManga1.id,
      chapterId: 'ch1',
      pageNumber: 10,
      totalPages: 20,
      percentage: 50,
      lastRead: new Date().toISOString(),
    };

    await act(async () => {
      await contextVal.updateProgress(progress, mockManga1);
    });

    expect(contextVal.library.length).toBe(1);
    expect(contextVal.library[0].progress?.pageNumber).toBe(10);
    expect(contextVal.history.length).toBe(1);
    expect(contextVal.history[0].manga.id).toBe(mockManga1.id);
  });

  it('does not add manga with Unknown Manga title', async () => {
    let contextVal: any = null;
    const TestConsumer = () => {
      contextVal = useLibrary();
      return null;
    };

    render(
      <LibraryProvider>
        <TestConsumer />
      </LibraryProvider>
    );

    await waitFor(() => expect(contextVal).toBeTruthy());

    await act(async () => {
      await contextVal.addToLibrary({
        ...mockManga1,
        id: 'bad-unknown',
        title: 'Unknown Manga',
      });
    });

    expect(contextVal.library.length).toBe(0);
  });

  it('clears reading history while preserving library entries', async () => {
    let contextVal: any = null;
    const TestConsumer = () => {
      contextVal = useLibrary();
      return null;
    };

    render(
      <LibraryProvider>
        <TestConsumer />
      </LibraryProvider>
    );

    await waitFor(() => expect(contextVal).toBeTruthy());

    await act(async () => {
      await contextVal.addToLibrary(mockManga1);
      await contextVal.updateProgress(
        {
          mangaId: mockManga1.id,
          chapterId: 'ch1',
          pageNumber: 15,
          totalPages: 20,
          percentage: 75,
          lastRead: new Date().toISOString(),
        },
        mockManga1
      );
    });

    expect(contextVal.library.length).toBe(1);
    expect(contextVal.history.length).toBe(1);

    await act(async () => {
      await contextVal.clearHistory();
    });

    expect(contextVal.history.length).toBe(0);
    expect(contextVal.library.length).toBe(1);
    expect(contextVal.library[0].progress).toBeNull();
  });
});
