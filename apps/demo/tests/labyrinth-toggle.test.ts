import { COST_IMPASSABLE } from '@leptoquark1/openage-pfadfinder/shared';
import { describe, expect, it } from 'vitest';
import { CELL_SIZE, World } from '../src/world/world.js';

function px(cell: number): number {
  return cell * CELL_SIZE + CELL_SIZE / 2;
}

function isWall(world: World, ne: number, se: number): boolean {
  return world.getStaticCost()[ne + se * world.getCols()] === COST_IMPASSABLE;
}

function wallCount(world: World): number {
  return world.getStats().obstacles - world.getObstacles().length;
}

describe('labyrinth toggle', () => {
  it('removes every obstacle before generating, but keeps target and mobs', () => {
    const world = new World();
    world.resize(32, 32);
    world.paintWall(px(5), px(4));
    world.addMovingObstacle(px(20), px(20));
    world.beginPatrolObstacle(px(25), px(10));
    world.setTargetAt(px(9), px(9));
    world.addMob(px(3), px(3));

    world.generateLabyrinth();

    expect(world.getObstacles()).toHaveLength(0);
    expect(world.getPatrolAnchor()).toBeNull();
    expect(world.getTarget()).toEqual({ ne: 9, se: 9 });
    expect(world.getMobs()).toHaveLength(1);
    expect(world.hasLabyrinth()).toBe(true);
  });

  it('leaves an empty field after removal; removed obstacles do not come back', () => {
    const world = new World();
    world.resize(32, 32);
    world.paintWall(px(5), px(4));
    world.addMovingObstacle(px(20), px(20));

    world.generateLabyrinth();
    world.removeLabyrinth();

    expect(world.hasLabyrinth()).toBe(false);
    expect(wallCount(world)).toBe(0);
    expect(world.getObstacles()).toHaveLength(0);
  });

  it('keeps walls painted onto free cells while the labyrinth was active', () => {
    const world = new World();
    world.resize(32, 32);
    world.generateLabyrinth();

    let painted: [number, number] | null = null;
    for (let se = 0; se < 32 && !painted; se++) {
      for (let ne = 0; ne < 32; ne++) {
        if (!isWall(world, ne, se) && world.canPlaceWall(px(ne), px(se))) {
          painted = [ne, se];
          break;
        }
      }
    }
    world.paintWall(px(painted![0]), px(painted![1]));

    world.removeLabyrinth();

    expect(isWall(world, painted![0], painted![1])).toBe(true);
    expect(wallCount(world)).toBe(1);
  });

  it('survives a resize', () => {
    const world = new World();
    world.resize(32, 32);
    world.generateLabyrinth();
    world.resize(48, 40);
    world.removeLabyrinth();

    expect(wallCount(world)).toBe(0);
  });

  it('reset drops the labyrinth', () => {
    const world = new World();
    world.resize(32, 32);
    world.generateLabyrinth();
    world.reset();
    expect(world.hasLabyrinth()).toBe(false);
  });
});
