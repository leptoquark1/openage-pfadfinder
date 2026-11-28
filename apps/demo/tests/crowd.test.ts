import { COST_MIN } from '@leptoquark1/openage-pfadfinder';
import { describe, expect, it } from 'vitest';
import { CROWD_SETTING_RANGES, DEFAULT_CROWD_SETTINGS, ObstacleRepulsion } from '../src/world/crowd.js';
import { CELL_SIZE, MOB_RADIUS, World } from '../src/world/world.js';

const px = (cell: number) => cell * CELL_SIZE + CELL_SIZE / 2;

function run(world: World, frames: number, from = 0): void {
  for (let i = 0; i < frames; i++) {
    world.step(16, from + i * 16);
  }
}

/** Smallest gap between two mob bodies, in px; mobs just put back on their spawn do not count. */
function minGap(world: World): number {
  const mobs = world.getMobs().filter(m => m.x !== m.spawnX || m.y !== m.spawnY);
  let min = Infinity;
  for (let i = 0; i < mobs.length; i++) {
    for (let j = i + 1; j < mobs.length; j++) {
      min = Math.min(min, Math.hypot(mobs[i]!.x - mobs[j]!.x, mobs[i]!.y - mobs[j]!.y) - 2 * MOB_RADIUS);
    }
  }
  return min;
}

describe('mobs as a crowd', () => {
  it('lets a group of mobs walk to the target without running into each other', () => {
    const world = new World();
    world.resize(32, 16);
    world.setTargetAt(px(28), px(8));
    for (let k = 0; k < 12; k++) {
      world.addMob(px(2 + (k % 4)), px(6 + Math.floor(k / 4)));
    }
    let gap = Infinity;
    let arrived = 0;
    const mobs = world.getMobs();
    const spawned = new Set<number>();
    // speeds are random (70–160 px/s): ~770 px take at most 11 s, run 19 s
    for (let i = 0; i < 1200; i++) {
      world.step(16, i * 16);
      if (i > 10) {
        gap = Math.min(gap, minGap(world));
      }
      mobs.forEach((mob, k) => {
        // back at its spawn after it left it: arrived once
        if (i > 30 && mob.x === mob.spawnX && mob.y === mob.spawnY && !spawned.has(k)) {
          spawned.add(k);
          arrived++;
        }
      });
    }
    expect(arrived).toBeGreaterThanOrEqual(10);
    // a mob respawning next to one on its way may touch it for a step
    expect(gap).toBeGreaterThan(-MOB_RADIUS / 2);
  });

  it('starts with the defaults and switches the side rule without losing the mobs', () => {
    const world = new World();
    world.resize(16, 16);
    expect(world.getCrowdSettings()).toEqual(DEFAULT_CROWD_SETTINGS);
    world.addMob(px(2), px(2));
    world.setTargetAt(px(12), px(12));
    world.step(0, 100);
    run(world, 20, 200);
    const mob = world.getMobs()[0]!;
    const agent = mob.agent;
    world.setCrowdSettings({ side: 'left' }); // live: same crowd, same agent
    expect(mob.agent).toBe(agent);
    world.setCrowdSettings({ side: 'off' }); // the rule goes: a new crowd
    expect(world.getCrowdSettings().side).toBe('off');
    // the mob keeps its position across the rebuilt crowd and walks on
    const before = { x: mob.x, y: mob.y };
    run(world, 60, 600);
    expect(Math.hypot(mob.x - before.x, mob.y - before.y)).toBeGreaterThan(CELL_SIZE);
  });

  it('changes avoidance, look-ahead, personal space and replan interval live', () => {
    const world = new World();
    world.resize(16, 16);
    world.addMob(px(2), px(2));
    world.setTargetAt(px(12), px(12));
    world.step(0, 100);
    const agent = world.getMobs()[0]!.agent;
    world.setCrowdSettings({ avoidance: 3, lookahead: 1.5, personalSpace: 0.5, replanInterval: 500 });
    expect(world.getMobs()[0]!.agent).toBe(agent);
    expect(world.getCrowdSettings()).toMatchObject({
      avoidance: 3,
      lookahead: 1.5,
      personalSpace: 0.5,
      replanInterval: 500,
    });
    // values outside the slider ranges are clamped
    world.setCrowdSettings({ avoidance: 99, personalSpace: 0, replanInterval: 1 });
    expect(world.getCrowdSettings()).toMatchObject({
      avoidance: CROWD_SETTING_RANGES.avoidance.max,
      personalSpace: CROWD_SETTING_RANGES.personalSpace.min,
      replanInterval: CROWD_SETTING_RANGES.replanInterval.min,
    });
  });

  it('runs the planning tick at the replan interval', () => {
    const plansIn = (interval: number) => {
      const world = new World();
      world.resize(16, 16);
      world.setCrowdSettings({ replanInterval: interval });
      world.addMob(px(2), px(2));
      world.setTargetAt(px(12), px(12));
      for (let i = 0; i < 120; i++) {
        world.step(16, i * 16.7); // two seconds
      }
      return (
        world
          .getPerf()
          .snapshot()
          .phases.find(([name]) => name === 'Traces')?.[1].callsPerSecond ?? 0
      );
    };
    expect(plansIn(100)).toBeGreaterThan(plansIn(1000));
  });

  it('steers every mob along a path of its own in single path mode', () => {
    const world = new World();
    world.resize(32, 16);
    world.setCrowdSettings({ guidance: 'path' });
    for (let se = 0; se < 12; se++) {
      world.paintWall(px(10), px(se));
    }
    world.setTargetAt(px(20), px(4));
    world.addMob(px(2), px(4));
    world.addMob(px(3), px(5));
    run(world, 20);
    for (let i = 0; i < 4; i++) {
      world.step(0, 1000 + i * 200);
    }
    const [a, b] = world.getMobs();
    // no flow fields in use: no routes, no overlay; the traces are the paths
    expect(a!.route).toBeNull();
    expect(world.getActiveRoutes()).toHaveLength(0);
    expect(world.getFlowOverlay().size).toBe(0);
    expect(a!.trace.at(-1)).toEqual({ ne: 20, se: 4 });
    expect(b!.trace.at(-1)).toEqual({ ne: 20, se: 4 });
    expect(a!.trace.some(c => c.se >= 12)).toBe(true); // around the wall's end
    expect(a!.blocked).toBe(false);
    // and they get there
    let arrived = false;
    for (let i = 0; i < 2000 && !arrived; i++) {
      world.step(16, 2000 + i * 16);
      arrived = a!.x === a!.spawnX && a!.y === a!.spawnY;
    }
    expect(arrived).toBe(true);
    // back to flow fields
    world.setCrowdSettings({ guidance: 'flow' });
    for (let i = 0; i < 3; i++) {
      world.step(16, 40_000 + i * 200);
    }
    expect(world.getActiveRoutes().length).toBeGreaterThan(0);
  });

  it('reports a mob without a path as blocked in single path mode', () => {
    const world = new World();
    world.resize(16, 16);
    world.setCrowdSettings({ guidance: 'path' });
    for (let se = 0; se < 16; se++) {
      world.paintWall(px(8), px(se));
    }
    world.setTargetAt(px(12), px(4));
    world.addMob(px(2), px(4));
    for (let i = 0; i < 4; i++) {
      world.step(16, 100 + i * 200);
    }
    expect(world.getMobs()[0]!.blocked).toBe(true);
  });

  it('raises the costs under a jam with congestion on, and restores them when switched off', () => {
    const world = new World();
    world.resize(16, 16);
    world.setCrowdSettings({ congestion: true, congestionCost: 80 });
    // a crowd packed around a target cell it cannot all reach at once
    world.setTargetAt(px(8), px(8));
    for (let k = 0; k < 30; k++) {
      world.addMob(px(6) + (k % 6) * 8, px(6) + Math.floor(k / 6) * 8);
    }
    run(world, 240);
    const grid = world.getGrid()!;
    const costOf = (ne: number, se: number) => {
      const sector = grid.getSectorAt(ne, se)!;
      const { localNe, localSe } = grid.globalToLocal(ne, se);
      return sector.getCostField().getCost(localNe, localSe);
    };
    let raised = 0;
    for (let se = 4; se < 12; se++) {
      for (let ne = 4; ne < 12; ne++) {
        if (costOf(ne, se) > COST_MIN) {
          raised++;
        }
      }
    }
    expect(raised).toBeGreaterThan(0);
    world.setCrowdSettings({ congestion: false });
    for (let se = 0; se < 16; se++) {
      for (let ne = 0; ne < 16; ne++) {
        expect(costOf(ne, se)).toBe(COST_MIN);
      }
    }
  });

  it('keeps terrain painted under a jam when congestion is switched off', () => {
    const world = new World();
    world.resize(16, 16);
    world.setCrowdSettings({ congestion: true });
    world.setTargetAt(px(8), px(8));
    for (let k = 0; k < 30; k++) {
      world.addMob(px(6) + (k % 6) * 8, px(6) + Math.floor(k / 6) * 8);
    }
    run(world, 120);
    world.paintTerrain(px(7), px(7), 'mud');
    run(world, 120, 2000);
    world.setCrowdSettings({ congestion: false });
    const grid = world.getGrid()!;
    const { localNe, localSe } = grid.globalToLocal(7, 7);
    expect(grid.getSectorAt(7, 7)!.getCostField().getCost(localNe, localSe)).toBe(7);
  });

  it('drops the crowd on reset and builds a new one with the next grid', () => {
    const world = new World();
    world.resize(16, 16);
    world.addMob(px(2), px(2));
    world.setTargetAt(px(12), px(12));
    world.step(0, 100);
    world.reset();
    world.addMob(px(3), px(3));
    world.setTargetAt(px(10), px(3));
    world.step(0, 300);
    const mob = world.getMobs()[0]!;
    run(world, 30, 400);
    expect(mob.x).toBeGreaterThan(px(3));
  });
});

describe('ObstacleRepulsion', () => {
  it('pushes an agent away from a nearby obstacle box and ignores far ones', () => {
    const obstacles = [{ x: 5, y: 5, half: 0.4 }];
    const force = new ObstacleRepulsion(() => obstacles);
    const agents = {
      x: () => 5.7,
      y: () => 5,
      radius: () => 0.2,
    };
    const ctx = { agents } as unknown as Parameters<ObstacleRepulsion['accumulate']>[0];
    const neighbors = { count: 0, index: new Int32Array(0), distSq: new Float64Array(0) };
    const out = { x: 0, y: 0 };
    force.accumulate(ctx, 0, neighbors, out);
    expect(out.x).toBeGreaterThan(0);
    expect(out.y).toBeCloseTo(0);
    obstacles[0] = { x: 20, y: 20, half: 0.4 };
    const none = { x: 0, y: 0 };
    force.accumulate(ctx, 0, neighbors, none);
    expect(none).toEqual({ x: 0, y: 0 });
  });
});
