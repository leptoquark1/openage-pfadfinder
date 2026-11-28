import { COST_IMPASSABLE, COST_MIN } from '@leptoquark1/openage-pfadfinder';
import { describe, expect, it } from 'vitest';
import { terrainById } from '../src/world/terrain.js';
import { CROWD_TIMESTEP } from '../src/world/crowd.js';
import { CELL_SIZE, terrainSpeedFactor, World } from '../src/world/world.js';

const px = (cell: number) => cell * CELL_SIZE + CELL_SIZE / 2;

/** Cost the grid holds for a cell, after the next planning tick. */
function gridCost(world: World, ne: number, se: number): number {
  const sector = world.getGrid()!.getSectorAt(ne, se)!;
  const origin = sector.getPosition();
  return sector.getCostField().getCost(ne - origin.x * 8, se - origin.y * 8);
}

describe('terrain', () => {
  it('writes the terrain cost into the grid and back to free ground on erase', () => {
    const world = new World();
    world.resize(16, 16);
    world.setTargetAt(px(14), px(14));
    world.step(0, 100);

    world.paintTerrain(px(3), px(4), 'mud');
    world.paintTerrain(px(11), px(4), 'swamp');
    world.step(0, 200);
    expect(gridCost(world, 3, 4)).toBe(terrainById('mud').cost);
    expect(gridCost(world, 11, 4)).toBe(terrainById('swamp').cost);

    world.paintTerrain(px(3), px(4), 'swamp');
    world.eraseTerrain(px(11), px(4));
    world.step(0, 300);
    expect(gridCost(world, 3, 4)).toBe(terrainById('swamp').cost);
    expect(gridCost(world, 11, 4)).toBe(COST_MIN);
  });

  it('can be painted under objects but not on walls', () => {
    const world = new World();
    world.resize(16, 16);
    world.setTargetAt(px(2), px(2));
    world.addMob(px(5), px(5));
    world.paintWall(px(8), px(8));

    expect(world.canPlaceTerrain(px(2), px(2))).toBe(true);
    expect(world.canPlaceTerrain(px(5), px(5))).toBe(true);
    expect(world.canPlaceTerrain(px(8), px(8))).toBe(false);

    world.paintTerrain(px(8), px(8), 'mud');
    expect(world.getTerrain()[8 + 8 * world.getCols()]).toBe(COST_MIN);
  });

  it('is kept under a wall and comes back when the wall goes', () => {
    const world = new World();
    world.resize(16, 16);
    world.setTargetAt(px(14), px(14));
    world.paintTerrain(px(4), px(4), 'mud');
    world.paintWall(px(4), px(4));
    world.step(0, 100);
    expect(gridCost(world, 4, 4)).toBe(COST_IMPASSABLE);
    expect(world.terrainAt(px(4), px(4), 'mud')).toBeNull();

    world.eraseWall(px(4), px(4));
    world.step(0, 200);
    expect(gridCost(world, 4, 4)).toBe(terrainById('mud').cost);
    expect(world.terrainAt(px(4), px(4), 'mud')).toEqual({ ne: 4, se: 4 });
    expect(world.terrainAt(px(4), px(4), 'swamp')).toBeNull();
  });

  it('survives a labyrinth and its removal, resizes and goes with a reset', () => {
    const world = new World();
    world.resize(32, 32);
    world.paintTerrain(px(1), px(1), 'swamp');

    world.generateLabyrinth();
    world.removeLabyrinth();
    expect(world.getTerrain()[1 + 1 * world.getCols()]).toBe(terrainById('swamp').cost);

    world.resize(16, 16);
    expect(world.getTerrain()[1 + 1 * world.getCols()]).toBe(terrainById('swamp').cost);

    world.reset();
    expect(world.getTerrain().every(c => c === COST_MIN)).toBe(true);
  });

  it('routes mobs around expensive terrain when a cheaper detour exists', () => {
    // Inside one sector: a swamp band with a free gap at the bottom. The
    // straight line crosses two swamp cells, the detour through the gap
    // costs less.
    const world = new World();
    world.resize(16, 16);
    for (let se = 0; se < 6; se++) {
      for (let ne = 3; ne <= 4; ne++) {
        world.paintTerrain(px(ne), px(se), 'swamp');
      }
    }
    world.setTargetAt(px(6), px(1));
    world.addMob(px(1), px(1));
    for (let i = 0; i < 5; i++) {
      world.step(16, 100 + i * 100);
    }

    const mob = world.getMobs()[0]!;
    expect(mob.blocked).toBe(false);
    expect(mob.trace.at(-1)).toEqual({ ne: 6, se: 1 });
    expect(mob.trace.some(c => c.ne >= 3 && c.ne <= 4 && c.se < 6)).toBe(false);

    // Without the gap the swamp is the only way, and the mob takes it.
    world.paintTerrain(px(3), px(6), 'swamp');
    world.paintTerrain(px(3), px(7), 'swamp');
    world.paintTerrain(px(4), px(6), 'swamp');
    world.paintTerrain(px(4), px(7), 'swamp');
    for (let se = 8; se < 16; se++) {
      world.paintWall(px(3), px(se));
    }
    for (let i = 0; i < 5; i++) {
      world.step(16, 1000 + i * 100);
    }
    expect(mob.blocked).toBe(false);
    expect(mob.trace.some(c => c.ne >= 3 && c.ne <= 4)).toBe(true);
  });

  it('slows mobs down by the cost of the cell they walk on', () => {
    // One row, target far to the east: the mob walks straight along it.
    // Agents accelerate towards their top speed, so measure once it is reached.
    const pace = (paint: boolean) => {
      const world = new World();
      world.resize(16, 16);
      for (let se = 0; se < 16; se++) {
        for (let ne = 0; ne < 16; ne++) {
          if (se !== 2) {
            world.paintWall(px(ne), px(se));
          } else if (paint) {
            world.paintTerrain(px(ne), px(se), 'mud');
          }
        }
      }
      world.setTargetAt(px(15), px(2));
      world.addMob(px(1), px(2));
      world.step(0, 100);
      const mob = world.getMobs()[0]!;
      for (let i = 0; i < 120; i++) {
        world.step(16, 200 + i * 16);
      }
      const startX = mob.x;
      for (let i = 0; i < 30; i++) {
        world.step(16, 2200 + i * 16);
      }
      return { moved: mob.x - startX, speed: mob.speed };
    };

    // 30 frames of 16 ms; fixed crowd steps may leave up to one step unspent
    const seconds = 30 * 0.016;
    const free = pace(false);
    const mud = pace(true);
    const mudSpeed = mud.speed * terrainSpeedFactor(terrainById('mud').cost);
    expect(Math.abs(free.moved - free.speed * seconds)).toBeLessThan(free.speed * CROWD_TIMESTEP + 1);
    expect(Math.abs(mud.moved - mudSpeed * seconds)).toBeLessThan(mudSpeed * CROWD_TIMESTEP + 1);
  });

  it('keeps full speed on free ground', () => {
    expect(terrainSpeedFactor(COST_MIN)).toBe(1);
    expect(terrainSpeedFactor(terrainById('swamp').cost)).toBeCloseTo(1 / 12);
  });
});
