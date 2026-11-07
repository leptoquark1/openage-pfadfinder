import { describe, expect, it } from 'vitest';
import { Pathfinder } from '../src/lib/pathfinding/pathfinder.js';
import { COST_IMPASSABLE, COST_MIN } from '../src/shared/constants.js';
import { buildGrid } from '../src/shared/cost-map/cost-map.js';
import { PathResult, type Waypoint } from '../src/shared/types.js';

const SECTOR = 8;
const SIZE = SECTOR * 2;

function setup() {
  const grid = buildGrid(
    new Uint8Array(SIZE * SIZE).fill(COST_MIN),
    { width: SIZE, height: SIZE },
    SECTOR,
    0,
  );
  const pf = new Pathfinder();
  pf.addGrid(grid);
  return { grid, pf };
}

/** Whether the polyline through the waypoint cell centers touches cell (ne, se). */
function crosses(waypoints: readonly Waypoint[], ne: number, se: number): boolean {
  for (let i = 1; i < waypoints.length; i++) {
    const a = waypoints[i - 1]!;
    const b = waypoints[i]!;
    const steps = Math.ceil(Math.hypot(b.ne - a.ne, b.se - a.se) * 20);
    for (let k = 0; k <= steps; k++) {
      const t = steps === 0 ? 0 : k / steps;
      if (
        Math.floor(a.ne + 0.5 + (b.ne - a.ne) * t) === ne
        && Math.floor(a.se + 0.5 + (b.se - a.se) * t) === se
      ) {
        return true;
      }
    }
  }
  return false;
}

describe('Grid.updateCosts', () => {
  it('routes around a cell blocked after the grid was built', () => {
    const { grid, pf } = setup();
    const request = { gridId: 0, start: { ne: 2, se: 4 }, target: { ne: 13, se: 4 } };
    expect(crosses(pf.getPath(request).waypoints, 8, 4)).toBe(true);

    // a "unit" stops right on the straight line across the sector border
    grid.updateCosts([{ ne: 8, se: 4, cost: COST_IMPASSABLE }]);
    const path = pf.getPath(request);
    expect(path.result).toBe(PathResult.FOUND);
    expect(crosses(path.waypoints, 8, 4)).toBe(false);
  });

  it('cuts and restores the connection through a sector border', () => {
    const { grid, pf } = setup();
    const request = { gridId: 0, start: { ne: 2, se: 4 }, target: { ne: 13, se: 4 } };
    const wall = Array.from({ length: SIZE }, (_, se) => ({ ne: 8, se, cost: COST_IMPASSABLE }));

    const changed = grid.updateCosts(wall);
    expect(changed.size).toBeGreaterThan(0);
    expect(pf.getPath(request).result).toBe(PathResult.NOT_FOUND);

    grid.updateCosts(wall.map(c => ({ ...c, cost: COST_MIN })));
    expect(pf.getPath(request).result).toBe(PathResult.FOUND);
  });

  it('ignores unchanged and out-of-grid cells', () => {
    const { grid } = setup();
    expect(
      grid.updateCosts([
        { ne: 3, se: 3, cost: COST_MIN },
        { ne: -1, se: 2, cost: COST_IMPASSABLE },
        { ne: SIZE, se: 0, cost: COST_IMPASSABLE },
      ]).size,
    ).toBe(0);
  });
});
