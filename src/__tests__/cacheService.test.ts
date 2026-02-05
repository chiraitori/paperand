import {
  cacheChapterList,
  getCachedChapterList,
  cacheChapterPages,
  getCachedChapterPages,
  cacheMangaMetadata,
  getCachedMangaMetadata,
} from '../services/cacheService';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(),
  getItem: jest.fn(),
  removeItem: jest.fn(),
}));

// Mock expo-file-system
jest.mock('expo-file-system', () => ({
  Directory: jest.fn(),
  File: jest.fn(),
  Paths: {
    document: '/mock/documents',
  },
}));

// Mock expo-image
jest.mock('expo-image', () => ({
  Image: {
    prefetch: jest.fn().mockResolvedValue(undefined),
  },
}));

describe('Cache Service - Chapter List', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('cacheChapterList', () => {
    it('should cache chapter list with page counts', async () => {
      const chapters = [
        {
          id: 'ch1',
          number: 1,
          title: 'Chapter 1',
          releaseDate: '2024-01-01',
          pages: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
        },
        {
          id: 'ch2',
          number: 2,
          title: 'Chapter 2',
          releaseDate: '2024-01-02',
          pages: [{ id: 'p4' }, { id: 'p5' }],
        },
      ];

      await cacheChapterList('manga-1', 'source-1', chapters);

      expect(AsyncStorage.setItem).toHaveBeenCalled();
      const callArgs = (AsyncStorage.setItem as jest.Mock).mock.calls[0];
      const cachedData = JSON.parse(callArgs[1]);
      
      expect(cachedData['source-1:manga-1']).toBeDefined();
      expect(cachedData['source-1:manga-1'].chapters).toHaveLength(2);
      expect(cachedData['source-1:manga-1'].chapters[0].pageCount).toBe(3);
      expect(cachedData['source-1:manga-1'].chapters[1].pageCount).toBe(2);
    });

    it('should handle chapters without pages', async () => {
      const chapters = [
        {
          id: 'ch1',
          number: 1,
          title: 'Chapter 1',
          releaseDate: '2024-01-01',
          pages: [],
        },
      ];

      await cacheChapterList('manga-1', 'source-1', chapters);

      const callArgs = (AsyncStorage.setItem as jest.Mock).mock.calls[0];
      const cachedData = JSON.parse(callArgs[1]);
      
      expect(cachedData['source-1:manga-1'].chapters[0].pageCount).toBeUndefined();
    });

    it('should handle undefined pages property', async () => {
      const chapters = [
        {
          id: 'ch1',
          number: 1,
          title: 'Chapter 1',
          releaseDate: '2024-01-01',
        },
      ];

      await cacheChapterList('manga-1', 'source-1', chapters as any);

      const callArgs = (AsyncStorage.setItem as jest.Mock).mock.calls[0];
      const cachedData = JSON.parse(callArgs[1]);
      
      expect(cachedData['source-1:manga-1'].chapters[0].pageCount).toBeUndefined();
    });
  });

  describe('getCachedChapterList', () => {
    it('should return cached chapter list with page counts', async () => {
      const mockCache = {
        'source-1:manga-1': {
          mangaId: 'manga-1',
          sourceId: 'source-1',
          chapters: [
            { id: 'ch1', number: 1, title: 'Chapter 1', releaseDate: '2024-01-01', pageCount: 5 },
            { id: 'ch2', number: 2, title: 'Chapter 2', releaseDate: '2024-01-02', pageCount: 3 },
          ],
          cachedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        },
      };

      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(mockCache));

      const result = await getCachedChapterList('manga-1', 'source-1');

      expect(result).toBeDefined();
      expect(result?.chapters).toHaveLength(2);
      expect(result?.chapters[0].pageCount).toBe(5);
      expect(result?.chapters[1].pageCount).toBe(3);
    });

    it('should return null when cache does not exist', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue('{}');

      const result = await getCachedChapterList('manga-1', 'source-1');

      expect(result).toBeNull();
    });

    it('should return expired cache data', async () => {
      const mockCache = {
        'source-1:manga-1': {
          mangaId: 'manga-1',
          sourceId: 'source-1',
          chapters: [{ id: 'ch1', number: 1, title: 'Chapter 1', releaseDate: '2024-01-01', pageCount: 5 }],
          cachedAt: new Date(Date.now() - 7200000).toISOString(),
          expiresAt: new Date(Date.now() - 3600000).toISOString(),
        },
      };

      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(mockCache));

      const result = await getCachedChapterList('manga-1', 'source-1');

      // Should still return data even if expired (caller decides to refresh)
      expect(result).toBeDefined();
      expect(result?.chapters[0].pageCount).toBe(5);
    });
  });
});

describe('Cache Service - Chapter Pages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('cacheChapterPages', () => {
    it('should cache chapter pages', async () => {
      const pages = [
        { pageNumber: 1, imageUrl: 'https://image.chiraitori.io.vn/image' },
        { pageNumber: 2, imageUrl: 'https://image.chiraitori.io.vn/image' },
        { pageNumber: 3, imageUrl: 'https://image.chiraitori.io.vn/image' },
      ];

      await cacheChapterPages('manga-1', 'ch1', pages);

      expect(AsyncStorage.setItem).toHaveBeenCalled();
      const callArgs = (AsyncStorage.setItem as jest.Mock).mock.calls[0];
      const cachedData = JSON.parse(callArgs[1]);
      
      expect(cachedData['manga-1:ch1']).toBeDefined();
      expect(cachedData['manga-1:ch1']).toHaveLength(3);
      expect(cachedData['manga-1:ch1'][0].pageNumber).toBe(1);
      expect(cachedData['manga-1:ch1'][2].imageUrl).toBe('https://image.chiraitori.io.vn/image');
    });

    it('should handle empty pages array', async () => {
      await cacheChapterPages('manga-1', 'ch1', []);

      const callArgs = (AsyncStorage.setItem as jest.Mock).mock.calls[0];
      const cachedData = JSON.parse(callArgs[1]);
      
      expect(cachedData['manga-1:ch1']).toEqual([]);
    });
  });

  describe('getCachedChapterPages', () => {
    it('should return cached pages', async () => {
      const mockCache = {
        'manga-1:ch1': [
          { mangaId: 'manga-1', chapterId: 'ch1', pageNumber: 1, imageUrl: 'https://image.chiraitori.io.vn/image', cachedAt: new Date().toISOString() },
          { mangaId: 'manga-1', chapterId: 'ch1', pageNumber: 2, imageUrl: 'https://image.chiraitori.io.vn/image', cachedAt: new Date().toISOString() },
        ],
      };

      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(mockCache));

      const result = await getCachedChapterPages('manga-1', 'ch1');

      expect(result).toBeDefined();
      expect(result).toHaveLength(2);
      expect(result?.[0].pageNumber).toBe(1);
      expect(result?.[1].imageUrl).toBe('https://image.chiraitori.io.vn/image');
    });

    it('should return null when no cached pages exist', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue('{}');

      const result = await getCachedChapterPages('manga-1', 'ch1');

      expect(result).toBeNull();
    });
  });
});

describe('Cache Service - Manga Metadata', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('cacheMangaMetadata', () => {
    it('should cache manga metadata', async () => {
      const manga = {
        id: 'manga-1',
        title: 'Test Manga',
        author: 'Test Author',
        description: 'Test Description',
        coverImage: 'https://image.chiraitori.io.vn/image',
        genres: ['Action', 'Adventure'],
        status: 'ongoing',
        chapters: [],
        lastUpdated: new Date().toISOString(),
        source: 'source-1',
      };

      await cacheMangaMetadata(manga, 'source-1');

      expect(AsyncStorage.setItem).toHaveBeenCalled();
      const callArgs = (AsyncStorage.setItem as jest.Mock).mock.calls[0];
      const cachedData = JSON.parse(callArgs[1]);
      
      expect(cachedData['source-1:manga-1']).toBeDefined();
      expect(cachedData['source-1:manga-1'].title).toBe('Test Manga');
      expect(cachedData['source-1:manga-1'].author).toBe('Test Author');
    });
  });

  describe('getCachedMangaMetadata', () => {
    it('should return cached metadata', async () => {
      const mockCache = {
        'source-1:manga-1': {
          mangaId: 'manga-1',
          sourceId: 'source-1',
          title: 'Test Manga',
          author: 'Test Author',
          description: 'Test Description',
          coverImage: 'https://image.chiraitori.io.vn/image',
          genres: ['Action'],
          status: 'ongoing',
          cachedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
      };

      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(mockCache));

      const result = await getCachedMangaMetadata('manga-1', 'source-1');

      expect(result).toBeDefined();
      expect(result?.title).toBe('Test Manga');
      expect(result?.author).toBe('Test Author');
    });

    it('should return null when metadata does not exist', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue('{}');

      const result = await getCachedMangaMetadata('manga-1', 'source-1');

      expect(result).toBeNull();
    });
  });
});
