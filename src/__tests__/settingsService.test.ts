import {
    getGeneralSettings,
    saveGeneralSettings,
    updateGeneralSetting,
    defaultSettings,
    GeneralSettings,
} from '../services/settingsService';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
    setItem: jest.fn(),
    getItem: jest.fn(),
    removeItem: jest.fn(),
}));

// Mock Platform
jest.mock('react-native', () => ({
    Platform: {
        OS: 'android',
    },
}));

describe('Settings Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('defaultSettings', () => {
        it('should have correct default values', () => {
            expect(defaultSettings.portraitColumns).toBe(3);
            expect(defaultSettings.landscapeColumns).toBe(7);
            expect(defaultSettings.chapterListSort).toBe('descending');
            expect(defaultSettings.interactiveUpdates).toBe(false);
            expect(defaultSettings.libraryAuth).toBe(false);
            expect(defaultSettings.historyAuth).toBe(false);
            expect(defaultSettings.hideUpdateModal).toBe(false);
            expect(defaultSettings.parallelDownloads).toBe(3);
        });
    });

    describe('getGeneralSettings', () => {
        it('should return default settings when nothing stored', async () => {
            (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

            const settings = await getGeneralSettings();

            expect(settings).toEqual(defaultSettings);
        });

        it('should merge stored settings with defaults', async () => {
            const storedSettings = {
                portraitColumns: 4,
                chapterListSort: 'ascending',
            };
            (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(storedSettings));

            const settings = await getGeneralSettings();

            expect(settings.portraitColumns).toBe(4);
            expect(settings.chapterListSort).toBe('ascending');
            // Should keep defaults for unstored values
            expect(settings.landscapeColumns).toBe(7);
            expect(settings.parallelDownloads).toBe(3);
        });

        it('should return defaults on storage error', async () => {
            (AsyncStorage.getItem as jest.Mock).mockRejectedValue(new Error('Storage error'));

            const settings = await getGeneralSettings();

            expect(settings).toEqual(defaultSettings);
        });

        it('should handle empty stored string', async () => {
            (AsyncStorage.getItem as jest.Mock).mockResolvedValue('{}');

            const settings = await getGeneralSettings();

            expect(settings).toEqual(defaultSettings);
        });
    });

    describe('saveGeneralSettings', () => {
        it('should save settings to storage', async () => {
            const settings: GeneralSettings = {
                ...defaultSettings,
                portraitColumns: 4,
                landscapeColumns: 6,
            };

            await saveGeneralSettings(settings);

            expect(AsyncStorage.setItem).toHaveBeenCalledWith(
                '@general_settings',
                JSON.stringify(settings)
            );
        });

        it('should handle storage errors gracefully', async () => {
            (AsyncStorage.setItem as jest.Mock).mockRejectedValue(new Error('Storage error'));

            // Should not throw
            await expect(saveGeneralSettings(defaultSettings)).resolves.not.toThrow();
        });
    });

    describe('updateGeneralSetting', () => {
        it('should update a single setting', async () => {
            (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(defaultSettings));

            await updateGeneralSetting('portraitColumns', 5);

            expect(AsyncStorage.setItem).toHaveBeenCalled();
            const savedData = JSON.parse((AsyncStorage.setItem as jest.Mock).mock.calls[0][1]);
            expect(savedData.portraitColumns).toBe(5);
            // Other settings should remain unchanged
            expect(savedData.landscapeColumns).toBe(7);
        });

        it('should update boolean settings', async () => {
            (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(defaultSettings));

            await updateGeneralSetting('libraryAuth', true);

            const savedData = JSON.parse((AsyncStorage.setItem as jest.Mock).mock.calls[0][1]);
            expect(savedData.libraryAuth).toBe(true);
        });

        it('should update string settings', async () => {
            (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(defaultSettings));

            await updateGeneralSetting('chapterListSort', 'ascending');

            const savedData = JSON.parse((AsyncStorage.setItem as jest.Mock).mock.calls[0][1]);
            expect(savedData.chapterListSort).toBe('ascending');
        });

        it('should preserve existing settings when updating', async () => {
            const existingSettings = {
                ...defaultSettings,
                portraitColumns: 4,
                libraryAuth: true,
            };
            (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(existingSettings));

            await updateGeneralSetting('parallelDownloads', 5);

            const savedData = JSON.parse((AsyncStorage.setItem as jest.Mock).mock.calls[0][1]);
            expect(savedData.portraitColumns).toBe(4);
            expect(savedData.libraryAuth).toBe(true);
            expect(savedData.parallelDownloads).toBe(5);
        });
    });

    describe('Settings validation', () => {
        it('should handle portraitColumns edge values', async () => {
            (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(defaultSettings));

            await updateGeneralSetting('portraitColumns', 1);
            let savedData = JSON.parse((AsyncStorage.setItem as jest.Mock).mock.calls[0][1]);
            expect(savedData.portraitColumns).toBe(1);

            await updateGeneralSetting('portraitColumns', 10);
            savedData = JSON.parse((AsyncStorage.setItem as jest.Mock).mock.calls[1][1]);
            expect(savedData.portraitColumns).toBe(10);
        });

        it('should handle parallelDownloads edge values', async () => {
            (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(defaultSettings));

            await updateGeneralSetting('parallelDownloads', 1);
            let savedData = JSON.parse((AsyncStorage.setItem as jest.Mock).mock.calls[0][1]);
            expect(savedData.parallelDownloads).toBe(1);

            await updateGeneralSetting('parallelDownloads', 10);
            savedData = JSON.parse((AsyncStorage.setItem as jest.Mock).mock.calls[1][1]);
            expect(savedData.parallelDownloads).toBe(10);
        });
    });
});
