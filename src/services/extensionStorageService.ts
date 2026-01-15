/**
 * Extension Storage Service
 * 
 * Manages installed extensions storage and source.js downloads.
 * Shared between sourceService and headlessExtensionRuntime.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

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
}

const INSTALLED_EXTENSIONS_KEY = '@installed_extensions_data';

/**
 * Get all installed extensions
 */
export const getInstalledExtensions = async (): Promise<InstalledExtension[]> => {
    try {
        const data = await AsyncStorage.getItem(INSTALLED_EXTENSIONS_KEY);
        if (!data) return [];
        return JSON.parse(data);
    } catch (error) {
        console.error('Error getting installed extensions:', error);
        return [];
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
export const downloadSourceJs = async (ext: InstalledExtension): Promise<string | null> => {
    if (!ext.repoBaseUrl || !ext.id) {
        console.error('Cannot download source.js - missing repoBaseUrl or id');
        return null;
    }

    const sourceUrl = `${ext.repoBaseUrl}/${ext.id}/source.js`;
    console.log('Downloading source.js from:', sourceUrl);

    try {
        const response = await fetch(sourceUrl, {
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
            throw new Error('Invalid source.js content');
        }

        console.log('Downloaded source.js, length:', js.length);
        return js;
    } catch (error: any) {
        console.error('Error downloading source.js:', error.message);
        return null;
    }
};
