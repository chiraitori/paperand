/**
 * Layout constants shared by every screen.
 *
 * They mirror the Kotlin port (`ui/common/WideLayout.kt`), which keeps a phone
 * layout intact at any window size: rows and text stop growing at
 * [ReadableColumnWidth] dp and get centred, and covers keep a phone-sized
 * width instead of stretching with the window.
 */

/** Widest a column of rows, text or form fields may grow. */
export const ReadableColumnWidth = 700;

/** Side margin every screen uses for headers and grid gutters. */
export const ScreenGutter = 16;

/** Width a cover aims for; grids grow by adding columns, never by widening. */
export const CoverTargetWidth = 112;

/** Gap between covers / cards in a grid. */
export const GridGap = 12;

/** Side gutter that centres a column at [maxWidth] for the given width. */
export function insetFor(width: number, maxWidth: number = ReadableColumnWidth): number {
  return Math.max(0, Math.round((width - maxWidth) / 2));
}

/**
 * Column count for a cover grid: as many [CoverTargetWidth] columns as fit the
 * full window, never fewer than the three the phone layout uses.
 */
export function coverColumns(
  width: number,
  gutter: number = ScreenGutter,
  gap: number = GridGap,
): number {
  const usable = Math.max(0, width - gutter * 2);
  const columns = Math.round((usable + gap) / (CoverTargetWidth + gap));
  return Math.max(3, columns);
}

/** Cover width for [columns] columns across [width] (gutter and gaps removed). */
export function coverWidth(
  width: number,
  columns: number,
  gutter: number = ScreenGutter,
  gap: number = GridGap,
): number {
  const usable = Math.max(0, width - gutter * 2 - gap * (columns - 1));
  return Math.floor(usable / columns);
}
