import { describe, expect, it } from 'vitest';
import { CELL_SIZE, SECTOR_SIZE, World } from '../src/world/world.js';

/**
 * Dirty-sector tracking: a moving obstacle invalidates only the sectors under
 * it, everything else keeps its portals, components and flow cells. The tests
 * pin the incremental behavior — that the flow stays correct (a mob still
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

  it('reuses flow cells of sectors the obstacle did not touch', () => {
    const world = new World();
    world.resize(48, 32);
    world.setTargetAt(44 * CELL_SIZE + 16, 28 * CELL_SIZE + 16);
    for (let i = 0; i < 60; i++) {
      world.step(16, i * 16);
    }

    // Pin the cells of a far-away sector, then move an obstacle elsewhere.
    const flows = world.getFlowFields();
    const farSectorId = 0;
    const before = flows.get(farSectorId)!.cells.slice();

    const obstacleX = 40 * CELL_SIZE + 16;
    world.addMovingObstacle(obstacleX, 24 * CELL_SIZE + 16);
    for (let i = 0; i < 30; i++) {
      world.step(16, (60 + i) * 16);
    }

    const after = flows.get(farSectorId)!.cells;
    expect(after).toEqual(before);
  });

  it('clears flow cells when a wall cuts a component off from its route', () => {
    const world = new World();
    world.resize(24, 24);
    world.setTargetAt(20 * CELL_SIZE + 16, 12 * CELL_SIZE + 16);
    for (let i = 0; i < 20; i++) {
      world.step(16, i * 16);
    }

    // Wall off the top-left sector completely: its component loses every
    // route, so its flow cells must be cleared instead of keeping stale
    // directions.
    for (let se = 0; se < SECTOR_SIZE; se++) {
      for (let ne = 0; ne < SECTOR_SIZE; ne++) {
        world.paintWall(ne * CELL_SIZE + 16, se * CELL_SIZE + 16);
      }
    }
    for (let i = 0; i < 12; i++) {
      world.step(16, (20 + i) * 16);
    }

    const flow = world.getFlowFields().get(0)!;
    const pathable = flow.cells.some(c => (c & 0x10) !== 0);
    expect(pathable).toBe(false);
  });
});
