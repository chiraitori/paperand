import {
    parsePBColorsFile,
    getCustomThemes,
    saveCustomTheme,
    deleteCustomTheme,
    getActiveCustomThemeId,
    setActiveCustomThemeId,
    getCustomThemeById,
} from '../services/themeService';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Mock dependencies
jest.mock('@react-native-async-storage/async-storage', () => ({
    setItem: jest.fn(),
    getItem: jest.fn(),
    removeItem: jest.fn(),
}));

jest.mock('expo-document-picker', () => ({
    getDocumentAsync: jest.fn(),
}));

jest.mock('expo-file-system', () => ({
    File: jest.fn(),
}));

describe('Theme Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('parsePBColorsFile', () => {
        const validPBColorsContent = JSON.stringify({
            accentColor: {
                lightColor: { red: 0.2, green: 0.4, blue: 0.8, alpha: 1 },
                darkColor: { red: 0.3, green: 0.5, blue: 0.9, alpha: 1 },
            },
            accentTextColor: {
                lightColor: { red: 1, green: 1, blue: 1, alpha: 1 },
                darkColor: { red: 1, green: 1, blue: 1, alpha: 1 },
            },
            foregroundColor: {
                lightColor: { red: 0.95, green: 0.95, blue: 0.95, alpha: 1 },
                darkColor: { red: 0.1, green: 0.1, blue: 0.1, alpha: 1 },
            },
            backgroundColor: {
                lightColor: { red: 1, green: 1, blue: 1, alpha: 1 },
                darkColor: { red: 0, green: 0, blue: 0, alpha: 1 },
            },
            overlayColor: {
                lightColor: { red: 0, green: 0, blue: 0, alpha: 0.5 },
                darkColor: { red: 0, green: 0, blue: 0, alpha: 0.7 },
            },
            separatorColor: {
                lightColor: { red: 0.8, green: 0.8, blue: 0.8, alpha: 1 },
                darkColor: { red: 0.3, green: 0.3, blue: 0.3, alpha: 1 },
            },
            bodyTextColor: {
                lightColor: { red: 0, green: 0, blue: 0, alpha: 1 },
                darkColor: { red: 1, green: 1, blue: 1, alpha: 1 },
            },
            subtitleTextColor: {
                lightColor: { red: 0.5, green: 0.5, blue: 0.5, alpha: 1 },
                darkColor: { red: 0.7, green: 0.7, blue: 0.7, alpha: 1 },
            },
        });

        it('should parse .pbcolors file and return CustomTheme', () => {
            const theme = parsePBColorsFile(validPBColorsContent, 'Test Theme');

            expect(theme).toBeDefined();
            expect(theme.name).toBe('Test Theme');
            expect(theme.id).toMatch(/^custom_\d+$/);
            expect(theme.light).toBeDefined();
            expect(theme.dark).toBeDefined();
        });

        it('should correctly convert colors to hex format', () => {
            const theme = parsePBColorsFile(validPBColorsContent, 'Test Theme');

            // Light theme background should be white (#FFFFFF)
            expect(theme.light.background).toBe('#FFFFFF');

            // Dark theme background should be black (#000000)
            expect(theme.dark.background).toBe('#000000');

            // Light theme text should be black (#000000)
            expect(theme.light.text).toBe('#000000');

            // Dark theme text should be white (#FFFFFF)
            expect(theme.dark.text).toBe('#FFFFFF');
        });

        it('should include default error and success colors', () => {
            const theme = parsePBColorsFile(validPBColorsContent, 'Test Theme');

            expect(theme.light.error).toBe('#B00020');
            expect(theme.light.success).toBe('#00C853');
            expect(theme.dark.error).toBe('#CF6679');
            expect(theme.dark.success).toBe('#00E676');
        });

        it('should throw error for invalid JSON', () => {
            expect(() => parsePBColorsFile('invalid json', 'Test')).toThrow();
        });
    });

    describe('getCustomThemes', () => {
        it('should return empty array when no themes stored', async () => {
            (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

            const themes = await getCustomThemes();

            expect(themes).toEqual([]);
        });

        it('should return parsed themes from storage', async () => {
            const mockThemes = [
                { id: 'theme1', name: 'Theme 1', light: {}, dark: {} },
                { id: 'theme2', name: 'Theme 2', light: {}, dark: {} },
            ];
            (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(mockThemes));

            const themes = await getCustomThemes();

            expect(themes).toHaveLength(2);
            expect(themes[0].name).toBe('Theme 1');
            expect(themes[1].name).toBe('Theme 2');
        });

        it('should return empty array on storage error', async () => {
            (AsyncStorage.getItem as jest.Mock).mockRejectedValue(new Error('Storage error'));

            const themes = await getCustomThemes();

            expect(themes).toEqual([]);
        });
    });

    describe('saveCustomTheme', () => {
        it('should save new theme to storage', async () => {
            (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify([]));

            const newTheme = { id: 'theme1', name: 'New Theme', light: {}, dark: {} };
            await saveCustomTheme(newTheme as any);

            expect(AsyncStorage.setItem).toHaveBeenCalled();
            const savedData = JSON.parse((AsyncStorage.setItem as jest.Mock).mock.calls[0][1]);
            expect(savedData).toHaveLength(1);
            expect(savedData[0].name).toBe('New Theme');
        });

        it('should replace existing theme with same name', async () => {
            const existingThemes = [{ id: 'theme1', name: 'Existing Theme', light: { primary: 'old' }, dark: {} }];
            (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(existingThemes));

            const updatedTheme = { id: 'theme2', name: 'Existing Theme', light: { primary: 'new' }, dark: {} };
            await saveCustomTheme(updatedTheme as any);

            const savedData = JSON.parse((AsyncStorage.setItem as jest.Mock).mock.calls[0][1]);
            expect(savedData).toHaveLength(1);
            expect(savedData[0].light.primary).toBe('new');
        });

        it('should add theme when name does not exist', async () => {
            const existingThemes = [{ id: 'theme1', name: 'Theme 1', light: {}, dark: {} }];
            (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(existingThemes));

            const newTheme = { id: 'theme2', name: 'Theme 2', light: {}, dark: {} };
            await saveCustomTheme(newTheme as any);

            const savedData = JSON.parse((AsyncStorage.setItem as jest.Mock).mock.calls[0][1]);
            expect(savedData).toHaveLength(2);
        });
    });

    describe('deleteCustomTheme', () => {
        it('should remove theme from storage', async () => {
            const existingThemes = [
                { id: 'theme1', name: 'Theme 1', light: {}, dark: {} },
                { id: 'theme2', name: 'Theme 2', light: {}, dark: {} },
            ];
            (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(existingThemes));

            await deleteCustomTheme('theme1');

            const savedData = JSON.parse((AsyncStorage.setItem as jest.Mock).mock.calls[0][1]);
            expect(savedData).toHaveLength(1);
            expect(savedData[0].id).toBe('theme2');
        });

        it('should clear active theme if deleted theme was active', async () => {
            const existingThemes = [{ id: 'theme1', name: 'Theme 1', light: {}, dark: {} }];
            (AsyncStorage.getItem as jest.Mock)
                .mockResolvedValueOnce(JSON.stringify(existingThemes)) // getCustomThemes
                .mockResolvedValueOnce('theme1'); // getActiveCustomThemeId

            await deleteCustomTheme('theme1');

            expect(AsyncStorage.removeItem).toHaveBeenCalled();
        });
    });

    describe('getActiveCustomThemeId', () => {
        it('should return active theme ID from storage', async () => {
            (AsyncStorage.getItem as jest.Mock).mockResolvedValue('theme1');

            const activeId = await getActiveCustomThemeId();

            expect(activeId).toBe('theme1');
        });

        it('should return null when no active theme', async () => {
            (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

            const activeId = await getActiveCustomThemeId();

            expect(activeId).toBeNull();
        });

        it('should return null on error', async () => {
            (AsyncStorage.getItem as jest.Mock).mockRejectedValue(new Error('Error'));

            const activeId = await getActiveCustomThemeId();

            expect(activeId).toBeNull();
        });
    });

    describe('setActiveCustomThemeId', () => {
        it('should save theme ID to storage', async () => {
            await setActiveCustomThemeId('theme1');

            expect(AsyncStorage.setItem).toHaveBeenCalledWith(
                '@paperback_active_custom_theme',
                'theme1'
            );
        });

        it('should remove from storage when null', async () => {
            await setActiveCustomThemeId(null);

            expect(AsyncStorage.removeItem).toHaveBeenCalledWith('@paperback_active_custom_theme');
        });
    });

    describe('getCustomThemeById', () => {
        it('should return theme by ID', async () => {
            const mockThemes = [
                { id: 'theme1', name: 'Theme 1', light: {}, dark: {} },
                { id: 'theme2', name: 'Theme 2', light: {}, dark: {} },
            ];
            (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(mockThemes));

            const theme = await getCustomThemeById('theme2');

            expect(theme).toBeDefined();
            expect(theme?.name).toBe('Theme 2');
        });

        it('should return null if theme not found', async () => {
            const mockThemes = [{ id: 'theme1', name: 'Theme 1', light: {}, dark: {} }];
            (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(mockThemes));

            const theme = await getCustomThemeById('nonexistent');

            expect(theme).toBeNull();
        });

        it('should return null on error', async () => {
            (AsyncStorage.getItem as jest.Mock).mockRejectedValue(new Error('Error'));

            const theme = await getCustomThemeById('theme1');

            expect(theme).toBeNull();
        });
    });
});
