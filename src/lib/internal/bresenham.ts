import type { TileDelta } from '../../shared/types.js';

/**
 * Modified Bresenham's line algorithm.
 * Traces cells from a corner point to the field edge,
 * away from the target. Used for LOS shadowcasting
 * to mark cells blocked by obstacle corners.
 *
 * Port of openage's IntegrationField::bresenhams_line().
 */
export function bresenhamLine(
  target: TileDelta,
  cornerX: number,
  cornerY: number,
  size: number,
): number[] {
  const cells: number[] = [];

  let cellX = cornerX;
  let cellY = cornerY;

  const boundary = size;

  // Target center (offset by 0.5 for cell center)
  const tx = target.ne + 0.5;
  const ty = target.se + 0.5;

  const dx = Math.abs(tx - cornerX);
  const dy = Math.abs(ty - cornerY);
  const m = dy / dx;

  let error = m;

  if (cornerX < tx) {
    if (cornerY < ty) {
      // left and up
      cellY -= 1;
      cellX -= 1;
      while (cellX >= 0 && cellY >= 0) {
        cells.push(cellX + cellY * size);
        if (error > 1.0) {
          cellY -= 1;
          error -= 1.0;
        }
        else {
          cellX -= 1;
          error += m;
        }
      }
    }
    else {
      // left and down
      cellX -= 1;
      while (cellX >= 0 && cellY < boundary) {
        cells.push(cellX + cellY * size);
        if (error > 1.0) {
          cellY += 1;
          error -= 1.0;
        }
        else {
          cellX -= 1;
          error += m;
        }
      }
    }
  }
  else {
    if (cornerY < ty) {
      // right and up
      cellY -= 1;
      while (cellX < boundary && cellY >= 0) {
        cells.push(cellX + cellY * size);
        if (error > 1.0) {
          cellY -= 1;
          error -= 1.0;
        }
        else {
          cellX += 1;
          error += m;
        }
      }
    }
    else {
      // right and down
      while (cellX < boundary && cellY < boundary) {
        cells.push(cellX + cellY * size);
        if (error > 1.0) {
          cellY += 1;
          error -= 1.0;
        }
        else {
          cellX += 1;
          error += m;
        }
      }
    }
  }

  return cells;
}
