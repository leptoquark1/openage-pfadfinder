import { describe, expect, it } from 'vitest';
import { Pathfinder } from '../src/lib/pathfinding/pathfinder.js';
import { COST_IMPASSABLE, COST_MIN } from '../src/shared/constants.js';
import { buildGrid, nearestReachable, reachableFrom } from '../src/shared/cost-map/cost-map.js';
import { PathResult } from '../src/shared/types.js';

const SIZE = { width: 8, height: 8 };

/** 8×8 map from rows of '.' (passable) and '#' (impassable). */
function parseMap(rows: string[]): Uint8Array {
  const costs = new Uint8Array(SIZE.width * SIZE.height);
  rows.forEach((row, se) => {
    for (let ne = 0; ne < row.length; ne++) {
      costs[ne + se * SIZE.width] = row[ne] === '#' ? COST_IMPASSABLE : COST_MIN;
    }
  });
  return costs;
}

// A walled-off room in the bottom right corner
const MAP = parseMap([
  '........',
  '........',
  '........',
  '........',
  '....####',
  '....#...',
  '....#...',
  '....#...',
]);

describe('buildGrid', () => {
  it('splits the global map into sector cost fields', () => {
    const grid = buildGrid(MAP, SIZE, 4);
    expect(grid.getSize()).toEqual({ width: 2, height: 2 });
    // global (5, 6) → sector (1, 1), local (1, 2)
    expect(grid.getSectorAt(5, 6)!.getCostField().getCost(1, 2)).toBe(COST_MIN);
    expect(grid.getSectorAt(4, 6)!.getCostField().getCost(0, 2)).toBe(COST_IMPASSABLE);
  });

  it('produces a grid getPath() can route across sectors', () => {
    const pf = new Pathfinder();
    pf.addGrid(buildGrid(MAP, SIZE, 4));
    const path = pf.getPath({ gridId: 0, start: { ne: 0, se: 7 }, target: { ne: 7, se: 0 } });
    expect(path.result).toBe(PathResult.FOUND);
    expect(path.waypoints.at(-1)).toEqual({ ne: 7, se: 0 });
  });

  it('rejects sizes that are not a multiple of the sector size', () => {
    expect(() => buildGrid(new Uint8Array(30), { width: 6, height: 5 }, 4)).toThrow(/multiple/);
  });
});

describe('reachableFrom', () => {
  it('does not leak into walled-off areas', () => {
    const mask = reachableFrom(MAP, SIZE, { ne: 0, se: 0 });
    expect(mask[0]).toBe(1);
    expect(mask[6 + 6 * 8]).toBe(0);
    expect(mask.reduce((a, b) => a + b, 0)).toBe(64 - 7 - 9);
  });

  it('is empty for impassable or out-of-bounds starts', () => {
    expect(reachableFrom(MAP, SIZE, { ne: 4, se: 4 }).some(Boolean)).toBe(false);
    expect(reachableFrom(MAP, SIZE, { ne: -1, se: 0 }).some(Boolean)).toBe(false);
  });
});

describe('nearestReachable', () => {
  it('returns the target itself when reachable', () => {
    expect(nearestReachable(MAP, SIZE, { ne: 0, se: 0 }, { ne: 3, se: 3 })).toEqual({
      ne: 3,
      se: 3,
    });
  });

  it('stops in front of a wall when the target is walled off', () => {
    expect(nearestReachable(MAP, SIZE, { ne: 0, se: 0 }, { ne: 6, se: 7 })).toEqual({
      ne: 3,
      se: 7,
    });
  });

  it('returns null when nothing is reachable', () => {
    expect(nearestReachable(MAP, SIZE, { ne: 4, se: 4 }, { ne: 0, se: 0 })).toBeNull();
  });
});
