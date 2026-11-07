import { describe, expect, it } from 'vitest';
import { CostField, Grid, Sector } from '../src/index.js';
import { COST_IMPASSABLE, COST_MIN } from '../src/shared/constants.js';

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
});
