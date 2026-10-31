import { CostField } from '../../lib/core/cost-field.js';
import { Grid } from '../../lib/graph/grid.js';
import { Sector } from '../../lib/graph/sector.js';
import { COST_IMPASSABLE } from '../constants.js';
import type { GridId, Size2s, TileDelta } from '../types.js';

/**
 * Helpers for apps that keep their map as one global cost array
 * (`costs[ne + se * width]`) and need the sector-based `Grid` from it.
 */

/**
 * Build a `Grid` with initialized portals from a global cost map.
 * `size` is in cells and must be a multiple of `sectorSize` on both axes.
 */
export function buildGrid(
  costs: Uint8Array,
  size: Size2s,
  sectorSize: number,
  gridId: GridId = 0,
): Grid {
  if (size.width % sectorSize !== 0 || size.height % sectorSize !== 0) {
    throw new Error(
      `map size ${size.width}x${size.height} is not a multiple of sector size ${sectorSize}`,
    );
  }
  if (costs.length !== size.width * size.height) {
    throw new Error(`cost map has ${costs.length} cells, expected ${size.width * size.height}`);
  }

  const sectorsX = size.width / sectorSize;
  const sectorsY = size.height / sectorSize;
  const grid = new Grid(gridId, { width: sectorsX, height: sectorsY }, sectorSize);

  let sectorId = 0;
  for (let sy = 0; sy < sectorsY; sy++) {
    for (let sx = 0; sx < sectorsX; sx++) {
      const local = new Uint8Array(sectorSize * sectorSize);
      for (let y = 0; y < sectorSize; y++) {
        const row = (sy * sectorSize + y) * size.width + sx * sectorSize;
        local.set(costs.subarray(row, row + sectorSize), y * sectorSize);
      }
      const costField = new CostField(sectorSize);
      costField.setCosts(local);
      grid.addSector(new Sector(sectorId++, { x: sx, y: sy }, costField));
    }
  }

  grid.initPortals();
  grid.initPortalNodes();
  return grid;
}

/**
 * Cells reachable from `start` over passable cells (4-connected flood fill).
 * Returns a mask with 1 for every reachable cell; all zero if `start` is
 * impassable or out of bounds.
 */
export function reachableFrom(costs: Uint8Array, size: Size2s, start: TileDelta): Uint8Array {
  const { width, height } = size;
  const seen = new Uint8Array(width * height);
  if (start.ne < 0 || start.se < 0 || start.ne >= width || start.se >= height) {
    return seen;
  }
  const startIdx = start.ne + start.se * width;
  if (costs[startIdx] === COST_IMPASSABLE) {
    return seen;
  }

  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  queue[tail++] = startIdx;
  seen[startIdx] = 1;

  while (head < tail) {
    const idx = queue[head++]!;
    const x = idx % width;
    const neighbours = [
      x > 0 ? idx - 1 : -1,
      x < width - 1 ? idx + 1 : -1,
      idx - width,
      idx + width,
    ];
    for (const n of neighbours) {
      if (n >= 0 && n < seen.length && !seen[n] && costs[n] !== COST_IMPASSABLE) {
        seen[n] = 1;
        queue[tail++] = n;
      }
    }
  }

  return seen;
}

/**
 * The cell reachable from `from` that is closest (Euclidean) to `target`;
 * `target` itself when it is reachable, `null` when nothing is. Ties go to
 * the cell closer to `from`. Scans the whole map, O(width × height).
 */
export function nearestReachable(
  costs: Uint8Array,
  size: Size2s,
  from: TileDelta,
  target: TileDelta,
): TileDelta | null {
  const reachable = reachableFrom(costs, size, from);
  const { width, height } = size;
  if (
    target.ne >= 0
    && target.se >= 0
    && target.ne < width
    && target.se < height
    && reachable[target.ne + target.se * width]
  ) {
    return { ne: target.ne, se: target.se };
  }

  let best: TileDelta | null = null;
  let bestDist = Infinity;
  let bestFromDist = Infinity;
  for (let se = 0; se < height; se++) {
    for (let ne = 0; ne < width; ne++) {
      if (!reachable[ne + se * width]) {
        continue;
      }
      const dist = (ne - target.ne) ** 2 + (se - target.se) ** 2;
      const fromDist = (ne - from.ne) ** 2 + (se - from.se) ** 2;
      if (dist < bestDist || (dist === bestDist && fromDist < bestFromDist)) {
        best = { ne, se };
        bestDist = dist;
        bestFromDist = fromDist;
      }
    }
  }
  return best;
}
