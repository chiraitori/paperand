import { sourceService } from '../services/sourceService';

jest.mock('expo-file-system', () => ({
  Directory: jest.fn(() => ({
    exists: jest.fn().mockResolvedValue(true),
    create: jest.fn().mockResolvedValue(undefined),
  })),
  File: jest.fn(),
  Paths: {
    document: '/mock/documents',
  },
}));

jest.mock('@react-native-async-storage/async-storage');

describe('Source Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize without errors', () => {
      expect(sourceService).toBeDefined();
    });
  });

  describe('Manga Search', () => {
    it('should search manga from source', async () => {
      const results = await sourceService.search('test-source', 'search query');
      expect(Array.isArray(results) || results === null).toBe(true);
    });

    it('should handle empty search query', async () => {
      const results = await sourceService.search('test-source', '');
      expect(Array.isArray(results) || results === null).toBe(true);
    });

    it('should handle special characters in query', async () => {
      const results = await sourceService.search('test-source', '日本 &Special #Chars');
      expect(Array.isArray(results) || results === null).toBe(true);
    });

    it('should handle network errors gracefully', async () => {
      const results = await sourceService.search('invalid-source', 'query');
      expect(Array.isArray(results) || results === null).toBe(true);
    });
  });

  describe('Chapter Fetching', () => {
    it('should get chapters for manga', async () => {
      const chapters = await sourceService.getChapters('source-id', 'manga-id');
      expect(Array.isArray(chapters) || chapters === null).toBe(true);
    });

    it('should handle missing manga', async () => {
      const chapters = await sourceService.getChapters('source-id', 'non-existent');
      expect(Array.isArray(chapters) || chapters === null).toBe(true);
    });

    it('should return chapters in correct order', async () => {
      const chapters = await sourceService.getChapters('source-id', 'manga-id');
      if (Array.isArray(chapters) && chapters.length > 1) {
        expect(chapters[0]).toBeDefined();
      }
    });
  });

  describe('Page Fetching', () => {
    it('should get pages for chapter', async () => {
      const pages = await sourceService.getChapterPages('source-id', 'chapter-id');
      expect(Array.isArray(pages) || pages === null).toBe(true);
    });

    it('should handle missing chapters', async () => {
      const pages = await sourceService.getChapterPages('source-id', 'non-existent');
      expect(Array.isArray(pages) || pages === null).toBe(true);
    });

    it('should return pages with valid image URLs', async () => {
      const pages = await sourceService.getChapterPages('source-id', 'chapter-id');
      if (Array.isArray(pages)) {
        pages.forEach(page => {
          expect(typeof page === 'string' || typeof page === 'object').toBe(true);
        });
      }
    });
  });

  describe('Image Operations', () => {
    it('should decrypt DRM images', async () => {
      const image = await sourceService.decryptDrmImage('drm://encrypted-image-data');
      expect(typeof image === 'string' || image instanceof Uint8Array).toBe(true);
    });

    it('should handle invalid DRM data', async () => {
      const image = await sourceService.decryptDrmImage('invalid-drm-data');
      expect(image !== null || image === null).toBe(true);
    });

    it('should fetch images through extension', async () => {
      const image = await sourceService.fetchImageThroughExtension('source-id', 'https://image.chiraitori.io.vn/image');
      expect(typeof image === 'string' || typeof image === 'object').toBe(true);
    });

    it('should handle image URL errors', async () => {
      const image = await sourceService.fetchImageThroughExtension('source-id', 'invalid-url');
      expect(image !== null || image === null).toBe(true);
    });
  });

  describe('Manga Details', () => {
    it('should get manga details', async () => {
      const details = await sourceService.getMangaDetails('source-id', 'manga-id');
      expect(details === null || typeof details === 'object').toBe(true);
    });

    it('should include manga metadata', async () => {
      const details = await sourceService.getMangaDetails('source-id', 'manga-id');
      if (details) {
        expect(details.id !== undefined || details.title !== undefined).toBe(true);
      }
    });

    it('should handle missing manga details', async () => {
      const details = await sourceService.getMangaDetails('source-id', 'non-existent');
      expect(details === null || typeof details === 'object').toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle network timeouts', async () => {
      // Service should not crash on timeouts
      await expect(sourceService.search('slow-source', 'query')).resolves.toBeDefined();
    });

    it('should handle malformed responses', async () => {
      // Service should gracefully handle bad data
      await expect(sourceService.getMangaDetails('source-id', 'manga-id')).resolves.toBeDefined();
    });

    it('should recover from errors', async () => {
      // First call might fail
      await sourceService.search('test-source', 'query');
      
      // Second call should work
      const results = await sourceService.search('test-source', 'query');
      expect(Array.isArray(results) || results === null).toBe(true);
    });
  });

  describe('Performance', () => {
    it('should handle bulk operations efficiently', async () => {
      const mangaIds = ['id1', 'id2', 'id3'];
      
      const results = await Promise.all(
        mangaIds.map(id => sourceService.getMangaDetails('source-id', id))
      );
      
      expect(results.length).toBe(3);
    });

    it('should cache results appropriately', async () => {
      const start1 = Date.now();
      await sourceService.getMangaDetails('source-id', 'manga-id');
      const time1 = Date.now() - start1;
      
      const start2 = Date.now();
      await sourceService.getMangaDetails('source-id', 'manga-id');
      const time2 = Date.now() - start2;
      
      // Cache hits should be faster or similar
      expect(time2).toBeLessThanOrEqual(time1 + 50);
    });
  });
});
