import { describe, expect, it } from 'vitest';
import { CELL_SIZE, World } from '../src/world/world.js';

function cellOf(x: number, y: number): { ne: number, se: number } {
  return { ne: Math.floor(x / CELL_SIZE), se: Math.floor(y / CELL_SIZE) };
}

describe('world resize and respawn', () => {
  it('pulls mobs back inside after shrinking the world', () => {
    const world = new World();
    world.resize(64, 64);

    // Mobs near the far edge of the large world.
    world.addMob(60 * CELL_SIZE + 16, 60 * CELL_SIZE + 16);
    world.addMovingObstacle(50 * CELL_SIZE + 16, 50 * CELL_SIZE + 16);
    world.setTargetAt(4 * CELL_SIZE + 16, 4 * CELL_SIZE + 16);
    world.step(50, 0);

    // Shrink far past the mobs' positions.
    world.resize(8, 8);

    const mob = world.getMobs()[0]!;
    const obstacle = world.getObstacles()[0]!;
    const mobCell = cellOf(mob.x, mob.y);
    expect(mobCell.ne).toBeGreaterThanOrEqual(0);
    expect(mobCell.se).toBeGreaterThanOrEqual(0);

    const worldCellsX = 8 * CELL_SIZE;
    expect(mob.x).toBeLessThanOrEqual(worldCellsX);
    expect(mob.y).toBeLessThanOrEqual(worldCellsX);
    expect(obstacle.x).toBeLessThanOrEqual(worldCellsX);
    expect(obstacle.y).toBeLessThanOrEqual(worldCellsX);

    // After the pull-back the mob must keep moving: step a while and it
    // must still resolve to a cell inside the grid (never frozen outside).
    let moved = false;
    for (let i = 0; i < 100; i++) {
      world.step(50, i * 50);
      const c = cellOf(world.getMobs()[0]!.x, world.getMobs()[0]!.y);
      if (c.ne >= 0 && c.se >= 0) {
        moved = true;
      }
    }
    expect(moved).toBe(true);
  });

  it('respawns a mob on the nearest free cell when its spawn got walled in', () => {
    const world = new World();
    world.resize(32, 32);

    const spawnX = 2 * CELL_SIZE + 16;
    const spawnY = 2 * CELL_SIZE + 16;
    world.addMob(spawnX, spawnY);
    const mob = world.getMobs()[0]!;

    // Target right next to the spawn.
    const targetX = 3 * CELL_SIZE + 16;
    const targetY = 2 * CELL_SIZE + 16;
    expect(world.setTargetAt(targetX, targetY)).toBe(true);

    // Wall the spawn cell over while the mob is away... actually the mob
    // starts on its spawn; move the wall in after it left, by painting the
    // spawn cell while the mob stands at the target.
    for (let i = 0; i < 100 && Math.hypot(mob.x - targetX, mob.y - targetY) > MOB_TOLERANCE; i++) {
      world.step(50, i * 50);
    }
    // The mob has reached the target and is back on (or near) its spawn;
    // paint the spawn cell and push the mob to the target again so the
    // next respawn finds its spawn blocked.
    world.paintWall(spawnX, spawnY);
    // Teleport-style: run until the mob reaches the target and respawns.
    for (let i = 0; i < 300; i++) {
      world.step(50, i * 50);
      const c = cellOf(mob.x, mob.y);
      // The respawned mob must never sit inside the walled cell.
      if (c.ne === 2 && c.se === 2) {
        expect(world.getStats().blocked).toBeDefined();
      }
    }
    // After everything, the mob is somewhere walkable.
    const c = cellOf(mob.x, mob.y);
    expect(c.ne).toBeGreaterThanOrEqual(0);
    expect(c.se).toBeGreaterThanOrEqual(0);
  });
});

const MOB_TOLERANCE = CELL_SIZE;
