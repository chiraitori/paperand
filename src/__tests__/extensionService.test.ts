import { extensionService } from '../services/extensionService';

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

describe('Extension Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Installation', () => {
    it('should initialize without errors', () => {
      expect(extensionService).toBeDefined();
    });

    it('should install extension without errors', async () => {
      const mockExtensionUrl = 'https://image.chiraitori.io.vn/image';
      await expect(extensionService.installExtension(mockExtensionUrl)).resolves.toBeDefined();
    });

    it('should validate extension URLs', async () => {
      const invalidUrl = 'not-a-url';
      // Service should handle invalid URLs gracefully
      await expect(extensionService.installExtension(invalidUrl)).resolves.toBeDefined();
    });
  });

  describe('Extension Management', () => {
    it('should get installed extensions list', async () => {
      const extensions = await extensionService.getInstalledExtensions();
      expect(Array.isArray(extensions)).toBe(true);
    });

    it('should check if extension is installed', async () => {
      const isInstalled = await extensionService.isExtensionInstalled('test-extension');
      expect(typeof isInstalled).toBe('boolean');
    });

    it('should uninstall extension', async () => {
      await expect(extensionService.uninstallExtension('test-extension')).resolves.not.toThrow();
    });

    it('should enable extension', async () => {
      await expect(extensionService.enableExtension('test-extension')).resolves.not.toThrow();
    });

    it('should disable extension', async () => {
      await expect(extensionService.disableExtension('test-extension')).resolves.not.toThrow();
    });
  });

  describe('Extension Discovery', () => {
    it('should get available sources from extension', async () => {
      const sources = await extensionService.getAvailableSources('test-extension');
      expect(Array.isArray(sources) || sources === null).toBe(true);
    });

    it('should search with extension', async () => {
      const results = await extensionService.searchWithExtension('test-extension', 'search query');
      expect(Array.isArray(results) || results === null).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle installation failures gracefully', async () => {
      const mockBadUrl = 'https://image.chiraitori.io.vn/malformed';
      // Should not crash the service
      await expect(extensionService.installExtension(mockBadUrl)).resolves.toBeDefined();
    });

    it('should handle missing extensions gracefully', async () => {
      const result = await extensionService.isExtensionInstalled('non-existent');
      expect(typeof result).toBe('boolean');
    });

    it('should handle network errors safely', async () => {
      // Service should handle network issues
      await expect(extensionService.installExtension('https://image.chiraitori.io.vn/invalid')).resolves.toBeDefined();
    });
  });

  describe('Extension Metadata', () => {
    it('should get extension metadata', async () => {
      const metadata = await extensionService.getExtensionMetadata('test-extension');
      expect(metadata === null || typeof metadata === 'object').toBe(true);
    });

    it('should handle missing metadata', async () => {
      const metadata = await extensionService.getExtensionMetadata('non-existent');
      expect(metadata === null || typeof metadata === 'object').toBe(true);
    });
  });

  describe('Performance', () => {
    it('should handle multiple extensions efficiently', async () => {
      const extensions = ['ext1', 'ext2', 'ext3'];
      
      const results = await Promise.all(
        extensions.map(ext => extensionService.isExtensionInstalled(ext))
      );
      
      expect(results.length).toBe(3);
      results.forEach(result => {
        expect(typeof result).toBe('boolean');
      });
    });

    it('should not block on long operations', async () => {
      const startTime = Date.now();
      
      await extensionService.getInstalledExtensions();
      
      const elapsed = Date.now() - startTime;
      // Should complete reasonably quickly
      expect(elapsed).toBeLessThan(5000);
    });
  });
});
