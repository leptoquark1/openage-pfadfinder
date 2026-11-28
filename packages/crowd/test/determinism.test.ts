import { describe, expect, it } from 'vitest';
import { DensityCostModel } from '../src/congestion/density-cost.ts';
import { simulation, worldFromRows } from './helpers.ts';

function run(ticks: number): number {
  const rows = ['################################'];
  for (let y = 0; y < 14; y++) {
    rows.push(y === 6 ? '#...............#..............#' : '#..............................#');
  }
  rows.push('################################');
  const sim = simulation(worldFromRows(rows, 8), { congestion: new DensityCostModel() });
  let seed = 99;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const ids: number[] = [];
  for (let k = 0; k < 40; k++) {
    const east = k % 2 === 0;
    ids.push(
      sim.addAgent({
        position: { x: east ? 2 + rnd() * 6 : 24 + rnd() * 6, y: 2 + rnd() * 12 },
        radius: 0.35,
        maxSpeed: 1 + rnd(),
        group: east ? 0 : 1,
        goal: { ne: east ? 29 : 2, se: 1 + Math.floor(rnd() * 13) },
      }),
    );
  }
  for (let t = 0; t < ticks; t++) {
    sim.step();
    for (const id of ids) {
      if (sim.getState(id) === 'ARRIVED') {
        const p = sim.getPosition(id);
        sim.setGoal(id, { ne: p.x < 16 ? 29 : 2, se: Math.floor(p.y) });
      }
    }
    if (t === Math.floor(ticks / 2)) {
      sim.applyTerrain([{ ne: 16, se: 10, cost: 255 }]);
    }
  }
  return sim.stateHash();
}

describe('determinism', () => {
  it('gives identical states for identical runs', { timeout: 60_000 }, () => {
    const a = run(10_000);
    const b = run(10_000);
    expect(a).toBe(b);
    expect(run(300)).not.toBe(a);
  });
});
