import { describe, expect, it } from 'vitest';
import { DensityCostModel } from '../src/congestion/density-cost.ts';
import { PowerLawAvoidance } from '../src/steering/power-law.ts';
import { Separation } from '../src/steering/separation.ts';
import { SideRule } from '../src/steering/side-rule.ts';
import { contextOf, openWorld, simulation } from './helpers.ts';

describe('configure()', () => {
  it('changes the power law live and validates', () => {
    const law = new PowerLawAvoidance();
    const before = law.pairForce(-2, 0, 2, 0, 1)!.x;
    law.configure({ strength: 3 });
    expect(law.pairForce(-2, 0, 2, 0, 1)!.x).toBeCloseTo(before * 2);
    expect(law.options.strength).toBe(3);
    expect(law.options.horizon).toBe(3); // kept
    law.configure({ horizon: 0.1 });
    expect(law.pairForce(-2, 0, 2, 0, 1)).toBeNull(); // τ = 0.5 s beyond the horizon
    expect(() => law.configure({ tau0: 0 })).toThrow(RangeError);
    expect(() => law.configure({ strength: Number.NaN })).toThrow(RangeError);
  });

  it('changes the separation range live', () => {
    const sep = new Separation();
    const { ctx, neighborsOf } = contextOf([
      { x: 0, y: 0, r: 0.4 },
      { x: 1.3, y: 0, r: 0.4 },
    ]);
    const out = { x: 0, y: 0 };
    sep.accumulate(ctx, 0, neighborsOf(0), out);
    expect(out.x).toBe(0); // gap 0.5 > 0.2
    sep.configure({ range: 1 });
    expect(sep.options).toEqual({ range: 1, strength: 8 });
    sep.accumulate(ctx, 0, neighborsOf(0), out);
    expect(out.x).toBeLessThan(0);
    expect(() => sep.configure({ range: 0 })).toThrow(RangeError);
  });

  it('switches the side of the side rule live and validates', () => {
    const rule = new SideRule();
    const { ctx, neighborsOf } = contextOf([
      { x: 0, y: 0, vx: 1 },
      { x: 3, y: 0, vx: -1 },
    ]);
    const v = { x: 1, y: 0 };
    rule.configure({ side: 'left' });
    rule.apply(ctx, 0, neighborsOf(0), v);
    expect(v.y).toBeLessThan(0);
    expect(rule.options.side).toBe('left');
    expect(rule.options.strength).toBe(1);
    expect(() => rule.configure({ side: 'up' as 'left' })).toThrow(RangeError);
    expect(() => rule.configure({ angle: 120 })).toThrow(RangeError);
    expect(() => rule.configure({ horizon: 0 })).toThrow(RangeError);
  });

  it('changes the congestion model live, also its timing once attached', () => {
    const model = new DensityCostModel();
    model.configure({ costPerDensity: 80, maxSurcharge: 999 });
    expect(model.options.costPerDensity).toBe(80);
    expect(model.options.maxSurcharge).toBe(254); // capped at COST_MAX
    simulation(openWorld(16, 16), { congestion: model });
    model.configure({ commitInterval: 1, dwellTime: 0, smoothingTime: 0 });
    expect(model.options.commitInterval).toBe(1);
    expect(() => model.configure({ commitInterval: 0 })).toThrow(RangeError);
    expect(() => model.configure({ freeDensity: -1 })).toThrow(RangeError);
  });
});

describe('initial velocity', () => {
  it('starts an agent with the given velocity and validates it', () => {
    const sim = simulation(openWorld(16, 16));
    const id = sim.addAgent({ position: { x: 4.5, y: 4.5 }, radius: 0.4, maxSpeed: 2, velocity: { x: 1, y: -0.5 } });
    expect(sim.getVelocity(id)).toEqual({ x: 1, y: -0.5 });
    const count = sim.agentCount;
    expect(() =>
      sim.addAgent({ position: { x: 4.5, y: 4.5 }, radius: 0.4, maxSpeed: 2, velocity: { x: Infinity, y: 0 } }),
    ).toThrow(RangeError);
    expect(sim.agentCount).toBe(count);
  });
});
