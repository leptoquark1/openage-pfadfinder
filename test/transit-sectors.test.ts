import { describe, expect, it } from 'vitest';
import { CostField } from '../src/lib/core/cost-field.js';
import { Grid } from '../src/lib/graph/grid.js';
import { Sector } from '../src/lib/graph/sector.js';
import { Pathfinder } from '../src/lib/pathfinding/pathfinder.js';
import { COST_MIN } from '../src/shared/constants.js';
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

describe('Transit-sector flow fields', () => {
  it('produces waypoints through transit sectors in 3x3 grid', () => {
    const grid = makeGrid(4, 3, 3);
    const pf = new Pathfinder();
    pf.addGrid(grid);

    const path = pf.getPath({
      gridId: 0,
      start: { ne: 0, se: 0 },
      target: { ne: 11, se: 11 },
    });

    expect(path.result).toBe(PathResult.FOUND);
    expect(path.waypoints.length).toBeGreaterThan(1);
    expect(path.waypoints[0]).toEqual({ ne: 0, se: 0 });
    expect(path.waypoints[path.waypoints.length - 1]).toEqual({ ne: 11, se: 11 });
  });

  it('transit waypoints are continuous across sectors', () => {
    const grid = makeGrid(5, 3, 1);
    const pf = new Pathfinder();
    pf.addGrid(grid);

    // Check portal connectivity
    const s0 = grid.getSector(0)!;
    const s1 = grid.getSector(1)!;
    const s2 = grid.getSector(2)!;

    // Each sector should have at least one portal
    expect(s0.getPortals().length).toBeGreaterThan(0);
    expect(s1.getPortals().length).toBeGreaterThan(0);
    expect(s2.getPortals().length).toBeGreaterThan(0);

    // Sector 1 should connect its portals (it has 2: one to s0, one to s2)
    for (const p of s1.getPortals()) {
      const exits = p.getConnected(s1.getId());
      expect(exits.length).toBeGreaterThan(0);
    }

    const path = pf.getPath({
      gridId: 0,
      start: { ne: 0, se: 0 },
      target: { ne: 14, se: 2 },
    });

    expect(path.result).toBe(PathResult.FOUND);
    // Verify no large jumps in waypoints (continuity)
    for (let i = 1; i < path.waypoints.length; i++) {
      const prev = path.waypoints[i - 1]!;
      const curr = path.waypoints[i]!;
      const dist = Math.abs(prev.ne - curr.ne) + Math.abs(prev.se - curr.se);
      expect(dist).toBeLessThan(20); // no sector-sized jumps
    }
  });
});
