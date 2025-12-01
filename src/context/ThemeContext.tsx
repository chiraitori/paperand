import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeColors, ThemeMode } from '../types';
import { lightTheme, darkTheme } from '../constants/theme';
import { 
  CustomTheme, 
  getCustomThemes, 
  getActiveCustomThemeId, 
  setActiveCustomThemeId,
  getCustomThemeById,
  importPBColorsFile,
  deleteCustomTheme as deleteTheme,
} from '../services/themeService';

interface ThemeContextType {
  theme: ThemeColors;
  themeMode: ThemeMode;
  isDark: boolean;
  setThemeMode: (mode: ThemeMode) => void;
  customThemes: CustomTheme[];
  activeCustomThemeId: string | null;
  setActiveCustomTheme: (themeId: string | null) => void;
  importTheme: () => Promise<CustomTheme | null>;
  deleteCustomTheme: (themeId: string) => Promise<void>;
  refreshCustomThemes: () => Promise<void>;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = '@paperback_theme';

export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const systemColorScheme = useColorScheme();
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system');
  const [customThemes, setCustomThemes] = useState<CustomTheme[]>([]);
  const [activeCustomThemeId, setActiveCustomThemeIdState] = useState<string | null>(null);

  useEffect(() => {
    loadThemePreference();
    loadCustomThemes();
  }, []);

  const loadThemePreference = async () => {
    try {
      const stored = await AsyncStorage.getItem(THEME_STORAGE_KEY);
      if (stored) {
        setThemeModeState(stored as ThemeMode);
      }
    } catch (error) {
      console.error('Failed to load theme preference:', error);
    }
  };

  const loadCustomThemes = async () => {
    try {
      const themes = await getCustomThemes();
      setCustomThemes(themes);
      
      const activeId = await getActiveCustomThemeId();
      setActiveCustomThemeIdState(activeId);
    } catch (error) {
      console.error('Failed to load custom themes:', error);
    }
  };

  const refreshCustomThemes = useCallback(async () => {
    await loadCustomThemes();
  }, []);

  const setThemeMode = async (mode: ThemeMode) => {
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, mode);
      setThemeModeState(mode);
    } catch (error) {
      console.error('Failed to save theme preference:', error);
    }
  };

  const setActiveCustomTheme = async (themeId: string | null) => {
    try {
      await setActiveCustomThemeId(themeId);
      setActiveCustomThemeIdState(themeId);
    } catch (error) {
      console.error('Failed to set active custom theme:', error);
    }
  };

  const importTheme = async (): Promise<CustomTheme | null> => {
    try {
      const theme = await importPBColorsFile();
      if (theme) {
        await loadCustomThemes();
      }
      return theme;
    } catch (error) {
      console.error('Failed to import theme:', error);
      throw error;
    }
  };

  const deleteCustomThemeHandler = async (themeId: string) => {
    try {
      await deleteTheme(themeId);
      
      // If deleted theme was active, clear it
      if (activeCustomThemeId === themeId) {
        setActiveCustomThemeIdState(null);
      }
      
      await loadCustomThemes();
    } catch (error) {
      console.error('Failed to delete custom theme:', error);
      throw error;
    }
  };

  const isDark = 
    themeMode === 'dark' || 
    (themeMode === 'system' && systemColorScheme === 'dark');

  // Determine the theme to use
  let theme: ThemeColors;
  if (activeCustomThemeId) {
    const customTheme = customThemes.find(t => t.id === activeCustomThemeId);
    if (customTheme) {
      theme = isDark ? customTheme.dark : customTheme.light;
    } else {
      theme = isDark ? darkTheme : lightTheme;
    }
  } else {
    theme = isDark ? darkTheme : lightTheme;
  }

  return (
    <ThemeContext.Provider value={{ 
      theme, 
      themeMode, 
      isDark, 
      setThemeMode,
      customThemes,
      activeCustomThemeId,
      setActiveCustomTheme,
      importTheme,
      deleteCustomTheme: deleteCustomThemeHandler,
      refreshCustomThemes,
    }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
