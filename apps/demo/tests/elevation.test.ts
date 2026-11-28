import { COST_IMPASSABLE, COST_MIN } from '@leptoquark1/openage-pfadfinder';
import { describe, expect, it } from 'vitest';
import {
  applyBrush,
  BRUSH_STRENGTH,
  CLIFF_SLOPE,
  generateHeights,
  isCliff,
  MAX_HEIGHT,
  SLOPE_STEP,
  slopeAt,
  slopeCost,
} from '../src/world/elevation.js';
import { CROWD_TIMESTEP } from '../src/world/crowd.js';
import { CELL_SIZE, terrainSpeedFactor, World } from '../src/world/world.js';

const px = (cell: number) => cell * CELL_SIZE + CELL_SIZE / 2;

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function gridCost(world: World, ne: number, se: number): number {
  const sector = world.getGrid()!.getSectorAt(ne, se)!;
  const origin = sector.getPosition();
  return sector.getCostField().getCost(ne - origin.x * 8, se - origin.y * 8);
}

function raiseUntilCliff(world: World, ne: number, se: number): number {
  for (let stroke = 0; stroke < 40; stroke++) {
    world.raiseGround(px(ne), px(se));
    const cliff = world
      .getHeight()
      .findIndex((_, idx) => world.isCliffCell(idx % world.getCols(), Math.floor(idx / world.getCols())));
    if (cliff >= 0) {
      return cliff;
    }
  }
  throw new Error('no cliff');
}

describe('slope cost', () => {
  it('adds one cost step per slope step and blocks cliffs', () => {
    expect(slopeCost(0)).toBe(0);
    expect(slopeCost(SLOPE_STEP)).toBe(1);
    expect(slopeCost(CLIFF_SLOPE)).toBe(CLIFF_SLOPE / SLOPE_STEP);
    expect(slopeCost(CLIFF_SLOPE + 1)).toBe(COST_IMPASSABLE);
  });

  it('measures the largest height difference to the four neighbors', () => {
    const height = Uint8Array.from([0, 10, 0, 40, 20, 0, 0, 5, 0]);
    expect(slopeAt(height, 3, 3, 4)).toBe(20);
    expect(slopeAt(height, 3, 3, 0)).toBe(40);
  });
});

describe('brush', () => {
  it('raises the center the most and stays within range', () => {
    const height = new Uint8Array(100);
    applyBrush(height, 10, 10, 5, 5, BRUSH_STRENGTH);
    expect(height[55]).toBe(BRUSH_STRENGTH);
    expect(height[56]!).toBeLessThan(BRUSH_STRENGTH);
    expect(height[0]).toBe(0);

    for (let i = 0; i < 20; i++) {
      applyBrush(height, 10, 10, 5, 5, BRUSH_STRENGTH);
    }
    expect(height[55]).toBe(MAX_HEIGHT);
    for (let i = 0; i < 40; i++) {
      applyBrush(height, 10, 10, 5, 5, -BRUSH_STRENGTH);
    }
    expect(height.every(level => level === 0)).toBe(true);
  });
});

describe('height generator', () => {
  it('repeats for the same random source and keeps cliffs rare', () => {
    const first = generateHeights(48, 32, seededRandom(7));
    const second = generateHeights(48, 32, seededRandom(7));
    expect(first).toEqual(second);
    expect(Math.max(...first)).toBeGreaterThan(0);

    let cliffs = 0;
    for (let idx = 0; idx < first.length; idx++) {
      if (isCliff(slopeAt(first, 48, 32, idx))) {
        cliffs++;
      }
    }
    expect(cliffs / first.length).toBeLessThan(0.02);
  });
});

describe('elevation in the world', () => {
  it('writes slope costs and cliffs into the grid', () => {
    const world = new World();
    world.resize(16, 16);
    world.setTargetAt(px(15), px(15));
    world.step(0, 100);

    world.raiseGround(px(4), px(4));
    world.step(0, 200);
    const idx = 5 + 4 * world.getCols();
    const slope = slopeAt(world.getHeight(), world.getCols(), world.getRows(), idx);
    expect(slope).toBeGreaterThan(0);
    expect(gridCost(world, 5, 4)).toBe(COST_MIN + slopeCost(slope));

    const cliff = raiseUntilCliff(world, 4, 4);
    world.step(0, 300);
    const cliffNe = cliff % world.getCols();
    const cliffSe = Math.floor(cliff / world.getCols());
    expect(gridCost(world, cliffNe, cliffSe)).toBe(COST_IMPASSABLE);
    expect(world.canPlaceMob(px(cliffNe), px(cliffSe))).toBe(false);
    expect(world.canPlaceTarget(px(cliffNe), px(cliffSe))).toBe(false);
  });

  it('adds slope cost on top of terrain', () => {
    const world = new World();
    world.resize(16, 16);
    world.setTargetAt(px(15), px(15));
    world.paintTerrain(px(5), px(4), 'mud');
    world.raiseGround(px(4), px(4));
    world.step(0, 100);
    const slope = slopeAt(world.getHeight(), world.getCols(), world.getRows(), 5 + 4 * world.getCols());
    expect(gridCost(world, 5, 4)).toBe(7 + slopeCost(slope));
  });

  it('keeps heights through resize, maze and scatter, and clears them on reset and flatten', () => {
    const world = new World();
    world.resize(32, 32);
    world.generateHills(seededRandom(3));
    const before = world.getHeight().slice();

    world.generateLabyrinth();
    world.removeLabyrinth();
    expect(world.getHeight()).toEqual(before);

    world.resize(16, 16);
    expect(world.getHeight()[3 + 3 * 16]).toBe(before[3 + 3 * 32]);

    world.flattenGround();
    expect(world.hasElevation()).toBe(false);

    world.generateHills(seededRandom(3));
    world.reset();
    expect(world.hasElevation()).toBe(false);
  });

  it('slows mobs down on slopes', () => {
    const distance = (ramp: boolean) => {
      const world = new World();
      world.resize(16, 16);
      for (let se = 0; se < 16; se++) {
        for (let ne = 0; ne < 16; ne++) {
          if (se !== 2) {
            world.paintWall(px(ne), px(se));
          }
          if (ramp) {
            world.getHeight()[ne + se * 16] = ne * SLOPE_STEP;
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

    const seconds = 30 * 0.016;
    const flat = distance(false);
    const ramp = distance(true);
    const rampSpeed = ramp.speed * terrainSpeedFactor(COST_MIN + 1);
    expect(Math.abs(flat.moved - flat.speed * seconds)).toBeLessThan(flat.speed * CROWD_TIMESTEP + 1);
    expect(Math.abs(ramp.moved - rampSpeed * seconds)).toBeLessThan(rampSpeed * CROWD_TIMESTEP + 1);
  });

  it('routes mobs around cliffs', () => {
    const world = new World();
    world.resize(16, 16);
    raiseUntilCliff(world, 4, 4);
    world.setTargetAt(px(7), px(4));
    world.addMob(px(1), px(4));
    for (let i = 0; i < 5; i++) {
      world.step(16, 100 + i * 100);
    }
    const mob = world.getMobs()[0]!;
    expect(mob.blocked).toBe(false);
    expect(mob.trace.some(cell => world.isCliffCell(cell.ne, cell.se))).toBe(false);
  });
});
