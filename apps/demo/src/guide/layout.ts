import { SECTOR_SIZE } from './scenarios.js';
import type { Box, GuideStep } from './timeline.js';

/** Canvas space the map keeps free for floating interface elements. */
export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface View {
  readonly s: number;
  readonly ox: number;
  readonly oy: number;
}

export interface GuideLayout {
  readonly insets: Insets;
  readonly card: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly maxHeight: number;
  };
}

const CARD_WIDTH = 360;
const SHEET_MAX_WIDTH = 480;
const MARGIN = 16;
/** Below the chapter menu. */
const TOP = 64;
/** Above the step controls. */
const BOTTOM = 84;
/** Narrower screens have no room beside the map, so the card sits below it. */
const SIDE_BY_SIDE_FROM = 900;
const SHEET_SHARE = 0.42;

/** Fits the camera box into the canvas area the insets leave free. */
export function makeView(width: number, height: number, camera: Box, insets: Insets): View {
  const freeWidth = Math.max(1, width - insets.left - insets.right);
  const freeHeight = Math.max(1, height - insets.top - insets.bottom);
  const s = Math.min(freeWidth / camera.w, freeHeight / camera.h);
  return {
    s,
    ox: insets.left + (freeWidth - camera.w * s) / 2 - camera.x * s,
    oy: insets.top + (freeHeight - camera.h * s) / 2 - camera.y * s,
  };
}

/**
 * Places the explanation next to what it explains. The map moves aside for
 * it, and the card follows the focus by sector row, so it stays calm to read
 * while the focus moves within a row.
 */
export function layoutGuide(
  width: number,
  height: number,
  side: GuideStep['side'],
  focus: Box,
  camera: Box,
  cardHeight: number,
): GuideLayout {
  if (width < SIDE_BY_SIDE_FROM) {
    const maxHeight = Math.round(height * SHEET_SHARE);
    const cardWidth = Math.min(width - MARGIN * 2, SHEET_MAX_WIDTH);
    return {
      insets: { top: TOP, right: 0, bottom: BOTTOM + maxHeight, left: 0 },
      card: {
        x: (width - cardWidth) / 2,
        y: height - BOTTOM - Math.min(cardHeight, maxHeight),
        width: cardWidth,
        maxHeight,
      },
    };
  }

  const reserved = CARD_WIDTH + MARGIN * 2;
  const insets: Insets = {
    top: TOP,
    right: side === 'right' ? reserved : 0,
    bottom: BOTTOM,
    left: side === 'left' ? reserved : 0,
  };
  const view = makeView(width, height, camera, insets);
  const x =
    side === 'left'
      ? Math.max(MARGIN, view.ox + camera.x * view.s - CARD_WIDTH - MARGIN)
      : Math.min(width - CARD_WIDTH - MARGIN, view.ox + (camera.x + camera.w) * view.s + MARGIN);

  const maxHeight = height - TOP - BOTTOM;
  const shown = Math.min(cardHeight, maxHeight);
  const row = (Math.floor((focus.y + focus.h / 2) / SECTOR_SIZE) + 0.5) * SECTOR_SIZE;
  const y = Math.max(TOP, Math.min(height - BOTTOM - shown, view.oy + row * view.s - shown / 2));

  return { insets, card: { x, y, width: CARD_WIDTH, maxHeight } };
}
