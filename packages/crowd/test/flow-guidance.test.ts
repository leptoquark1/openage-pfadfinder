import { COST_IMPASSABLE, COST_MIN } from '@leptoquark1/openage-pfadfinder';
import { describe, expect, it } from 'vitest';
import { FlowRouteGuidance } from '../src/guidance/flow-route.ts';
import { Invalidation } from '../src/guidance/types.ts';
import { openWorld, runUntil, simulation } from './helpers.ts';

/** Two groups in the start sector with a route each, budget one plan per tick. */
function twoGroups() {
  const world = openWorld(32, 32);
  const guidance = new FlowRouteGuidance(world.pathfinder, 0, { maxPlansPerTick: 1 });
  const sim = simulation(world, { guidance });
  const ids = [0, 1].map(group =>
    sim.addAgent({
      position: { x: 2.5 + group * 2, y: 2.5 },
      radius: 0.4,
      maxSpeed: 2,
      group,
      goal: { ne: 28, se: 28 },
    }),
  );
  sim.step();
  sim.step();
  expect(guidance.getPlanCount()).toBe(2);
  const sector = world.grid.getSectorAt(2, 2)!;
  return { world, guidance, sim, ids, sector };
}

describe('FlowRouteGuidance', () => {
  it('needs a known grid', () => {
    expect(() => new FlowRouteGuidance(openWorld(8, 8).pathfinder, 3)).toThrow(RangeError);
  });

  it('lets a group with one goal share its routes', () => {
    const world = openWorld(32, 32);
    const guidance = new FlowRouteGuidance(world.pathfinder, 0);
    const sim = simulation(world, { guidance });
    const ids: number[] = [];
    for (let k = 0; k < 10; k++) {
      ids.push(
        sim.addAgent({
          position: { x: 2.5 + (k % 5), y: 2.5 + Math.floor(k / 5) },
          radius: 0.4,
          maxSpeed: 2,
          goal: { ne: 28, se: 28 },
        }),
      );
    }
    runUntil(sim, () => ids.every(id => sim.getState(id) === 'ARRIVED'), 1500);
    expect(ids.every(id => sim.getState(id) === 'ARRIVED')).toBe(true);
    // ten agents starting in one sector follow the same fields
    expect(guidance.getPlanCount()).toBeLessThanOrEqual(3);
  });

  it('plans separately for other groups', () => {
    const { guidance } = twoGroups();
    expect(guidance.getRouteCount()).toBe(2);
  });

  it('waits while the planning budget is used up', () => {
    const world = openWorld(32, 32);
    const guidance = new FlowRouteGuidance(world.pathfinder, 0, { maxPlansPerTick: 0 });
    const sim = simulation(world, { guidance });
    const id = sim.addAgent({ position: { x: 2.5, y: 2.5 }, radius: 0.4, maxSpeed: 2, goal: { ne: 28, se: 28 } });
    sim.step();
    expect(guidance.getPlanCount()).toBe(0);
    expect(sim.getVelocity(id)).toEqual({ x: 0, y: 0 });
    expect(sim.getState(id)).toBe('MOVING');
  });

  it('replans STALE routes within the budget and follows them meanwhile', () => {
    const { guidance, sim, ids, sector } = twoGroups();
    const field = sector.getCostField();
    const costs = field.getCosts().slice();
    costs[7 + 7 * 8] = COST_MIN + 5; // costs only, passability unchanged
    field.setCosts(costs);
    guidance.invalidate(new Set([sector.getId()]), Invalidation.STALE);
    sim.step();
    expect(guidance.getPlanCount()).toBe(3); // one plan: the budget
    for (const id of ids) {
      expect(Math.hypot(sim.getVelocity(id).x, sim.getVelocity(id).y)).toBeGreaterThan(0.1);
    }
    sim.step();
    expect(guidance.getPlanCount()).toBe(4); // the other one, a tick later
  });

  it('replans UNSAFE routes at once, outside the budget', () => {
    const { guidance, sim, ids } = twoGroups();
    sim.applyTerrain([{ ne: 6, se: 6, cost: COST_IMPASSABLE }]); // in the start sector
    sim.step();
    expect(guidance.getPlanCount()).toBe(4); // both in the same tick
    runUntil(sim, () => ids.every(id => sim.getState(id) === 'ARRIVED'), 1500);
    expect(ids.every(id => sim.getState(id) === 'ARRIVED')).toBe(true);
  });

  it('treats a cost change nobody announced as UNSAFE', () => {
    const { world, guidance, sim } = twoGroups();
    world.grid.updateCosts([{ ne: 6, se: 6, cost: COST_IMPASSABLE }]); // behind the guidance's back
    sim.step();
    expect(guidance.getPlanCount()).toBe(4);
  });

  it('keeps a route UNSAFE when a STALE announcement follows an UNSAFE one', () => {
    const { guidance, sim, sector } = twoGroups();
    const field = sector.getCostField();
    field.setCosts(field.getCosts().slice());
    guidance.invalidate(new Set([sector.getId()]), Invalidation.UNSAFE);
    field.setCosts(field.getCosts().slice());
    guidance.invalidate(new Set([sector.getId()]), Invalidation.STALE);
    sim.step();
    expect(guidance.getPlanCount()).toBe(4);
  });

  it('ignores invalidations of nothing or of unknown sectors', () => {
    const { guidance, sim } = twoGroups();
    guidance.invalidate(new Set(), Invalidation.UNSAFE);
    guidance.invalidate(new Set([999]), Invalidation.UNSAFE);
    sim.step();
    expect(guidance.getPlanCount()).toBe(2);
  });

  it('retries unreachable goals after the retry interval or a cost change', () => {
    const world = openWorld(16, 16);
    world.grid.updateCosts(Array.from({ length: 16 }, (_, se) => ({ ne: 7, se, cost: COST_IMPASSABLE })));
    const guidance = new FlowRouteGuidance(world.pathfinder, 0, { retryInterval: 10 });
    const sim = simulation(world, { guidance });
    const id = sim.addAgent({ position: { x: 2.5, y: 8.5 }, radius: 0.4, maxSpeed: 2, goal: { ne: 12, se: 8 } });
    sim.step();
    expect(sim.getState(id)).toBe('UNREACHABLE');
    const plans = guidance.getPlanCount();
    for (let t = 0; t < 5; t++) {
      sim.step();
    }
    expect(guidance.getPlanCount()).toBe(plans); // within the retry interval
    for (let t = 0; t < 6; t++) {
      sim.step();
    }
    expect(guidance.getPlanCount()).toBe(plans + 1); // retried once
    sim.applyTerrain([{ ne: 7, se: 8, cost: COST_MIN }]);
    runUntil(sim, () => sim.getState(id) === 'ARRIVED', 400);
    expect(sim.getState(id)).toBe('ARRIVED');
  });

  it('drops routes nobody used for a while', () => {
    const world = openWorld(32, 32);
    const guidance = new FlowRouteGuidance(world.pathfinder, 0, { routeTtl: 5 });
    const sim = simulation(world, { guidance });
    const id = sim.addAgent({ position: { x: 2.5, y: 2.5 }, radius: 0.4, maxSpeed: 2, goal: { ne: 28, se: 28 } });
    sim.step();
    expect(guidance.getRouteCount()).toBe(1);
    sim.setGoal(id, null);
    for (let t = 0; t < 7; t++) {
      sim.step();
    }
    expect(guidance.getRouteCount()).toBe(0);
    guidance.dispose();
  });

  it('steers straight at the goal center inside the goal cell', () => {
    const sim = simulation(openWorld(16, 16), { preferredModifiers: [], forces: [] });
    const id = sim.addAgent({ position: { x: 4.1, y: 4.1 }, radius: 0.4, maxSpeed: 2, goal: { ne: 4, se: 4 } });
    sim.step();
    const v = sim.getVelocity(id);
    expect(v.x).toBeGreaterThan(0);
    expect(v.x).toBeCloseTo(v.y);
    expect(runUntil(sim, () => sim.getState(id) === 'ARRIVED', 40)).toBeLessThan(20);
  });
});
