import { ThemeColors } from '../types';

/**
 * Legacy theme roles, kept for the screens that still read `theme.*` directly.
 * The values now follow the PaperBack iOS 0.8.11 palette (`src/theme/palette.ts`)
 * so a screen that has not been migrated yet still uses the same coral accent
 * and the same grouped-background/separator greys as the rest of the app.
 */
export const lightTheme: ThemeColors = {
  primary: '#FD6A68',
  background: '#F2F2F7',
  card: '#FFFFFF',
  text: '#000000',
  textSecondary: '#8E8E93',
  border: '#C6C6C8',
  accent: '#FD6A68',
  error: '#FF3B30',
  success: '#34C759',
};

export const darkTheme: ThemeColors = {
  primary: '#FD6A68',
  background: '#000000',
  card: '#171717',
  text: '#FFFFFF',
  textSecondary: '#8E8E93',
  border: '#38383A',
  accent: '#FD6A68',
  error: '#FF453A',
  success: '#34C759',
};
