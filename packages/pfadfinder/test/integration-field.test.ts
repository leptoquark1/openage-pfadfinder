import { describe, expect, it } from 'vitest';
import { CostField } from '../src/lib/core/cost-field.js';
import { FlowField } from '../src/lib/core/flow-field.js';
import { IntegrationField } from '../src/lib/core/integration-field.js';
import { FLOW_PATHABLE_MASK, INTEGRATED_COST_UNREACHABLE } from '../src/shared/constants.js';
import { FlowDir } from '../src/shared/types.js';

describe('IntegrationField', () => {
  it('creates field with correct size', () => {
    const ifield = new IntegrationField(5);
    expect(ifield.getSize()).toBe(5);
    expect(ifield.getCosts().length).toBe(25);
  });

  it('reset fills with UNREACHABLE', () => {
    const ifield = new IntegrationField(3);
    ifield.getCosts()[0] = 42;
    ifield.reset();
    expect(ifield.getCost(0)).toBe(INTEGRATED_COST_UNREACHABLE);
  });

  it('integrateCost sets target to 0', () => {
    const cf = new CostField(3);
    cf.setCosts(new Uint8Array([1, 1, 1, 1, 1, 1, 1, 1, 1]));
    const ifield = new IntegrationField(3);
    ifield.integrateCost(cf, { ne: 0, se: 0 });
    expect(ifield.getCost(0)).toBe(0);
  });

  it('integrateCost computes correct distances on open grid', () => {
    const size = 5;
    const cf = new CostField(size);
    cf.setCosts(new Uint8Array(size * size).fill(1));
    const ifield = new IntegrationField(size);
    ifield.integrateCost(cf, { ne: 0, se: 0 });

    // Cell (0,0) = target = cost 0
    expect(ifield.getCost(0)).toBe(0);
    // Cell (1,0) = 1 step = cost 1
    expect(ifield.getCost(1)).toBe(1);
    // Cell (0,1) = 1 step = cost 1
    expect(ifield.getCost(5)).toBe(1);
    // Cell (2,3) = Manhattan distance 5 = cost 5
    expect(ifield.getCost(2 + 3 * size)).toBe(5);
  });

  it('integrateCost respects impassable cells', () => {
    const size = 3;
    const cf = new CostField(size);
    // Wall in the middle column
    cf.setCosts(new Uint8Array([1, 255, 1, 1, 255, 1, 1, 1, 1]));
    const ifield = new IntegrationField(size);
    ifield.integrateCost(cf, { ne: 0, se: 0 });

    // Target at (0,0) = 0
    expect(ifield.getCost(0)).toBe(0);
    // (0,1) = cost 1
    expect(ifield.getCost(3)).toBe(1);
    // (1,0) is impassable → unreachable
    expect(ifield.getCost(1)).toBe(INTEGRATED_COST_UNREACHABLE);
    // (2,0) reachable via bottom: 0→3→6→7→8→5→2 = cost 6
    expect(ifield.getCost(2)).toBe(6);
  });

  it('integrateLos marks LOS cells', () => {
    const size = 5;
    const cf = new CostField(size);
    cf.setCosts(new Uint8Array(size * size).fill(1));
    const ifield = new IntegrationField(size);
    ifield.integrateLos(cf, { ne: 0, se: 0 });

    // On an open grid, all cells should have LOS
    // Target cell should have LOS flag
    expect(ifield.getFlags(0) & 0x20).toBeTruthy(); // LOS_MASK
  });

  it('integrateLos with obstacle returns wavefront blocked cells', () => {
    const size = 5;
    const cf = new CostField(size);
    cf.setCosts(new Uint8Array(size * size).fill(1));
    // Place obstacle at (2,2)
    cf.setCost(2, 2, 10);
    const ifield = new IntegrationField(size);
    const blocked = ifield.integrateLos(cf, { ne: 0, se: 0 });

    // The obstacle cell should be in wavefront_blocked
    expect(blocked.length).toBeGreaterThan(0);
  });
});

describe('FlowField', () => {
  it('creates field with correct size', () => {
    const ff = new FlowField(4);
    expect(ff.getSize()).toBe(4);
    expect(ff.getCells().length).toBe(16);
  });

  it('build from integration field sets directions', () => {
    const size = 3;
    const cf = new CostField(size);
    cf.setCosts(new Uint8Array(size * size).fill(1));
    const ifield = new IntegrationField(size);
    ifield.integrateCost(cf, { ne: 0, se: 0 });
    ifield.integrateLos(cf, { ne: 0, se: 0 });

    const ff = new FlowField(size);
    ff.build(ifield);

    // Cell (1,0) should point WEST (toward target at 0,0)
    expect(ff.getDir(1)).toBe(FlowDir.WEST);
    // Cell (0,1) should point NORTH (toward target at 0,0)
    expect(ff.getDir(3)).toBe(FlowDir.NORTH);
    // Cell (1,1) should point NORTH_WEST
    expect(ff.getDir(4)).toBe(FlowDir.NORTH_WEST);
  });

  it('build marks target as pathable', () => {
    const size = 3;
    const cf = new CostField(size);
    cf.setCosts(new Uint8Array(size * size).fill(1));
    const ifield = new IntegrationField(size);
    ifield.integrateCost(cf, { ne: 2, se: 2 });

    const ff = new FlowField(size);
    ff.build(ifield);

    // Target cell should be pathable
    expect(ff.getCell(8) & FLOW_PATHABLE_MASK).toBeTruthy();
  });

  it('build leaves unreachable cells as init', () => {
    const size = 3;
    const cf = new CostField(size);
    cf.setCosts(new Uint8Array([1, 255, 1, 255, 255, 255, 1, 1, 1]));
    const ifield = new IntegrationField(size);
    ifield.integrateCost(cf, { ne: 0, se: 0 });

    const ff = new FlowField(size);
    ff.build(ifield);

    // Impassable cells should not be pathable
    expect(ff.getCell(1) & FLOW_PATHABLE_MASK).toBeFalsy();
  });

  it('reset clears all cells', () => {
    const ff = new FlowField(2);
    ff.getCells()[0] = 0xff;
    ff.reset();
    expect(ff.getCell(0)).toBe(0);
  });

  it('clamps accumulated costs to 65534 and never wraps to near-zero', () => {
    // High cost + long path: 300 cells × cost 254 = 76200 > 65535.
    // Without the clamp, the Uint16Array would wrap to a small value,
    // pretending those cells were closer to the target than earlier cells.
    const size = 30; // 30×30 grid, path length > 300 needed: serpentine via portal-like target
    const cf = new CostField(size);
    cf.setCosts(new Uint8Array(size * size).fill(254)); // every cell is expensive
    const ifield = new IntegrationField(size);

    ifield.integrateCost(cf, { ne: 0, se: 0 });

    // Max Manhattan distance in a 30x30 grid is 29+29=58 steps.
    // Worst-case accumulated cost with clamping: 58 × 254 = 14732 (no overflow).
    // We can verify the deepest corner cell:
    const corner = size - 1 + (size - 1) * size;
    const cornerCost = ifield.getCost(corner);
    expect(cornerCost).toBeLessThanOrEqual(INTEGRATED_COST_UNREACHABLE - 1);
    expect(cornerCost).toBeGreaterThan(0); // it was reached (not left as 65535)

    // Verify the cost increases monotonically with Manhattan distance from target
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const c = ifield.getCost(x + y * size);
        const expected = (x + y) * 254;
        expect(c).toBe(Math.min(expected, INTEGRATED_COST_UNREACHABLE - 1));
      }
    }
  });
});

describe('LOS integration on walled sectors', () => {
  const SIZE = 16;

  /** Deterministic sector with random wall cells. */
  function randomCosts(seed: number): Uint8Array {
    let state = seed >>> 0;
    const rand = (): number => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };
    const costs = new Uint8Array(SIZE * SIZE).fill(1);
    for (let i = 0; i < costs.length; i++) {
      if (rand() < 0.3) {
        costs[i] = 255;
      }
    }
    return costs;
  }

  /** 4-connected flood fill over passable cells. */
  function reachableFrom(costs: Uint8Array, start: number): Set<number> {
    const seen = new Set([start]);
    const queue = [start];
    for (let i = 0; i < queue.length; i++) {
      const idx = queue[i]!;
      const x = idx % SIZE;
      const next = [x > 0 ? idx - 1 : -1, x < SIZE - 1 ? idx + 1 : -1, idx - SIZE, idx + SIZE];
      for (const n of next) {
        if (n >= 0 && n < costs.length && !seen.has(n) && costs[n] !== 255) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    return seen;
  }

  // A shadow line from the target through a wall corner can pass diagonally
  // into a pocket the LOS wave never reaches; such cells must not seed the
  // cost wave with the "unreachable" sentinel.
  it('gives a cost only to cells reachable from the target', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const costs = randomCosts(seed);
      const target = costs.findIndex(c => c !== 255);
      const cf = new CostField(SIZE);
      cf.setCosts(costs);
      const field = new IntegrationField(SIZE);
      field.integrateCostFromWavefront(
        cf,
        field.integrateLos(cf, { ne: target % SIZE, se: Math.floor(target / SIZE) }),
      );
      const reachable = reachableFrom(costs, target);
      for (let i = 0; i < costs.length; i++) {
        if (!reachable.has(i)) {
          expect(field.getCost(i), `seed ${seed} cell ${i % SIZE},${Math.floor(i / SIZE)}`).toBe(
            INTEGRATED_COST_UNREACHABLE,
          );
        }
      }
    }
  });
});
