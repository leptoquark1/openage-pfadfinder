import { describe, expect, it } from 'vitest';
import { CostField } from '../src/lib/core/cost-field.js';
import { Grid } from '../src/lib/graph/grid.js';
import { Sector } from '../src/lib/graph/sector.js';
import { Pathfinder } from '../src/lib/pathfinding/pathfinder.js';
import { COST_IMPASSABLE } from '../src/shared/constants.js';
import { buildGrid } from '../src/shared/cost-map/cost-map.js';
import { PathResult } from '../src/shared/types.js';

describe('Grid and Sector', () => {
  it('creates a grid with sectors', () => {
    const grid = new Grid(0, { width: 2, height: 2 }, 4);
    expect(grid.getId()).toBe(0);
    expect(grid.getSize()).toEqual({ width: 2, height: 2 });
    expect(grid.getSectorSize()).toBe(4);
  });

  it('globalToLocal converts correctly', () => {
    const grid = new Grid(0, { width: 3, height: 3 }, 5);
    const result = grid.globalToLocal(7, 3);
    expect(result.sectorX).toBe(1);
    expect(result.sectorY).toBe(0);
    expect(result.localNe).toBe(2);
    expect(result.localSe).toBe(3);
  });

  it('getSectorAt returns correct sector', () => {
    const grid = new Grid(0, { width: 2, height: 2 }, 5);
    const cf1 = new CostField(5);
    cf1.setCosts(new Uint8Array(25).fill(1));
    const sector0 = new Sector(0, { x: 0, y: 0 }, cf1);
    grid.addSector(sector0);

    const s = grid.getSectorAt(3, 2);
    expect(s).toBe(sector0);
  });

  it('initPortals finds portals between adjacent open sectors', () => {
    const size = 5;
    const grid = new Grid(0, { width: 2, height: 1 }, size);

    const cf0 = new CostField(size);
    cf0.setCosts(new Uint8Array(size * size).fill(1));
    const cf1 = new CostField(size);
    cf1.setCosts(new Uint8Array(size * size).fill(1));

    const s0 = new Sector(0, { x: 0, y: 0 }, cf0);
    const s1 = new Sector(1, { x: 1, y: 0 }, cf1);
    grid.addSector(s0);
    grid.addSector(s1);

    grid.initPortals();

    // Should have at least one EAST_WEST portal
    expect(s0.getPortals().length).toBeGreaterThan(0);
    expect(s1.getPortals().length).toBeGreaterThan(0);
  });

  it('initPortals skips blocked edges', () => {
    const size = 3;
    const grid = new Grid(0, { width: 2, height: 1 }, size);

    const cf0 = new CostField(size);
    const cf1 = new CostField(size);
    // Block right edge of sector 0 and left edge of sector 1
    for (let y = 0; y < size; y++) {
      cf0.setCost(size - 1, y, COST_IMPASSABLE);
      cf1.setCost(0, y, COST_IMPASSABLE);
    }
    // Fill rest with min cost
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (cf0.getCost(x, y) === 0) {
          cf0.setCost(x, y, 1);
        }
        if (cf1.getCost(x, y) === 0) {
          cf1.setCost(x, y, 1);
        }
      }
    }

    const s0 = new Sector(0, { x: 0, y: 0 }, cf0);
    const s1 = new Sector(1, { x: 1, y: 0 }, cf1);
    grid.addSector(s0);
    grid.addSector(s1);

    grid.initPortals();

    // No portals should be created
    expect(s0.getPortals().length).toBe(0);
    expect(s1.getPortals().length).toBe(0);
  });
});

describe('Pathfinder', () => {
  it('getPath returns OUT_OF_BOUNDS for out-of-bounds target', () => {
    const size = 5;
    const grid = new Grid(0, { width: 1, height: 1 }, size);
    const cf = new CostField(size);
    cf.setCosts(new Uint8Array(size * size).fill(1));
    const sector = new Sector(0, { x: 0, y: 0 }, cf);
    grid.addSector(sector);
    grid.initPortals();

    const pf = new Pathfinder();
    pf.addGrid(grid);

    const path = pf.getPath({
      gridId: 0,
      start: { ne: 0, se: 0 },
      target: { ne: 100, se: 100 },
    });
    expect(path.result).toBe(PathResult.OUT_OF_BOUNDS);
  });

  it('getPath returns NOT_FOUND for impassable target', () => {
    const size = 5;
    const grid = new Grid(0, { width: 1, height: 1 }, size);
    const cf = new CostField(size);
    cf.setCosts(new Uint8Array(size * size).fill(1));
    cf.setCost(4, 4, COST_IMPASSABLE);
    const sector = new Sector(0, { x: 0, y: 0 }, cf);
    grid.addSector(sector);
    grid.initPortals();

    const pf = new Pathfinder();
    pf.addGrid(grid);

    const path = pf.getPath({
      gridId: 0,
      start: { ne: 0, se: 0 },
      target: { ne: 4, se: 4 },
    });
    expect(path.result).toBe(PathResult.NOT_FOUND);
  });

  it('getPath finds path in a single sector', () => {
    const size = 5;
    const grid = new Grid(0, { width: 1, height: 1 }, size);
    const cf = new CostField(size);
    cf.setCosts(new Uint8Array(size * size).fill(1));
    const sector = new Sector(0, { x: 0, y: 0 }, cf);
    grid.addSector(sector);
    grid.initPortals();
    grid.initPortalNodes();

    const pf = new Pathfinder();
    pf.addGrid(grid);

    const path = pf.getPath({
      gridId: 0,
      start: { ne: 0, se: 0 },
      target: { ne: 4, se: 4 },
    });
    expect(path.result).toBe(PathResult.FOUND);
    expect(path.waypoints.length).toBeGreaterThan(0);
    // First waypoint should be start
    expect(path.waypoints[0]).toEqual({ ne: 0, se: 0 });
  });

  it('getPath finds path across multiple sectors', () => {
    const size = 5;
    const grid = new Grid(0, { width: 2, height: 1 }, size);

    const cf0 = new CostField(size);
    cf0.setCosts(new Uint8Array(size * size).fill(1));
    const cf1 = new CostField(size);
    cf1.setCosts(new Uint8Array(size * size).fill(1));

    const s0 = new Sector(0, { x: 0, y: 0 }, cf0);
    const s1 = new Sector(1, { x: 1, y: 0 }, cf1);
    grid.addSector(s0);
    grid.addSector(s1);

    grid.initPortals();
    grid.initPortalNodes();

    const pf = new Pathfinder();
    pf.addGrid(grid);

    const path = pf.getPath({
      gridId: 0,
      start: { ne: 0, se: 0 },
      target: { ne: 7, se: 3 },
    });
    expect(path.result).toBe(PathResult.FOUND);
    expect(path.waypoints.length).toBeGreaterThan(0);
  });

  it('getPath navigates around obstacles', () => {
    const size = 5;
    const grid = new Grid(0, { width: 1, height: 1 }, size);
    const cf = new CostField(size);
    cf.setCosts(new Uint8Array(size * size).fill(1));
    // Create a wall with a gap
    for (let y = 0; y < size; y++) {
      if (y !== 2) {
        cf.setCost(2, y, COST_IMPASSABLE);
      }
    }
    const sector = new Sector(0, { x: 0, y: 0 }, cf);
    grid.addSector(sector);
    grid.initPortals();
    grid.initPortalNodes();

    const pf = new Pathfinder();
    pf.addGrid(grid);

    const path = pf.getPath({
      gridId: 0,
      start: { ne: 0, se: 0 },
      target: { ne: 4, se: 0 },
    });
    expect(path.result).toBe(PathResult.FOUND);
    // Path should go through the gap at y=2
    expect(path.waypoints.length).toBeGreaterThan(2);
  });
});

describe('route fields for inspection', () => {
  it('hands out the flow field of every route sector and counts the cached portal fields', () => {
    const costs = new Uint8Array(32 * 32).fill(1);
    const pf = new Pathfinder();
    pf.addGrid(buildGrid(costs, { width: 32, height: 32 }, 16, 0));
    expect(pf.getCachedFieldCount()).toBe(0);
    const route = pf.getFlowRoute({
      gridId: 0,
      start: { ne: 2, se: 2 },
      target: { ne: 29, se: 2 },
    })!;
    const steps = route.getSteps();
    expect(steps.map(s => s.sector.getId())).toEqual(route.getSectorIds());
    expect(steps.length).toBe(2);
    expect(steps[0]!.flowField.getSize()).toBe(16);
    expect(pf.getCachedFieldCount()).toBeGreaterThan(0);
  });
});
