import { describe, expect, it } from 'vitest';
import { Pathfinder } from '../src/lib/pathfinding/pathfinder.js';
import { COST_IMPASSABLE, COST_MIN } from '../src/shared/constants.js';
import { buildGrid } from '../src/shared/cost-map/cost-map.js';

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
  const cells: { ne: number, se: number }[] = [];
  let pos = START;
  for (let i = 0; i < 4 * SIZE && (pos.ne !== TARGET.ne || pos.se !== TARGET.se); i++) {
    const next = route!.next(pos.ne, pos.se);
    if (!next || (next.ne === pos.ne && next.se === pos.se)) {
      break;
    }
    cells.push(next);
    pos = next;
  }
  return cells;
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
    const pf = new Pathfinder();
    pf.addGrid(build(walled(), 0));
    follow(pf, 0);
    const cached = pf.getCachedFieldCount();
    expect(cached).toBeGreaterThan(0);
    follow(pf, 0);
    expect(pf.getCachedFieldCount()).toBe(cached);
  });
});
