import { Pathfinder } from '@leptoquark1/openage-pfadfinder';
import { describe, expect, it } from 'vitest';
import { CELL_SIZE, World } from '../src/world/world.js';

const px = (cell: number) => cell * CELL_SIZE + CELL_SIZE / 2;

/** Run until the mob has been sent back to its spawn, which marks an arrival. */
function arrives(world: World, frames: number): boolean {
  const mob = world.getMobs()[0]!;
  let left = false;
  for (let i = 0; i < frames; i++) {
    world.step(16, 1000 + i * 16);
    const home = mob.x === mob.spawnX && mob.y === mob.spawnY;
    if (!home) {
      left = true;
    } else if (left) {
      return true;
    }
  }
  return false;
}

describe('the playground follows the library routes', () => {
  it('crosses a sector corner whose two ways around cost the same', () => {
    // Four sectors meet at a single open corner, so the portals on each side
    // of it share a centre cell and both ways around are equally long.
    const open = new Set<number>();
    for (let ne = 4; ne <= 7; ne++) {
      open.add(ne + 7 * 16);
    }
    open.add(8 + 7 * 16);
    open.add(7 + 8 * 16);
    for (let ne = 8; ne <= 12; ne++) {
      open.add(ne + 8 * 16);
    }

    const world = new World();
    world.resize(16, 16);
    for (let idx = 0; idx < 16 * 16; idx++) {
      if (!open.has(idx)) {
        world.paintWall(px(idx % 16), px(Math.floor(idx / 16)));
      }
    }
    expect(world.setTargetAt(px(12), px(8))).toBe(true);
    world.addMob(px(4), px(7));

    expect(arrives(world, 1500)).toBe(true);
  });

  it('does not report a route longer than 256 cells as blocked', () => {
    // A serpentine: every odd row is a wall with one gap, alternating sides.
    const size = 64;
    const world = new World();
    world.resize(size, size);
    for (let se = 1; se < size; se += 2) {
      const gap = (se - 1) % 4 === 0 ? size - 1 : 0;
      for (let ne = 0; ne < size; ne++) {
        if (ne !== gap) {
          world.paintWall(px(ne), px(se));
        }
      }
    }
    expect(world.setTargetAt(px(63), px(62))).toBe(true);
    world.addMob(px(0), px(0));
    world.step(0, 1000);

    const mob = world.getMobs()[0]!;
    expect(mob.blocked).toBe(false);
    expect(mob.trace.length).toBeGreaterThan(256);
    expect(mob.trace[mob.trace.length - 1]).toEqual({ ne: 63, se: 62 });
  });

  it('steers along the route the pathfinder plans', () => {
    const world = new World();
    world.resize(32, 16);
    expect(world.setTargetAt(px(28), px(4))).toBe(true);
    world.addMob(px(2), px(12));
    world.step(0, 1000);

    const start = { ne: 2, se: 12 };
    const target = { ne: 28, se: 4 };
    const pathfinder = new Pathfinder();
    pathfinder.addGrid(world.getGrid()!);
    const route = pathfinder.getFlowRoute({ gridId: 0, start, target })!;

    const expected = [start];
    for (let cell = route.next(start.ne, start.se); cell; cell = route.next(cell.ne, cell.se)) {
      expected.push(cell);
    }
    expect(world.getMobs()[0]!.trace).toEqual(expected);
  });

  it('shares one route between mobs in the same sector area', () => {
    const world = new World();
    world.resize(32, 16);
    expect(world.setTargetAt(px(28), px(4))).toBe(true);
    world.addMob(px(1), px(1));
    world.addMob(px(5), px(5));
    world.addMob(px(20), px(12));
    world.step(0, 1000);

    const [a, b, c] = world.getMobs();
    expect(a!.route).not.toBeNull();
    expect(b!.route).toBe(a!.route);
    expect(c!.route).not.toBe(a!.route);
    expect(world.getActiveRoutes()).toHaveLength(2);
  });

  it('draws only the sectors of routes in use', () => {
    const world = new World();
    world.resize(32, 32);
    expect(world.setTargetAt(px(12), px(4))).toBe(true);
    world.step(0, 1000);
    expect(world.getFlowOverlay().size).toBe(0);

    world.addMob(px(2), px(4));
    world.step(0, 1200);

    const route = world.getActiveRoutes()[0]!;
    expect([...world.getFlowOverlay().keys()].sort((x, y) => x - y)).toEqual(
      [...route.getSectorIds()].sort((x, y) => x - y),
    );
  });
});
