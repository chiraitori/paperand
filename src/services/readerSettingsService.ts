import AsyncStorage from '@react-native-async-storage/async-storage';

export type ReaderMode = 'longStrip' | 'horizontal'; // Swift: longStrip (vertical), horizontal (paged)
export type ReaderDirection = 'rightToLeft' | 'leftToRight'; // Swift: rightToLeft (Manga), leftToRight (Comics)
export type PagedDisplayMode = 'singlePage' | 'doublePage' | 'automatic'; // Swift: singlePage, doublePage, automatic
export type ChapterBackground = 'theme' | 'dark' | 'light' | 'black' | 'white';
export type SettingButtonLocation = 'left' | 'right';
export type ChapterChangeArrowLocation = 'left' | 'middle' | 'right';
export type DeviceOrientationSetting = 'portrait' | 'landscape' | 'both';

export interface ReaderSettingsValues {
  readerMode: ReaderMode;
  readerDirection: ReaderDirection;
  pagedDisplayMode: PagedDisplayMode;
  markFirstPageAsSingle: boolean; // Always Separate First Page
  chapterBackgroundColor: ChapterBackground;
  settingButtonLocation: SettingButtonLocation;
  chapterChangeArrows: ChapterChangeArrowLocation;
  tapSidesToNavgiate: boolean; // Swift naming: tapSidesToNavgiate
  longPressToSaveImageEnabled: boolean;
  pagePadding: boolean;
  rotationLocked: boolean;
  downsamplePages: boolean;
  overlayEnabled: boolean;
  overlayStrength: number; // 0.0 - 1.0 (default 0.7)
  pillarbox: boolean;
  pillarboxOrientation: DeviceOrientationSetting;
}

export const defaultReaderSettings: ReaderSettingsValues = {
  readerMode: 'horizontal',
  readerDirection: 'rightToLeft', // Default manga direction
  pagedDisplayMode: 'automatic', // Single in portrait, double in landscape
  markFirstPageAsSingle: true,
  chapterBackgroundColor: 'black',
  settingButtonLocation: 'right',
  chapterChangeArrows: 'middle',
  tapSidesToNavgiate: true,
  longPressToSaveImageEnabled: true,
  pagePadding: false,
  rotationLocked: false,
  downsamplePages: true,
  overlayEnabled: true,
  overlayStrength: 0.7,
  pillarbox: false,
  pillarboxOrientation: 'both',
};

const GLOBAL_SETTINGS_KEY = '@paperback_reader_settings_global';
const MANGA_SETTINGS_PREFIX = '@paperback_reader_settings_manga_';

/**
 * Get reader settings for a specific manga or fallback to global settings
 */
export const getReaderSettings = async (mangaId?: string): Promise<{ settings: ReaderSettingsValues; isCustom: boolean }> => {
  try {
    if (mangaId) {
      const mangaSaved = await AsyncStorage.getItem(`${MANGA_SETTINGS_PREFIX}${mangaId}`);
      if (mangaSaved) {
        return {
          settings: { ...defaultReaderSettings, ...JSON.parse(mangaSaved) },
          isCustom: true,
        };
      }
    }

    const globalSaved = await AsyncStorage.getItem(GLOBAL_SETTINGS_KEY);
    if (globalSaved) {
      return {
        settings: { ...defaultReaderSettings, ...JSON.parse(globalSaved) },
        isCustom: false,
      };
    }
  } catch (error) {
    console.error('Failed to load reader settings:', error);
  }

  return { settings: defaultReaderSettings, isCustom: false };
};

/**
 * Save reader settings (either manga-specific or global)
 */
export const saveReaderSettings = async (
  settings: ReaderSettingsValues,
  mangaId?: string
): Promise<void> => {
  try {
    const key = mangaId ? `${MANGA_SETTINGS_PREFIX}${mangaId}` : GLOBAL_SETTINGS_KEY;
    await AsyncStorage.setItem(key, JSON.stringify(settings));
  } catch (error) {
    console.error('Failed to save reader settings:', error);
  }
};

/**
 * Reset manga-specific reader settings back to global defaults
 */
export const resetMangaReaderSettings = async (mangaId: string): Promise<void> => {
  try {
    await AsyncStorage.removeItem(`${MANGA_SETTINGS_PREFIX}${mangaId}`);
  } catch (error) {
    console.error('Failed to reset manga reader settings:', error);
  }
};

/**
 * Save settings globally and clear manga override
 */
export const applySettingsGlobally = async (
  settings: ReaderSettingsValues,
  currentMangaId?: string
): Promise<void> => {
  try {
    await AsyncStorage.setItem(GLOBAL_SETTINGS_KEY, JSON.stringify(settings));
    if (currentMangaId) {
      await AsyncStorage.removeItem(`${MANGA_SETTINGS_PREFIX}${currentMangaId}`);
    }
  } catch (error) {
    console.error('Failed to apply reader settings globally:', error);
  }
};
