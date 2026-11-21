import { describe, expect, it } from 'vitest';
import { Integrator } from '../src/lib/core/integrator.js';
import { FieldCache } from '../src/lib/pathfinding/field-cache.js';
import { Pathfinder } from '../src/lib/pathfinding/pathfinder.js';
import { COST_IMPASSABLE, COST_MIN } from '../src/shared/constants.js';
import { buildGrid } from '../src/shared/cost-map/cost-map.js';

const SECTOR = 8;
const WIDTH = SECTOR * 2;

function setup() {
  const costs = new Uint8Array(WIDTH * SECTOR).fill(COST_MIN);
  costs[3 + 3 * WIDTH] = COST_IMPASSABLE;
  const grid = buildGrid(costs, { width: WIDTH, height: SECTOR }, SECTOR);
  return { grid, costField: grid.getSectors()[0]!.getCostField(), integrator: new Integrator() };
}

const cellsOf = (pair: ReturnType<Integrator['get']>) => ({
  costs: [...pair.integrationField.getCosts()],
  flags: [...pair.integrationField.getFlagsArray()],
  flow: [...pair.flowField.getCells()],
});

describe('Integrator.getTargetShared', () => {
  it('hands out one pair of fields per target', () => {
    const { costField, integrator } = setup();
    const first = integrator.getTargetShared(costField, { ne: 6, se: 6 });

    expect(integrator.getTargetShared(costField, { ne: 6, se: 6 })).toBe(first);
    expect(integrator.getTargetShared(costField, { ne: 1, se: 6 })).not.toBe(first);
  });

  it('holds what get() computes with line of sight', () => {
    const { costField, integrator } = setup();
    const target = { ne: 6, se: 6 };

    expect(cellsOf(integrator.getTargetShared(costField, target))).toEqual(cellsOf(integrator.get(costField, target)));
  });

  it('computes the fields again once the cost field changed', () => {
    const { costField, integrator } = setup();
    const target = { ne: 6, se: 6 };
    const before = integrator.getTargetShared(costField, target);

    costField.setCost(5, 6, COST_IMPASSABLE);
    const after = integrator.getTargetShared(costField, target);

    expect(after).not.toBe(before);
    expect(cellsOf(after)).toEqual(cellsOf(integrator.get(costField, target)));
  });

  it('keeps the most recently used targets and drops the oldest', () => {
    const { costField, integrator } = setup();
    const at = (ne: number) => integrator.getTargetShared(costField, { ne, se: 0 });
    const kept = Array.from({ length: FieldCache.MAX_TARGETS }, (_, ne) => at(ne));

    // using the oldest makes the second one the next to go
    expect(at(0)).toBe(kept[0]);
    at(FieldCache.MAX_TARGETS);

    expect(at(0)).toBe(kept[0]);
    expect(at(1)).not.toBe(kept[1]);
  });

  it('does not count as a portal field', () => {
    const { costField, integrator } = setup();
    integrator.getTargetShared(costField, { ne: 6, se: 6 });

    expect(integrator.getCachedFieldCount()).toBe(0);
  });

  it('does not share fields between cost fields', () => {
    const { grid, integrator } = setup();
    const [left, right] = grid.getSectors();
    const target = { ne: 6, se: 6 };

    expect(integrator.getTargetShared(left!.getCostField(), target)).not.toBe(
      integrator.getTargetShared(right!.getCostField(), target),
    );
  });
});

describe('FieldCache target fields', () => {
  it('replaces an entry without evicting another and clears with the cache', () => {
    const cache = new FieldCache();
    const { costField, integrator } = setup();
    const entry = () => ({ ...integrator.get(costField, { ne: 0, se: 0 }), costFieldVersion: 0 });
    const kept = Array.from({ length: FieldCache.MAX_TARGETS }, entry);
    kept.forEach((e, cell) => {
      cache.addTarget(cell, e);
    });

    const replacement = entry();
    cache.addTarget(0, replacement);
    expect(cache.getTarget(0)).toBe(replacement);
    expect(cache.getTarget(1)).toBe(kept[1]);

    cache.clear();
    expect(cache.getTarget(0)).toBeUndefined();
  });
});

describe('Pathfinder with one target', () => {
  it('shares the target field between routes and replans after a change', () => {
    const { grid } = setup();
    const pf = new Pathfinder();
    pf.addGrid(grid);
    const target = { ne: 13, se: 4 };
    const route = (ne: number, se: number) => pf.getFlowRoute({ gridId: 0, start: { ne, se }, target })!;
    const targetField = (r: ReturnType<typeof route>) => r.getSteps().at(-1)!.flowField;

    const first = route(1, 1);
    expect(targetField(route(2, 6))).toBe(targetField(first));
    expect(targetField(route(10, 1))).toBe(targetField(first));

    grid.updateCosts([{ ne: 12, se: 4, cost: COST_IMPASSABLE }]);
    expect(targetField(route(1, 1))).not.toBe(targetField(first));
    // a route planned before keeps the fields it was given
    expect(first.next(12, 4)).not.toBeNull();
  });
});
