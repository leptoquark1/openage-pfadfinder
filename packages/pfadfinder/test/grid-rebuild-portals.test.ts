import { describe, expect, it } from 'vitest';
import { CostField, Grid, Sector } from '../src/index.js';
import { COST_IMPASSABLE, COST_MIN } from '../src/shared/constants.js';
import { freshPortalGraphOf, portalGraphOf } from './helpers.js';

function fullCostField(size: number): CostField {
  const field = new CostField(size);
  field.setCosts(new Uint8Array(size * size).fill(COST_MIN));
  return field;
}

describe('Grid.rebuildPortals incremental update', () => {
  it('keeps portal identity when a dirty sector change does not touch the shared border', () => {
    const size = 8;
    const grid = new Grid(0, { width: 2, height: 1 }, size);
    const sector0 = new Sector(0, { x: 0, y: 0 }, fullCostField(size));
    const sector1 = new Sector(1, { x: 1, y: 0 }, fullCostField(size));
    grid.addSector(sector0);
    grid.addSector(sector1);
    grid.initPortals();
    grid.initPortalNodes();

    const portalBefore = sector0.getPortals()[0]!;
    expect(portalBefore).toBeDefined();

    // Interior change: wall far from the shared border.
    sector0.getCostField().setCost(2, 3, COST_IMPASSABLE);
    const changed = grid.rebuildPortals([sector0]);

    // Same range → same portal object survives.
    expect(sector0.getPortals()).toContain(portalBefore);
    expect(sector1.getPortals()).toContain(portalBefore);
    expect(changed.has(0)).toBe(true);
    expect(changed.has(1)).toBe(false);

    // Portal graph stays usable.
    grid.rebuildPortalNodes();
    expect(grid.getPortalMap().has(portalBefore.getId())).toBe(true);
  });

  it('drops a portal when a wall blocks the shared border and restores it after undo', () => {
    const size = 8;
    const grid = new Grid(0, { width: 2, height: 1 }, size);
    const sector0 = new Sector(0, { x: 0, y: 0 }, fullCostField(size));
    const sector1 = new Sector(1, { x: 1, y: 0 }, fullCostField(size));
    grid.addSector(sector0);
    grid.addSector(sector1);
    grid.initPortals();

    // Full-height wall on the right edge of sector 0 kills the portal.
    for (let y = 0; y < size; y++) {
      sector0.getCostField().setCost(size - 1, y, COST_IMPASSABLE);
    }
    const changed = grid.rebuildPortals([sector0]);
    grid.rebuildPortalNodes();

    expect(sector0.getPortals().length).toBe(0);
    expect(sector1.getPortals().length).toBe(0);
    expect(changed.has(0)).toBe(true);
    // sector1's portal list changed too (it lost the portal), so it must
    // be reported for exit recomputation.
    expect(changed.has(1)).toBe(true);
    expect(grid.getPortalMap().size).toBe(0);

    // Undo: the portal comes back with a fresh identity.
    for (let y = 0; y < size; y++) {
      sector0.getCostField().setCost(size - 1, y, COST_MIN);
    }
    grid.rebuildPortals([sector0]);
    grid.rebuildPortalNodes();

    expect(sector0.getPortals().length).toBe(1);
    expect(grid.getPortalMap().size).toBe(1);
  });

  it('restricts a split portal to its passable run', () => {
    const size = 8;
    const grid = new Grid(0, { width: 2, height: 1 }, size);
    const sector0 = new Sector(0, { x: 0, y: 0 }, fullCostField(size));
    const sector1 = new Sector(1, { x: 1, y: 0 }, fullCostField(size));
    grid.addSector(sector0);
    grid.addSector(sector1);
    grid.initPortals();

    // Wall in the middle of the border splits the portal into two.
    sector0.getCostField().setCost(size - 1, 3, COST_IMPASSABLE);
    sector0.getCostField().setCost(size - 1, 4, COST_IMPASSABLE);
    grid.rebuildPortals([sector0]);
    grid.rebuildPortalNodes();

    const ids = new Set<number>();
    for (const p of sector0.getPortals()) {
      ids.add(p.getId());
    }
    expect(sector0.getPortals().length).toBe(2);
    expect(ids.size).toBe(2);
    expect(grid.getPortalMap().size).toBe(2);
  });

  it('never hands out a portal id twice when a surviving portal precedes a new one', () => {
    const size = 8;
    const grid = new Grid(0, { width: 3, height: 1 }, size);
    const sectors = [0, 1, 2].map(i => new Sector(i, { x: i, y: 0 }, fullCostField(size)));
    for (const sector of sectors) {
      grid.addSector(sector);
    }
    const [sector0, sector1] = sectors as [Sector, Sector, Sector];

    // Border 0|1 starts with two portals: rows 0..4 and 6..7.
    sector0.getCostField().setCost(size - 1, 5, COST_IMPASSABLE);
    grid.initPortals();
    grid.initPortalNodes();

    // Row 6 closes: rows 0..4 survive, rows 7..7 become a new portal.
    sector0.getCostField().setCost(size - 1, 6, COST_IMPASSABLE);
    grid.rebuildPortals([sector0]);
    grid.rebuildPortalNodes();

    // Another border splits and gets fresh ids.
    sector1.getCostField().setCost(size - 1, 3, COST_IMPASSABLE);
    grid.rebuildPortals([sector1]);
    grid.rebuildPortalNodes();

    const portals = new Set(sectors.flatMap(s => s.getPortals()));
    const ids = new Set([...portals].map(p => p.getId()));
    expect(portals.size).toBe(4);
    expect(ids.size).toBe(portals.size);
    expect(grid.getPortalMap().size).toBe(portals.size);
  });

  it('gives ids only to new portals, not to survivors found again', () => {
    const size = 8;
    const grid = new Grid(0, { width: 2, height: 1 }, size);
    const sectors = [0, 1].map(i => new Sector(i, { x: i, y: 0 }, fullCostField(size)));
    for (const sector of sectors) {
      grid.addSector(sector);
    }
    const [sector0] = sectors as [Sector, Sector];

    // Border 0|1 starts with two portals: rows 0..4 and 6..7 → ids 0 and 1.
    sector0.getCostField().setCost(size - 1, 5, COST_IMPASSABLE);
    grid.initPortals();
    grid.initPortalNodes();
    expect(sector0.getPortals().map(p => p.getId())).toEqual([0, 1]);

    // Rebuilds that find the same portals again must not use up ids.
    for (let i = 0; i < 3; i++) {
      sector0.getCostField().setCost(2, i, COST_IMPASSABLE);
      grid.rebuildPortals([sector0]);
      grid.rebuildPortalNodes();
    }
    expect(sector0.getPortals().map(p => p.getId())).toEqual([0, 1]);

    // Row 2 closes: rows 0..1 and 3..4 are new, rows 6..7 survive.
    sector0.getCostField().setCost(size - 1, 2, COST_IMPASSABLE);
    grid.rebuildPortals([sector0]);
    grid.rebuildPortalNodes();
    expect(sector0.getPortals().map(p => p.getId()).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('syncs only the nodes of the sectors it is given', () => {
    const size = 8;
    const grid = new Grid(0, { width: 4, height: 1 }, size);
    const sectors = [0, 1, 2, 3].map(i => new Sector(i, { x: i, y: 0 }, fullCostField(size)));
    for (const sector of sectors) {
      grid.addSector(sector);
    }
    const [sector0, sector1, , sector3] = sectors as [Sector, Sector, Sector, Sector];
    grid.initPortals();
    grid.initPortalNodes();
    const border01 = sector0.getPortals()[0]!.getId();
    const far = grid.getPortalMap().get(sector3.getPortals()[0]!.getId())!;
    const farExits = far.exits.get(2);

    // A wall on border 0|1 drops its portal; sectors 0 and 1 changed.
    for (let y = 0; y < size; y++) {
      sector0.getCostField().setCost(size - 1, y, COST_IMPASSABLE);
    }
    const changed = grid.rebuildPortals([sector0]);
    grid.rebuildPortalNodes(changed);

    expect(changed).toEqual(new Set([0, 1]));
    expect(grid.getPortalMap().has(border01)).toBe(false);
    // Border 1|2 lost its exit to the dropped portal.
    const border12 = grid.getPortalMap().get(sector1.getPortals()[0]!.getId())!;
    expect([...border12.exits.get(1)!.keys()]).toEqual([]);
    // Border 2|3 lies outside the changed sectors and was left alone.
    expect(grid.getPortalMap().get(far.portal.getId())).toBe(far);
    expect(far.exits.get(2)).toBe(farExits);
    expect(portalGraphOf(grid.getPortalMap())).toEqual(freshPortalGraphOf(grid));

    // Undo: the portal comes back with a node of its own.
    for (let y = 0; y < size; y++) {
      sector0.getCostField().setCost(size - 1, y, COST_MIN);
    }
    grid.rebuildPortalNodes(grid.rebuildPortals([sector0]));
    expect(grid.getPortalMap().size).toBe(3);
    expect(portalGraphOf(grid.getPortalMap())).toEqual(freshPortalGraphOf(grid));

    // Nothing changed, nothing to do.
    grid.rebuildPortalNodes(new Set());
    expect(far.exits.get(2)).toBe(farExits);
  });
});
