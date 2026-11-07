import { describe, expect, it } from 'vitest';
import { CostField } from '../src/lib/core/cost-field.js';
import { Grid } from '../src/lib/graph/grid.js';
import { Sector } from '../src/lib/graph/sector.js';
import { Pathfinder } from '../src/lib/pathfinding/pathfinder.js';
import { COST_IMPASSABLE, COST_MIN } from '../src/shared/constants.js';
import { PathResult, type Waypoint } from '../src/shared/types.js';
import { followRoute, makeRandom } from './helpers.js';

const SECTOR_SIZE = 16;
const SECTORS = 4;
const CELLS = SECTOR_SIZE * SECTORS;

/** Global cost map with a lake and wall segments that straddle sector borders. */
function makeCosts(seed: number): Uint8Array {
  const rand = makeRandom(seed);
  const costs = new Uint8Array(CELLS * CELLS).fill(COST_MIN);

  const lakeX = 16 + Math.floor(rand() * 32);
  const lakeY = 16 + Math.floor(rand() * 32);
  const lakeR = 5 + Math.floor(rand() * 5);
  for (let y = 0; y < CELLS; y++) {
    for (let x = 0; x < CELLS; x++) {
      if ((x - lakeX) ** 2 + (y - lakeY) ** 2 <= lakeR * lakeR) {
        costs[x + y * CELLS] = COST_IMPASSABLE;
      }
    }
  }

  for (let w = 0; w < 14; w++) {
    const horizontal = rand() < 0.5;
    const len = 6 + Math.floor(rand() * 18);
    const x0 = Math.floor(rand() * CELLS);
    const y0 = Math.floor(rand() * CELLS);
    for (let i = 0; i < len; i++) {
      const x = horizontal ? x0 + i : x0;
      const y = horizontal ? y0 : y0 + i;
      if (x < CELLS && y < CELLS) {
        costs[x + y * CELLS] = COST_IMPASSABLE;
      }
    }
  }

  return costs;
}

function makeGrid(costs: Uint8Array): Grid {
  const grid = new Grid(0, { width: SECTORS, height: SECTORS }, SECTOR_SIZE);
  let sid = 0;
  for (let sy = 0; sy < SECTORS; sy++) {
    for (let sx = 0; sx < SECTORS; sx++) {
      const local = new Uint8Array(SECTOR_SIZE * SECTOR_SIZE);
      for (let y = 0; y < SECTOR_SIZE; y++) {
        for (let x = 0; x < SECTOR_SIZE; x++) {
          local[x + y * SECTOR_SIZE]
            = costs[sx * SECTOR_SIZE + x + (sy * SECTOR_SIZE + y) * CELLS]!;
        }
      }
      const cf = new CostField(SECTOR_SIZE);
      cf.setCosts(local);
      grid.addSector(new Sector(sid++, { x: sx, y: sy }, cf));
    }
  }
  grid.initPortals();
  grid.initPortalNodes();
  return grid;
}

/** 4-connected BFS distance map from `from` over walkable cells. */
function reachable(costs: Uint8Array, from: Waypoint): Uint8Array {
  const seen = new Uint8Array(CELLS * CELLS);
  const queue = [from.ne + from.se * CELLS];
  seen[queue[0]!] = 1;
  for (let i = 0; i < queue.length; i++) {
    const idx = queue[i]!;
    const x = idx % CELLS;
    const y = (idx - x) / CELLS;
    const next = [
      x > 0 ? idx - 1 : -1,
      x < CELLS - 1 ? idx + 1 : -1,
      y > 0 ? idx - CELLS : -1,
      y < CELLS - 1 ? idx + CELLS : -1,
    ];
    for (const n of next) {
      if (n >= 0 && !seen[n] && costs[n] !== COST_IMPASSABLE) {
        seen[n] = 1;
        queue.push(n);
      }
    }
  }
  return seen;
}

/** First impassable cell touched by the straight segment between two cell centers, or null. */
function blockedCellOnSegment(costs: Uint8Array, a: Waypoint, b: Waypoint): Waypoint | null {
  const ax = a.ne + 0.5;
  const ay = a.se + 0.5;
  const steps = Math.max(1, Math.ceil(Math.hypot(b.ne - a.ne, b.se - a.se) * 20));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.floor(ax + (b.ne - a.ne) * t);
    const y = Math.floor(ay + (b.se - a.se) * t);
    if (costs[x + y * CELLS] === COST_IMPASSABLE) {
      return { ne: x, se: y };
    }
  }
  return null;
}

function randomWalkable(costs: Uint8Array, rand: () => number): Waypoint {
  for (;;) {
    const ne = Math.floor(rand() * CELLS);
    const se = Math.floor(rand() * CELLS);
    if (costs[ne + se * CELLS] !== COST_IMPASSABLE) {
      return { ne, se };
    }
  }
}

describe('getPath() waypoints stay on walkable cells', () => {
  for (const seed of [1, 7, 42, 1337, 9001]) {
    it(`seed ${seed}: every segment avoids impassable cells`, () => {
      const costs = makeCosts(seed);
      const pf = new Pathfinder();
      pf.addGrid(makeGrid(costs));
      const rand = makeRandom(seed * 31 + 5);

      for (let q = 0; q < 40; q++) {
        const start = randomWalkable(costs, rand);
        const target = randomWalkable(costs, rand);
        const canReach = reachable(costs, start)[target.ne + target.se * CELLS] === 1;
        const path = pf.getPath({ gridId: 0, start, target });
        const label = `seed=${seed} start=${start.ne},${start.se} target=${target.ne},${target.se}`;

        if (!canReach) {
          expect(path.result, label).not.toBe(PathResult.FOUND);
          continue;
        }

        expect(path.result, label).toBe(PathResult.FOUND);
        expect(path.waypoints[0], label).toEqual(start);
        expect(path.waypoints[path.waypoints.length - 1], label).toEqual(target);
        for (let i = 1; i < path.waypoints.length; i++) {
          const blocked = blockedCellOnSegment(costs, path.waypoints[i - 1]!, path.waypoints[i]!);
          expect(blocked, `${label} segment ${i}`).toBeNull();
        }
      }
    });
  }
});

describe('getFlowRoute() leads every unit on the route to the target', () => {
  for (const seed of [1, 7, 42, 1337, 9001]) {
    it(`seed ${seed}: next() reaches the target over walkable cells, also from other cells of the route`, () => {
      const costs = makeCosts(seed);
      const pf = new Pathfinder();
      pf.addGrid(makeGrid(costs));
      const rand = makeRandom(seed * 17 + 3);

      for (let q = 0; q < 25; q++) {
        const start = randomWalkable(costs, rand);
        const target = randomWalkable(costs, rand);
        const route = pf.getFlowRoute({ gridId: 0, start, target });
        const label = `seed=${seed} start=${start.ne},${start.se} target=${target.ne},${target.se}`;
        if (reachable(costs, start)[target.ne + target.se * CELLS] !== 1) {
          expect(route, label).toBeNull();
          continue;
        }
        expect(route, label).not.toBeNull();

        // the planned start, then any cell of the route's sectors the route reaches
        const sectors = new Set(route!.getSectorIds());
        const others: Waypoint[] = [];
        for (let tries = 0; tries < 400 && others.length < 8; tries++) {
          const cell = randomWalkable(costs, rand);
          const sector
            = Math.floor(cell.ne / SECTOR_SIZE) + Math.floor(cell.se / SECTOR_SIZE) * SECTORS;
          if (sectors.has(sector) && route!.next(cell.ne, cell.se)) {
            others.push(cell);
          }
        }
        for (const from of [start, ...others]) {
          const cells = followRoute(route!, from, CELLS * CELLS);
          expect(cells.at(-1), `${label} from=${from.ne},${from.se}`).toEqual(target);
          for (let i = 1; i < cells.length; i++) {
            expect(
              blockedCellOnSegment(costs, cells[i - 1]!, cells[i]!),
              `${label} from=${from.ne},${from.se} step ${i}`,
            ).toBeNull();
          }
        }
      }
    });
  }
});
