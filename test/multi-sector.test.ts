import { describe, expect, it } from 'vitest';
import { CostField } from '../src/lib/core/cost-field.js';
import { Grid } from '../src/lib/graph/grid.js';
import { Sector } from '../src/lib/graph/sector.js';
import { Pathfinder } from '../src/lib/pathfinding/pathfinder.js';
import { COST_IMPASSABLE, COST_MIN } from '../src/shared/constants.js';
import { PathResult } from '../src/shared/types.js';

describe('Multi-sector pathfinding', () => {
  function makeGrid(sectorSize: number, gridW: number, gridH: number): Grid {
    const grid = new Grid(0, { width: gridW, height: gridH }, sectorSize);
    let sid = 0;
    for (let sy = 0; sy < gridH; sy++) {
      for (let sx = 0; sx < gridW; sx++) {
        const cf = new CostField(sectorSize);
        cf.setCosts(new Uint8Array(sectorSize * sectorSize).fill(COST_MIN));
        grid.addSector(new Sector(sid++, { x: sx, y: sy }, cf));
      }
    }
    grid.initPortals();
    grid.initPortalNodes();
    return grid;
  }

  it('finds path across 2 horizontal sectors', () => {
    const grid = makeGrid(5, 2, 1);
    const pf = new Pathfinder();
    pf.addGrid(grid);

    const path = pf.getPath({
      gridId: 0,
      start: { ne: 0, se: 0 },
      target: { ne: 7, se: 3 },
    });

    console.log('2H:', path.result, JSON.stringify(path.waypoints));
    expect(path.result).toBe(PathResult.FOUND);
    expect(path.waypoints.length).toBeGreaterThan(1);
    // First waypoint = start
    expect(path.waypoints[0]).toEqual({ ne: 0, se: 0 });
    // Last waypoint = target
    expect(path.waypoints[path.waypoints.length - 1]).toEqual({ ne: 7, se: 3 });
  });

  it('finds path across 2 vertical sectors', () => {
    const grid = makeGrid(5, 1, 2);
    const pf = new Pathfinder();
    pf.addGrid(grid);

    const path = pf.getPath({
      gridId: 0,
      start: { ne: 0, se: 0 },
      target: { ne: 3, se: 7 },
    });

    console.log('2V:', path.result, JSON.stringify(path.waypoints));
    expect(path.result).toBe(PathResult.FOUND);
    expect(path.waypoints.length).toBeGreaterThan(1);
    expect(path.waypoints[0]).toEqual({ ne: 0, se: 0 });
    expect(path.waypoints[path.waypoints.length - 1]).toEqual({ ne: 3, se: 7 });
  });

  it('finds path across 4 sectors (2x2)', () => {
    const grid = makeGrid(5, 2, 2);
    const pf = new Pathfinder();
    pf.addGrid(grid);

    const path = pf.getPath({
      gridId: 0,
      start: { ne: 0, se: 0 },
      target: { ne: 7, se: 7 },
    });

    console.log('2x2:', path.result, JSON.stringify(path.waypoints));
    expect(path.result).toBe(PathResult.FOUND);
    expect(path.waypoints.length).toBeGreaterThan(1);
    expect(path.waypoints[0]).toEqual({ ne: 0, se: 0 });
    expect(path.waypoints[path.waypoints.length - 1]).toEqual({ ne: 7, se: 7 });
  });

  it('finds path across 3x3 sectors', () => {
    const grid = makeGrid(4, 3, 3);
    const pf = new Pathfinder();
    pf.addGrid(grid);

    const path = pf.getPath({
      gridId: 0,
      start: { ne: 0, se: 0 },
      target: { ne: 11, se: 11 },
    });

    console.log('3x3:', path.result, JSON.stringify(path.waypoints));
    expect(path.result).toBe(PathResult.FOUND);
    expect(path.waypoints.length).toBeGreaterThan(1);
    expect(path.waypoints[0]).toEqual({ ne: 0, se: 0 });
    expect(path.waypoints[path.waypoints.length - 1]).toEqual({ ne: 11, se: 11 });
  });

  it('finds path navigating around walls across sectors', () => {
    const size = 5;
    const grid = makeGrid(size, 2, 1);

    // Build a wall in sector 0 blocking direct path to portal
    const s0 = grid.getSector(0)!;
    for (let y = 0; y < size; y++) {
      s0.getCostField().setCost(3, y, COST_IMPASSABLE);
    }
    // Leave gap at y=4
    s0.getCostField().setCost(3, 4, COST_MIN);

    const pf = new Pathfinder();
    pf.addGrid(grid);

    const path = pf.getPath({
      gridId: 0,
      start: { ne: 0, se: 0 },
      target: { ne: 7, se: 2 },
    });

    console.log('wall:', path.result, JSON.stringify(path.waypoints));
    expect(path.result).toBe(PathResult.FOUND);
    expect(path.waypoints.length).toBeGreaterThan(1);
  });
});
