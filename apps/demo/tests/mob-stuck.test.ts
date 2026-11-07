import { describe, expect, it } from 'vitest';
import { CELL_SIZE, World } from '../src/world/world.js';

function cellOf(x: number, y: number): { ne: number, se: number } {
  return { ne: Math.floor(x / CELL_SIZE), se: Math.floor(y / CELL_SIZE) };
}

describe('mob stuck in blocked cells', () => {
  it('does not enter a wall painted ahead of it and still reaches the target', () => {
    const world = new World();
    world.resize(16, 16);

    const mobX = 2 * CELL_SIZE + 16;
    const mobY = 2 * CELL_SIZE + 16;
    world.addMob(mobX, mobY);

    const targetX = 6 * CELL_SIZE + 16;
    const targetY = 2 * CELL_SIZE + 16;
    expect(world.setTargetAt(targetX, targetY)).toBe(true);

    // Wall directly east of the mob, on its flow path to the target.
    const wallNe = 4;
    const wallSe = 2;
    world.paintWall(wallNe * CELL_SIZE + 16, wallSe * CELL_SIZE + 16);

    const seenCells = new Set<string>();
    let reachedTarget = false;
    // Step until the mob has completed one full run to the target — with
    // random per-mob speed the arrival time varies, so a fixed frame count
    // would race the respawn cycle.
    for (let i = 0; i < 4000 && !reachedTarget; i++) {
      world.step(50, i * 50);
      const mob = world.getMobs()[0]!;
      const cell = cellOf(mob.x, mob.y);
      seenCells.add(`${cell.ne}:${cell.se}`);
      if (Math.hypot(mob.x - targetX, mob.y - targetY) < CELL_SIZE) {
        reachedTarget = true;
      }
    }

    expect(seenCells.has(`${wallNe}:${wallSe}`)).toBe(false);
    expect(reachedTarget).toBe(true);
  });

  it('escapes a cell covered by a moving obstacle instead of freezing', () => {
    const world = new World();
    world.resize(16, 16);

    const mobX = 4 * CELL_SIZE + 16;
    const mobY = 4 * CELL_SIZE + 16;
    world.addMob(mobX, mobY);

    const targetX = 12 * CELL_SIZE + 16;
    const targetY = 4 * CELL_SIZE + 16;
    expect(world.setTargetAt(targetX, targetY)).toBe(true);

    // Spawn the obstacle away from the mob, then drift it over the mob's
    // cell — the overrun that used to freeze the mob for good.
    world.addMovingObstacle(8 * CELL_SIZE + 16, 12 * CELL_SIZE + 16);
    const obstacle = world.getObstacles()[0]!;
    const mob = world.getMobs()[0]!;
    const startX = mob.x;
    const startY = mob.y;

    for (let i = 0; i < 400; i++) {
      // Pin the obstacle over the mob's starting cell every frame. The
      // escape distance scales with the mob's random speed, so keep
      // stepping until the mob has clearly left the cell.
      obstacle.x = startX;
      obstacle.y = startY;
      world.step(50, i * 50);
      if (Math.hypot(mob.x - startX, mob.y - startY) > CELL_SIZE) {
        break;
      }
    }

    expect(Math.hypot(mob.x - startX, mob.y - startY)).toBeGreaterThan(CELL_SIZE);
  });
});
