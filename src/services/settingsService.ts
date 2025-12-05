import AsyncStorage from '@react-native-async-storage/async-storage';

const SETTINGS_KEY = '@general_settings';

export interface GeneralSettings {
    portraitColumns: number;
    landscapeColumns: number;
    chapterListSort: 'ascending' | 'descending';
    interactiveUpdates: boolean;
    libraryAuth: boolean;
    hideUpdateModal: boolean;
}

export const defaultSettings: GeneralSettings = {
    portraitColumns: 3,
    landscapeColumns: 7,
    chapterListSort: 'descending',
    interactiveUpdates: false,
    libraryAuth: false,
    hideUpdateModal: false,
};

/**
 * Get general settings from storage
 */
export const getGeneralSettings = async (): Promise<GeneralSettings> => {
    try {
        const saved = await AsyncStorage.getItem(SETTINGS_KEY);
        if (saved) {
            return { ...defaultSettings, ...JSON.parse(saved) };
        }
    } catch (error) {
        console.error('Failed to load general settings:', error);
    }
    return defaultSettings;
};

/**
 * Save general settings to storage
 */
export const saveGeneralSettings = async (settings: GeneralSettings): Promise<void> => {
    try {
        await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (error) {
        console.error('Failed to save general settings:', error);
    }
};

/**
 * Update a single setting
 */
export const updateGeneralSetting = async <K extends keyof GeneralSettings>(
    key: K,
    value: GeneralSettings[K]
): Promise<void> => {
    const current = await getGeneralSettings();
    const updated = { ...current, [key]: value };
    await saveGeneralSettings(updated);
};
