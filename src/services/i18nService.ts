/**
 * i18n Service - Internationalization for Paperand
 * 
 * Uses expo-localization for device locale detection
 * and i18n-js for translation management.
 * 
 * Translations are managed via Crowdin and synced to src/locales/
 */

import { I18n } from 'i18n-js';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { en, vi, zh, de, id, ja, ms, ru, es, th } from '../locales';

// Supported languages with display names
export const SUPPORTED_LANGUAGES = {
    en: { name: 'English', nativeName: 'English' },
    vi: { name: 'Vietnamese', nativeName: 'Tiếng Việt' },
    zh: { name: 'Chinese (Simplified)', nativeName: '简体中文' },
    de: { name: 'German', nativeName: 'Deutsch' },
    id: { name: 'Indonesian', nativeName: 'Bahasa Indonesia' },
    ja: { name: 'Japanese', nativeName: '日本語' },
    ms: { name: 'Malay', nativeName: 'Bahasa Melayu' },
    ru: { name: 'Russian', nativeName: 'Русский' },
    es: { name: 'Spanish', nativeName: 'Español' },
    th: { name: 'Thai', nativeName: 'ไทย' },
} as const;

export type LanguageCode = keyof typeof SUPPORTED_LANGUAGES;

const LANGUAGE_STORAGE_KEY = '@app_language';

// Create i18n instance with all translations
const i18n = new I18n({
    en,
    vi,
    zh,
    de,
    id,
    ja,
    ms,
    ru,
    es,
    th,
});

// Set default options
i18n.defaultLocale = 'en';
i18n.enableFallback = true;

// Initialize with device locale
const deviceLocale = Localization.getLocales()[0]?.languageCode || 'en';
i18n.locale = deviceLocale in SUPPORTED_LANGUAGES ? deviceLocale : 'en';

/**
 * Initialize i18n with saved language preference
 */
export const initializeI18n = async (): Promise<void> => {
    try {
        const savedLanguage = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
        if (savedLanguage && savedLanguage in SUPPORTED_LANGUAGES) {
            i18n.locale = savedLanguage;
        }
    } catch (error) {
        console.error('Failed to load saved language:', error);
    }
};

/**
 * Get current language code
 */
export const getCurrentLanguage = (): LanguageCode => {
    return i18n.locale as LanguageCode;
};

/**
 * Set app language
 */
export const setLanguage = async (languageCode: LanguageCode): Promise<void> => {
    if (languageCode in SUPPORTED_LANGUAGES) {
        i18n.locale = languageCode;
        await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, languageCode);
    }
};

/**
 * Get device's preferred language
 */
export const getDeviceLanguage = (): string => {
    return Localization.getLocales()[0]?.languageCode || 'en';
};

/**
 * Translation function - shorthand for i18n.t()
 * Usage: t('common.loading') or t('library.empty')
 */
export const t = (key: string, options?: object): string => {
    return i18n.t(key, options);
};

/**
 * Check if a translation key exists
 */
export const hasTranslation = (key: string): boolean => {
    const translation = i18n.t(key, { defaultValue: '__MISSING__' });
    return translation !== '__MISSING__';
};

// Export the i18n instance for advanced usage
export { i18n };

// Default export as translation function
export default t;
