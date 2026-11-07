import { describe, expect, it } from 'vitest';
import { CELL_SIZE, World } from '../src/world/world.js';

describe('labyrinth generation', () => {
  it('creates walls and a connected corridor system', () => {
    const world = new World();
    world.resize(33, 33);
    world.generateLabyrinth();

    // A perfect maze carves every odd/odd lattice cell…
    const costs = world.getStaticCost();
    const cols = world.getCols();
    for (let se = 1; se < 33; se += 2) {
      for (let ne = 1; ne < 33; ne += 2) {
        expect(costs[ne + se * cols]).toBe(1); // COST_MIN
      }
    }

    // …and leaves the even rows/columns as wall skeleton somewhere.
    let walls = 0;
    for (let i = 0; i < costs.length; i++) {
      if (costs[i] === 255) {
        walls++;
      }
    }
    expect(walls).toBeGreaterThan(0);

    // Every free cell reaches every other free cell — a single component.
    const freeIdx: number[] = [];
    for (let i = 0; i < costs.length; i++) {
      if (costs[i] !== 255) {
        freeIdx.push(i);
      }
    }
    const visited = new Uint8Array(costs.length);
    const queue = [freeIdx[0]!];
    visited[queue[0]!] = 1;
    while (queue.length > 0) {
      const idx = queue.shift()!;
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
        if (nn < 0 || ns < 0 || nn >= cols || ns >= world.getRows()) {
          continue;
        }
        const nIdx = nn + ns * cols;
        if (!visited[nIdx] && costs[nIdx] !== 255) {
          visited[nIdx] = 1;
          queue.push(nIdx);
        }
      }
    }
    for (const idx of freeIdx) {
      expect(visited[idx]).toBe(1);
    }
  });

  it('keeps the target and mob cells free with a connected pocket', () => {
    const world = new World();
    world.resize(33, 33);

    const mobX = 5 * CELL_SIZE + 16;
    const mobY = 5 * CELL_SIZE + 16;
    world.addMob(mobX, mobY);
    const targetX = 27 * CELL_SIZE + 16;
    const targetY = 27 * CELL_SIZE + 16;
    expect(world.setTargetAt(targetX, targetY)).toBe(true);

    world.generateLabyrinth();

    const costs = world.getStaticCost();
    const cols = world.getCols();
    const rows = world.getRows();

    // Both object cells stay free…
    const mobCell = { ne: Math.floor(mobX / CELL_SIZE), se: Math.floor(mobY / CELL_SIZE) };
    const targetCell = { ne: Math.floor(targetX / CELL_SIZE), se: Math.floor(targetY / CELL_SIZE) };
    expect(costs[mobCell.ne + mobCell.se * cols]).toBe(1); // COST_MIN
    expect(costs[targetCell.ne + targetCell.se * cols]).toBe(1); // COST_MIN

    // …and one breadth-first sweep over the free cells connects them: the
    // cleared pockets around the objects open into the corridor system.
    const start = mobCell.ne + mobCell.se * cols;
    const goal = targetCell.ne + targetCell.se * cols;
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

  it('clears the previous walls on regeneration', () => {
    const world = new World();
    world.resize(33, 33);
    world.generateLabyrinth();
    const before = world.getStaticCost().join(',');
    world.generateLabyrinth();
    const after = world.getStaticCost().join(',');
    // Randomized runs differ (overwhelmingly likely for a 16x16 lattice).
    expect(before).not.toBe(after);
  });
});
