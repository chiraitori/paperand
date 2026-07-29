/**
 * Extension Storage Service
 * 
 * Manages installed extensions storage and source.js downloads.
 * Shared between sourceService and headlessExtensionRuntime.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import type { PaperbackApiVersion } from './extensionService';

export interface InstalledExtension {
    id: string;
    name: string;
    author: string;
    desc: string;
    website: string;
    version: string;
    icon: string;
    tags?: { text: string; type: string }[];
    contentRating?: string;
    websiteBaseURL?: string;
    repositoryUrl?: string;
    repoBaseUrl?: string;
    sourceJs?: string;
    apiVersion?: PaperbackApiVersion;
    bundleFilename?: 'source.js' | 'index.js';
    assetDirectory?: 'includes' | 'static';
    language?: string;
    intents?: number;
}

const INSTALLED_EXTENSIONS_KEY = '@installed_extensions_data';
const BUILT_IN_YURI_GARDEN_SEED_KEY = '@built_in_yurigarden_1_1_0';

const compareVersions = (left: string, right: string): number => {
    const a = left.split('.').map(value => Number(value) || 0);
    const b = right.split('.').map(value => Number(value) || 0);
    const length = Math.max(a.length, b.length);
    for (let index = 0; index < length; index++) {
        const difference = (a[index] || 0) - (b[index] || 0);
        if (difference !== 0) return difference;
    }
    return 0;
};

const loadBuiltInYuriGarden = async (): Promise<InstalledExtension> => {
    const asset = Asset.fromModule(require('../../assets/extensions/YuriGarden.pbjs'));
    await asset.downloadAsync();
    const uri = asset.localUri || asset.uri;
    const sourceJs = await new File(uri).text();

    return {
        id: 'YuriGarden',
        name: 'YuriGarden',
        author: 'AlanNois',
        desc: 'Đọc manga từ YuriGarden.moe với đăng nhập và giải mã ảnh.',
        website: 'https://yurigarden.moe/',
        websiteBaseURL: 'https://yurigarden.moe/',
        version: '1.1.0',
        icon: 'icon.png',
        tags: [{ text: 'Recommended', type: 'info' }],
        contentRating: 'MATURE',
        repositoryUrl: 'https://github.com/chiraitori/TruyenViet-0.8',
        repoBaseUrl: 'https://chiraitori.github.io/TruyenViet-0.8',
        sourceJs,
        apiVersion: '0.8',
        bundleFilename: 'source.js',
        assetDirectory: 'includes',
        language: 'vi',
    };
};

/**
 * Get all installed extensions
 */
export const getInstalledExtensions = async (): Promise<InstalledExtension[]> => {
    let stored: InstalledExtension[] = [];
    try {
        const data = await AsyncStorage.getItem(INSTALLED_EXTENSIONS_KEY);
        stored = data ? JSON.parse(data) : [];
        const seeded = await AsyncStorage.getItem(BUILT_IN_YURI_GARDEN_SEED_KEY);
        if (seeded === 'true') return stored;

        let builtIn: InstalledExtension;
        try {
            builtIn = await loadBuiltInYuriGarden();
        } catch (error) {
            console.error('Error loading built-in YuriGarden extension:', error);
            return stored;
        }
        const existingIndex = stored.findIndex(
            extension => extension.id.toLowerCase() === builtIn.id.toLowerCase()
        );

        if (existingIndex < 0) {
            stored.push(builtIn);
        } else if (compareVersions(stored[existingIndex].version, builtIn.version) < 0) {
            stored[existingIndex] = { ...stored[existingIndex], ...builtIn };
        }

        await AsyncStorage.multiSet([
            [INSTALLED_EXTENSIONS_KEY, JSON.stringify(stored)],
            [BUILT_IN_YURI_GARDEN_SEED_KEY, 'true'],
        ]);
        return stored;
    } catch (error) {
        console.error('Error getting installed extensions:', error);
        return stored;
    }
};

/**
 * Save installed extensions
 */
export const saveInstalledExtensions = async (extensions: InstalledExtension[]): Promise<void> => {
    try {
        await AsyncStorage.setItem(INSTALLED_EXTENSIONS_KEY, JSON.stringify(extensions));
    } catch (error) {
        console.error('Error saving installed extensions:', error);
    }
};

/**
 * Download source.js for an extension
 */
export const getInstalledExtensionBundleUrl = (ext: InstalledExtension): string | null => {
    if (!ext.repoBaseUrl || !ext.id) {
        return null;
    }

    const filename = ext.bundleFilename
        || (ext.apiVersion === '0.9' ? 'index.js' : 'source.js');
    return `${ext.repoBaseUrl.replace(/\/+$/, '')}/${ext.id}/${filename}`;
};

export const getInstalledExtensionIconUrl = (ext: InstalledExtension): string | null => {
    if (!ext.repoBaseUrl || !ext.id || !ext.icon) {
        return null;
    }

    const directory = ext.assetDirectory
        || (ext.apiVersion === '0.9' ? 'static' : 'includes');
    return `${ext.repoBaseUrl.replace(/\/+$/, '')}/${ext.id}/${directory}/${ext.icon}`;
};

/**
 * Download the executable bundle for a Paperback extension.
 * The sourceJs field is intentionally retained in storage for migration
 * compatibility, even when the actual file is a Paperback 0.9 index.js.
 */
export const downloadExtensionBundle = async (ext: InstalledExtension): Promise<string | null> => {
    const bundleUrl = getInstalledExtensionBundleUrl(ext);
    if (!bundleUrl) {
        console.error('Cannot download extension bundle - missing repoBaseUrl or id');
        return null;
    }

    console.log('Downloading extension bundle from:', bundleUrl);

    try {
        const response = await fetch(bundleUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36',
                'Accept': '*/*',
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const js = await response.text();
        if (!js || js.length < 100) {
            throw new Error('Invalid extension bundle content');
        }

        console.log('Downloaded extension bundle, length:', js.length);
        return js;
    } catch (error: any) {
        console.error('Error downloading source.js:', error.message);
        return null;
    }
};

// Backward-compatible export used by older callers.
export const downloadSourceJs = downloadExtensionBundle;
