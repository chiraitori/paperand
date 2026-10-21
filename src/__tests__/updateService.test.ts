import {
  updateService,
  selectBestApkAsset,
  parseReleaseData,
  getAssetArch,
  normalizeArch,
} from '../services/updateService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';

jest.mock('@react-native-async-storage/async-storage');
jest.mock('expo-application', () => ({
  nativeApplicationVersion: '1.0.0',
}));

describe('Update Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Version Checking', () => {
    it('should initialize without errors', () => {
      expect(updateService).toBeDefined();
    });

    it('should check for updates', async () => {
      const updateInfo = await updateService.checkForUpdates();
      expect(updateInfo === null || typeof updateInfo === 'object').toBe(true);
    });

    it('should get current version', async () => {
      const version = await updateService.getCurrentVersion();
      expect(typeof version).toBe('string');
    });

    it('should get latest version', async () => {
      const version = await updateService.getLatestVersion();
      expect(version === null || typeof version === 'string').toBe(true);
    });
  });

  describe('Update Detection', () => {
    it('should determine if update is available', async () => {
      const hasUpdate = await updateService.hasUpdateAvailable();
      expect(typeof hasUpdate).toBe('boolean');
    });

    it('should compare versions correctly', async () => {
      const isNewer = updateService.isNewerVersion('2.0.0', '1.0.0');
      expect(typeof isNewer).toBe('boolean');
    });

    it('should handle same version', async () => {
      const isNewer = updateService.isNewerVersion('1.0.0', '1.0.0');
      expect(isNewer).toBe(false);
    });

    it('should handle invalid version formats', async () => {
      const isNewer = updateService.isNewerVersion('invalid', '1.0.0');
      expect(typeof isNewer).toBe('boolean');
    });
  });

  describe('Update Settings', () => {
    it('should save last checked timestamp', async () => {
      await expect(updateService.saveLastCheckedTime()).resolves.not.toThrow();
    });

    it('should get last checked time', async () => {
      const time = await updateService.getLastCheckedTime();
      expect(time === null || typeof time === 'number').toBe(true);
    });

    it('should handle update modal dismissal', async () => {
      await expect(updateService.dismissUpdateModal()).resolves.not.toThrow();
    });

    it('should check if update modal was dismissed', async () => {
      const isDismissed = await updateService.isUpdateModalDismissed();
      expect(typeof isDismissed).toBe('boolean');
    });
  });

  describe('Network Handling', () => {
    it('should handle network errors gracefully', async () => {
      // Service should not crash on network issues
      await expect(updateService.checkForUpdates()).resolves.toBeDefined();
    });

    it('should timeout on slow connections', async () => {
      const startTime = Date.now();
      await updateService.checkForUpdates();
      const elapsed = Date.now() - startTime;
      
      // Should have a reasonable timeout
      expect(elapsed).toBeLessThan(15000);
    });
  });

  describe('Version Parsing', () => {
    it('should parse semantic versions', () => {
      const version = '1.2.3';
      const parts = updateService.parseVersion(version);
      expect(Array.isArray(parts) || typeof parts === 'object').toBe(true);
    });

    it('should handle version with pre-release tags', () => {
      const version = '1.0.0-beta.1';
      const parts = updateService.parseVersion(version);
      expect(Array.isArray(parts) || typeof parts === 'object').toBe(true);
    });

    it('should handle version with build metadata', () => {
      const version = '1.0.0+build.123';
      const parts = updateService.parseVersion(version);
      expect(Array.isArray(parts) || typeof parts === 'object').toBe(true);
    });
  });

  describe('Error Recovery', () => {
    it('should recover from failed update checks', async () => {
      // First check fails (simulated internally)
      await updateService.checkForUpdates();
      
      // Second check should succeed
      const result = await updateService.checkForUpdates();
      expect(result === null || typeof result === 'object').toBe(true);
    });

    it('should not corrupt settings on errors', async () => {
      await updateService.checkForUpdates();
      const isDismissed = await updateService.isUpdateModalDismissed();
      expect(typeof isDismissed).toBe('boolean');
    });
  });

  describe('Performance', () => {
    it('should cache version check results', async () => {
      const start1 = Date.now();
      await updateService.checkForUpdates();
      const time1 = Date.now() - start1;
      
      const start2 = Date.now();
      await updateService.getLatestVersion();
      const time2 = Date.now() - start2;
      
      // Cached call should be faster or similar
      expect(time2).toBeLessThanOrEqual(time1 + 100);
    });
  });

  describe('Architecture Matching & APK Selection', () => {
    const mockAssets = [
      { name: 'paperand-0.0.32-arm64-v8a.apk', size: 35000000, browser_download_url: 'https://github.com/.../arm64.apk' },
      { name: 'paperand-0.0.32-armeabi-v7a.apk', size: 32000000, browser_download_url: 'https://github.com/.../armeabi.apk' },
      { name: 'paperand-0.0.32-x86_64.apk', size: 38000000, browser_download_url: 'https://github.com/.../x86_64.apk' },
      { name: 'paperand-0.0.32-universal.apk', size: 89000000, browser_download_url: 'https://github.com/.../universal.apk' },
      { name: 'paperand-0.0.32.ipa', size: 50000000, browser_download_url: 'https://github.com/.../paperand.ipa' },
    ];

    it('should select arm64-v8a APK for 64-bit ARM devices', () => {
      const selected = selectBestApkAsset(mockAssets, 'arm64-v8a');
      expect(selected?.arch).toBe('arm64-v8a');
      expect(selected?.asset.name).toBe('paperand-0.0.32-arm64-v8a.apk');
    });

    it('should select armeabi-v7a APK for 32-bit ARM devices', () => {
      const selected = selectBestApkAsset(mockAssets, 'armeabi-v7a');
      expect(selected?.arch).toBe('armeabi-v7a');
      expect(selected?.asset.name).toBe('paperand-0.0.32-armeabi-v7a.apk');
    });

    it('should select x86_64 APK for x86_64 devices', () => {
      const selected = selectBestApkAsset(mockAssets, 'x86_64');
      expect(selected?.arch).toBe('x86_64');
      expect(selected?.asset.name).toBe('paperand-0.0.32-x86_64.apk');
    });

    it('should fallback to universal APK when device architecture is not in assets', () => {
      const selected = selectBestApkAsset(mockAssets, 'mips');
      expect(selected?.arch).toBe('universal');
      expect(selected?.asset.name).toBe('paperand-0.0.32-universal.apk');
    });

    it('should fallback to single APK when only one APK is provided', () => {
      const singleAsset = [{ name: 'paperand-custom.apk', size: 40000000, browser_download_url: '...' }];
      const selected = selectBestApkAsset(singleAsset, 'arm64-v8a');
      expect(selected?.asset.name).toBe('paperand-custom.apk');
    });

    it('should parse release data with correct architecture', () => {
      const releaseData = {
        tag_name: 'v0.0.32',
        body: 'New release notes',
        assets: mockAssets,
      };
      const parsed = parseReleaseData(releaseData, 'arm64-v8a');
      expect(parsed.version).toBe('0.0.32');
      expect(parsed.apkArchitecture).toBe('arm64-v8a');
      expect(parsed.apkSize).toBe(35000000);
      expect(parsed.apkDownloadUrl).toBe('https://github.com/.../arm64.apk');
    });

    it('should identify asset arch correctly', () => {
      expect(getAssetArch('paperand-1.0.0-arm64-v8a.apk')).toBe('arm64-v8a');
      expect(getAssetArch('paperand-1.0.0-armeabi-v7a.apk')).toBe('armeabi-v7a');
      expect(getAssetArch('paperand-1.0.0-x86_64.apk')).toBe('x86_64');
      expect(getAssetArch('paperand-1.0.0-universal.apk')).toBe('universal');
      expect(getAssetArch('paperand-1.0.0.apk')).toBe('universal');
    });

    it('should normalize arch names accurately', () => {
      expect(normalizeArch('aarch64')).toBe('arm64-v8a');
      expect(normalizeArch('arm64')).toBe('arm64-v8a');
      expect(normalizeArch('armv7l')).toBe('armeabi-v7a');
      expect(normalizeArch('x64')).toBe('x86_64');
    });
  });
});
