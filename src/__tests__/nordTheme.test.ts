import { parsePBColorsFile } from '../services/themeService';
import { ThemeColors, CustomTheme } from '../types';
import * as fs from 'fs';
import * as path from 'path';

// Nord theme test data
const nordThemeContent = `{
 "accentColor": {
  "lightColor": {
   "red": 0.3686274509803922,
   "green": 0.5058823529411764,
   "blue": 0.6745098039215687,
   "alpha": 1
  },
  "darkColor": {
   "red": 0.3686274509803922,
   "green": 0.5058823529411764,
   "blue": 0.6745098039215687,
   "alpha": 1
  }
 },
 "accentTextColor": {
  "lightColor": {
   "red": 0.8980392156862745,
   "green": 0.9137254901960784,
   "blue": 0.9411764705882353,
   "alpha": 1
  },
  "darkColor": {
   "red": 0.1803921568627451,
   "green": 0.20392156862745098,
   "blue": 0.25098039215686274,
   "alpha": 1
  }
 },
 "foregroundColor": {
  "lightColor": {
   "red": 0.9254901960784314,
   "green": 0.9372549019607843,
   "blue": 0.9568627450980393,
   "alpha": 1
  },
  "darkColor": {
   "red": 0.23137254901960785,
   "green": 0.25882352941176473,
   "blue": 0.3215686274509804,
   "alpha": 1
  }
 },
 "backgroundColor": {
  "lightColor": {
   "red": 0.8980392156862745,
   "green": 0.9137254901960784,
   "blue": 0.9411764705882353,
   "alpha": 1
  },
  "darkColor": {
   "red": 0.1803921568627451,
   "green": 0.20392156862745098,
   "blue": 0.25098039215686274,
   "alpha": 1
  }
 },
 "overlayColor": {
  "lightColor": {
   "red": 0.8980392156862745,
   "green": 0.9137254901960784,
   "blue": 0.9411764705882353,
   "alpha": 0.3
  },
  "darkColor": {
   "red": 0.1803921568627451,
   "green": 0.20392156862745098,
   "blue": 0.25098039215686274,
   "alpha": 0.3
  }
 },
 "separatorColor": {
  "lightColor": {
   "red": 0.3686274509803922,
   "green": 0.5058823529411764,
   "blue": 0.6745098039215687,
   "alpha": 1
  },
  "darkColor": {
   "red": 0.3686274509803922,
   "green": 0.5058823529411764,
   "blue": 0.6745098039215687,
   "alpha": 1
  }
 },
 "bodyTextColor": {
  "lightColor": {
   "red": 0.1803921568627451,
   "green": 0.20392156862745098,
   "blue": 0.25098039215686274,
   "alpha": 1
  },
  "darkColor": {
   "red": 0.9254901960784314,
   "green": 0.9372549019607843,
   "blue": 0.9568627450980393,
   "alpha": 1
  }
 },
 "subtitleTextColor": {
  "lightColor": {
   "red": 0.5019607843137255,
   "green": 0.5450980392156862,
   "blue": 0.6,
   "alpha": 1
  },
  "darkColor": {
   "red": 0.6431372549019608,
   "green": 0.6666666666666666,
   "blue": 0.7137254901960784,
   "alpha": 1
  }
 }
}`;

describe('Nord Theme (.pbcolors)', () => {
  describe('Theme Parsing', () => {
    it('should parse Nord.pbcolors file correctly', () => {
      const theme = parsePBColorsFile(nordThemeContent, 'Nord');
      
      expect(theme).toBeDefined();
      expect(theme.name).toBe('Nord');
      expect(theme.id).toBeDefined();
      expect(theme.light).toBeDefined();
      expect(theme.dark).toBeDefined();
    });

    it('should have valid light theme colors', () => {
      const theme = parsePBColorsFile(nordThemeContent, 'Nord');
      const light = theme.light;

      expect(light.primary).toBeDefined();
      expect(light.accent).toBeDefined();
      expect(light.background).toBeDefined();
      expect(light.card).toBeDefined();
      expect(light.text).toBeDefined();
      expect(light.textSecondary).toBeDefined();
      expect(light.border).toBeDefined();
      expect(light.error).toBeDefined();
      expect(light.success).toBeDefined();
    });

    it('should have valid dark theme colors', () => {
      const theme = parsePBColorsFile(nordThemeContent, 'Nord');
      const dark = theme.dark;

      expect(dark.primary).toBeDefined();
      expect(dark.accent).toBeDefined();
      expect(dark.background).toBeDefined();
      expect(dark.card).toBeDefined();
      expect(dark.text).toBeDefined();
      expect(dark.textSecondary).toBeDefined();
      expect(dark.border).toBeDefined();
      expect(dark.error).toBeDefined();
      expect(dark.success).toBeDefined();
    });
  });

  describe('Color Conversion', () => {
    it('should convert colors to valid hex format', () => {
      const theme = parsePBColorsFile(nordThemeContent, 'Nord');
      const hexColorRegex = /^#[0-9A-F]{6}$/;

      expect(theme.light.primary).toMatch(hexColorRegex);
      expect(theme.light.accent).toMatch(hexColorRegex);
      expect(theme.light.background).toMatch(hexColorRegex);
      expect(theme.dark.primary).toMatch(hexColorRegex);
      expect(theme.dark.text).toMatch(hexColorRegex);
    });

    it('should have correct light theme accent color (Nord Blue)', () => {
      const theme = parsePBColorsFile(nordThemeContent, 'Nord');
      // Nord Blue: rgb(88, 129, 172) -> #5881AC
      expect(theme.light.primary).toBe('#5881AC');
      expect(theme.light.accent).toBe('#5881AC');
    });

    it('should have correct light theme background color', () => {
      const theme = parsePBColorsFile(nordThemeContent, 'Nord');
      // Light background: rgb(229, 233, 240) -> #E5E9F0
      expect(theme.light.background).toBe('#E5E9F0');
    });

    it('should have correct dark theme background color', () => {
      const theme = parsePBColorsFile(nordThemeContent, 'Nord');
      // Dark background: rgb(46, 52, 64) -> #2E3440
      expect(theme.dark.background).toBe('#2E3440');
    });
  });

  describe('Theme Consistency', () => {
    it('should have matching accent colors for light and dark', () => {
      const theme = parsePBColorsFile(nordThemeContent, 'Nord');
      // Nord uses same accent color for both themes
      expect(theme.light.accent).toBe(theme.dark.accent);
      expect(theme.light.primary).toBe(theme.dark.primary);
    });

    it('should have contrasting text colors between light and dark', () => {
      const theme = parsePBColorsFile(nordThemeContent, 'Nord');
      // Light text should differ from dark text
      expect(theme.light.text).not.toBe(theme.dark.text);
    });

    it('should have matching border colors for light and dark', () => {
      const theme = parsePBColorsFile(nordThemeContent, 'Nord');
      // Nord uses same separator/border for both themes
      expect(theme.light.border).toBe(theme.dark.border);
    });

    it('should have default error and success colors when not in pbcolors', () => {
      const theme = parsePBColorsFile(nordThemeContent, 'Nord');
      
      expect(theme.light.error).toBe('#B00020');
      expect(theme.light.success).toBe('#00C853');
      expect(theme.dark.error).toBe('#CF6679');
      expect(theme.dark.success).toBe('#00E676');
    });
  });

  describe('Theme Properties', () => {
    it('should have unique theme ID', () => {
      const theme1 = parsePBColorsFile(nordThemeContent, 'Nord');
      const theme2 = parsePBColorsFile(nordThemeContent, 'Nord');
      
      // Different instances should have different IDs (based on timestamp)
      expect(theme1.id).not.toBe(theme2.id);
    });

    it('should preserve theme name', () => {
      const theme = parsePBColorsFile(nordThemeContent, 'Nord');
      expect(theme.name).toBe('Nord');
    });

    it('should handle custom theme names', () => {
      const theme = parsePBColorsFile(nordThemeContent, 'My Custom Nord');
      expect(theme.name).toBe('My Custom Nord');
    });
  });

  describe('Color Range Validation', () => {
    it('should produce RGB values in valid range', () => {
      const theme = parsePBColorsFile(nordThemeContent, 'Nord');
      const hexToRgb = (hex: string) => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? [
          parseInt(result[1], 16),
          parseInt(result[2], 16),
          parseInt(result[3], 16),
        ] : null;
      };

      const validateColor = (hex: string) => {
        const rgb = hexToRgb(hex);
        if (!rgb) return false;
        return rgb.every(val => val >= 0 && val <= 255);
      };

      expect(validateColor(theme.light.primary)).toBe(true);
      expect(validateColor(theme.light.background)).toBe(true);
      expect(validateColor(theme.dark.text)).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing optional colors gracefully', () => {
      const incompleteTheme = `{
        "accentColor": { "lightColor": { "red": 0.5, "green": 0.5, "blue": 0.5, "alpha": 1 }, "darkColor": { "red": 0.5, "green": 0.5, "blue": 0.5, "alpha": 1 } },
        "backgroundColor": { "lightColor": { "red": 0.9, "green": 0.9, "blue": 0.9, "alpha": 1 }, "darkColor": { "red": 0.1, "green": 0.1, "blue": 0.1, "alpha": 1 } },
        "bodyTextColor": { "lightColor": { "red": 0.2, "green": 0.2, "blue": 0.2, "alpha": 1 }, "darkColor": { "red": 0.8, "green": 0.8, "blue": 0.8, "alpha": 1 } },
        "foregroundColor": { "lightColor": { "red": 0.85, "green": 0.85, "blue": 0.85, "alpha": 1 }, "darkColor": { "red": 0.25, "green": 0.25, "blue": 0.25, "alpha": 1 } },
        "separatorColor": { "lightColor": { "red": 0.5, "green": 0.5, "blue": 0.5, "alpha": 1 }, "darkColor": { "red": 0.5, "green": 0.5, "blue": 0.5, "alpha": 1 } },
        "accentTextColor": { "lightColor": { "red": 0.9, "green": 0.9, "blue": 0.9, "alpha": 1 }, "darkColor": { "red": 0.2, "green": 0.2, "blue": 0.2, "alpha": 1 } },
        "subtitleTextColor": { "lightColor": { "red": 0.6, "green": 0.6, "blue": 0.6, "alpha": 1 }, "darkColor": { "red": 0.6, "green": 0.6, "blue": 0.6, "alpha": 1 } },
        "overlayColor": { "lightColor": { "red": 0.9, "green": 0.9, "blue": 0.9, "alpha": 0.3 }, "darkColor": { "red": 0.1, "green": 0.1, "blue": 0.1, "alpha": 0.3 } }
      }`;

      const theme = parsePBColorsFile(incompleteTheme, 'Test');
      expect(theme).toBeDefined();
      expect(theme.light.error).toBe('#B00020'); // Default error color
      expect(theme.light.success).toBe('#00C853'); // Default success color
    });

    it('should handle invalid JSON gracefully', () => {
      const invalidJson = '{ invalid json }';
      
      expect(() => {
        parsePBColorsFile(invalidJson, 'Invalid');
      }).toThrow();
    });
  });

  describe('Accessibility', () => {
    it('should have sufficient contrast between text and background in light theme', () => {
      const theme = parsePBColorsFile(nordThemeContent, 'Nord');
      
      // Light text on light background should have some difference
      expect(theme.light.text).not.toBe(theme.light.background);
      expect(theme.light.text).not.toBe(theme.light.card);
    });

    it('should have sufficient contrast between text and background in dark theme', () => {
      const theme = parsePBColorsFile(nordThemeContent, 'Nord');
      
      // Dark text on dark background should have some difference
      expect(theme.dark.text).not.toBe(theme.dark.background);
      expect(theme.dark.text).not.toBe(theme.dark.card);
    });

    it('should have distinct secondary text color', () => {
      const theme = parsePBColorsFile(nordThemeContent, 'Nord');
      
      expect(theme.light.textSecondary).toBeDefined();
      expect(theme.dark.textSecondary).toBeDefined();
      expect(theme.light.textSecondary).not.toBe(theme.light.text);
      expect(theme.dark.textSecondary).not.toBe(theme.dark.text);
    });
  });
});
