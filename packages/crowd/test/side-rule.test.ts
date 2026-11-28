import { describe, expect, it } from 'vitest';
import { SideRule } from '../src/steering/side-rule.ts';
import { contextOf, runUntil, simulation, worldFromRows } from './helpers.ts';

describe('SideRule', () => {
  it('turns towards the own right in counter-flow, keeping the speed', () => {
    // heading east; se points down, so right is +y
    const { ctx, neighborsOf } = contextOf([
      { x: 0, y: 0, vx: 1 },
      { x: 3, y: 0, vx: -1 },
    ]);
    const v = { x: 1.5, y: 0 };
    new SideRule().apply(ctx, 0, neighborsOf(0), v);
    expect(v.y).toBeGreaterThan(0);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1.5);
  });

  it('turns left when configured so', () => {
    const { ctx, neighborsOf } = contextOf([
      { x: 0, y: 0, vx: 1 },
      { x: 3, y: 0, vx: -1 },
    ]);
    const v = { x: 1, y: 0 };
    new SideRule({ side: 'left' }).apply(ctx, 0, neighborsOf(0), v);
    expect(v.y).toBeLessThan(0);
  });

  it('overtakes a clearly slower agent ahead on the other side', () => {
    const { ctx, neighborsOf } = contextOf([
      { x: 0, y: 0, vx: 1.5 },
      { x: 1.5, y: 0, vx: 0.5 },
    ]);
    const v = { x: 1.5, y: 0 };
    new SideRule().apply(ctx, 0, neighborsOf(0), v);
    expect(v.y).toBeLessThan(0); // keep right, overtake left (-y when heading east)
    const off = { x: 1.5, y: 0 };
    new SideRule({ overtake: false }).apply(ctx, 0, neighborsOf(0), off);
    expect(off).toEqual({ x: 1.5, y: 0 });
  });

  it('dodges counter-flow before overtaking', () => {
    const { ctx, neighborsOf } = contextOf([
      { x: 0, y: 0, vx: 1.5 },
      { x: 1.5, y: 0, vx: 0.5 },
      { x: 3, y: 0, vx: -1.5 },
    ]);
    const v = { x: 1.5, y: 0 };
    new SideRule().apply(ctx, 0, neighborsOf(0), v);
    expect(v.y).toBeGreaterThan(0);
  });

  it('leaves the velocity alone without counter-flow on a collision course', () => {
    const cases = [
      [
        { x: 0, y: 0, vx: 1 },
        { x: 3, y: 0, vx: 1 },
      ], // same direction, same speed
      [
        { x: 0, y: 0, vx: 1 },
        { x: -3, y: 0, vx: -1 },
      ], // behind
      [
        { x: 0, y: 0, vx: 1 },
        { x: 3, y: 0 },
      ], // standing
      [
        { x: 0, y: 0, vx: 1 },
        { x: 3, y: -5, vx: -1 },
      ], // passing far apart
      [
        { x: 0, y: 0, vx: 1 },
        { x: 3, y: 0.6, vx: -1 },
      ], // already on the right: pass it on the left
    ];
    for (const bodies of cases) {
      const { ctx, neighborsOf } = contextOf(bodies);
      const v = { x: 1, y: 0 };
      new SideRule().apply(ctx, 0, neighborsOf(0), v);
      expect(v).toEqual({ x: 1, y: 0 });
    }
    const { ctx, neighborsOf } = contextOf([{ x: 0, y: 0 }]);
    const still = { x: 0, y: 0 };
    new SideRule().apply(ctx, 0, neighborsOf(0), still);
    expect(still).toEqual({ x: 0, y: 0 });
  });

  it('makes both agents of a head-on pair agree on the side', () => {
    // the neighbor is offset slightly to agent 0's left: both see the same offset
    const bodies = [
      { x: 0, y: 0, vx: 1 },
      { x: 3, y: -0.2, vx: -1 },
    ];
    const { ctx, neighborsOf } = contextOf(bodies);
    const v0 = { x: 1, y: 0 };
    const v1 = { x: -1, y: 0 };
    new SideRule().apply(ctx, 0, neighborsOf(0), v0);
    new SideRule().apply(ctx, 1, neighborsOf(1), v1);
    // each to its own right: 0 to +y, 1 to -y — they part
    expect(v0.y).toBeGreaterThan(0);
    expect(v1.y).toBeLessThan(0);
  });
});

describe('SideRule in the simulation', () => {
  function passOf(side: 'right' | 'left'): number {
    const world = worldFromRows(['................................'.repeat(1)], 8);
    const sim = simulation(world, { preferredModifiers: [new SideRule({ side })] });
    const a = sim.addAgent({ position: { x: 2.5, y: 4.5 }, radius: 0.4, maxSpeed: 1.5, goal: { ne: 29, se: 4 } });
    const b = sim.addAgent({ position: { x: 29.5, y: 4.5 }, radius: 0.4, maxSpeed: 1.5, goal: { ne: 2, se: 4 } });
    let offset = 0;
    runUntil(
      sim,
      () => {
        const pa = sim.getPosition(a);
        const pb = sim.getPosition(b);
        if (offset === 0 && pa.x >= pb.x) {
          offset = pa.y - pb.y; // a's y minus b's y when they pass
        }
        return sim.getState(a) === 'ARRIVED' && sim.getState(b) === 'ARRIVED';
      },
      1000,
    );
    expect(sim.getState(a)).toBe('ARRIVED');
    expect(sim.getState(b)).toBe('ARRIVED');
    return offset;
  }

  it('makes a head-on pair pass on their own right (or left)', () => {
    // a walks east, its right is +y; b walks west, its right is -y
    expect(passOf('right')).toBeGreaterThan(0.5);
    expect(passOf('left')).toBeLessThan(-0.5);
  });

  /** Share of agents in the middle of a corridor walking on their right half, two opposing streams of 30. */
  function laneShare(withRule: boolean, seed0: number): number {
    const rows = ['#'.repeat(64)];
    for (let k = 0; k < 10; k++) {
      rows.push(`#${'.'.repeat(62)}#`);
    }
    rows.push('#'.repeat(64));
    const sim = simulation(worldFromRows(rows), withRule ? {} : { preferredModifiers: [] });
    let seed = seed0;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const streams: { id: number; dir: 1 | -1 }[] = [];
    for (let k = 0; k < 30; k++) {
      for (const dir of [1, -1] as const) {
        const x = dir === 1 ? 1.5 + rnd() * 10 : 52.5 + rnd() * 10;
        const id = sim.addAgent({
          position: { x, y: 1.5 + rnd() * 9 },
          radius: 0.35,
          maxSpeed: 1.3 + rnd() * 0.4,
          group: dir === 1 ? 0 : 1,
          goal: { ne: dir === 1 ? 62 : 1, se: 1 + Math.floor(rnd() * 10) },
        });
        streams.push({ id, dir });
      }
    }
    let good = 0;
    let total = 0;
    for (let t = 0; t < 2400; t++) {
      sim.step();
      for (const { id, dir } of streams) {
        const p = sim.getPosition(id);
        if (sim.getState(id) === 'ARRIVED') {
          // walk the corridor again from the start, in the same row
          sim.teleport(id, { x: dir === 1 ? 1.5 : 62.5, y: p.y });
          sim.setGoal(id, { ne: dir === 1 ? 62 : 1, se: Math.floor(p.y) });
        }
        if (t > 1200 && p.x > 20 && p.x < 44) {
          total++;
          // the right half for an eastbound agent is +y (south), for a westbound one -y
          if ((dir === 1 && p.y > 6) || (dir === -1 && p.y < 6)) {
            good++;
          }
        }
      }
    }
    return good / total;
  }

  it('turns two opposing streams in a corridor into lanes', { timeout: 30_000 }, () => {
    // mean over four crowds: single runs vary by ±0.1, the effect holds on average
    const seeds = [7, 11, 23, 42];
    const mean = (rule: boolean) => seeds.reduce((sum, seed) => sum + laneShare(rule, seed), 0) / seeds.length;
    const without = mean(false);
    const withRule = mean(true);
    expect(without).toBeLessThan(0.6); // no rule: about half on either side
    expect(withRule).toBeGreaterThan(0.6);
    expect(withRule).toBeGreaterThan(without + 0.07);
  });
});
