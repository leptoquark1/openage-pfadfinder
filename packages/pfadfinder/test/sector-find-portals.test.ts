import { describe, expect, it } from 'vitest';
import { CostField, Portal, Sector } from '../src/index.js';
import { COST_IMPASSABLE, COST_MIN } from '../src/shared/constants.js';
import { PortalDirection } from '../src/shared/types.js';

const size = 8;

function fullCostField(): CostField {
  const field = new CostField(size);
  field.setCosts(new Uint8Array(size * size).fill(COST_MIN));
  return field;
}

/** Two sectors side by side whose east/west border has a wall at row 5. */
function splitBorder(): [Sector, Sector] {
  const west = new Sector(0, { x: 0, y: 0 }, fullCostField());
  const east = new Sector(1, { x: 1, y: 0 }, fullCostField());
  west.getCostField().setCost(size - 1, 5, COST_IMPASSABLE);
  return [west, east];
}

describe('Sector.findPortals', () => {
  it('numbers new portals from a start id', () => {
    const [west, east] = splitBorder();
    const portals = west.findPortals(east, PortalDirection.EAST_WEST, 10);

    expect(portals.map(p => p.getId())).toEqual([10, 11]);
    expect(portals.map(p => [p.getEntryStart(0).se, p.getEntryEnd(0).se])).toEqual([
      [0, 4],
      [6, 7],
    ]);
  });

  it('calls an allocator once per new portal', () => {
    const [west, east] = splitBorder();
    const ids = [7, 3];
    const portals = west.findPortals(east, PortalDirection.EAST_WEST, () => ids.shift()!);

    expect(portals.map(p => p.getId())).toEqual([7, 3]);
    expect(ids).toEqual([]);
  });

  it('returns reused portals as they are and gives ids only to new ranges', () => {
    const [west, east] = splitBorder();
    const old = west.findPortals(east, PortalDirection.EAST_WEST, 0);

    // Row 2 closes: rows 0..1 and 3..4 are new, rows 6..7 survive.
    west.getCostField().setCost(size - 1, 2, COST_IMPASSABLE);
    let calls = 0;
    const portals = west.findPortals(
      east,
      PortalDirection.EAST_WEST,
      () => 100 + calls++,
      old,
    );

    expect(calls).toBe(2);
    expect(portals.map(p => p.getId())).toEqual([100, 101, 1]);
    expect(portals[2]).toBe(old[1]);
  });

  it('numbers north/south portals and ignores reuse portals of other edges', () => {
    const north = new Sector(0, { x: 0, y: 0 }, fullCostField());
    const south = new Sector(2, { x: 0, y: 1 }, fullCostField());
    // Same cell range, but an east/west portal of another edge.
    const unrelated = new Portal(
      5,
      0,
      1,
      PortalDirection.EAST_WEST,
      { ne: size - 1, se: 0 },
      { ne: size - 1, se: size - 1 },
    );

    const [portal] = north.findPortals(south, PortalDirection.NORTH_SOUTH, 0, [unrelated]);

    expect(portal).not.toBe(unrelated);
    expect(portal!.getId()).toBe(0);
    expect(portal!.getEntryStart(0)).toEqual({ ne: 0, se: size - 1 });
    expect(portal!.getEntryEnd(0)).toEqual({ ne: size - 1, se: size - 1 });
  });
});

describe('Portal.matches / Portal.spans', () => {
  const make = (id: number, start: number, end: number): Portal =>
    new Portal(
      id,
      0,
      1,
      PortalDirection.EAST_WEST,
      { ne: size - 1, se: start },
      { ne: size - 1, se: end },
    );

  it('compares sectors, direction and range, not the id', () => {
    const portal = make(0, 0, 4);

    expect(portal.matches(make(9, 0, 4))).toBe(true);
    expect(portal.matches(make(0, 0, 3))).toBe(false);
    expect(portal.spans(0, 1, PortalDirection.EAST_WEST, { ne: size - 1, se: 0 }, { ne: size - 1, se: 4 })).toBe(true);
    expect(portal.spans(0, 2, PortalDirection.EAST_WEST, { ne: size - 1, se: 0 }, { ne: size - 1, se: 4 })).toBe(false);
    expect(portal.spans(0, 1, PortalDirection.NORTH_SOUTH, { ne: size - 1, se: 0 }, { ne: size - 1, se: 4 })).toBe(false);
  });
});
