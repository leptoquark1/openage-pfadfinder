import { COST_IMPASSABLE } from '@leptoquark1/openage-pfadfinder/shared';
import { describe, expect, it } from 'vitest';
import { CELL_SIZE, World } from '../src/world/world.js';

function px(cell: number): number {
  return cell * CELL_SIZE + CELL_SIZE / 2;
}

/** Wall count by full scan — what getStats() used to do every frame. */
function scannedWalls(world: World): number {
  return world.getStaticCost().filter(c => c === COST_IMPASSABLE).length;
}

function countedWalls(world: World): number {
  return world.getStats().obstacles - world.getObstacles().length;
}

describe('wall counter', () => {
  it('matches a full scan through paint, erase and bulk rewrites', () => {
    const world = new World();
    world.resize(32, 32);
    expect(countedWalls(world)).toBe(0);

    world.paintWall(px(3), px(3));
    world.paintWall(px(4), px(3));
    world.paintWall(px(3), px(3)); // already a wall
    expect(countedWalls(world)).toBe(2);

    world.eraseWall(px(3), px(3));
    world.eraseWall(px(3), px(3)); // already free
    expect(countedWalls(world)).toBe(1);

    world.generateLabyrinth();
    expect(countedWalls(world)).toBe(scannedWalls(world));

    world.resize(16, 16);
    expect(countedWalls(world)).toBe(scannedWalls(world));

    world.reset();
    world.setTargetAt(px(8), px(8));
    expect(world.scatterWallsAroundTarget()).toBe(true);
    expect(countedWalls(world)).toBe(scannedWalls(world));

    world.reset();
    expect(countedWalls(world)).toBe(0);
  });
});

describe('grid updates go through the CostField API', () => {
  it('bumps the version of a sector cost field when one of its cells changes', () => {
    const world = new World();
    world.resize(16, 16);
    world.setTargetAt(px(14), px(14));
    world.step(0, 100);

    const sector = world.getGrid()!.getSectorAt(3, 3)!;
    const untouched = world.getGrid()!.getSectorAt(12, 3)!;
    const before = sector.getCostField().getVersion();
    const untouchedBefore = untouched.getCostField().getVersion();

    world.paintWall(px(3), px(3));
    world.step(0, 200);

    expect(world.getGrid()!.getSectorAt(3, 3)).toBe(sector);
    expect(sector.getCostField().getVersion()).toBeGreaterThan(before);
    expect(sector.getCostField().getCost(3, 3)).toBe(COST_IMPASSABLE);
    expect(untouched.getCostField().getVersion()).toBe(untouchedBefore);
  });
});
