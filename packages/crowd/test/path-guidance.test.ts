import { COST_IMPASSABLE, COST_MIN } from '@leptoquark1/openage-pfadfinder';
import { describe, expect, it } from 'vitest';
import { PathGuidance } from '../src/guidance/path.ts';
import { Invalidation } from '../src/guidance/types.ts';
import { anyInWall, openWorld, runUntil, simulation, worldFromRows } from './helpers.ts';

describe('PathGuidance', () => {
  it('needs a known grid and valid options', () => {
    const world = openWorld(8, 8);
    expect(() => new PathGuidance(world.pathfinder, 3)).toThrow(RangeError);
    expect(() => new PathGuidance(world.pathfinder, 0, { waypointRadius: 0 })).toThrow(RangeError);
    expect(() => new PathGuidance(world.pathfinder, 0, { replanInterval: -1 })).toThrow(RangeError);
  });

  it('brings an agent along its own path around walls to the goal', () => {
    const world = worldFromRows(
      [
        '################',
        '#..............#',
        '#.######.......#',
        '#.#....#.......#',
        '#.#.##.#.......#',
        '#...#..........#',
        '################',
      ],
      8,
    );
    const guidance = new PathGuidance(world.pathfinder, 0);
    const sim = simulation(world, { guidance });
    const id = sim.addAgent({ position: { x: 1.5, y: 1.5 }, radius: 0.35, maxSpeed: 3, goal: { ne: 5, se: 3 } });
    let inWall = false;
    sim.step();
    const path = guidance.getPath(id)!;
    expect(path.at(-1)).toEqual({ ne: 5, se: 3 });
    runUntil(
      sim,
      () => {
        inWall ||= anyInWall(sim);
        return sim.getState(id) === 'ARRIVED';
      },
      1200,
    );
    expect(sim.getState(id)).toBe('ARRIVED');
    expect(inWall).toBe(false);
    expect(guidance.getPath(999)).toBeNull();
  });

  it('plans one path per agent, within the budget', () => {
    const world = openWorld(32, 32);
    const guidance = new PathGuidance(world.pathfinder, 0, { maxPlansPerTick: 2, replanInterval: 0 });
    const sim = simulation(world, { guidance });
    for (let k = 0; k < 5; k++) {
      sim.addAgent({ position: { x: 2.5 + k, y: 2.5 }, radius: 0.4, maxSpeed: 2, goal: { ne: 28, se: 28 } });
    }
    sim.step();
    expect(guidance.getPlanCount()).toBe(2);
    sim.step();
    sim.step();
    expect(guidance.getPlanCount()).toBe(5);
    for (let t = 0; t < 20; t++) {
      sim.step();
    }
    expect(guidance.getPlanCount()).toBe(5); // no interval: nothing to replan
  });

  it('replans every interval and after a STALE invalidation', () => {
    const world = openWorld(32, 32);
    const guidance = new PathGuidance(world.pathfinder, 0, { replanInterval: 0.5 });
    const sim = simulation(world, { guidance });
    sim.addAgent({ position: { x: 2.5, y: 2.5 }, radius: 0.4, maxSpeed: 2, goal: { ne: 28, se: 28 } });
    for (let t = 0; t < 21; t++) {
      sim.step(); // 1.05 s at 20 Hz
    }
    expect(guidance.getPlanCount()).toBe(3);
    guidance.configure({ replanInterval: 0 });
    guidance.invalidate(new Set(), Invalidation.STALE); // nothing: ignored
    sim.step();
    expect(guidance.getPlanCount()).toBe(3);
    guidance.invalidate(new Set([0]), Invalidation.STALE);
    sim.step();
    expect(guidance.getPlanCount()).toBe(4);
    guidance.invalidate(new Set([0]), Invalidation.UNSAFE); // checked by the line test, no replan
    sim.step();
    expect(guidance.getPlanCount()).toBe(4);
  });

  it('replans at once when a wall cuts the line to the next waypoint', () => {
    const world = openWorld(32, 16);
    const guidance = new PathGuidance(world.pathfinder, 0, { maxPlansPerTick: 0, replanInterval: 0 });
    const sim = simulation(world, { guidance });
    // budget 0: only urgent replans run; give the agent a first path through a blocked line
    const id = sim.addAgent({ position: { x: 2.5, y: 8.5 }, radius: 0.4, maxSpeed: 2, goal: { ne: 28, se: 8 } });
    sim.step();
    expect(guidance.getPlanCount()).toBe(0); // no path and no budget: waits
    guidance.configure({ maxPlansPerTick: 1 });
    sim.step();
    expect(guidance.getPlanCount()).toBe(1);
    guidance.configure({ maxPlansPerTick: 0 });
    sim.applyTerrain(Array.from({ length: 12 }, (_, k) => ({ ne: 10, se: 2 + k, cost: COST_IMPASSABLE })));
    sim.step();
    expect(guidance.getPlanCount()).toBe(2); // the line to the goal is cut: replanned over budget
    guidance.configure({ maxPlansPerTick: 8 });
    runUntil(sim, () => sim.getState(id) === 'ARRIVED', 1000);
    expect(sim.getState(id)).toBe('ARRIVED');
  });

  it('reports unreachable goals and retries them', () => {
    const world = openWorld(16, 16);
    world.grid.updateCosts(Array.from({ length: 16 }, (_, se) => ({ ne: 7, se, cost: COST_IMPASSABLE })));
    const guidance = new PathGuidance(world.pathfinder, 0, { retryInterval: 10 });
    const sim = simulation(world, { guidance });
    const id = sim.addAgent({ position: { x: 2.5, y: 8.5 }, radius: 0.4, maxSpeed: 2, goal: { ne: 12, se: 8 } });
    const wall = sim.addAgent({ position: { x: 2.5, y: 3.5 }, radius: 0.4, maxSpeed: 2, goal: { ne: 7, se: 3 } });
    sim.step();
    expect(sim.getState(id)).toBe('UNREACHABLE');
    expect(sim.getState(wall)).toBe('UNREACHABLE');
    const plans = guidance.getPlanCount();
    for (let t = 0; t < 5; t++) {
      sim.step();
    }
    expect(guidance.getPlanCount()).toBe(plans);
    sim.applyTerrain([{ ne: 7, se: 8, cost: COST_MIN }]);
    runUntil(sim, () => sim.getState(id) === 'ARRIVED', 600);
    expect(sim.getState(id)).toBe('ARRIVED');
    sim.setGoal(id, { ne: 2, se: 2 });
    sim.removeAgent(wall);
    runUntil(sim, () => sim.getState(id) === 'ARRIVED', 600);
    expect(sim.getState(id)).toBe('ARRIVED');
    guidance.dispose();
    expect(guidance.getPath(id)).toBeNull();
  });
});
