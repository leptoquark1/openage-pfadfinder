import { describe, expect, it } from 'vitest';
import { CostField } from '../src/lib/core/cost-field.js';
import { Grid } from '../src/lib/graph/grid.js';
import { Sector } from '../src/lib/graph/sector.js';
import { portalAStar } from '../src/lib/pathfinding/portal-graph.js';
import { COST_IMPASSABLE, COST_MIN } from '../src/shared/constants.js';

describe('portalAStar partial-path fallback', () => {
  it('returns no portals when sectors are completely disconnected', () => {
    const size = 5;
    const grid = new Grid(0, { width: 2, height: 1 }, size);

    const cf0 = new CostField(size);
    cf0.setCosts(new Uint8Array(size * size).fill(COST_MIN));
    // Block the entire right edge of sector 0
    for (let y = 0; y < size; y++) {
      cf0.setCost(size - 1, y, COST_IMPASSABLE);
    }

    const cf1 = new CostField(size);
    cf1.setCosts(new Uint8Array(size * size).fill(COST_MIN));
    // Block entire left edge of sector 1
    for (let y = 0; y < size; y++) {
      cf1.setCost(0, y, COST_IMPASSABLE);
    }

    grid.addSector(new Sector(0, { x: 0, y: 0 }, cf0));
    grid.addSector(new Sector(1, { x: 1, y: 0 }, cf1));
    grid.initPortals();
    grid.initPortalNodes();

    // No portals should exist between the sectors
    const s0 = grid.getSector(0)!;
    const s1 = grid.getSector(1)!;
    expect(s0.getPortals().length).toBe(0);
    expect(s1.getPortals().length).toBe(0);
  });

  it('portalAStar returns partial flag when no full path exists', () => {
    const size = 5;
    const grid = new Grid(0, { width: 3, height: 1 }, size);

    // Sector 0, 1, 2 in a row
    for (let i = 0; i < 3; i++) {
      const cf = new CostField(size);
      cf.setCosts(new Uint8Array(size * size).fill(COST_MIN));
      grid.addSector(new Sector(i, { x: i, y: 0 }, cf));
    }

    // Block edge between sector 1 and 2
    const s1 = grid.getSector(1)!;
    for (let y = 0; y < size; y++) {
      s1.getCostField().setCost(size - 1, y, COST_IMPASSABLE);
    }
    const s2 = grid.getSector(2)!;
    for (let y = 0; y < size; y++) {
      s2.getCostField().setCost(0, y, COST_IMPASSABLE);
    }

    grid.initPortals();
    grid.initPortalNodes();

    // Portal A* from sector 0 to sector 2 should not find a full path
    const s0 = grid.getSector(0)!;
    // target position as global tile coords: sector 2 starts at ne=10, local (2,2) → global (12,2)
    const result = portalAStar(
      grid,
      s0.getPortals(),
      s2.getPortals(),
      grid.getPortalMap(),
      { ne: 12, se: 2 },
      s0.getId(),
    );

    // Either found is false (no path through blocked portal)
    expect(result.found).toBe(false);
  });
});
