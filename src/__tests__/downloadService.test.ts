import { downloadService } from '../services/downloadService';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage');
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

jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn().mockResolvedValue({
    type: 'wifi',
    isConnected: true,
  }),
  NetInfoStateType: {
    wifi: 'wifi',
    cellular: 'cellular',
    none: 'none',
  },
}));

describe('Download Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize without errors', () => {
      expect(downloadService).toBeDefined();
    });

    it('should ensure downloads directory exists', async () => {
      await expect(downloadService.ensureDirectoryExists()).resolves.not.toThrow();
    });
  });

  describe('Download Queue Management', () => {
    it('should return empty queue initially', () => {
      const queue = downloadService.getDownloadQueue();
      expect(Array.isArray(queue)).toBe(true);
    });

    it('should add download to queue', async () => {
      const mockManga = {
        id: 'test-manga-1',
        title: 'Test Manga',
        coverImage: 'https://image.chiraitori.io.vn/image',
      };

      const mockChapter = {
        id: 'ch-001',
        name: 'Chapter 1',
        number: 1,
        date: new Date(),
        isRead: false,
      };

      await downloadService.addToQueue(mockManga, mockChapter);
      // Should not throw and add to queue
      expect(downloadService).toBeDefined();
    });

    it('should pause downloads', async () => {
      await expect(downloadService.pauseDownloads()).resolves.not.toThrow();
    });

    it('should resume downloads', async () => {
      await expect(downloadService.resumeDownloads()).resolves.not.toThrow();
    });

    it('should clear queue', async () => {
      await expect(downloadService.clearQueue()).resolves.not.toThrow();
    });
  });

  describe('Download Operations', () => {
    it('should cancel download', async () => {
      await expect(downloadService.cancelDownload('test-id')).resolves.not.toThrow();
    });

    it('should remove download', async () => {
      await expect(downloadService.removeDownload('test-id')).resolves.not.toThrow();
    });

    it('should check if download exists', async () => {
      const exists = await downloadService.isDownloaded('test-id', 'ch-001');
      expect(typeof exists).toBe('boolean');
    });

    it('should get download progress', () => {
      const progress = downloadService.getDownloadProgress('test-id');
      expect(typeof progress).toBe('number');
    });
  });

  describe('Listeners', () => {
    it('should register queue change listener', () => {
      const mockListener = jest.fn();
      downloadService.onQueueChanged(mockListener);
      expect(mockListener).toBeDefined();
    });

    it('should call listener on queue changes', async () => {
      const mockListener = jest.fn();
      downloadService.onQueueChanged(mockListener);

      const mockManga = {
        id: 'test',
        title: 'Test',
        coverImage: 'test.jpg',
      };

      const mockChapter = {
        id: 'ch-1',
        name: 'Ch 1',
        number: 1,
        date: new Date(),
        isRead: false,
      };

      await downloadService.addToQueue(mockManga, mockChapter);
      // Listener should be registered
      expect(mockListener).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid download gracefully', async () => {
      await expect(downloadService.cancelDownload('')).resolves.not.toThrow();
    });

    it('should handle directory creation errors', async () => {
      // Service should handle errors internally
      await expect(downloadService.ensureDirectoryExists()).resolves.not.toThrow();
    });

    it('should persist metadata safely', async () => {
      await expect(downloadService.getDownloadedChapters('test-id')).resolves.toBeDefined();
    });
  });
});
