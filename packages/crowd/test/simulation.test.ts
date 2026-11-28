import { describe, expect, it } from 'vitest';
import { FlowRouteGuidance } from '../src/guidance/flow-route.ts';
import { CrowdSimulation } from '../src/simulation.ts';
import { openWorld, runUntil, simulation, worldFromRows } from './helpers.ts';

describe('CrowdSimulation', () => {
  it('validates its options and the agents', () => {
    const world = openWorld(16, 16);
    expect(() => new CrowdSimulation(world.pathfinder, 7, { timestep: 0.05 })).toThrow(RangeError);
    expect(() => new CrowdSimulation(world.pathfinder, 0, { timestep: 0 })).toThrow(RangeError);
    expect(() => new CrowdSimulation(world.pathfinder, 0, { timestep: Infinity })).toThrow(RangeError);
    const sim = simulation(world);
    const ok = { position: { x: 1, y: 1 }, radius: 0.4, maxSpeed: 1 };
    expect(() => sim.addAgent({ ...ok, radius: 0 })).toThrow(RangeError);
    expect(() => sim.addAgent({ ...ok, maxSpeed: -1 })).toThrow(RangeError);
    expect(() => sim.addAgent({ ...ok, maxAccel: 0 })).toThrow(RangeError);
    expect(() => sim.addAgent({ ...ok, group: 1.5 })).toThrow(RangeError);
    expect(() => sim.addAgent({ ...ok, position: { x: Number.NaN, y: 1 } })).toThrow(RangeError);
    const id = sim.addAgent(ok);
    expect(() => sim.setGoal(id, { ne: 1.5, se: 2 })).toThrow(RangeError);
    expect(() => sim.getPosition(id + 1)).toThrow(RangeError);
    for (const hashCellSize of [0, -1, Number.NaN, Infinity]) {
      expect(() => simulation(world, { hashCellSize })).toThrow(RangeError);
    }
  });

  it('changes nothing when an agent or a goal is rejected', () => {
    const sim = simulation(openWorld(16, 16));
    const ok = { position: { x: 1.5, y: 1.5 }, radius: 0.4, maxSpeed: 1 };
    expect(() => sim.addAgent({ ...ok, goal: { ne: 2.5, se: 3 } })).toThrow(RangeError);
    expect(sim.agentCount).toBe(0);
    const id = sim.addAgent({ ...ok, goal: { ne: 8, se: 8 } });
    expect(() => sim.setGoal(id, { ne: Number.NaN, se: 3 })).toThrow(RangeError);
    expect(sim.getState(id)).toBe('MOVING'); // still on its way to (8, 8)
    runUntil(sim, () => sim.getState(id) === 'ARRIVED', 400);
    expect(sim.getState(id)).toBe('ARRIVED');
  });

  it('gives ids that are never reused and keeps getters as copies', () => {
    const sim = simulation(openWorld(16, 16));
    const a = sim.addAgent({ position: { x: 2.5, y: 2.5 }, radius: 0.4, maxSpeed: 1 });
    const b = sim.addAgent({ position: { x: 5.5, y: 2.5 }, radius: 0.4, maxSpeed: 1 });
    expect(sim.removeAgent(a)).toBe(true);
    expect(sim.removeAgent(a)).toBe(false);
    const c = sim.addAgent({ position: { x: 8.5, y: 2.5 }, radius: 0.4, maxSpeed: 1 });
    expect(c).toBeGreaterThan(b);
    expect(sim.hasAgent(a)).toBe(false);
    expect(sim.agentCount).toBe(2);
    const p = sim.getPosition(b);
    p.x = 100;
    expect(sim.getPosition(b).x).toBe(5.5);
    const out = { x: 0, y: 0 };
    expect(sim.getPosition(b, out)).toBe(out);
    expect(sim.getVelocity(b)).toEqual({ x: 0, y: 0 });
    // the agent view is by ascending id
    const view = sim.agents;
    expect([view.id(0), view.id(1)]).toEqual([b, c]);
    expect(view.indexOf(c)).toBe(1);
    expect(view.maxSpeed(0)).toBe(1);
    expect(view.group(0)).toBe(0);
  });

  it('brings a single agent to its goal across sectors without oscillating', () => {
    const sim = simulation(openWorld(32, 32));
    const id = sim.addAgent({ position: { x: 2.5, y: 2.5 }, radius: 0.4, maxSpeed: 2, goal: { ne: 28, se: 25 } });
    expect(sim.getState(id)).toBe('MOVING');
    let turns = 0;
    let last = { x: 0, y: 0 };
    const ticks = runUntil(
      sim,
      () => {
        const v = sim.getVelocity(id);
        if (Math.hypot(v.x, v.y) > 0.5 && Math.hypot(last.x, last.y) > 0.5 && v.x * last.x + v.y * last.y < 0) {
          turns++;
        }
        last = v;
        return sim.getState(id) === 'ARRIVED';
      },
      1000,
    );
    expect(sim.getState(id)).toBe('ARRIVED');
    // 34.6 cells at 2 cells/s: about 17 s, plus braking
    expect(ticks).toBeLessThan(25 * 20);
    expect(turns).toBe(0);
    const p = sim.getPosition(id);
    expect(Math.hypot(p.x - 28.5, p.y - 25.5)).toBeLessThanOrEqual(0.5);
    // arrived agents come to rest
    for (let t = 0; t < 40; t++) {
      sim.step();
    }
    expect(Math.hypot(sim.getVelocity(id).x, sim.getVelocity(id).y)).toBeLessThan(0.05);
    expect(sim.getState(id)).toBe('ARRIVED');
  });

  it('keeps agents without a goal idle and at rest', () => {
    const sim = simulation(openWorld(16, 16));
    const id = sim.addAgent({ position: { x: 4.5, y: 4.5 }, radius: 0.4, maxSpeed: 1, goal: { ne: 12, se: 12 } });
    sim.step();
    sim.setGoal(id, null);
    expect(sim.getState(id)).toBe('IDLE');
    for (let t = 0; t < 40; t++) {
      sim.step();
    }
    expect(sim.getState(id)).toBe('IDLE');
    expect(Math.hypot(sim.getVelocity(id).x, sim.getVelocity(id).y)).toBeLessThan(0.05);
  });

  it('reports a goal behind a closed wall as unreachable, and a reachable one again after it opens', () => {
    const rows = Array.from({ length: 16 }, () => '.......#........');
    const world = worldFromRows(rows, 8);
    const sim = simulation(world);
    const id = sim.addAgent({ position: { x: 2.5, y: 8.5 }, radius: 0.4, maxSpeed: 2, goal: { ne: 12, se: 8 } });
    sim.step();
    expect(sim.getState(id)).toBe('UNREACHABLE');
    const wall = sim.addAgent({ position: { x: 2.5, y: 2.5 }, radius: 0.4, maxSpeed: 2, goal: { ne: 7, se: 3 } });
    sim.step();
    expect(sim.getState(wall)).toBe('UNREACHABLE'); // goal inside a wall
    sim.applyTerrain([{ ne: 7, se: 8, cost: 1 }]);
    runUntil(sim, () => sim.getState(id) === 'ARRIVED', 600);
    expect(sim.getState(id)).toBe('ARRIVED');
  });

  it('marks an agent held back by a crowd as stuck, and moving again once the way clears', () => {
    const world = worldFromRows(['################', '................', '################'], 8);
    const sim = simulation(world, { stuckTime: 1 });
    const blockers = [6.5, 7.5, 8.5].map(x => sim.addAgent({ position: { x, y: 1.5 }, radius: 0.45, maxSpeed: 1 }));
    const id = sim.addAgent({ position: { x: 1.5, y: 1.5 }, radius: 0.4, maxSpeed: 2, goal: { ne: 14, se: 1 } });
    runUntil(sim, () => sim.getState(id) === 'STUCK', 400);
    expect(sim.getState(id)).toBe('STUCK');
    for (const b of blockers) {
      sim.removeAgent(b);
    }
    sim.step();
    sim.step();
    runUntil(sim, () => sim.getState(id) !== 'STUCK', 100);
    expect(sim.getState(id)).toBe('MOVING');
    runUntil(sim, () => sim.getState(id) === 'ARRIVED', 400);
    expect(sim.getState(id)).toBe('ARRIVED');
  });

  it('lets a crowd with one goal arrive around it instead of pushing for the cell', () => {
    /** Largest distance from the goal center at which an agent arrived. */
    const arrivalSpread = (chainGap: number) => {
      const sim = simulation(openWorld(32, 32), { arrivalChainGap: chainGap });
      const ids: number[] = [];
      for (let k = 0; k < 12; k++) {
        ids.push(
          sim.addAgent({
            position: { x: 3.5 + (k % 4), y: 3.5 + Math.floor(k / 4) },
            radius: 0.4,
            maxSpeed: 2,
            goal: { ne: 24, se: 24 },
          }),
        );
      }
      let spread = 0;
      const arrived = new Set<number>();
      runUntil(
        sim,
        () => {
          for (const id of ids) {
            if (!arrived.has(id) && sim.getState(id) === 'ARRIVED') {
              arrived.add(id);
              const p = sim.getPosition(id);
              spread = Math.max(spread, Math.hypot(p.x - 24.5, p.y - 24.5));
            }
          }
          return arrived.size === ids.length;
        },
        3000,
      );
      return { spread, arrived: arrived.size };
    };
    const chained = arrivalSpread(0.2);
    expect(chained.arrived).toBe(12);
    expect(chained.spread).toBeGreaterThan(1); // arrived next to the others, not at the cell
    const lone = arrivalSpread(0);
    expect(lone.spread).toBeLessThanOrEqual(0.5); // each one had to reach the goal itself
  });

  it('lists the neighbors of an agent by ascending id', () => {
    const sim = simulation(openWorld(16, 16));
    const ids = [5, 3, 4, 9].map(x => sim.addAgent({ position: { x: x + 0.5, y: 4.5 }, radius: 0.4, maxSpeed: 1 }));
    const seen: [number, number][] = [];
    sim.forEachNeighbor(ids[2]!, 1.5, (id, d) => {
      seen.push([id, d]);
    });
    expect(seen).toEqual([
      [ids[0], 1],
      [ids[1], 1],
    ]);
  });

  it('runs without any steering strategies', () => {
    const sim = simulation(openWorld(16, 16), { preferredModifiers: [], forces: [], overlap: null });
    const id = sim.addAgent({
      position: { x: 2.5, y: 2.5 },
      radius: 0.4,
      maxSpeed: 2,
      maxAccel: 4,
      goal: { ne: 12, se: 12 },
    });
    runUntil(sim, () => sim.getState(id) === 'ARRIVED', 400);
    expect(sim.getState(id)).toBe('ARRIVED');
    expect(sim.tick).toBeGreaterThan(0);
  });

  it('plans routes without moving anyone', () => {
    const world = openWorld(16, 16);
    world.grid.updateCosts(Array.from({ length: 16 }, (_, se) => ({ ne: 7, se, cost: 255 })));
    const guidance = new FlowRouteGuidance(world.pathfinder, 0);
    const sim = simulation(world, { guidance });
    const free = sim.addAgent({ position: { x: 2.5, y: 2.5 }, radius: 0.4, maxSpeed: 2, goal: { ne: 5, se: 12 } });
    const cut = sim.addAgent({ position: { x: 2.5, y: 8.5 }, radius: 0.4, maxSpeed: 2, goal: { ne: 12, se: 8 } });
    const idle = sim.addAgent({ position: { x: 4.5, y: 4.5 }, radius: 0.4, maxSpeed: 2 });
    sim.plan();
    expect(guidance.getRoute(free)).not.toBeNull();
    expect(sim.getState(cut)).toBe('UNREACHABLE');
    expect(sim.getState(idle)).toBe('IDLE');
    expect(sim.getPosition(free)).toEqual({ x: 2.5, y: 2.5 });
    expect(sim.tick).toBe(0);
    sim.applyTerrain([{ ne: 7, se: 8, cost: 1 }]);
    sim.plan();
    expect(sim.getState(cut)).toBe('MOVING');
  });

  it('changes the top speed of an agent', () => {
    const sim = simulation(openWorld(32, 16), { preferredModifiers: [], forces: [] });
    const id = sim.addAgent({ position: { x: 2.5, y: 8.5 }, radius: 0.4, maxSpeed: 2, goal: { ne: 30, se: 8 } });
    sim.setMaxSpeed(id, 0.5);
    for (let t = 0; t < 60; t++) {
      sim.step();
    }
    expect(Math.hypot(sim.getVelocity(id).x, sim.getVelocity(id).y)).toBeCloseTo(0.5);
    expect(() => sim.setMaxSpeed(id, -1)).toThrow(RangeError);
  });

  it('limits the acceleration', () => {
    const sim = simulation(openWorld(16, 16), { preferredModifiers: [], forces: [] });
    const id = sim.addAgent({
      position: { x: 2.5, y: 2.5 },
      radius: 0.4,
      maxSpeed: 2,
      maxAccel: 1,
      goal: { ne: 12, se: 2 },
    });
    sim.step();
    const v = sim.getVelocity(id);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1 / 20);
  });

  it('cannot be used after dispose', () => {
    const sim = simulation(openWorld(16, 16));
    const id = sim.addAgent({ position: { x: 2.5, y: 2.5 }, radius: 0.4, maxSpeed: 2 });
    sim.dispose();
    sim.dispose();
    expect(() => sim.step()).toThrow();
    expect(() => sim.getPosition(id)).toThrow();
    expect(() => sim.addAgent({ position: { x: 2.5, y: 2.5 }, radius: 0.4, maxSpeed: 2 })).toThrow();
  });

  it('lets the neighbor callback change the crowd', () => {
    const sim = simulation(openWorld(16, 16));
    const ids = [0, 1, 2, 3].map(k => sim.addAgent({ position: { x: 4 + k * 0.9, y: 4 }, radius: 0.4, maxSpeed: 1 }));
    const seen: [number, number][] = [];
    sim.forEachNeighbor(ids[0]!, 5, (n, d) => {
      seen.push([n, d]);
      if (n === ids[1]) {
        sim.removeAgent(ids[1]!);
        sim.getPosition(ids[0]!); // compacts the store
        sim.forEachNeighbor(ids[3]!, 5, () => {}); // reuses the neighbor buffer
      }
    });
    expect(seen.map(([n]) => n)).toEqual([ids[1], ids[2], ids[3]]);
    expect(seen[1]![1]).toBeCloseTo(1.8);
    expect(seen[2]![1]).toBeCloseTo(2.7);
  });

  it('does not take a slow agent walking steadily for stuck', () => {
    const sim = simulation(openWorld(32, 16));
    // 0.1 cells/s: 0.2 cells in the 2 s stuck time, less than stuckDistance
    const id = sim.addAgent({ position: { x: 2.5, y: 8.5 }, radius: 0.4, maxSpeed: 0.1, goal: { ne: 28, se: 8 } });
    for (let t = 0; t < 200; t++) {
      sim.step(); // 10 s
      expect(sim.getState(id)).toBe('MOVING');
    }
    expect(sim.getPosition(id).x).toBeGreaterThan(3.3);
  });

  it('replans only for sectors whose terrain really changed', () => {
    const world = openWorld(32, 32);
    const guidance = new FlowRouteGuidance(world.pathfinder, 0);
    const sim = simulation(world, { guidance });
    sim.addAgent({ position: { x: 2.5, y: 2.5 }, radius: 0.4, maxSpeed: 2, goal: { ne: 28, se: 28 } });
    sim.step();
    const plans = guidance.getPlanCount();
    const same = world.grid.getSectorAt(2, 2)!.getCostField().getCost(2, 2);
    sim.applyTerrain([{ ne: 2, se: 2, cost: same }]); // no change
    sim.step();
    expect(guidance.getPlanCount()).toBe(plans);
    sim.applyTerrain([{ ne: 2, se: 3, cost: same + 5 }]);
    sim.step();
    expect(guidance.getPlanCount()).toBe(plans + 1);
  });
});
