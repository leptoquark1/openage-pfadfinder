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

  it('still finds a route after border portals were split and shrunk', () => {
    const sectors = 3;
    const cells = SECTOR * sectors;
    const costs = new Uint8Array(cells * cells).fill(COST_MIN);
    const grid = buildGrid(costs.slice(), { width: cells, height: cells }, SECTOR, 0);
    const pf = new Pathfinder();
    pf.addGrid(grid);
    const block = (...cells2: [number, number][]) => {
      const changes = cells2.map(([ne, se]) => ({ ne, se, cost: COST_IMPASSABLE }));
      for (const { ne, se } of changes) {
        costs[ne + se * cells] = COST_IMPASSABLE;
      }
      grid.updateCosts(changes);
    };
    const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

    // Only the top sector row stays connected: wall along its lower border.
    block(...range(0, cells - 1).map(ne => [ne, SECTOR] as [number, number]));
    // Border ne=7|8: split into se 0..4 and 6..7, then shrink the lower run
    // to se 7, so a surviving portal precedes a new one.
    block([7, 5]);
    block([7, 6]);
    // Border ne=15|16: split, which hands out fresh ids.
    block([15, 3]);
    // Leave a single way through each border: se 7 and se 0..2.
    block(...range(0, 4).map(se => [7, se] as [number, number]));
    block(...range(4, 7).map(se => [15, se] as [number, number]));

    const fresh = new Pathfinder();
    fresh.addGrid(buildGrid(costs, { width: cells, height: cells }, SECTOR, 0));
    for (const [start, target] of [
      [{ ne: 1, se: 1 }, { ne: 20, se: 1 }],
      [{ ne: 20, se: 6 }, { ne: 2, se: 3 }],
    ] as const) {
      const request = { gridId: 0, start, target };
      expect(fresh.getFlowRoute(request)).not.toBeNull();
      expect(pf.getFlowRoute(request)).not.toBeNull();
    }
  });

  it('matches a freshly built grid after hundreds of random updates', () => {
    const sectors = 4;
    const cells = SECTOR * sectors;
    let state = 4242;
    const rand = () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };
    const pick = (n: number) => Math.floor(rand() * n);

    const costs = new Uint8Array(cells * cells).fill(COST_MIN);
    const grid = buildGrid(costs.slice(), { width: cells, height: cells }, SECTOR, 0);
    const pf = new Pathfinder();
    pf.addGrid(grid);

    for (let step = 0; step < 300; step++) {
      // a short wall piece on a random sector border
      const vertical = rand() < 0.5;
      const border = (1 + pick(sectors - 1)) * SECTOR - pick(2);
      const from = pick(cells);
      const length = 1 + pick(3);
      const cost = rand() < 0.55 ? COST_IMPASSABLE : COST_MIN;
      const changes: { ne: number, se: number, cost: number }[] = [];
      for (let i = 0; i < length && from + i < cells; i++) {
        const [ne, se] = vertical ? [border, from + i] : [from + i, border];
        costs[ne + se * cells] = cost;
        changes.push({ ne, se, cost });
      }
      grid.updateCosts(changes);

      const ids = grid.getSectors().flatMap(s => s.getPortals()).map(p => p.getId());
      const portals = new Set(grid.getSectors().flatMap(s => s.getPortals()));
      expect(new Set(ids).size, `step ${step}`).toBe(portals.size);
      expect(grid.getPortalMap().size, `step ${step}`).toBe(portals.size);

      const fresh = new Pathfinder();
      fresh.addGrid(buildGrid(costs, { width: cells, height: cells }, SECTOR, 0));
      for (let k = 0; k < 4; k++) {
        const request = {
          gridId: 0,
          start: { ne: pick(cells), se: pick(cells) },
          target: { ne: pick(cells), se: pick(cells) },
        };
        expect(pf.getFlowRoute(request) !== null, `step ${step} ${JSON.stringify(request)}`)
          .toBe(fresh.getFlowRoute(request) !== null);
      }
    }
  });
});
