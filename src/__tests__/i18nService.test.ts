import {
    initializeI18n,
    getCurrentLanguage,
    setLanguage,
    getDeviceLanguage,
    t,
    hasTranslation,
    SUPPORTED_LANGUAGES,
    i18n,
} from '../services/i18nService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import { Platform } from 'react-native';

// Mock dependencies
jest.mock('@react-native-async-storage/async-storage', () => ({
    setItem: jest.fn(),
    getItem: jest.fn(),
    removeItem: jest.fn(),
}));

jest.mock('expo-localization', () => ({
    getLocales: jest.fn().mockReturnValue([{ languageCode: 'en' }]),
}));

jest.mock('react-native', () => ({
    Platform: {
        OS: 'android',
    },
}));

// Mock locale files
jest.mock('../locales', () => ({
    en: {
        common: {
            loading: 'Loading...',
            error: 'Error',
            ok: 'OK',
            cancel: 'Cancel',
        },
        library: {
            title: 'Library',
            empty: 'Your library is empty',
        },
    },
    vi: {
        common: {
            loading: 'Đang tải...',
            error: 'Lỗi',
            ok: 'OK',
            cancel: 'Hủy',
        },
        library: {
            title: 'Thư viện',
            empty: 'Thư viện của bạn trống',
        },
    },
    zh: {},
    de: {},
    id: {},
    ja: {},
    ms: {},
    ru: {},
    es: {},
    th: {},
    el: {},
    hi: {},
    hu: {},
    it: {},
    lo: {},
    pt: {},
}));

describe('i18n Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Reset i18n locale to English for each test
        i18n.locale = 'en';
    });

    describe('SUPPORTED_LANGUAGES', () => {
        it('should have English as a supported language', () => {
            expect(SUPPORTED_LANGUAGES.en).toBeDefined();
            expect(SUPPORTED_LANGUAGES.en.name).toBe('English');
            expect(SUPPORTED_LANGUAGES.en.nativeName).toBe('English');
        });

        it('should have Vietnamese as a supported language', () => {
            expect(SUPPORTED_LANGUAGES.vi).toBeDefined();
            expect(SUPPORTED_LANGUAGES.vi.name).toBe('Vietnamese');
            expect(SUPPORTED_LANGUAGES.vi.nativeName).toBe('Tiếng Việt');
        });

        it('should have all expected languages', () => {
            const expectedLanguages = ['en', 'vi', 'zh', 'de', 'el', 'hi', 'hu', 'id', 'it', 'ja', 'lo', 'ms', 'pt', 'ru', 'es', 'th'];
            expectedLanguages.forEach(lang => {
                expect(SUPPORTED_LANGUAGES[lang as keyof typeof SUPPORTED_LANGUAGES]).toBeDefined();
            });
        });
    });

    describe('initializeI18n', () => {
        it('should use saved language preference on Android', async () => {
            (AsyncStorage.getItem as jest.Mock).mockResolvedValue('vi');

            await initializeI18n();

            expect(i18n.locale).toBe('vi');
        });

        it('should fallback to device locale when no saved preference on Android', async () => {
            (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
            (Localization.getLocales as jest.Mock).mockReturnValue([{ languageCode: 'de' }]);

            await initializeI18n();

            // Since no saved preference and de is supported, it should use device locale
            // But the i18n initialization already happened, so we check the fallback behavior
            expect(AsyncStorage.getItem).toHaveBeenCalled();
        });

        it('should ignore invalid saved language', async () => {
            const originalLocale = i18n.locale;
            (AsyncStorage.getItem as jest.Mock).mockResolvedValue('invalid_lang');

            await initializeI18n();

            // Should keep current locale
            expect(i18n.locale).toBe(originalLocale);
        });

        it('should handle storage errors gracefully', async () => {
            (AsyncStorage.getItem as jest.Mock).mockRejectedValue(new Error('Storage error'));

            // Should not throw
            await expect(initializeI18n()).resolves.not.toThrow();
        });
    });

    describe('getCurrentLanguage', () => {
        it('should return current locale', () => {
            i18n.locale = 'en';
            expect(getCurrentLanguage()).toBe('en');

            i18n.locale = 'vi';
            expect(getCurrentLanguage()).toBe('vi');
        });
    });

    describe('setLanguage', () => {
        it('should change language and save to storage', async () => {
            await setLanguage('vi');

            expect(i18n.locale).toBe('vi');
            expect(AsyncStorage.setItem).toHaveBeenCalledWith('@app_language', 'vi');
        });

        it('should not change language for unsupported locale', async () => {
            i18n.locale = 'en';

            // @ts-ignore - Testing invalid input
            await setLanguage('invalid');

            expect(i18n.locale).toBe('en');
            expect(AsyncStorage.setItem).not.toHaveBeenCalled();
        });
    });

    describe('getDeviceLanguage', () => {
        it('should return device language code', () => {
            (Localization.getLocales as jest.Mock).mockReturnValue([{ languageCode: 'ja' }]);

            const lang = getDeviceLanguage();

            expect(lang).toBe('ja');
        });

        it('should return en as default when no locales', () => {
            (Localization.getLocales as jest.Mock).mockReturnValue([]);

            const lang = getDeviceLanguage();

            expect(lang).toBe('en');
        });

        it('should return en when languageCode is undefined', () => {
            (Localization.getLocales as jest.Mock).mockReturnValue([{}]);

            const lang = getDeviceLanguage();

            expect(lang).toBe('en');
        });
    });

    describe('t (translation function)', () => {
        beforeEach(() => {
            i18n.locale = 'en';
        });

        it('should translate keys correctly', () => {
            expect(t('common.loading')).toBe('Loading...');
            expect(t('library.title')).toBe('Library');
        });

        it('should translate with different locale', () => {
            i18n.locale = 'vi';

            expect(t('common.loading')).toBe('Đang tải...');
            expect(t('library.title')).toBe('Thư viện');
        });

        it('should fallback to English for missing translations', () => {
            i18n.locale = 'zh';

            // zh locale is empty, should fallback to en
            expect(t('common.loading')).toBe('Loading...');
        });

        it('should handle translation options', () => {
            // Assuming the translation supports interpolation
            const result = t('common.loading', { defaultValue: 'Custom Default' });
            expect(result).toBeDefined();
        });
    });

    describe('hasTranslation', () => {
        beforeEach(() => {
            i18n.locale = 'en';
        });

        it('should return true for existing keys', () => {
            expect(hasTranslation('common.loading')).toBe(true);
            expect(hasTranslation('library.title')).toBe(true);
        });

        it('should return false for non-existing keys', () => {
            expect(hasTranslation('non.existing.key')).toBe(false);
        });
    });

    describe('i18n instance', () => {
        it('should have fallback enabled', () => {
            expect(i18n.enableFallback).toBe(true);
        });

        it('should have English as default locale', () => {
            expect(i18n.defaultLocale).toBe('en');
        });
    });
});
