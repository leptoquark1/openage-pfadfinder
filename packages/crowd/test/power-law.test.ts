import { describe, expect, it } from 'vitest';
import { PowerLawAvoidance } from '../src/steering/power-law.ts';
import { timeToCollision } from '../src/steering/ttc.ts';
import { contextOf, minGap, openWorld, runUntil, simulation } from './helpers.ts';

describe('timeToCollision', () => {
  it('is the time until the discs touch', () => {
    // 4 apart, closing at 2/s, touching at distance 1: 1.5 s
    expect(timeToCollision(-4, 0, 2, 0, 1)).toBeCloseTo(1.5);
  });

  it('is 0 when overlapping and Infinity without a collision', () => {
    expect(timeToCollision(0.5, 0, 1, 0, 1)).toBe(0);
    expect(timeToCollision(-4, 0, -1, 0, 1)).toBe(Infinity); // moving apart
    expect(timeToCollision(-4, 0, 0, 0, 1)).toBe(Infinity); // no relative motion
    expect(timeToCollision(-4, 3, 1, 0, 1)).toBe(Infinity); // passing
  });
});

describe('PowerLawAvoidance.pairForce', () => {
  const law = new PowerLawAvoidance();

  it('pushes back along the line for a head-on approach', () => {
    const f = law.pairForce(-2, 0, 2, 0, 1)!;
    expect(f.x).toBeLessThan(0);
    expect(f.y).toBeCloseTo(0);
  });

  it('has a lateral component for an offset approach, away from the other', () => {
    // the other agent is ahead and slightly to +y: dodge towards -y
    const f = law.pairForce(-3, -0.4, 2, 0, 0.8)!;
    expect(f.y).toBeLessThan(0);
  });

  it('matches the numerical gradient of the energy', () => {
    const k = 1.5;
    const tau0 = 3;
    const energy = (x: number, y: number) => {
      const tau = timeToCollision(x, y, 1.2, 0.3, 0.8);
      return (k / (tau * tau)) * Math.exp(-tau / tau0);
    };
    const x = -3;
    const y = -0.2;
    const h = 1e-6;
    const gx = -(energy(x + h, y) - energy(x - h, y)) / (2 * h);
    const gy = -(energy(x, y + h) - energy(x, y - h)) / (2 * h);
    const f = law.pairForce(x, y, 1.2, 0.3, 0.8)!;
    expect(f.x).toBeCloseTo(gx, 5);
    expect(f.y).toBeCloseTo(gy, 5);
  });

  it('gives no force without a predicted collision within the horizon', () => {
    expect(law.pairForce(0.5, 0, 1, 0, 1)).toBeNull(); // overlapping
    expect(law.pairForce(-4, 0, 1e-8, 0, 1)).toBeNull(); // no relative motion
    expect(law.pairForce(-4, 0, -1, 0, 1)).toBeNull(); // moving apart
    expect(law.pairForce(-4, 3, 1, 0, 1)).toBeNull(); // passing
    expect(law.pairForce(-10, 0, 1, 0, 1)).toBeNull(); // τ = 9 s > horizon
  });

  it('saturates below tauMin', () => {
    // τ = 0.05 s and 0.02 s, both below 0.2 s; head-on, so the direction is v
    const a = law.pairForce(-1.05, 0, 1, 0, 1)!.x;
    const b = law.pairForce(-1.02, 0, 1, 0, 1)!.x;
    expect(a).toBeCloseTo(b);
  });

  it('caps the summed force', () => {
    const bodies = [{ x: 0, y: 0, vx: 2 }];
    for (let k = 0; k < 8; k++) {
      bodies.push({ x: 1 + k * 0.1, y: (k - 4) * 0.2, vx: -2 });
    }
    const { ctx, neighborsOf } = contextOf(bodies);
    const out = { x: 0, y: 0 };
    new PowerLawAvoidance({ maxForce: 5 }).accumulate(ctx, 0, neighborsOf(0), out);
    expect(Math.hypot(out.x, out.y)).toBeCloseTo(5);
  });

  it('adds nothing for agents walking side by side', () => {
    const { ctx, neighborsOf } = contextOf([
      { x: 0, y: 0, vx: 1.5 },
      { x: 0, y: 1, vx: 1.5 },
    ]);
    const out = { x: 0.25, y: -0.5 };
    new PowerLawAvoidance().accumulate(ctx, 0, neighborsOf(0), out);
    expect(out).toEqual({ x: 0.25, y: -0.5 });
  });
});

describe('PowerLawAvoidance in the simulation', () => {
  it('lets two agents walking head-on evade early and both arrive', () => {
    const sim = simulation(openWorld(32, 16));
    const a = sim.addAgent({ position: { x: 4.5, y: 8.5 }, radius: 0.4, maxSpeed: 1.5, goal: { ne: 27, se: 8 } });
    const b = sim.addAgent({ position: { x: 27.5, y: 8.5 }, radius: 0.4, maxSpeed: 1.5, goal: { ne: 4, se: 8 } });
    let gap = Infinity;
    let dodgeDistance = 0;
    runUntil(
      sim,
      () => {
        gap = Math.min(gap, minGap(sim));
        const pa = sim.getPosition(a);
        const pb = sim.getPosition(b);
        if (dodgeDistance === 0 && Math.abs(pa.y - 8.5) > 0.05) {
          dodgeDistance = pb.x - pa.x;
        }
        return sim.getState(a) === 'ARRIVED' && sim.getState(b) === 'ARRIVED';
      },
      1000,
    );
    expect(sim.getState(a)).toBe('ARRIVED');
    expect(sim.getState(b)).toBe('ARRIVED');
    expect(gap).toBeGreaterThan(0);
    // started to dodge while still more than 2 cells apart
    expect(dodgeDistance).toBeGreaterThan(2);
  });

  it('lets two agents cross at a right angle without touching', () => {
    const sim = simulation(openWorld(32, 32));
    const a = sim.addAgent({ position: { x: 4.5, y: 16.5 }, radius: 0.4, maxSpeed: 1.5, goal: { ne: 28, se: 16 } });
    const b = sim.addAgent({ position: { x: 16.5, y: 4.5 }, radius: 0.4, maxSpeed: 1.5, goal: { ne: 16, se: 28 } });
    let gap = Infinity;
    runUntil(
      sim,
      () => {
        gap = Math.min(gap, minGap(sim));
        return sim.getState(a) === 'ARRIVED' && sim.getState(b) === 'ARRIVED';
      },
      1200,
    );
    expect(sim.getState(a)).toBe('ARRIVED');
    expect(sim.getState(b)).toBe('ARRIVED');
    expect(gap).toBeGreaterThan(0);
  });

  it('lets a fast agent overtake a slow one without oscillating', () => {
    const sim = simulation(openWorld(48, 16));
    const slow = sim.addAgent({ position: { x: 8.5, y: 8.5 }, radius: 0.4, maxSpeed: 0.6, goal: { ne: 44, se: 8 } });
    const fast = sim.addAgent({ position: { x: 3.5, y: 8.5 }, radius: 0.4, maxSpeed: 2, goal: { ne: 44, se: 8 } });
    let gap = Infinity;
    let flips = 0;
    let lastSign = 0;
    runUntil(
      sim,
      () => {
        gap = Math.min(gap, minGap(sim));
        const vy = sim.getVelocity(fast).y;
        const sign = Math.abs(vy) < 0.05 ? 0 : Math.sign(vy);
        if (sign !== 0 && lastSign !== 0 && sign !== lastSign) {
          flips++;
        }
        if (sign !== 0) {
          lastSign = sign;
        }
        return sim.getState(fast) === 'ARRIVED';
      },
      1000,
    );
    expect(sim.getState(fast)).toBe('ARRIVED');
    expect(sim.getPosition(slow).x).toBeLessThan(44);
    expect(gap).toBeGreaterThan(-0.05);
    // out to one side and back in: at most a couple of turns, no zig-zag
    expect(flips).toBeLessThanOrEqual(3);
  });
});
