import { describe, expect, it } from 'vitest';
import { moveWithWalls, pushOut, resolveWalls } from '../src/collision/walls.ts';
import { GridNavigation } from '../src/navigation.ts';
import { fallbackDirection } from '../src/steering/fallback.ts';
import { Separation } from '../src/steering/separation.ts';
import { anyInWall, contextOf, minGap, openWorld, runUntil, simulation, worldFromRows } from './helpers.ts';

const ROOM = [
  '################',
  '#..............#',
  '#..............#',
  '#......#.......#',
  '#..............#',
  '################',
];

describe('walls', () => {
  const nav = new GridNavigation(worldFromRows(ROOM, 8).grid);

  it('pushes a circle out of an edge and slides along it', () => {
    const pos = { x: 3.5, y: 1.2 }; // body reaches into the top wall (y < 1)
    const vel = { x: 1, y: -1 };
    expect(resolveWalls(nav, pos, vel, 0.4)).toBe(true);
    expect(pos.y).toBeCloseTo(1.4);
    expect(pos.x).toBeCloseTo(3.5);
    expect(vel).toEqual({ x: 1, y: 0 }); // the component into the wall is gone
  });

  it('pushes a circle out of a corner diagonally', () => {
    // wall cell (7, 3); the circle touches its top-left corner (7, 3)
    const pos = { x: 6.85, y: 2.85 };
    resolveWalls(nav, pos, null, 0.4);
    const d = Math.hypot(pos.x - 7, pos.y - 3);
    expect(d).toBeCloseTo(0.4);
    expect(pos.x - 6.85).toBeCloseTo(pos.y - 2.85); // along the diagonal
  });

  it('leaves a free circle alone', () => {
    const pos = { x: 4.5, y: 2.5 };
    expect(resolveWalls(nav, pos, null, 0.4)).toBe(false);
    expect(pos).toEqual({ x: 4.5, y: 2.5 });
  });

  it('handles a center exactly on a wall border', () => {
    const pos = { x: 8, y: 3.5 }; // right border of the wall cell (7, 3)
    resolveWalls(nav, pos, null, 0.4);
    expect(pos.x).toBeCloseTo(8.4);
  });

  it('moves a center inside a wall to the nearest free point', () => {
    const pos = { x: 7.5, y: 3.5 };
    expect(pushOut(nav, pos)).toBe(true);
    expect(nav.isBlocked(Math.floor(pos.x), Math.floor(pos.y))).toBe(false);
    expect(Math.hypot(pos.x - 7.5, pos.y - 3.5)).toBeCloseTo(0.5, 2);
    const outside = { x: -3, y: 2.5 };
    resolveWalls(nav, outside, null, 0.4);
    expect(nav.isBlocked(Math.floor(outside.x), Math.floor(outside.y))).toBe(false);
  });

  it('pushes a center out on the side it is nearest to, not in search order', () => {
    // wall cell (7, 3): just inside its west and north sides
    const west = { x: 7.2, y: 3.5 };
    pushOut(nav, west);
    expect(west.x).toBeLessThan(7);
    expect(west.y).toBeCloseTo(3.5);
    const north = { x: 7.5, y: 3.1 };
    pushOut(nav, north);
    expect(north.y).toBeLessThan(3);
    expect(north.x).toBeCloseTo(7.5);
  });

  it('gives up when no free cell is near', () => {
    const solid = new GridNavigation(worldFromRows(Array(8).fill('########'), 8).grid);
    const pos = { x: 3.5, y: 3.5 };
    expect(pushOut(solid, pos)).toBe(false);
    expect(pos).toEqual({ x: 3.5, y: 3.5 });
  });

  it('does not tunnel through a wall one cell thick on a long move', () => {
    const pos = { x: 6.5, y: 3.5 };
    moveWithWalls(nav, pos, null, 0.3, 3, 0); // would end at 9.5, behind the wall cell
    expect(pos.x).toBeLessThan(7);
  });
});

describe('agents and walls in the simulation', () => {
  it('keeps agents out of the walls, also around corners', () => {
    const world = worldFromRows(
      [
        '################',
        '#..............#',
        '#.######.......#',
        '#.#....#.......#',
        '#.#.##.#.......#',
        '#...#..........#',
        '################',
      ],
      8,
    );
    const sim = simulation(world);
    const ids = [0, 1, 2, 3].map(k =>
      sim.addAgent({ position: { x: 1.5, y: 1.5 + k * 0.1 }, radius: 0.35, maxSpeed: 3, goal: { ne: 5, se: 3 } }),
    );
    let inWall = false;
    runUntil(
      sim,
      () => {
        inWall ||= anyInWall(sim);
        return ids.every(id => sim.getState(id) === 'ARRIVED');
      },
      2000,
    );
    expect(ids.map(id => sim.getState(id))).toEqual(['ARRIVED', 'ARRIVED', 'ARRIVED', 'ARRIVED']);
    expect(inWall).toBe(false);
  });

  it('spawns and teleports out of walls', () => {
    const sim = simulation(worldFromRows(ROOM, 8));
    const id = sim.addAgent({ position: { x: 7.5, y: 3.5 }, radius: 0.4, maxSpeed: 1 });
    expect(anyInWall(sim)).toBe(false);
    sim.teleport(id, { x: 0.2, y: 0.2 });
    expect(anyInWall(sim)).toBe(false);
  });

  it('pushes agents out of terrain painted on top of them', () => {
    const sim = simulation(worldFromRows(ROOM, 8));
    const id = sim.addAgent({ position: { x: 4.5, y: 2.5 }, radius: 0.4, maxSpeed: 1 });
    sim.applyTerrain([{ ne: 4, se: 2, cost: 255 }]);
    sim.step();
    expect(anyInWall(sim)).toBe(false);
    expect(sim.getPosition(id)).not.toEqual({ x: 4.5, y: 2.5 });
  });
});

describe('Separation', () => {
  it('pushes nearly touching agents apart, harder the closer', () => {
    const sep = new Separation();
    const push = (dx: number) => {
      const { ctx, neighborsOf } = contextOf([
        { x: 0, y: 0, r: 0.4 },
        { x: dx, y: 0, r: 0.4 },
      ]);
      const out = { x: 0, y: 0 };
      sep.accumulate(ctx, 0, neighborsOf(0), out);
      return out.x;
    };
    expect(push(1.5)).toBe(0); // gap 0.7 > range
    expect(push(0.9)).toBeLessThan(0);
    expect(push(0.6)).toBeLessThan(push(0.9)); // overlap: stronger, away from the other (-x)
    expect(push(0.0001)).toBeGreaterThanOrEqual(-16);
  });

  it('splits agents on the same spot deterministically, in opposite directions', () => {
    const { ctx, neighborsOf } = contextOf([
      { x: 1, y: 1 },
      { x: 1, y: 1 },
    ]);
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 0 };
    new Separation().accumulate(ctx, 0, neighborsOf(0), a);
    new Separation().accumulate(ctx, 1, neighborsOf(1), b);
    expect(Math.hypot(a.x, a.y)).toBeGreaterThan(0);
    expect(a.x).toBeCloseTo(-b.x);
    expect(a.y).toBeCloseTo(-b.y);
  });

  it('derives the fallback direction from the id pair only', () => {
    const d1 = fallbackDirection(3, 9, { x: 0, y: 0 });
    const d2 = fallbackDirection(9, 3, { x: 0, y: 0 });
    expect(Math.hypot(d1.x, d1.y)).toBeCloseTo(1);
    expect(d1.x).toBeCloseTo(-d2.x);
    expect(fallbackDirection(3, 9, { x: 0, y: 0 })).toEqual(d1);
  });
});

describe('OverlapResolver', () => {
  it('leaves no lasting overlap in a dense packing', () => {
    const sim = simulation(openWorld(16, 16));
    for (let k = 0; k < 30; k++) {
      // all on almost the same spot, three exactly on it
      sim.addAgent({ position: { x: 8 + (k % 5) * 0.05, y: 8 + Math.floor(k / 10) * 0.05 }, radius: 0.4, maxSpeed: 1 });
    }
    for (let t = 0; t < 60; t++) {
      sim.step();
    }
    expect(minGap(sim)).toBeGreaterThan(-0.02);
  });

  it('resolves three agents pressed together in a bottleneck without pushing them into walls', () => {
    const world = worldFromRows(['################', '#######.########', '################'], 8);
    const sim = simulation(world, { forces: [] });
    for (const x of [7.4, 7.5, 7.6]) {
      sim.addAgent({ position: { x, y: 1.5 }, radius: 0.3, maxSpeed: 1 });
    }
    sim.step();
    expect(anyInWall(sim, 1e-3)).toBe(false);
  });

  it('does not push an agent through a wall one cell thick', () => {
    // a wall across the whole room at ne = 5: no way around it
    const world = worldFromRows(
      ['################', '#....#.........#', '#....#.........#', '#....#.........#', '################'],
      8,
    );
    const sim = simulation(world, { forces: [], preferredModifiers: [] });
    // three neighbors on its west side push the front agent towards +ne,
    // together by more than the distance to the wall
    const front = sim.addAgent({ position: { x: 4.55, y: 2.5 }, radius: 0.45, maxSpeed: 1 });
    for (const y of [2.45, 2.5, 2.55]) {
      sim.addAgent({ position: { x: 4.2, y }, radius: 0.45, maxSpeed: 1 });
    }
    sim.step();
    expect(sim.getPosition(front).x).toBeLessThan(5);
    expect(anyInWall(sim, 1e-3)).toBe(false);
  });

  it('can be turned off', () => {
    const sim = simulation(openWorld(16, 16), { overlap: null, forces: [] });
    sim.addAgent({ position: { x: 8, y: 8 }, radius: 0.4, maxSpeed: 1 });
    sim.addAgent({ position: { x: 8.2, y: 8 }, radius: 0.4, maxSpeed: 1 });
    sim.step();
    expect(minGap(sim)).toBeLessThan(-0.5);
  });
});
