import { COST_IMPASSABLE, COST_MIN } from '@leptoquark1/openage-pfadfinder/shared';
import type { ChapterId } from './timeline.js';

export const SECTOR_SIZE = 6;
export const SECTORS_X = 4;
export const SECTORS_Y = 3;
export const COLS = SECTORS_X * SECTOR_SIZE;
export const ROWS = SECTORS_Y * SECTOR_SIZE;
/** Passable but expensive terrain. */
export const COST_MUD = 6;

export interface Cell {
  readonly ne: number;
  readonly se: number;
}

export interface Scenario {
  readonly id: string;
  readonly name: string;
  /** What makes this map different from the others. */
  readonly hint: string;
  /** The chapter where that difference shows best. */
  readonly watch: ChapterId;
  readonly costs: Uint8Array;
  readonly start: Cell;
  readonly target: Cell;
}

export const cellIndex = (cell: Cell): number => cell.ne + cell.se * COLS;

export const inMap = (cell: Cell): boolean => cell.ne >= 0 && cell.se >= 0 && cell.ne < COLS && cell.se < ROWS;

const sameCell = (a: Cell, b: Cell): boolean => a.ne === b.ne && a.se === b.se;

/** Maps are drawn as text: `#` wall, `~` mud, `.` free, `S` start, `T` target. */
function scenario(id: string, name: string, hint: string, watch: ChapterId, rows: readonly string[]): Scenario {
  if (rows.length !== ROWS || rows.some(row => row.length !== COLS)) {
    throw new Error(`scenario ${id} must be ${COLS}x${ROWS}`);
  }
  const costs = new Uint8Array(COLS * ROWS).fill(COST_MIN);
  let start: Cell | null = null;
  let target: Cell | null = null;
  rows.forEach((row, se) => {
    [...row].forEach((char, ne) => {
      if (char === '#') {
        costs[ne + se * COLS] = COST_IMPASSABLE;
      } else if (char === '~') {
        costs[ne + se * COLS] = COST_MUD;
      } else if (char === 'S') {
        start = { ne, se };
      } else if (char === 'T') {
        target = { ne, se };
      }
    });
  });
  if (!start || !target) {
    throw new Error(`scenario ${id} needs a start and a target`);
  }
  return { id, name, hint, watch, costs, start, target };
}

export const SCENARIOS: readonly Scenario[] = [
  scenario(
    'fortress',
    'Fortress',
    'The all-rounder. Walls, gates and mud force a winding route across many sectors.',
    'search',
    [
      '........................',
      '.S....#.......#.........',
      '......#.......#...~~~...',
      '..#####...###.#...~~~...',
      '......#...#...#.........',
      '......#...#...#####.....',
      '...~~~....#.........#...',
      '...~~~....#..~~~....#...',
      '.........##..~~~....#...',
      '..####....#..~~~...##...',
      '.....#....#.........#...',
      '.....#....######....#...',
      '.....#.........#....#...',
      '~~~..#..###....#..###...',
      '~~~.....#......#......T.',
      '~~~.....#..~~~.#........',
      '........#..~~~.#........',
      '........................',
    ],
  ),
  scenario(
    'split',
    'Split sector',
    'Start and target share a sector, but a wall divides it, so the route has to leave and come back.',
    'areas',
    [
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........#...............',
      '........#...............',
      '.......S#.T.............',
      '........#...............',
      '........#...............',
      '........#...............',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
    ],
  ),
  scenario(
    'swamp',
    'Swamp',
    'Portal A* counts distance, not terrain. The route wades through mud although a dry detour exists.',
    'route',
    [
      '........................',
      '.S......................',
      '........................',
      '........................',
      '~~~~~~~~~~~~~~~~~~~~....',
      '~~~~~~~~~~~~~~~~~~~~....',
      '~~~~~~~~~~~~~~~~~~~~....',
      '~~~~~~~~~~~~~~~~~~~~....',
      '........................',
      '........................',
      '....~~~~~~~~~~~~~~~~~~~~',
      '....~~~~~~~~~~~~~~~~~~~~',
      '....~~~~~~~~~~~~~~~~~~~~',
      '....~~~~~~~~~~~~~~~~~~~~',
      '........................',
      '......................T.',
      '........................',
      '........................',
    ],
  ),
  scenario(
    'maze',
    'Labyrinth',
    'Corridors split most sectors into several areas. The portal graph gets dense and the route doubles back.',
    'graph',
    [
      '.S.#.....#.......#......',
      '...#.###.#.#####.#.####.',
      '.###.#...#.#.....#....#.',
      '.....#.###.#.#######.##.',
      '.#####.....#.#.......#..',
      '.#.....#####.#.#####.#.#',
      '.#.#####.....#.#...#.#..',
      '.#.....#.#####.#.#.#.##.',
      '.#####.#.#.....#.#.#....',
      '.....#.#.#.#####.#.####.',
      '####.#.#.#.....#.#....#.',
      '...#.#.#.#####.#.####.#.',
      '.#.#.#.#.....#.#....#.#.',
      '.#.#.#.#####.#.####.#.#.',
      '.#...#.......#....#.#.#.',
      '.#################.#.#..',
      '.....................#T.',
      '........................',
    ],
  ),
  scenario(
    'open',
    'Open field',
    'No obstacles, the simplest case. In the target sector, the line-of-sight wave does all the work.',
    'target',
    [
      '........................',
      '........................',
      '..S.....................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '.....................T..',
      '........................',
      '........................',
    ],
  ),
  scenario(
    'sealed',
    'Sealed',
    'The target is walled in, so no route exists. The search runs out of portals and gives up.',
    'search',
    [
      '........................',
      '.S......................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '..............#######...',
      '..............#.....#...',
      '..............#.....#...',
      '..............#..T..#...',
      '..............#.....#...',
      '..............#######...',
      '........................',
      '........................',
      '........................',
    ],
  ),
];

/** The scenario with a new cost on one cell; unchanged when the cell holds a pin. */
export function withCost(base: Scenario, cell: Cell, cost: number): Scenario {
  if (!inMap(cell) || sameCell(cell, base.start) || sameCell(cell, base.target)) {
    return base;
  }
  if (base.costs[cellIndex(cell)] === cost) {
    return base;
  }
  const costs = base.costs.slice();
  costs[cellIndex(cell)] = cost;
  return { ...base, costs };
}

/** The scenario with a pin moved; unchanged when the cell is blocked or holds the other pin. */
export function withPin(base: Scenario, pin: 'start' | 'target', cell: Cell): Scenario {
  const other = pin === 'start' ? base.target : base.start;
  if (!inMap(cell) || sameCell(cell, other) || sameCell(cell, base[pin])) {
    return base;
  }
  if (base.costs[cellIndex(cell)] === COST_IMPASSABLE) {
    return base;
  }
  return { ...base, [pin]: { ne: cell.ne, se: cell.se } };
}

/** Whether two maps differ in terrain or pins, so an edit that was undone by hand counts as none. */
export function differsFrom(a: Scenario, b: Scenario): boolean {
  return !sameCell(a.start, b.start) || !sameCell(a.target, b.target) || a.costs.some((cost, i) => cost !== b.costs[i]);
}
