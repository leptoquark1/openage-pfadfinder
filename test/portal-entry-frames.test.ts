import { describe, expect, it } from 'vitest';
import { CostField } from '../src/lib/core/cost-field.js';
import { Grid } from '../src/lib/graph/grid.js';
import { Sector } from '../src/lib/graph/sector.js';
import { COST_MIN } from '../src/shared/constants.js';
import { PortalDirection } from '../src/shared/types.js';

const SIZE = 8;

function makeGrid(gridW: number, gridH: number): Grid {
  const grid = new Grid(0, { width: gridW, height: gridH }, SIZE);
  let sid = 0;
  for (let sy = 0; sy < gridH; sy++) {
    for (let sx = 0; sx < gridW; sx++) {
      const cf = new CostField(SIZE);
      cf.setCosts(new Uint8Array(SIZE * SIZE).fill(COST_MIN));
      grid.addSector(new Sector(sid++, { x: sx, y: sy }, cf));
    }
  }
  grid.initPortals();
  grid.initPortalNodes();
  return grid;
}

describe('Portal entry/exit coordinate frames', () => {
  it('NORTH_SOUTH portal maps the sector1 side onto row 0', () => {
    const grid = makeGrid(1, 2);
    const portal = grid.getSector(0)!.getPortals()[0]!;
    expect(portal.getDirection()).toBe(PortalDirection.NORTH_SOUTH);

    const s0 = portal.getSector0();
    const s1 = portal.getSector1();

    expect(portal.getEntryStart(s0)).toEqual({ ne: 0, se: SIZE - 1 });
    expect(portal.getEntryEnd(s0)).toEqual({ ne: SIZE - 1, se: SIZE - 1 });
    expect(portal.getEntryStart(s1)).toEqual({ ne: 0, se: 0 });
    expect(portal.getEntryEnd(s1)).toEqual({ ne: SIZE - 1, se: 0 });
    expect(portal.getEntryCenter(s1).se).toBe(0);

    // Exiting a sector lands on the other side's border row
    expect(portal.getExitStart(s0)).toEqual({ ne: 0, se: 0 });
    expect(portal.getExitEnd(s0)).toEqual({ ne: SIZE - 1, se: 0 });
    expect(portal.getExitStart(s1)).toEqual({ ne: 0, se: SIZE - 1 });
    expect(portal.getExitCenter(s0).se).toBe(0);
  });

  it('EAST_WEST portal maps the sector1 side onto column 0', () => {
    const grid = makeGrid(2, 1);
    const portal = grid.getSector(0)!.getPortals()[0]!;
    expect(portal.getDirection()).toBe(PortalDirection.EAST_WEST);

    const s0 = portal.getSector0();
    const s1 = portal.getSector1();

    expect(portal.getEntryStart(s0)).toEqual({ ne: SIZE - 1, se: 0 });
    expect(portal.getEntryStart(s1)).toEqual({ ne: 0, se: 0 });
    expect(portal.getEntryEnd(s1)).toEqual({ ne: 0, se: SIZE - 1 });
    expect(portal.getExitStart(s0)).toEqual({ ne: 0, se: 0 });
    expect(portal.getExitEnd(s0)).toEqual({ ne: 0, se: SIZE - 1 });
    expect(portal.getExitStart(s1)).toEqual({ ne: SIZE - 1, se: 0 });
  });
});
