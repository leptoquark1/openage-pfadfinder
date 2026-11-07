import { describe, expect, it } from 'vitest';
import { CostField } from '../src/lib/core/cost-field.js';
import { Grid } from '../src/lib/graph/grid.js';
import { Sector } from '../src/lib/graph/sector.js';
import { Pathfinder } from '../src/lib/pathfinding/pathfinder.js';
import { COST_MIN } from '../src/shared/constants.js';
import { PathResult } from '../src/shared/types.js';

describe('LOS string-pulling waypoint extraction', () => {
  it('single-sector path on open grid produces few waypoints', () => {
    const size = 8;
    const grid = new Grid(0, { width: 1, height: 1 }, size);
    const cf = new CostField(size);
    cf.setCosts(new Uint8Array(size * size).fill(COST_MIN));
    grid.addSector(new Sector(0, { x: 0, y: 0 }, cf));
    grid.initPortals();
    grid.initPortalNodes();

    const pf = new Pathfinder();
    pf.addGrid(grid);

    const path = pf.getPath({
      gridId: 0,
      start: { ne: 0, se: 0 },
      target: { ne: 7, se: 7 },
    });

    expect(path.result).toBe(PathResult.FOUND);
    // On an open grid with LOS, string-pulling should produce very few waypoints
    // (start, possibly one intermediate if LOS detected, and target)
    expect(path.waypoints.length).toBeLessThanOrEqual(4);
  });
});
