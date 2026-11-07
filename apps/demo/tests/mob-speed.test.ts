import { describe, expect, it } from 'vitest';
import { CELL_SIZE, World } from '../src/world/world.js';

describe('random mob speed', () => {
  it('assigns every mob an individual speed inside the valid range', () => {
    const world = new World();
    world.resize(64, 64);

    for (let i = 0; i < 32; i++) {
      world.addMob(i * CELL_SIZE + 16, 16);
    }

    const mobs = world.getMobs();
    expect(mobs.length).toBe(32);
    const speeds = new Set<number>();
    for (const mob of mobs) {
      expect(mob.speed).toBeGreaterThanOrEqual(70);
      expect(mob.speed).toBeLessThanOrEqual(160);
      speeds.add(mob.speed);
    }
    // 32 random draws from a continuous range: distinct values throughout.
    expect(speeds.size).toBe(32);
  });
});
