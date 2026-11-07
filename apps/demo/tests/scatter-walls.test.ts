import { describe, expect, it } from 'vitest';
import { CELL_SIZE, SCATTER_RADIUS, World } from '../src/world/world.js';

describe('scatter walls around the target', () => {
  it('returns false without a target', () => {
    const world = new World();
    world.resize(40, 40);
    expect(world.scatterWallsAroundTarget()).toBe(false);
  });

  it('stamps walls inside the scatter area and leaves the outside untouched', () => {
    const world = new World();
    world.resize(64, 64);
    // Corner target — the scatter area is clipped to the world bounds.
    const targetX = 3 * CELL_SIZE + 16;
    const targetY = 3 * CELL_SIZE + 16;
    expect(world.setTargetAt(targetX, targetY)).toBe(true);

    world.scatterWallsAroundTarget();

    const costs = world.getStaticCost();
    const cols = world.getCols();

    // The scatter box is clamped to the world, so walls exist inside…
    const minNe = Math.max(0, 3 - SCATTER_RADIUS);
    const maxNe = 3 + SCATTER_RADIUS;
    const minSe = Math.max(0, 3 - SCATTER_RADIUS);
    const maxSe = 3 + SCATTER_RADIUS;
    let wallsInside = 0;
    for (let se = minSe; se <= maxSe; se++) {
      for (let ne = minNe; ne <= maxNe; ne++) {
        if (costs[ne + se * cols] === 255) {
          wallsInside++;
        }
      }
    }
    // Overwhelmingly likely for a 16x16 scatter box at 22% density.
    expect(wallsInside).toBeGreaterThan(0);

    // …and cells far beyond the area stay untouched (COST_MIN).
    const farNe = 60;
    const farSe = 60;
    expect(costs[farNe + farSe * cols]).toBe(1);
    expect(Math.abs(farNe - 3)).toBeGreaterThan(SCATTER_RADIUS);
  });

  it('keeps the target cell and its neighbours free', () => {
    const world = new World();
    world.resize(64, 64);
    const targetX = 30 * CELL_SIZE + 16;
    const targetY = 30 * CELL_SIZE + 16;
    expect(world.setTargetAt(targetX, targetY)).toBe(true);

    world.scatterWallsAroundTarget();

    const costs = world.getStaticCost();
    const cols = world.getCols();
    for (const [dn, ds] of [
      [0, 0],
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const) {
      expect(costs[30 + dn + (30 + ds) * cols]).toBe(1); // COST_MIN
    }
  });

  it('carves a route from the target to a mob inside the area', () => {
    const world = new World();
    world.resize(64, 64);
    const targetX = 30 * CELL_SIZE + 16;
    const targetY = 30 * CELL_SIZE + 16;
    expect(world.setTargetAt(targetX, targetY)).toBe(true);

    const mobX = (30 - 8) * CELL_SIZE + 16;
    const mobY = (30 - 6) * CELL_SIZE + 16;
    world.addMob(mobX, mobY);

    world.scatterWallsAroundTarget();

    const costs = world.getStaticCost();
    const cols = world.getCols();
    const rows = world.getRows();

    // Breadth-first sweep from the target reaches the mob.
    const start = 30 + 30 * cols;
    const goal = 22 + 24 * cols;
    const visited = new Uint8Array(costs.length);
    visited[start] = 1;
    const queue = [start];
    while (queue.length > 0) {
      const idx = queue.shift()!;
      if (idx === goal) {
        break;
      }
      const ne = idx % cols;
      const se = Math.floor(idx / cols);
      for (const [dn, ds] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const) {
        const nn = ne + dn;
        const ns = se + ds;
        if (nn < 0 || ns < 0 || nn >= cols || ns >= rows) {
          continue;
        }
        const nIdx = nn + ns * cols;
        if (!visited[nIdx] && costs[nIdx] !== 255) {
          visited[nIdx] = 1;
          queue.push(nIdx);
        }
      }
    }
    expect(visited[goal]).toBe(1);
  });

  it('does not touch walls outside the scatter radius', () => {
    const world = new World();
    world.resize(64, 64);
    // Paint a wall far away from the target.
    const farNe = 58;
    const farSe = 58;
    world.paintWall(farNe * CELL_SIZE + 16, farSe * CELL_SIZE + 16);

    const targetX = 30 * CELL_SIZE + 16;
    const targetY = 30 * CELL_SIZE + 16;
    expect(world.setTargetAt(targetX, targetY)).toBe(true);

    world.scatterWallsAroundTarget();

    const costs = world.getStaticCost();
    const cols = world.getCols();
    expect(costs[farNe + farSe * cols]).toBe(255); // COST_IMPASSABLE
  });

  it('clears previous walls inside the area on regeneration', () => {
    const world = new World();
    world.resize(64, 64);
    const targetX = 30 * CELL_SIZE + 16;
    const targetY = 30 * CELL_SIZE + 16;
    expect(world.setTargetAt(targetX, targetY)).toBe(true);

    // Paint walls covering the whole scatter area first.
    for (let se = 30 - SCATTER_RADIUS; se <= 30 + SCATTER_RADIUS; se++) {
      for (let ne = 30 - SCATTER_RADIUS; ne <= 30 + SCATTER_RADIUS; ne++) {
        if (world.canPlaceWall(ne * CELL_SIZE + 16, se * CELL_SIZE + 16)) {
          world.paintWall(ne * CELL_SIZE + 16, se * CELL_SIZE + 16);
        }
      }
    }
    const before = world.getStaticCost().filter(c => c === 255).length;
    expect(before).toBeGreaterThan(0);

    world.scatterWallsAroundTarget();

    const after = world
      .getStaticCost()
      .slice(0, world.getCols() * world.getRows())
      .filter(c => c === 255).length;
    // The full wall sheet inside the area was replaced by ~22% density.
    expect(after).toBeLessThan(before);
  });
});
