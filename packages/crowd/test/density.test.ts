import { COST_IMPASSABLE, COST_MAX, COST_MIN } from '@leptoquark1/openage-pfadfinder';
import { describe, expect, it } from 'vitest';
import { DensityCostModel } from '../src/congestion/density-cost.ts';
import { DensityField } from '../src/congestion/density-field.ts';
import { openWorld, simulation, worldFromRows } from './helpers.ts';

describe('DensityField', () => {
  it('splats bilinearly and conserves the mass, also at the border', () => {
    const field = new DensityField(8, 8, 1, 0); // no smoothing: density = observation
    field.splat(2, 3); // between cells (1, 2), (2, 2), (1, 3), (2, 3)
    field.splat(0.1, 0.1); // corner: everything stays inside
    field.update();
    expect(field.at(1, 2)).toBeCloseTo(0.25);
    expect(field.at(2, 3)).toBeCloseTo(0.25);
    expect(field.at(0, 0)).toBeCloseTo(1);
    expect(field.total()).toBeCloseTo(2);
    expect(field.at(-1, 0)).toBe(0);
  });

  it('smooths with a time constant independent of the timestep', () => {
    // after 1 s of constant observation: 1 − e^(−1/T), whatever dt
    for (const dt of [1 / 10, 1 / 60]) {
      const field = new DensityField(4, 4, dt, 2);
      for (let t = 0; t < Math.round(1 / dt); t++) {
        field.splat(1.5, 1.5);
        field.update();
      }
      expect(field.at(1, 1)).toBeCloseTo(1 - Math.exp(-0.5), 5);
    }
  });

  it('forgets empty cells', () => {
    const field = new DensityField(4, 4, 1, 0.1);
    field.splat(1.5, 1.5);
    field.update();
    expect(field.activeCells().count).toBe(1);
    field.update();
    expect(field.at(1, 1)).toBe(0);
    expect(field.activeCells().count).toBe(0);
    field.splat(1.5, 1.5);
    field.update();
    field.clear();
    expect(field.total()).toBe(0);
  });
});

/** One sector, a wall at x = 8 with gaps at y = 3 (direct) and y = 12 (detour), and a jam in front of the direct gap. */
function bottlenecks(jam: number, congestion: DensityCostModel | null) {
  const rows: string[] = [];
  for (let y = 0; y < 16; y++) {
    rows.push(`........${y === 3 || y === 12 ? '.' : '#'}.......`);
  }
  const world = worldFromRows(rows, 16);
  const sim = simulation(world, { congestion });
  for (let a = 0; a < jam; a++) {
    sim.addAgent({ position: { x: 5.5 + (a % 4) * 0.8, y: 2.3 + Math.floor(a / 4) * 0.8 }, radius: 0.35, maxSpeed: 1 });
  }
  for (let t = 0; t < 100; t++) {
    sim.step();
  }
  const path = world.pathfinder.getPath({ gridId: 0, start: { ne: 1, se: 3 }, target: { ne: 14, se: 3 } });
  const gapY = Math.max(...path.waypoints.map(p => p.se));
  return { world, sim, gapY };
}

describe('DensityCostModel', () => {
  it('sends a new route through the other bottleneck of the sector when one is jammed', () => {
    expect(bottlenecks(12, null).gapY).toBe(3);
    expect(bottlenecks(12, new DensityCostModel()).gapY).toBe(12);
  });

  it('writes surcharges with hysteresis and a dwell time, not every tick', () => {
    const model = new DensityCostModel();
    const { world, sim } = bottlenecks(12, model);
    const field = world.grid.getSectorAt(0, 0)!.getCostField();
    const v0 = field.getVersion();
    expect(model.surchargeAt(6, 3)).toBeGreaterThan(0);
    for (let t = 0; t < 100; t++) {
      sim.step();
    }
    // 5 s at 20 Hz: at most one write per dwell time (1 s)
    expect(field.getVersion() - v0).toBeLessThanOrEqual(5);
  });

  it('never touches impassable cells and never makes a passable one impassable', () => {
    const model = new DensityCostModel({ maxSurcharge: 254, costPerDensity: 254, freeDensity: 0, maxStep: 254 });
    const { world, sim } = bottlenecks(12, model);
    for (let t = 0; t < 60; t++) {
      sim.step();
    }
    const costs = world.grid.getSectorAt(0, 0)!.getCostField().getCosts();
    for (let c = 0; c < costs.length; c++) {
      expect(costs[c] === COST_IMPASSABLE).toBe(world.costs[c] === COST_IMPASSABLE);
      expect(costs[c]).toBeLessThanOrEqual(costs[c] === COST_IMPASSABLE ? COST_IMPASSABLE : COST_MAX);
    }
    expect(model.surchargeAt(8, 0)).toBe(0); // a wall cell
  });

  it('lets the surcharge fade once the crowd is gone', () => {
    const model = new DensityCostModel();
    const { sim } = bottlenecks(12, model);
    expect(model.surchargeAt(6, 3)).toBeGreaterThan(0);
    for (const id of [...Array(12).keys()]) {
      sim.removeAgent(id);
    }
    for (let t = 0; t < 400; t++) {
      sim.step();
    }
    expect(model.surchargeAt(6, 3)).toBe(0);
    expect(model.baseCostAt(6, 3)).toBe(COST_MIN);
  });

  it('keeps base costs and surcharges apart through applyTerrain', () => {
    const model = new DensityCostModel();
    const { world, sim } = bottlenecks(12, model);
    const s = model.surchargeAt(6, 3);
    expect(s).toBeGreaterThan(0);
    sim.applyTerrain([
      { ne: 6, se: 3, cost: 10 }, // under the jam: new base, surcharge kept
      { ne: 7, se: 9, cost: COST_IMPASSABLE },
      { ne: 99, se: 99, cost: 1 }, // outside: ignored
    ]);
    const field = world.grid.getSectorAt(0, 0)!.getCostField();
    expect(model.baseCostAt(6, 3)).toBe(10);
    expect(field.getCost(6, 3)).toBe(10 + model.surchargeAt(6, 3));
    expect(field.getCost(7, 9)).toBe(COST_IMPASSABLE);
    sim.dispose();
    // the current base, not the costs from before the terrain change
    expect(field.getCost(6, 3)).toBe(10);
    expect(field.getCost(7, 9)).toBe(COST_IMPASSABLE);
    expect(field.getCost(6, 4)).toBe(COST_MIN);
  });

  it('takes over terrain changed behind its back and reports it unsafe', () => {
    const model = new DensityCostModel();
    const { world, sim } = bottlenecks(12, model);
    const field = world.grid.getSectorAt(0, 0)!.getCostField();
    world.grid.updateCosts([{ ne: 2, se: 12, cost: COST_IMPASSABLE }]);
    for (let t = 0; t < 20; t++) {
      sim.step();
    }
    expect(model.baseCostAt(2, 12)).toBe(COST_IMPASSABLE);
    sim.dispose();
    expect(field.getCost(2, 12)).toBe(COST_IMPASSABLE); // not restored to the old base
    expect(field.getCost(6, 3)).toBe(COST_MIN);
  });

  it('reports nothing outside the map or before it is attached', () => {
    const model = new DensityCostModel();
    expect(model.field).toBeUndefined();
    expect(model.surchargeAt(0, 0)).toBe(0);
    expect(model.baseCostAt(0, 0)).toBe(COST_IMPASSABLE);
    const sim = simulation(openWorld(16, 16), { congestion: model });
    expect(sim.density).toBe(model.field);
    expect(model.baseCostAt(-1, 0)).toBe(COST_IMPASSABLE);
    expect(model.baseCostAt(3, 3)).toBe(COST_MIN);
  });
});
