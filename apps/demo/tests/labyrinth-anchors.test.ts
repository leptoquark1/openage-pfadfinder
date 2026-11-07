import { COST_IMPASSABLE } from '@leptoquark1/openage-pfadfinder/shared';
import { describe, expect, it } from 'vitest';
import { CELL_SIZE, MOB_RADIUS, World } from '../src/world/world.js';

function px(cell: number): number {
  return cell * CELL_SIZE + CELL_SIZE / 2;
}

/** Free cells reachable from `start`, 4-connected. */
function reachable(world: World, start: { ne: number, se: number }): Uint8Array {
  const cols = world.getCols();
  const rows = world.getRows();
  const costs = world.getStaticCost();
  const seen = new Uint8Array(cols * rows);
  const queue = [start.ne + start.se * cols];
  seen[queue[0]!] = 1;
  while (queue.length > 0) {
    const idx = queue.pop()!;
    const ne = idx % cols;
    const se = Math.floor(idx / cols);
    for (const [n, s] of [[ne - 1, se], [ne + 1, se], [ne, se - 1], [ne, se + 1]] as const) {
      if (n < 0 || s < 0 || n >= cols || s >= rows) {
        continue;
      }
      const next = n + s * cols;
      if (seen[next] || costs[next] === COST_IMPASSABLE) {
        continue;
      }
      seen[next] = 1;
      queue.push(next);
    }
  }
  return seen;
}

/** Cells a mob's body overlaps at its current position, plus its spawn cell. */
function mobCells(world: World): { ne: number, se: number }[] {
  const cells: { ne: number, se: number }[] = [];
  for (const mob of world.getMobs()) {
    for (const [x, y] of [
      [mob.x - MOB_RADIUS, mob.y - MOB_RADIUS],
      [mob.x + MOB_RADIUS, mob.y - MOB_RADIUS],
      [mob.x - MOB_RADIUS, mob.y + MOB_RADIUS],
      [mob.x + MOB_RADIUS, mob.y + MOB_RADIUS],
      [mob.spawnX, mob.spawnY],
    ] as const) {
      cells.push({ ne: Math.floor(x / CELL_SIZE), se: Math.floor(y / CELL_SIZE) });
    }
  }
  return cells;
}

describe('labyrinth keeps objects free and connected', () => {
  // 32 x 32 cells: the lattice ends at column/row 29, so objects on 30/31
  // need an explicit passage. Repeat for several random mazes.
  for (let run = 0; run < 20; run++) {
    it(`connects target, mob bodies and spawn points (run ${run})`, () => {
      const world = new World();
      world.resize(32, 32);
      expect(world.setTargetAt(px(31), px(31))).toBe(true);
      world.addMob(px(31), px(0));
      world.addMob(px(0), px(31));
      // Near a cell corner, so the body overlaps four cells.
      world.addMob(12 * CELL_SIZE + 2, 18 * CELL_SIZE + 2);
      world.addMob(px(30), px(16));

      // Let the mobs walk off their spawn points first.
      for (let i = 0; i < 15; i++) {
        world.step(50, (i + 1) * 100);
      }

      world.generateLabyrinth();

      const fromTarget = reachable(world, world.getTarget()!);
      for (const cell of mobCells(world)) {
        expect(world.getStaticCost()[cell.ne + cell.se * world.getCols()]).not.toBe(COST_IMPASSABLE);
        expect(fromTarget[cell.ne + cell.se * world.getCols()]).toBe(1);
      }
    });
  }
});
