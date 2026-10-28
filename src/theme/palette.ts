import { ThemeColors } from '../types';

/**
 * Semantic colours of the PaperBack iOS 0.8.11 interface.
 *
 * The React Native port inlined dark literals at every call site (`#1C1C1E`
 * cards, `#FFF` labels, `#2C2C2E` separators), so light mode ended up with
 * black slabs on a white page and every new screen had to guess a colour.
 * This is the same role list the Kotlin port uses (see
 * `ui/theme/AppColors.kt`), with the dark values sampled from the shipped iOS
 * build and the light values taken from the matching iOS system colours
 * (`systemGroupedBackground`, `separator`, `secondaryLabel`, ...).
 *
 * Read them through `usePalette()` - never inline a hex literal in a screen.
 */
export interface Palette {
  /** Window / grouped-table background. */
  window: string;
  /** Grouped cell fill. */
  card: string;
  /** Secondary cell fill used by a few lists. */
  cardAlt: string;
  /** Inset text-field fill. */
  field: string;
  /** Sheets and menus that are not alerts. */
  sheet: string;
  /** Alert dialog surface. */
  dialog: string;
  /** Bottom tab bar and other navigation chrome. */
  navBar: string;
  /** Empty-state artwork plate. */
  plate: string;
  /** 0.5 pt inset separators. */
  separator: string;
  /** Stronger hairlines and field borders. */
  hairline: string;
  /** Segmented-control / stepper track. */
  control: string;
  /** Selected segment thumb. */
  controlSelected: string;
  /** Off switch track. */
  switchOff: string;
  /** Primary text and icons drawn on the window or a card. */
  label: string;
  /** Subtitles, values, section headers, chevrons. */
  secondaryLabel: string;
  /** Soft body text on a card. */
  tertiaryLabel: string;
  /** Muted secondary text. */
  quietLabel: string;
  /** Long-form body copy. */
  bodyLabel: string;
  /** Bright muted glyphs. */
  iconStrong: string;
  /** Disabled control content. */
  disabled: string;
  /** Destructive actions. */
  destructive: string;
  /** Unselected bottom-tab item. */
  navInactive: string;
  /** Accent used by the selected tab, buttons and links. */
  accent: string;
  /** Reader chrome: header pill, info/footer buttons, page pill. */
  readerChrome: string;
  /** Content drawn on the reader chrome. */
  readerChromeLabel: string;
  /** Reader settings sheet surface. */
  readerSheet: string;
  /** Menus opened from the reader settings sheet. */
  readerMenu: string;
  /** Hairlines inside the reader settings sheet. */
  readerSeparator: string;
}

/** Dark palette: true black window, `#171717` grouped cells, coral accent. */
export const darkPalette: Palette = {
  window: '#000000',
  card: '#171717',
  cardAlt: '#1C1C1E',
  field: '#0F0F0F',
  sheet: '#0B0B0B',
  dialog: '#2C2C2E',
  navBar: '#000000',
  plate: '#3A3A3C',
  separator: '#38383A',
  hairline: '#48484A',
  control: '#2C2C2E',
  controlSelected: '#636366',
  switchOff: '#39393D',
  label: '#FFFFFF',
  secondaryLabel: '#8E8E93',
  tertiaryLabel: '#D1D1D6',
  quietLabel: '#AEAEB2',
  bodyLabel: '#E5E5EA',
  iconStrong: '#EBEBEB',
  disabled: '#636366',
  destructive: '#FF453A',
  navInactive: '#8E8E93',
  accent: '#FD6A68',
  readerChrome: '#000000',
  readerChromeLabel: '#FFFFFF',
  readerSheet: '#000000',
  readerMenu: '#2C2C2E',
  readerSeparator: '#38383A',
};

/** Light palette: iOS grouped style - `#F2F2F7` window, white cards. */
export const lightPalette: Palette = {
  window: '#F2F2F7',
  card: '#FFFFFF',
  cardAlt: '#FFFFFF',
  field: '#FFFFFF',
  sheet: '#F2F2F7',
  dialog: '#FFFFFF',
  navBar: '#FFFFFF',
  plate: '#E5E5EA',
  separator: '#C6C6C8',
  hairline: '#C6C6C8',
  control: '#E9E9EB',
  controlSelected: '#FFFFFF',
  switchOff: '#E9E9EB',
  label: '#000000',
  secondaryLabel: '#8E8E93',
  tertiaryLabel: '#3C3C43',
  quietLabel: '#6C6C70',
  bodyLabel: '#3C3C43',
  iconStrong: '#3C3C43',
  disabled: '#C7C7CC',
  destructive: '#FF3B30',
  navInactive: '#8E8E93',
  accent: '#FD6A68',
  readerChrome: '#FFFFFF',
  readerChromeLabel: '#000000',
  readerSheet: '#F2F2F7',
  readerMenu: '#FFFFFF',
  readerSeparator: '#C6C6C8',
};

/**
 * Palette for a custom theme imported from a Paperback `.pbcolors` file.
 *
 * Only the nine legacy roles exist in those files, so the semantic extras are
 * derived from them: cards keep the custom fill, the window falls back to the
 * custom background and text roles follow the custom label colour.
 */
export function paletteFromCustomTheme(colors: ThemeColors, isDark: boolean): Palette {
  const base = isDark ? darkPalette : lightPalette;
  return {
    ...base,
    window: colors.background || base.window,
    card: colors.card || base.card,
    cardAlt: colors.card || base.cardAlt,
    field: colors.card || base.field,
    label: colors.text || base.label,
    secondaryLabel: colors.textSecondary || base.secondaryLabel,
    tertiaryLabel: colors.text || base.tertiaryLabel,
    quietLabel: colors.textSecondary || base.quietLabel,
    bodyLabel: colors.text || base.bodyLabel,
    iconStrong: colors.text || base.iconStrong,
    separator: colors.border || base.separator,
    hairline: colors.border || base.hairline,
    accent: colors.accent || colors.primary || base.accent,
  } as Palette;
}

export function paletteFor(isDark: boolean): Palette {
  return isDark ? darkPalette : lightPalette;
}
