import { afterEach, describe, expect, it, vi } from 'vitest';
import { Integrator } from '../src/lib/core/integrator.js';
import { Pathfinder } from '../src/lib/pathfinding/pathfinder.js';
import { COST_IMPASSABLE, COST_MIN } from '../src/shared/constants.js';
import { buildGrid } from '../src/shared/cost-map/cost-map.js';
import { followRoute } from './helpers.js';

const SECTOR = 8;
const SIZE = SECTOR * 2;
const START = { ne: 13, se: 2 };
const TARGET = { ne: 1, se: 2 };

const open = () => new Uint8Array(SIZE * SIZE).fill(COST_MIN);

/**
 * A wall inside the start sector, clear of every sector border: both grids
 * get the same portals and ids, so their portal fields share cache keys.
 */
function walled(): Uint8Array {
  const costs = open();
  for (let se = 0; se <= 5; se++) {
    costs[10 + se * SIZE] = COST_IMPASSABLE;
  }
  return costs;
}

const build = (costs: Uint8Array, gridId: number) =>
  buildGrid(costs, { width: SIZE, height: SIZE }, SECTOR, gridId);

/** Follow the flow route cell by cell; the cells stepped on. */
function follow(pf: Pathfinder, gridId: number): { ne: number, se: number }[] {
  const route = pf.getFlowRoute({ gridId, start: START, target: TARGET });
  expect(route).not.toBeNull();
  return followRoute(route!, START, 4 * SIZE).slice(1);
}

function expectAroundWall(costs: Uint8Array, cells: { ne: number, se: number }[]): void {
  expect(cells.at(-1)).toEqual(TARGET);
  for (const { ne, se } of cells) {
    expect(costs[ne + se * SIZE], `${ne},${se}`).not.toBe(COST_IMPASSABLE);
  }
}

describe('portal field cache across grids', () => {
  it('does not hand one grid the cached fields of another', () => {
    const pf = new Pathfinder();
    pf.addGrid(build(open(), 0));
    const costs = walled();
    pf.addGrid(build(costs, 1));

    follow(pf, 0); // fills the cache with fields of the open grid
    expectAroundWall(costs, follow(pf, 1));
  });

  it('does not keep the fields of a grid replaced under the same id', () => {
    const pf = new Pathfinder();
    pf.addGrid(build(open(), 0));
    follow(pf, 0);

    const costs = walled();
    pf.addGrid(build(costs, 0));
    expectAroundWall(costs, follow(pf, 0));
  });

  it('still reuses fields within one grid', () => {
    const integrate = vi.spyOn(Integrator.prototype, 'integratePortal');
    const pf = new Pathfinder();
    pf.addGrid(build(walled(), 0));
    follow(pf, 0);
    const computed = integrate.mock.calls.length;
    expect(computed).toBeGreaterThan(0);
    expect(pf.getCachedFieldCount()).toBe(computed);

    follow(pf, 0);
    expect(integrate.mock.calls.length).toBe(computed);
  });

  it('keeps the fields of several grids side by side', () => {
    const integrate = vi.spyOn(Integrator.prototype, 'integratePortal');
    const pf = new Pathfinder();
    pf.addGrid(build(open(), 0));
    pf.addGrid(build(walled(), 1));
    follow(pf, 0);
    follow(pf, 1);
    const computed = integrate.mock.calls.length;

    for (let i = 0; i < 10; i++) {
      follow(pf, i % 2);
    }
    expect(integrate.mock.calls.length).toBe(computed);
  });

  it('does not grow while a border cell toggles', () => {
    const pf = new Pathfinder();
    const grid = build(open(), 0);
    pf.addGrid(grid);
    // On the border between the start and target sectors: every toggle
    // splits or merges the portal there, and the old portal is dropped.
    const cell = { ne: 7, se: 2 };
    const costs = open();
    for (let i = 0; i < 100; i++) {
      const cost = i % 2 === 0 ? COST_IMPASSABLE : COST_MIN;
      costs[cell.ne + cell.se * SIZE] = cost;
      grid.updateCosts([{ ...cell, cost }]);
      expectAroundWall(costs, follow(pf, 0));
    }
    expect(pf.getCachedFieldCount()).toBeLessThanOrEqual(4);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
