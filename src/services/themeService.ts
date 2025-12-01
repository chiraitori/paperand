import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { ThemeColors, CustomTheme } from '../types';

const CUSTOM_THEMES_KEY = '@paperback_custom_themes';
const ACTIVE_CUSTOM_THEME_KEY = '@paperback_active_custom_theme';

// Paperback .pbcolors format
interface PBColor {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

interface PBColorPair {
  lightColor: PBColor;
  darkColor: PBColor;
}

interface PBColorsFile {
  accentColor: PBColorPair;
  accentTextColor: PBColorPair;
  foregroundColor: PBColorPair;
  backgroundColor: PBColorPair;
  overlayColor: PBColorPair;
  separatorColor: PBColorPair;
  bodyTextColor: PBColorPair;
  subtitleTextColor: PBColorPair;
}

// Re-export CustomTheme for convenience
export type { CustomTheme };

// Convert PBColor (0-1 range) to hex string
const pbColorToHex = (color: PBColor): string => {
  const r = Math.round(color.red * 255);
  const g = Math.round(color.green * 255);
  const b = Math.round(color.blue * 255);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
};

// Convert PBColor to rgba string (for colors with alpha)
const pbColorToRgba = (color: PBColor): string => {
  const r = Math.round(color.red * 255);
  const g = Math.round(color.green * 255);
  const b = Math.round(color.blue * 255);
  return `rgba(${r}, ${g}, ${b}, ${color.alpha})`;
};

// Parse .pbcolors file content into CustomTheme
export const parsePBColorsFile = (content: string, name: string): CustomTheme => {
  const pbColors: PBColorsFile = JSON.parse(content);
  
  const lightTheme: ThemeColors = {
    primary: pbColorToHex(pbColors.accentColor.lightColor),
    accent: pbColorToHex(pbColors.accentColor.lightColor),
    background: pbColorToHex(pbColors.backgroundColor.lightColor),
    card: pbColorToHex(pbColors.foregroundColor.lightColor),
    text: pbColorToHex(pbColors.bodyTextColor.lightColor),
    textSecondary: pbColorToHex(pbColors.subtitleTextColor.lightColor),
    border: pbColorToHex(pbColors.separatorColor.lightColor),
    error: '#B00020', // Not in pbcolors, use default
    success: '#00C853', // Not in pbcolors, use default
  };

  const darkTheme: ThemeColors = {
    primary: pbColorToHex(pbColors.accentColor.darkColor),
    accent: pbColorToHex(pbColors.accentColor.darkColor),
    background: pbColorToHex(pbColors.backgroundColor.darkColor),
    card: pbColorToHex(pbColors.foregroundColor.darkColor),
    text: pbColorToHex(pbColors.bodyTextColor.darkColor),
    textSecondary: pbColorToHex(pbColors.subtitleTextColor.darkColor),
    border: pbColorToHex(pbColors.separatorColor.darkColor),
    error: '#CF6679', // Not in pbcolors, use default
    success: '#00E676', // Not in pbcolors, use default
  };

  return {
    id: `custom_${Date.now()}`,
    name,
    light: lightTheme,
    dark: darkTheme,
  };
};

// Pick and import a .pbcolors file
export const importPBColorsFile = async (): Promise<CustomTheme | null> => {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*', // Accept all files, we'll filter by extension
      copyToCacheDirectory: true,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return null;
    }

    const asset = result.assets[0];
    
    // Check file extension
    if (!asset.name.endsWith('.pbcolors')) {
      throw new Error('Please select a .pbcolors file');
    }

    // Read file content
    const file = new File(asset.uri);
    const content = await file.text();
    
    // Extract theme name from filename (remove .pbcolors extension)
    const themeName = asset.name.replace('.pbcolors', '');
    
    // Parse the file
    const theme = parsePBColorsFile(content, themeName);
    
    // Save to storage
    await saveCustomTheme(theme);
    
    return theme;
  } catch (error) {
    console.error('Error importing .pbcolors file:', error);
    throw error;
  }
};

// Save a custom theme to storage
export const saveCustomTheme = async (theme: CustomTheme): Promise<void> => {
  try {
    const themes = await getCustomThemes();
    
    // Check if theme with same name exists, replace it
    const existingIndex = themes.findIndex(t => t.name === theme.name);
    if (existingIndex >= 0) {
      themes[existingIndex] = theme;
    } else {
      themes.push(theme);
    }
    
    await AsyncStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(themes));
  } catch (error) {
    console.error('Error saving custom theme:', error);
    throw error;
  }
};

// Get all custom themes from storage
export const getCustomThemes = async (): Promise<CustomTheme[]> => {
  try {
    const stored = await AsyncStorage.getItem(CUSTOM_THEMES_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
    return [];
  } catch (error) {
    console.error('Error getting custom themes:', error);
    return [];
  }
};

// Delete a custom theme
export const deleteCustomTheme = async (themeId: string): Promise<void> => {
  try {
    const themes = await getCustomThemes();
    const filtered = themes.filter(t => t.id !== themeId);
    await AsyncStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(filtered));
    
    // If this was the active theme, clear it
    const activeThemeId = await getActiveCustomThemeId();
    if (activeThemeId === themeId) {
      await setActiveCustomThemeId(null);
    }
  } catch (error) {
    console.error('Error deleting custom theme:', error);
    throw error;
  }
};

// Get the active custom theme ID
export const getActiveCustomThemeId = async (): Promise<string | null> => {
  try {
    return await AsyncStorage.getItem(ACTIVE_CUSTOM_THEME_KEY);
  } catch (error) {
    console.error('Error getting active custom theme:', error);
    return null;
  }
};

// Set the active custom theme ID (null to use default)
export const setActiveCustomThemeId = async (themeId: string | null): Promise<void> => {
  try {
    if (themeId) {
      await AsyncStorage.setItem(ACTIVE_CUSTOM_THEME_KEY, themeId);
    } else {
      await AsyncStorage.removeItem(ACTIVE_CUSTOM_THEME_KEY);
    }
  } catch (error) {
    console.error('Error setting active custom theme:', error);
    throw error;
  }
};

// Get a specific custom theme by ID
export const getCustomThemeById = async (themeId: string): Promise<CustomTheme | null> => {
  try {
    const themes = await getCustomThemes();
    return themes.find(t => t.id === themeId) || null;
  } catch (error) {
    console.error('Error getting custom theme by ID:', error);
    return null;
  }
};
