import { describe, expect, it } from 'vitest';
import { CostField } from '../src/lib/core/cost-field.js';
import { Grid } from '../src/lib/graph/grid.js';
import { Sector } from '../src/lib/graph/sector.js';
import { Pathfinder } from '../src/lib/pathfinding/pathfinder.js';
import { COST_IMPASSABLE, COST_MIN } from '../src/shared/constants.js';
import { PathResult } from '../src/shared/types.js';

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

describe('CostField dirty tracking', () => {
  it('version increments on modification', () => {
    const cf = new CostField(3);
    const v0 = cf.getVersion();
    cf.setCost(0, 0, 5);
    expect(cf.getVersion()).toBe(v0 + 1);
    expect(cf.isDirty(v0)).toBe(true);
  });

  it('Integrator evicts stale cache on dirty cost field', () => {
    const size = 5;
    const grid = makeGrid(size, 2, 1);
    const pf = new Pathfinder();
    pf.addGrid(grid);

    // First path — should compute and cache
    const path1 = pf.getPath({
      gridId: 0,
      start: { ne: 0, se: 0 },
      target: { ne: 7, se: 2 },
    });
    expect(path1.result).toBe(PathResult.FOUND);

    // Modify cost field — make a wall
    const s0 = grid.getSector(0)!;
    s0.getCostField().setCost(2, 2, COST_IMPASSABLE);

    // Second path — should detect dirty cache and recompute
    const path2 = pf.getPath({
      gridId: 0,
      start: { ne: 0, se: 0 },
      target: { ne: 7, se: 2 },
    });
    expect(path2.result).toBe(PathResult.FOUND);
  });
});
