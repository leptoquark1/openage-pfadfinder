import { describe, expect, it } from 'vitest';
import { CELL_SIZE, SECTOR_SIZE, World } from '../src/world/world.js';

/**
 * Dirty-sector tracking: a moving obstacle invalidates only the sectors under
 * it, everything else keeps its portals and cached fields. The tests pin
 * the incremental behavior — that the routes stay correct (a mob still
 * reaches its target) and that untouched sectors are not rebuilt.
 */
describe('incremental grid and flow updates', () => {
  it('keeps steering correct while obstacles move across cells', () => {
    const world = new World();
    world.resize(48, 32);
    world.setTargetAt(44 * CELL_SIZE + 16, 28 * CELL_SIZE + 16);

    const mobX = 4 * CELL_SIZE + 16;
    const mobY = 4 * CELL_SIZE + 16;
    world.addMob(mobX, mobY);

    // Obstacles scattered so their boxes cover several sectors.
    for (let i = 0; i < 4; i++) {
      world.addMovingObstacle((8 + i * 9) * CELL_SIZE + 16, (8 + i * 5) * CELL_SIZE + 16);
    }

    // Long run: every planning tick goes through the incremental path.
    // With random per-mob speed the arrival time varies, so the loop
    // runs until the target is reached, not for a fixed frame count.
    const mob = world.getMobs()[0]!;
    let reached = false;
    for (let i = 0; i < 4000 && !reached; i++) {
      world.step(50, i * 50);
      reached = Math.hypot(mob.x - (44 * CELL_SIZE + 16), mob.y - (28 * CELL_SIZE + 16)) < CELL_SIZE;
    }
    expect(reached).toBe(true);
  });

  it('reuses the cached field of a sector the obstacle did not touch', () => {
    const world = new World();
    world.resize(48, 32);
    world.setTargetAt(44 * CELL_SIZE + 16, 28 * CELL_SIZE + 16);
    world.addMob(2 * CELL_SIZE + 16, 2 * CELL_SIZE + 16);
    world.step(0, 1000);

    const farField = () =>
      world
        .getActiveRoutes()[0]!
        .getSteps()
        .find(step => step.sector.getId() === 0)!.flowField;
    const before = farField();

    // Plans again, but the far sector's costs stayed the same.
    world.addMovingObstacle(40 * CELL_SIZE + 16, 24 * CELL_SIZE + 16);
    world.step(0, 1200);

    expect(farField()).toBe(before);
  });

  it('drops the route and its overlay when a wall cuts the mob off', () => {
    const world = new World();
    world.resize(24, 24);
    world.setTargetAt(20 * CELL_SIZE + 16, 12 * CELL_SIZE + 16);
    world.addMob(3 * CELL_SIZE + 16, 3 * CELL_SIZE + 16);
    world.step(0, 1000);
    expect(world.getFlowOverlay().size).toBeGreaterThan(0);

    // A closed ring around the mob, inside its sector.
    for (let i = 1; i <= 5; i++) {
      for (const [ne, se] of [
        [i, 1],
        [i, 5],
        [1, i],
        [5, i],
      ] as const) {
        world.paintWall(ne * CELL_SIZE + 16, se * CELL_SIZE + 16);
      }
    }
    expect(SECTOR_SIZE).toBeGreaterThan(5);
    world.step(0, 1200);

    expect(world.getStats().blocked).toBe(1);
    expect(world.getActiveRoutes()).toEqual([]);
    expect(world.getFlowOverlay().size).toBe(0);
  });
});
