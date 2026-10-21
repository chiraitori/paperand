import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

// GitHub repository configuration
const GITHUB_OWNER = 'chiraitori';
const GITHUB_REPO = 'paperand';
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

// Storage keys
const STORAGE_KEYS = {
  LAST_CHECK_TIME: '@update_last_check',
  SKIPPED_VERSION: '@update_skipped_version',
  APK_DOWNLOAD_META: '@update_apk_download_meta',
};

// Debug mode - set to true to test update modal with mock data
const DEBUG_FORCE_UPDATE = false; // Set to true for testing with mock data

// Check interval in milliseconds (24 hours)
const CHECK_INTERVAL = 24 * 60 * 60 * 1000;

export interface ReleaseInfo {
  version: string;
  tagName: string;
  releaseNotes: string;
  publishedAt: string;
  htmlUrl: string;
  downloadUrl: string | null;
  apkDownloadUrl: string | null;
  apkSize: number | null;
  apkArchitecture?: string | null;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestRelease: ReleaseInfo | null;
  error: string | null;
}

export interface ApkDownloadMetadata {
  url: string;
  fileUri: string;
  expectedSize: number | null;
  downloadedBytes: number;
  totalBytes: number;
  completed: boolean;
}

export interface ApkDownloadStateSnapshot {
  state: 'idle' | 'downloading' | 'paused' | 'downloaded';
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
  fileUri: string | null;
}

/**
 * Get the current app version from expo config
 */
export const getCurrentVersion = (): string => {
  return Constants.expoConfig?.version || '0.0.0';
};

/**
 * Compare two semantic version strings
 * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
export const compareVersions = (v1: string, v2: string): number => {
  const stripBuild = (v: string) => (v || '').replace(/^v/, '').replace(/\+.*$/, '');
  const clean1 = stripBuild(v1);
  const clean2 = stripBuild(v2);

  const [core1, ...tagParts1] = clean1.split('-');
  const [core2, ...tagParts2] = clean2.split('-');

  const parts1 = (core1 || '').split('.').map((n) => parseInt(n, 10) || 0);
  const parts2 = (core2 || '').split('.').map((n) => parseInt(n, 10) || 0);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const num1 = parts1[i] || 0;
    const num2 = parts2[i] || 0;

    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }

  // If base versions are equal, check pre-release tags
  // Release version (no tag) > pre-release version (with tag)
  const tag1 = tagParts1.join('-');
  const tag2 = tagParts2.join('-');
  const hasTag1 = tag1.length > 0;
  const hasTag2 = tag2.length > 0;

  if (!hasTag1 && hasTag2) return 1;
  if (hasTag1 && !hasTag2) return -1;
  if (hasTag1 && hasTag2) {
    const cmp = tag1.localeCompare(tag2, undefined, { numeric: true, sensitivity: 'base' });
    if (cmp > 0) return 1;
    if (cmp < 0) return -1;
  }

  return 0;
};

/**
 * Normalizes an architecture name to standard Android ABI names
 */
export const normalizeArch = (arch: string): string => {
  const lower = (arch || '').toLowerCase();
  if (lower.includes('arm64') || lower.includes('aarch64')) return 'arm64-v8a';
  if (lower.includes('v7') || lower.includes('armeabi')) return 'armeabi-v7a';
  if (lower.includes('x86_64') || lower.includes('x64')) return 'x86_64';
  if (lower.includes('x86')) return 'x86';
  if (lower.includes('universal')) return 'universal';
  return lower;
};

/**
 * Determine the architecture of an APK asset from its filename
 */
export const getAssetArch = (fileName: string): string => {
  const lower = (fileName || '').toLowerCase();
  if (lower.includes('arm64-v8a') || lower.includes('arm64') || lower.includes('aarch64')) {
    return 'arm64-v8a';
  }
  if (lower.includes('armeabi-v7a') || lower.includes('armeabi') || lower.includes('armv7')) {
    return 'armeabi-v7a';
  }
  if (lower.includes('x86_64') || lower.includes('x64')) {
    return 'x86_64';
  }
  if (lower.includes('x86') && !lower.includes('x86_64')) {
    return 'x86';
  }
  return 'universal';
};

/**
 * Get device's supported CPU architectures, with primary ABI first
 */
export const getDeviceSupportedAbis = (): string[] => {
  if (Device.supportedCpuArchitectures && Device.supportedCpuArchitectures.length > 0) {
    return Device.supportedCpuArchitectures.map(normalizeArch);
  }
  return [];
};

/**
 * Get primary device architecture name
 */
export const getDeviceArchitecture = (): string => {
  const abis = getDeviceSupportedAbis();
  return abis.length > 0 ? abis[0] : 'universal';
};

/**
 * Select the best matching APK asset based on device CPU architecture.
 * Priority order:
 * 1. Match supported CPU architectures in order of preference (primary ABI first).
 * 2. Universal APK (e.g. 'universal' or default release apk).
 * 3. Fallback to any available .apk asset.
 */
export const selectBestApkAsset = (
  assets: any[],
  customDeviceAbi?: string
): { asset: any; arch: string } | null => {
  if (!assets || !Array.isArray(assets)) return null;

  const apkAssets = assets.filter((asset: any) =>
    asset?.name?.toLowerCase().endsWith('.apk')
  );
  if (apkAssets.length === 0) return null;

  if (apkAssets.length === 1) {
    return {
      asset: apkAssets[0],
      arch: getAssetArch(apkAssets[0].name),
    };
  }

  const deviceAbis = customDeviceAbi
    ? [normalizeArch(customDeviceAbi)]
    : getDeviceSupportedAbis();

  // 1. Try matching device ABIs in order of preference (primary ABI first)
  for (const abi of deviceAbis) {
    const matched = apkAssets.find((asset: any) => {
      const arch = getAssetArch(asset.name);
      return arch === abi;
    });

    if (matched) {
      return {
        asset: matched,
        arch: getAssetArch(matched.name),
      };
    }
  }

  // 2. Try universal APK
  const universal = apkAssets.find((asset: any) => {
    const arch = getAssetArch(asset.name);
    return arch === 'universal';
  });

  if (universal) {
    return {
      asset: universal,
      arch: 'universal',
    };
  }

  // 3. Fallback to first available APK
  return {
    asset: apkAssets[0],
    arch: getAssetArch(apkAssets[0].name),
  };
};

/**
 * Parse GitHub release data to extract relevant information
 */
export const parseReleaseData = (data: any, customDeviceAbi?: string): ReleaseInfo => {
  // Find APK download URL from assets based on device CPU architecture
  let apkDownloadUrl: string | null = null;
  let apkSize: number | null = null;
  let apkArchitecture: string | null = null;

  if (data.assets && Array.isArray(data.assets)) {
    const selected = selectBestApkAsset(data.assets, customDeviceAbi);
    if (selected) {
      apkDownloadUrl = selected.asset.browser_download_url;
      apkSize = selected.asset.size;
      apkArchitecture = selected.arch;
    }
  }

  // Clean up release notes - remove HTML tags and extract meaningful content
  let releaseNotes = data.body || 'No release notes available.';
  releaseNotes = cleanReleaseNotes(releaseNotes);

  return {
    version: data.tag_name?.replace(/^v/, '') || data.name || 'Unknown',
    tagName: data.tag_name || '',
    releaseNotes,
    publishedAt: data.published_at || '',
    htmlUrl: data.html_url || '',
    downloadUrl: data.html_url || null,
    apkDownloadUrl,
    apkSize,
    apkArchitecture,
  };
};

/**
 * Clean up release notes by removing HTML tags and extracting key sections
 */
const cleanReleaseNotes = (notes: string): string => {
  // Remove HTML tags like <div>, <img>, etc.
  let cleaned = notes.replace(/<[^>]*>/g, '');

  // Remove markdown image syntax ![alt](url)
  cleaned = cleaned.replace(/!\[[^\]]*\]\([^)]*\)/g, '');

  // Remove markdown link syntax but keep text [text](url) -> text
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

  // Remove horizontal rules
  cleaned = cleaned.replace(/^---+$/gm, '');

  // Remove excessive whitespace and empty lines
  cleaned = cleaned.replace(/\r\n/g, '\n');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  // Try to extract "What's New" section
  const whatsNewMatch = cleaned.match(/##\s*✨\s*What's New([\s\S]*?)(?=##|$)/i) ||
    cleaned.match(/##\s*What's New([\s\S]*?)(?=##|$)/i);

  if (whatsNewMatch) {
    let whatsNew = whatsNewMatch[1].trim();
    // Clean up the extracted section and limit to 5 items
    const items = whatsNew.split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('|') && line.startsWith('-'))
      .slice(0, 5); // Only show first 5 items

    if (items.length > 0) {
      return items.join('\n'); // Don't include heading, modal already has one
    }
  }

  // Fallback: just clean up and return first meaningful content
  const lines = cleaned.split('\n')
    .map(line => line.trim())
    .filter(line => {
      // Skip empty lines, single characters, badges, and table rows
      if (!line || line.length < 3) return false;
      if (line.startsWith('|')) return false;
      if (line.match(/^#+\s*$/)) return false;
      return true;
    });

  return lines.slice(0, 8).join('\n').trim() || 'New version available!';
};

/**
 * Fetch the latest release information from GitHub
 */
export const fetchLatestRelease = async (): Promise<ReleaseInfo | null> => {
  try {
    const response = await fetch(GITHUB_API_URL, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'Paperand-App',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.log('No releases found on GitHub');
        return null;
      }
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const data = await response.json();
    return parseReleaseData(data);
  } catch (error) {
    console.error('Error fetching latest release:', error);
    throw error;
  }
};

/**
 * Check if enough time has passed since the last update check
 */
export const shouldCheckForUpdate = async (): Promise<boolean> => {
  try {
    const lastCheckStr = await AsyncStorage.getItem(STORAGE_KEYS.LAST_CHECK_TIME);
    if (!lastCheckStr) return true;

    const lastCheck = parseInt(lastCheckStr, 10);
    const now = Date.now();

    return now - lastCheck >= CHECK_INTERVAL;
  } catch (error) {
    console.error('Error checking update interval:', error);
    return true;
  }
};

/**
 * Mark the current time as the last update check time
 */
export const markUpdateChecked = async (): Promise<void> => {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.LAST_CHECK_TIME, Date.now().toString());
  } catch (error) {
    console.error('Error marking update checked:', error);
  }
};

/**
 * Check if a version was previously skipped by the user
 */
export const isVersionSkipped = async (version: string): Promise<boolean> => {
  try {
    const skippedVersion = await AsyncStorage.getItem(STORAGE_KEYS.SKIPPED_VERSION);
    return skippedVersion === version;
  } catch (error) {
    console.error('Error checking skipped version:', error);
    return false;
  }
};

/**
 * Mark a version as skipped
 */
export const skipVersion = async (version: string): Promise<void> => {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.SKIPPED_VERSION, version);
  } catch (error) {
    console.error('Error skipping version:', error);
  }
};

/**
 * Clear the skipped version (useful when user manually checks for updates)
 */
export const clearSkippedVersion = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(STORAGE_KEYS.SKIPPED_VERSION);
  } catch (error) {
    console.error('Error clearing skipped version:', error);
  }
};

/**
 * Main function to check for updates
 */
export const checkForUpdate = async (force: boolean = false): Promise<UpdateCheckResult> => {
  const currentVersion = getCurrentVersion();
  console.log('Current app version:', currentVersion);

  // Debug mode: return mock update data
  if (DEBUG_FORCE_UPDATE) {
    const mockRelease: ReleaseInfo = {
      version: '1.0.0',
      tagName: 'v1.0.0',
      releaseNotes: `## What's New

- New update checker feature
- Improved performance
- Bug fixes and stability improvements

## Bug Fixes

- Fixed crash on startup
- Fixed image loading issues`,
      publishedAt: new Date().toISOString(),
      htmlUrl: 'https://github.com/chiraitori/paperand/releases/tag/v1.0.0',
      downloadUrl: 'https://github.com/chiraitori/paperand/releases/tag/v1.0.0',
      apkDownloadUrl: 'https://github.com/chiraitori/paperand/releases/download/v1.0.0/app-release.apk',
      apkSize: 25 * 1024 * 1024, // 25 MB mock size
    };
    return {
      hasUpdate: true,
      currentVersion,
      latestRelease: mockRelease,
      error: null,
    };
  }

  try {
    // Check if we should perform the check (unless forced)
    if (!force) {
      const shouldCheck = await shouldCheckForUpdate();
      if (!shouldCheck) {
        return {
          hasUpdate: false,
          currentVersion,
          latestRelease: null,
          error: null,
        };
      }
    }

    // Fetch the latest release
    const latestRelease = await fetchLatestRelease();

    // Mark that we checked
    await markUpdateChecked();

    if (!latestRelease) {
      return {
        hasUpdate: false,
        currentVersion,
        latestRelease: null,
        error: null,
      };
    }

    // Compare versions
    console.log('Comparing versions - GitHub:', latestRelease.version, 'vs App:', currentVersion);
    const comparison = compareVersions(latestRelease.version, currentVersion);
    console.log('Version comparison result:', comparison, '(1 = update available, 0 = same, -1 = older)');
    const hasUpdate = comparison > 0;

    // Check if this version was skipped (unless force check)
    if (hasUpdate && !force) {
      const isSkipped = await isVersionSkipped(latestRelease.version);
      if (isSkipped) {
        return {
          hasUpdate: false,
          currentVersion,
          latestRelease,
          error: null,
        };
      }
    }

    return {
      hasUpdate,
      currentVersion,
      latestRelease,
      error: null,
    };
  } catch (error) {
    return {
      hasUpdate: false,
      currentVersion,
      latestRelease: null,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
};

/**
 * Download progress callback type
 */
export type DownloadProgressCallback = (progress: number, downloadedBytes: number, totalBytes: number) => void;

// Persistent & In-Memory Resumable APK Download Manager
let activeDownloadResumable: FileSystem.DownloadResumable | null = null;
let activeDownloadPromise: Promise<string | null> | null = null;
let activeDownloadUrl: string | null = null;
let isDownloadPausedByUser = false;
let isDownloadCancelledByUser = false;
const progressListeners = new Set<DownloadProgressCallback>();
let lastKnownProgress = { progress: 0, downloadedBytes: 0, totalBytes: 0 };

const getApkFileUri = (): string => {
  const baseDir = FileSystem.documentDirectory || FileSystem.cacheDirectory || '';
  return `${baseDir}paperand-update.apk`;
};

const loadApkDownloadMeta = async (): Promise<ApkDownloadMetadata | null> => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.APK_DOWNLOAD_META);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const saveApkDownloadMeta = async (meta: ApkDownloadMetadata): Promise<void> => {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.APK_DOWNLOAD_META, JSON.stringify(meta));
  } catch {}
};

const notifyProgressListeners = (progress: number, downloadedBytes: number, totalBytes: number) => {
  lastKnownProgress = { progress, downloadedBytes, totalBytes };
  progressListeners.forEach((cb) => {
    try {
      cb(progress, downloadedBytes, totalBytes);
    } catch {}
  });
};

/**
 * Subscribe to ongoing APK download progress (used when UpdateModal re-opens)
 */
export const subscribeToApkDownload = (cb: DownloadProgressCallback): (() => void) => {
  progressListeners.add(cb);
  if (lastKnownProgress.downloadedBytes > 0 || lastKnownProgress.totalBytes > 0) {
    cb(lastKnownProgress.progress, lastKnownProgress.downloadedBytes, lastKnownProgress.totalBytes);
  }
  return () => {
    progressListeners.delete(cb);
  };
};

/**
 * Check the current state of an APK download (in-memory or partial/completed on disk)
 */
export const getApkDownloadState = async (
  url: string | null,
  expectedSize?: number | null
): Promise<ApkDownloadStateSnapshot> => {
  if (!url || Platform.OS !== 'android') {
    return { state: 'idle', progress: 0, downloadedBytes: 0, totalBytes: 0, fileUri: null };
  }

  const fileUri = getApkFileUri();

  // 1. Check if actively downloading in memory right now
  if (activeDownloadPromise && activeDownloadUrl === url) {
    return {
      state: 'downloading',
      progress: lastKnownProgress.progress,
      downloadedBytes: lastKnownProgress.downloadedBytes,
      totalBytes: lastKnownProgress.totalBytes || expectedSize || 0,
      fileUri,
    };
  }

  // 2. Check disk & persisted metadata
  try {
    const [meta, fileInfo] = await Promise.all([
      loadApkDownloadMeta(),
      FileSystem.getInfoAsync(fileUri),
    ]);

    if (meta && meta.url === url && fileInfo.exists) {
      const diskSize = (fileInfo as any).size || 0;
      const targetTotal = meta.totalBytes || expectedSize || 0;

      if (meta.completed && diskSize > 0 && (!expectedSize || diskSize >= expectedSize)) {
        return {
          state: 'downloaded',
          progress: 1,
          downloadedBytes: diskSize,
          totalBytes: diskSize,
          fileUri,
        };
      }

      if (diskSize > 0 && (!targetTotal || diskSize < targetTotal)) {
        const progress = targetTotal > 0 ? Math.min(0.99, Math.max(0, diskSize / targetTotal)) : 0;
        lastKnownProgress = { progress, downloadedBytes: diskSize, totalBytes: targetTotal };
        return {
          state: 'paused',
          progress,
          downloadedBytes: diskSize,
          totalBytes: targetTotal,
          fileUri,
        };
      }
    }
  } catch {}

  return { state: 'idle', progress: 0, downloadedBytes: 0, totalBytes: expectedSize || 0, fileUri: null };
};

/**
 * Pause the active APK download without deleting the partial file on disk
 */
export const pauseApkDownload = async (): Promise<void> => {
  isDownloadPausedByUser = true;
  if (activeDownloadResumable) {
    try {
      await activeDownloadResumable.pauseAsync();
    } catch {}
  }
};

/**
 * Cancel and delete the partial APK download file
 */
export const cancelApkDownload = async (): Promise<void> => {
  isDownloadCancelledByUser = true;
  isDownloadPausedByUser = false;
  if (activeDownloadResumable) {
    try {
      await activeDownloadResumable.cancelAsync();
    } catch {}
    activeDownloadResumable = null;
  }
  activeDownloadPromise = null;
  activeDownloadUrl = null;
  lastKnownProgress = { progress: 0, downloadedBytes: 0, totalBytes: 0 };
  try {
    const fileUri = getApkFileUri();
    const info = await FileSystem.getInfoAsync(fileUri);
    if (info.exists) {
      await FileSystem.deleteAsync(fileUri, { idempotent: true });
    }
    await AsyncStorage.removeItem(STORAGE_KEYS.APK_DOWNLOAD_META);
  } catch {}
};

/**
 * Wait until network connection is restored (e.g., during Wi-Fi switch or temporary drop)
 */
const waitForNetworkConnection = (timeoutMs: number = 45000): Promise<boolean> => {
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;

    const finish = (connected: boolean) => {
      if (settled) return;
      settled = true;
      if (unsubscribe) unsubscribe();
      clearTimeout(timer);
      resolve(connected);
    };

    const timer = setTimeout(() => finish(false), timeoutMs);

    NetInfo.fetch()
      .then((state) => {
        if (state.isConnected && state.isInternetReachable !== false) {
          finish(true);
        } else {
          unsubscribe = NetInfo.addEventListener((nextState) => {
            if (nextState.isConnected && nextState.isInternetReachable !== false) {
              // Give the new network interface 800ms to stabilize routing before resuming HTTP Range request
              setTimeout(() => finish(true), 800);
            }
          });
        }
      })
      .catch(() => finish(true));
  });
};

/**
 * Download APK file for Android with full HTTP Range resumption across Wi-Fi changes and modal closes
 */
export const downloadApk = async (
  url: string,
  onProgress?: DownloadProgressCallback,
  expectedSize?: number | null
): Promise<string | null> => {
  if (Platform.OS !== 'android') {
    console.log('APK download is only supported on Android');
    return null;
  }

  if (onProgress) {
    progressListeners.add(onProgress);
  }

  // If the exact same APK URL is already downloading in the background, attach to it
  if (activeDownloadPromise && activeDownloadUrl === url) {
    if (onProgress && (lastKnownProgress.downloadedBytes > 0 || lastKnownProgress.totalBytes > 0)) {
      onProgress(lastKnownProgress.progress, lastKnownProgress.downloadedBytes, lastKnownProgress.totalBytes);
    }
    try {
      return await activeDownloadPromise;
    } finally {
      if (onProgress) {
        progressListeners.delete(onProgress);
      }
    }
  }

  isDownloadPausedByUser = false;
  isDownloadCancelledByUser = false;
  activeDownloadUrl = url;

  const runDownload = async (): Promise<string | null> => {
    const fileUri = getApkFileUri();
    let lastSavedMetaBytes = 0;

    // Inspect existing file & metadata to see if we should resume or start fresh
    const existingMeta = await loadApkDownloadMeta();
    const initialInfo = await FileSystem.getInfoAsync(fileUri);

    if (initialInfo.exists) {
      const initialDiskSize = (initialInfo as any).size || 0;
      const isSameUrl = existingMeta?.url === url;

      if (isSameUrl && existingMeta?.completed && initialDiskSize > 0 && (!expectedSize || initialDiskSize >= expectedSize)) {
        // Already completely downloaded!
        notifyProgressListeners(1, initialDiskSize, initialDiskSize);
        return fileUri;
      }

      const maxAllowedSize = expectedSize || existingMeta?.totalBytes || 0;
      if (!isSameUrl || (maxAllowedSize > 0 && initialDiskSize > maxAllowedSize)) {
        // Different release URL or corrupted oversized file -> delete and start fresh
        await FileSystem.deleteAsync(fileUri, { idempotent: true });
        await saveApkDownloadMeta({
          url,
          fileUri,
          expectedSize: expectedSize ?? null,
          downloadedBytes: 0,
          totalBytes: expectedSize || 0,
          completed: false,
        });
      }
    } else {
      await saveApkDownloadMeta({
        url,
        fileUri,
        expectedSize: expectedSize ?? null,
        downloadedBytes: 0,
        totalBytes: expectedSize || 0,
        completed: false,
      });
    }

    const MAX_NETWORK_RESUME_ATTEMPTS = 6;
    let attempt = 0;

    // Listen for network interface switches (e.g. Wi-Fi A -> Wi-Fi B or Wi-Fi -> Cellular)
    // If network changes mid-flight, OkHttp's socket on the old interface may stall; cancelling the socket
    // cleanly triggers the retry loop below, which immediately resumes from `fileInfo.size` on the new network!
    let lastNetworkType: string | null = null;
    const netUnsubscribe = NetInfo.addEventListener((state) => {
      const currentType = `${state.type}_${state.isConnected}`;
      if (lastNetworkType && lastNetworkType !== currentType && activeDownloadResumable && !isDownloadPausedByUser) {
        // Network changed while downloading - pause the current socket so the loop resumes on the new interface
        activeDownloadResumable.pauseAsync().catch(() => {});
      }
      lastNetworkType = currentType;
    });

    try {
      while (attempt < MAX_NETWORK_RESUME_ATTEMPTS) {
        if (isDownloadCancelledByUser || isDownloadPausedByUser) {
          return null;
        }

        const currentFileInfo = await FileSystem.getInfoAsync(fileUri);
        const currentDiskBytes = currentFileInfo.exists ? ((currentFileInfo as any).size || 0) : 0;
        const storedMeta = await loadApkDownloadMeta();
        const knownTotal = storedMeta?.totalBytes || expectedSize || 0;

        // If the partial file already reached the full size, mark completed and return
        if (knownTotal > 0 && currentDiskBytes >= knownTotal) {
          await saveApkDownloadMeta({
            url,
            fileUri,
            expectedSize: expectedSize ?? null,
            downloadedBytes: currentDiskBytes,
            totalBytes: currentDiskBytes,
            completed: true,
          });
          notifyProgressListeners(1, currentDiskBytes, currentDiskBytes);
          return fileUri;
        }

        const resumeData = currentDiskBytes > 0 ? String(currentDiskBytes) : undefined;
        if (currentDiskBytes > 0 && knownTotal > 0) {
          const resumedProgress = Math.min(0.99, Math.max(0, currentDiskBytes / knownTotal));
          notifyProgressListeners(resumedProgress, currentDiskBytes, knownTotal);
        }

        const downloadResumable = FileSystem.createDownloadResumable(
          url,
          fileUri,
          {},
          (downloadProgress) => {
            const written = Math.max(0, downloadProgress.totalBytesWritten || 0);
            const rawExpected = downloadProgress.totalBytesExpectedToWrite;
            const total =
              rawExpected && rawExpected > 0
                ? rawExpected
                : knownTotal > 0
                ? knownTotal
                : 0;

            const rawRatio = total > 0 ? written / total : 0;
            const safeProgress = Math.min(1, Math.max(0, Number.isFinite(rawRatio) ? rawRatio : 0));

            notifyProgressListeners(safeProgress, written, total);

            // Periodically persist progress metadata (every ~512KB)
            if (written - lastSavedMetaBytes >= 512 * 1024 || (total > 0 && written >= total)) {
              lastSavedMetaBytes = written;
              saveApkDownloadMeta({
                url,
                fileUri,
                expectedSize: expectedSize ?? null,
                downloadedBytes: written,
                totalBytes: total,
                completed: false,
              });
            }
          },
          resumeData
        );

        activeDownloadResumable = downloadResumable;

        try {
          const result = resumeData
            ? await downloadResumable.resumeAsync()
            : await downloadResumable.downloadAsync();

          if (isDownloadCancelledByUser || isDownloadPausedByUser) {
            return null;
          }

          // Check HTTP status (200 OK or 206 Partial Content)
          if (result && result.uri && (!result.status || (result.status >= 200 && result.status < 300))) {
            const finalInfo = await FileSystem.getInfoAsync(result.uri);
            const finalSize = finalInfo.exists ? ((finalInfo as any).size || lastKnownProgress.downloadedBytes) : lastKnownProgress.downloadedBytes;

            await saveApkDownloadMeta({
              url,
              fileUri: result.uri,
              expectedSize: expectedSize ?? null,
              downloadedBytes: finalSize,
              totalBytes: finalSize,
              completed: true,
            });
            notifyProgressListeners(1, finalSize, finalSize);
            return result.uri;
          }

          // If result is null/undefined because NetInfo paused the socket during a Wi-Fi switch,
          // wait for the new network to stabilize and loop to resume from currentDiskBytes!
          if (!result && !isDownloadPausedByUser && !isDownloadCancelledByUser) {
            attempt++;
            const connected = await waitForNetworkConnection(45000);
            if (!connected) {
              throw new Error('Network connection lost. Tap Resume when back online.');
            }
            continue;
          }

          return null;
        } catch (err) {
          if (isDownloadCancelledByUser || isDownloadPausedByUser) {
            return null;
          }

          attempt++;
          // Persist whatever bytes are on disk right now so nothing is lost
          try {
            const partialInfo = await FileSystem.getInfoAsync(fileUri);
            if (partialInfo.exists && (partialInfo as any).size > 0) {
              await saveApkDownloadMeta({
                url,
                fileUri,
                expectedSize: expectedSize ?? null,
                downloadedBytes: (partialInfo as any).size,
                totalBytes: lastKnownProgress.totalBytes || expectedSize || 0,
                completed: false,
              });
            }
          } catch {}

          if (attempt >= MAX_NETWORK_RESUME_ATTEMPTS) {
            console.error('Error downloading APK after resume attempts:', err);
            throw err;
          }

          // Wait for network to reconnect (e.g. Wi-Fi switch) before resuming
          const connected = await waitForNetworkConnection(45000);
          if (!connected) {
            throw err;
          }
        }
      }

      return null;
    } finally {
      netUnsubscribe();
      activeDownloadResumable = null;
    }
  };

  activeDownloadPromise = runDownload();

  try {
    return await activeDownloadPromise;
  } finally {
    activeDownloadPromise = null;
    activeDownloadUrl = null;
    if (onProgress) {
      progressListeners.delete(onProgress);
    }
  }
};

/**
 * Install APK file on Android
 */
export const installApk = async (fileUri: string): Promise<void> => {
  if (Platform.OS !== 'android') {
    console.log('APK installation is only supported on Android');
    return;
  }

  try {
    // Convert file:// URI to content:// URI for Android
    const contentUri = await FileSystem.getContentUriAsync(fileUri);

    // FLAG_ACTIVITY_NEW_TASK (0x10000000 = 268435456) | FLAG_GRANT_READ_URI_PERMISSION (0x1)
    // Combined: 268435457
    // This is required for the APK installation dialog to appear properly
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: contentUri,
      flags: 268435457,
      type: 'application/vnd.android.package-archive',
    });
  } catch (error) {
    console.error('Error installing APK:', error);
    throw error;
  }
};

/**
 * Format bytes to human readable string
 */
export const formatBytes = (bytes: number): string => {
  if (!bytes || bytes <= 0 || !Number.isFinite(bytes)) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

/**
 * Check if automatic installation is available for the current platform
 */
export const canAutoInstall = (): boolean => {
  return Platform.OS === 'android';
};

export const updateService = {
  checkForUpdates: async (force: boolean = true) => checkForUpdate(force),
  getCurrentVersion: async () => getCurrentVersion(),
  getLatestVersion: async () => {
    const res = await checkForUpdate(true);
    return res.latestRelease?.version || null;
  },
  hasUpdateAvailable: async () => {
    const res = await checkForUpdate(true);
    return res.hasUpdate;
  },
  isNewerVersion: (v1: string, v2: string) => {
    try {
      return compareVersions(v1, v2) > 0;
    } catch {
      return false;
    }
  },
  saveLastCheckedTime: async () => markUpdateChecked(),
  getLastCheckedTime: async () => {
    try {
      const val = await AsyncStorage.getItem(STORAGE_KEYS.LAST_CHECK_TIME);
      return val ? parseInt(val, 10) : null;
    } catch {
      return null;
    }
  },
  dismissUpdateModal: async () => {
    try {
      await AsyncStorage.setItem('@update_modal_dismissed', 'true');
    } catch {}
  },
  isUpdateModalDismissed: async (): Promise<boolean> => {
    try {
      const val = await AsyncStorage.getItem('@update_modal_dismissed');
      return val === 'true';
    } catch {
      return false;
    }
  },
  parseVersion: (version: string) => {
    const clean = (version || '').replace(/^v/, '');
    const [core, ...meta] = clean.split(/[-+]/);
    const parts = (core || '').split('.').map((n) => parseInt(n, 10) || 0);
    return {
      major: parts[0] || 0,
      minor: parts[1] || 0,
      patch: parts[2] || 0,
      tag: meta.join('-'),
    };
  },
  skipVersion: async (version: string) => skipVersion(version),
  isVersionSkipped: async (version: string) => isVersionSkipped(version),
  resetSkippedVersion: async () => clearSkippedVersion(),
  getApkDownloadState: async (url: string, expectedSize?: number | null) =>
    getApkDownloadState(url, expectedSize),
  pauseApkDownload: async () => pauseApkDownload(),
  cancelApkDownload: async () => cancelApkDownload(),
  subscribeToApkDownload: (cb: (progress: number, downloadedBytes: number, totalBytes: number) => void) =>
    subscribeToApkDownload(cb),
};
