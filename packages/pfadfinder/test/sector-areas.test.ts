import { describe, expect, it } from 'vitest';
import { CostField } from '../src/lib/core/cost-field.js';
import { Sector } from '../src/lib/graph/sector.js';
import { Pathfinder } from '../src/lib/pathfinding/pathfinder.js';
import { COST_IMPASSABLE, COST_MIN } from '../src/shared/constants.js';
import { buildGrid } from '../src/shared/cost-map/cost-map.js';
import { PathResult } from '../src/shared/types.js';
import { followRoute, makeRandom } from './helpers.js';

const SIZE = 6;

/** A sector from rows of `.` (passable) and `#` (wall). */
function sectorOf(rows: string[]): Sector {
  const field = new CostField(rows.length);
  field.setCosts(Uint8Array.from(rows.join(''), cell => (cell === '#' ? COST_IMPASSABLE : COST_MIN)));
  return new Sector(0, { x: 0, y: 0 }, field);
}

/** Cells a flood fill over 4-connected passable cells reaches from `start`. */
function flood(costs: Uint8Array, size: number, start: number): Set<number> {
  const seen = new Set([start]);
  const open = [start];
  while (open.length > 0) {
    const idx = open.pop()!;
    const x = idx % size;
    for (const next of [idx - size, x > 0 ? idx - 1 : -1, idx + size, x < size - 1 ? idx + 1 : -1]) {
      if (next >= 0 && next < costs.length && !seen.has(next) && costs[next] !== COST_IMPASSABLE) {
        seen.add(next);
        open.push(next);
      }
    }
  }
  return seen;
}

describe('Sector.getAreas', () => {
  it('gives cells split by a wall different areas and walls none', () => {
    const sector = sectorOf(['..#...', '..#...', '..#...', '..#...', '..#...', '..#...']);
    const areas = sector.getAreas();

    expect(areas[2]).toBe(0);
    expect(areas[0]).not.toBe(0);
    expect(areas[5]).not.toBe(0);
    expect(areas[0]).not.toBe(areas[5]);
    // down the left side, and across to the right one
    expect(areas[5 * SIZE]).toBe(areas[0]);
    expect(areas[5 * SIZE + 5]).toBe(areas[5]);
  });

  it('does not join areas that only touch diagonally', () => {
    const sector = sectorOf(['.#....', '#.....', '......', '......', '......', '......']);
    const areas = sector.getAreas();

    expect(areas[0]).not.toBe(0);
    expect(areas[0]).not.toBe(areas[SIZE + 1]);
  });

  it('labels again only after the cost field changed', () => {
    const sector = sectorOf(['..#...', '..#...', '..#...', '..#...', '..#...', '..#...']);
    const areas = sector.getAreas();
    expect(sector.getAreas()).toBe(areas);

    sector.getCostField().setCost(2, 3, COST_MIN); // a gap in the wall
    const joined = sector.getAreas();
    expect(joined).not.toBe(areas);
    expect(joined[0]).toBe(joined[5]);
  });

  it('matches a flood fill from every cell on random sectors', () => {
    const rand = makeRandom(11);
    for (let round = 0; round < 40; round++) {
      const size = 3 + Math.floor(rand() * 10);
      const density = rand() * 0.6;
      const field = new CostField(size);
      field.setCosts(Uint8Array.from({ length: size * size }, () => (rand() < density ? COST_IMPASSABLE : COST_MIN)));
      const costs = field.getCosts();
      const areas = new Sector(0, { x: 0, y: 0 }, field).getAreas();

      for (let start = 0; start < costs.length; start++) {
        if (costs[start] === COST_IMPASSABLE) {
          expect(areas[start], `round ${round} cell ${start}`).toBe(0);
          continue;
        }
        const reached = flood(costs, size, start);
        for (let idx = 0; idx < costs.length; idx++) {
          expect(areas[idx] === areas[start], `round ${round} from ${start} to ${idx}`).toBe(reached.has(idx));
        }
      }
    }
  });
});

describe('Pathfinder with a start on an impassable cell', () => {
  const SECTOR = 8;
  const CELLS = SECTOR * 2;

  /** A wall across the left sector with a single wall cell sticking out below it. */
  function setup() {
    const costs = new Uint8Array(CELLS * CELLS).fill(COST_MIN);
    for (let ne = 0; ne < SECTOR; ne++) {
      costs[ne + 3 * CELLS] = COST_IMPASSABLE;
    }
    const pf = new Pathfinder();
    pf.addGrid(buildGrid(costs, { width: CELLS, height: CELLS }, SECTOR));
    return { pf, costs };
  }

  it('plans a route from the areas next to the start, which a unit there can step into', () => {
    const { pf, costs } = setup();
    const start = { ne: 2, se: 3 }; // on the wall
    const target = { ne: 5, se: 6 }; // below it, same sector
    const route = pf.getFlowRoute({ gridId: 0, start, target });

    expect(route).not.toBeNull();
    expect(route!.getSectorIds()).toEqual([0]);
    // the wall cell itself has no flow; the cell below it leads to the target
    expect(route!.next(start.ne, start.se)).toBeNull();
    const walked = followRoute(route!, { ne: 2, se: 4 }, CELLS * CELLS);
    expect(walked.at(-1)).toEqual(target);
    for (const { ne, se } of walked) {
      expect(costs[ne + se * CELLS]).not.toBe(COST_IMPASSABLE);
    }
    expect(pf.getPath({ gridId: 0, start, target }).result).toBe(PathResult.NOT_FOUND);
  });

  it('plans through the portals of those areas when the target lies in another sector', () => {
    const { pf } = setup();
    const route = pf.getFlowRoute({ gridId: 0, start: { ne: 2, se: 3 }, target: { ne: 12, se: 12 } });

    expect(route).not.toBeNull();
    expect(route!.getSectorIds().at(-1)).toBe(3);
  });

  it('finds no route from a wall cell with only walls around it', () => {
    const costs = new Uint8Array(CELLS * CELLS).fill(COST_MIN);
    for (const [ne, se] of [
      [2, 2],
      [1, 2],
      [3, 2],
      [2, 1],
      [2, 3],
    ] as const) {
      costs[ne + se * CELLS] = COST_IMPASSABLE;
    }
    const pf = new Pathfinder();
    pf.addGrid(buildGrid(costs, { width: CELLS, height: CELLS }, SECTOR));

    expect(pf.getFlowRoute({ gridId: 0, start: { ne: 2, se: 2 }, target: { ne: 5, se: 6 } })).toBeNull();
    expect(pf.getFlowRoute({ gridId: 0, start: { ne: 2, se: 2 }, target: { ne: 12, se: 12 } })).toBeNull();
  });
});
