import { useWindowDimensions } from 'react-native';
import {
  ReadableColumnWidth,
  ScreenGutter,
  GridGap,
  CoverTargetWidth,
  coverColumns,
  coverWidth,
} from '../theme/metrics';

export interface ResponsiveLayout {
  width: number;
  height: number;
  isLandscape: boolean;
  /** Window is wide enough for the tablet/foldable treatment (>= 600 dp). */
  isWide: boolean;
  /**
   * Width the screen actually paints into. The navigators cap every scene at
   * [ReadableColumnWidth] and centre it, so on a tablet or an unfolded foldable
   * this is 700 dp while [width] is the raw window.
   */
  contentWidth: number;
  /** Side gutter a screen applies to its rows (always the phone 16 dp). */
  pad: number;
  /** Cover-grid columns at the current content width. */
  columns: number;
  /** Width of one cover in that grid. */
  cardWidth: number;
  gutter: number;
  gap: number;
}

/**
 * Window metrics for the phone-first layout.
 *
 * Both navigators wrap a scene in a centred column (`contentStyle` /
 * `sceneStyle`), so a wide window never stretches a row, a form field or a
 * cover: it only changes how many covers fit. Phone portrait (the reference
 * device, 385 dp) resolves to 16 dp gutters, 3 columns and ~110 dp covers -
 * exactly the pixels the app painted before this pass.
 */
export function useResponsive(): ResponsiveLayout {
  const { width, height } = useWindowDimensions();
  const contentWidth = Math.min(width, ReadableColumnWidth);
  const columns = coverColumns(contentWidth);
  return {
    width,
    height,
    isLandscape: width > height,
    isWide: width >= 600,
    contentWidth,
    pad: ScreenGutter,
    columns,
    cardWidth: coverWidth(contentWidth, columns),
    gutter: ScreenGutter,
    gap: GridGap,
  };
}

/** Column used by the navigators to centre a scene on a wide window. */
export const readableColumnStyle = {
  width: '100%' as const,
  maxWidth: ReadableColumnWidth,
  alignSelf: 'center' as const,
};

export { CoverTargetWidth };
