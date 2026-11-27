import { afterEach, describe, expect, it, vi } from 'vitest';
import { IntegrationField } from '../src/lib/core/integration-field.js';
import { Integrator } from '../src/lib/core/integrator.js';
import { Pathfinder } from '../src/lib/pathfinding/pathfinder.js';
import { COST_IMPASSABLE, COST_MIN } from '../src/shared/constants.js';
import { buildGrid } from '../src/shared/cost-map/cost-map.js';
import type { PathRequest } from '../src/shared/types.js';
import { makeRandom } from './helpers.js';

const SECTOR = 8;
const CELLS = SECTOR * 6;
const GRIDS = 3;

/** Grids with walls of different density, and requests spread over all of them. */
function setup(seed: number) {
  const rand = makeRandom(seed);
  const pick = (n: number) => Math.floor(rand() * n);
  const grids = Array.from({ length: GRIDS }, (_, id) => {
    const costs = new Uint8Array(CELLS * CELLS).map(() => (rand() < 0.05 * (id + 1) ? COST_IMPASSABLE : COST_MIN));
    return () => buildGrid(costs.slice(), { width: CELLS, height: CELLS }, SECTOR, id);
  });
  const requests: PathRequest[] = Array.from({ length: 300 }, () => ({
    gridId: pick(GRIDS),
    start: { ne: pick(CELLS), se: pick(CELLS) },
    // few distinct targets, so target fields get reused as well as dropped
    target: { ne: 4 + pick(4) * 11, se: 4 + pick(4) * 11 },
  }));
  return { grids, requests };
}

function pathfinder(
  grids: (() => ReturnType<typeof buildGrid>)[],
  options?: ConstructorParameters<typeof Pathfinder>[0],
) {
  const pf = new Pathfinder(options);
  for (const grid of grids) {
    pf.addGrid(grid());
  }
  return pf;
}

describe('bounded field cache', () => {
  it('keeps the fields of all grids within the bounds and plans the same routes', () => {
    const { grids, requests } = setup(11);
    const limits = { maxPortalFields: 12, maxTargetFields: 5 };
    const bounded = pathfinder(grids, limits);
    const unbounded = pathfinder(grids);

    for (const request of requests) {
      const label = JSON.stringify(request);
      expect(bounded.getPath(request), label).toEqual(unbounded.getPath(request));
      // the fields themselves come out the same when they are computed again
      const steps = bounded.getFlowRoute(request)?.getSteps() ?? [];
      const expected = unbounded.getFlowRoute(request)?.getSteps() ?? [];
      expect(
        steps.map(s => s.flowField.getCells()),
        label,
      ).toEqual(expected.map(s => s.flowField.getCells()));

      expect(bounded.getCachedFieldCount()).toBeLessThanOrEqual(limits.maxPortalFields);
      expect(bounded.getCachedTargetFieldCount()).toBeLessThanOrEqual(limits.maxTargetFields);
    }
    // the bounds were reached, not just respected
    expect(unbounded.getCachedFieldCount()).toBeGreaterThan(limits.maxPortalFields);
    expect(unbounded.getCachedTargetFieldCount()).toBeGreaterThan(limits.maxTargetFields);
    expect(bounded.getCachedFieldCount()).toBe(limits.maxPortalFields);
    expect(bounded.getCachedTargetFieldCount()).toBe(limits.maxTargetFields);
  });

  it('computes a dropped field again and keeps the recently used ones', () => {
    const integrate = vi.spyOn(Integrator.prototype, 'integratePortal');
    const grid = buildGrid(new Uint8Array(CELLS * CELLS).fill(COST_MIN), { width: CELLS, height: CELLS }, SECTOR, 0);
    const pf = new Pathfinder({ maxPortalFields: 2 });
    pf.addGrid(grid);
    // one portal field each: from the sector right of the target
    const near = { gridId: 0, start: { ne: 12, se: 4 }, target: { ne: 4, se: 4 } };
    const other = { gridId: 0, start: { ne: 12, se: 20 }, target: { ne: 4, se: 20 } };
    const third = { gridId: 0, start: { ne: 12, se: 36 }, target: { ne: 4, se: 36 } };

    pf.getPath(near);
    pf.getPath(other);
    pf.getPath(near); // now more recent than other
    expect(integrate).toHaveBeenCalledTimes(2);

    pf.getPath(third); // drops the field of other
    pf.getPath(near);
    expect(integrate).toHaveBeenCalledTimes(3);
    pf.getPath(other);
    expect(integrate).toHaveBeenCalledTimes(4);
    expect(pf.getCachedFieldCount()).toBe(2);
  });

  it('does not count the fields of a changed cost field against the bound', () => {
    const grid = buildGrid(
      new Uint8Array(2 * SECTOR * SECTOR).fill(COST_MIN),
      { width: 2 * SECTOR, height: SECTOR },
      SECTOR,
    );
    const [left, right] = grid.getSectors() as [
      ReturnType<typeof grid.getSectors>[number],
      ReturnType<typeof grid.getSectors>[number],
    ];
    const portal = left.getPortals()[0]!;
    const integrator = new Integrator({ maxPortalFields: 2 });
    const other = new IntegrationField(SECTOR);
    const target = { ne: 0, se: 0 };
    const intoLeft = () => integrator.getPortalShared(left.getCostField(), other, right.getId(), portal, target);
    const intoRight = () => integrator.getPortalShared(right.getCostField(), other, left.getId(), portal, target);

    intoLeft();
    const rightField = intoRight();
    intoLeft(); // the left field is now the most recent one
    left.getCostField().setCost(3, 3, COST_IMPASSABLE);
    // the left cache is cleared and its field computed anew; the right one must stay
    intoLeft();
    expect(integrator.getCachedFieldCount()).toBe(2);
    expect(intoRight()).toBe(rightField);
  });

  it('accepts no bound, Infinity and zero, and rejects others', () => {
    expect(() => new Pathfinder({})).not.toThrow();
    expect(() => new Pathfinder({ maxPortalFields: Number.POSITIVE_INFINITY })).not.toThrow();
    for (const bad of [-1, 1.5, Number.NaN]) {
      expect(() => new Pathfinder({ maxPortalFields: bad })).toThrow(RangeError);
      expect(() => new Pathfinder({ maxTargetFields: bad })).toThrow(RangeError);
    }

    const { grids, requests } = setup(3);
    const none = pathfinder(grids, { maxPortalFields: 0, maxTargetFields: 0 });
    const unbounded = pathfinder(grids);
    for (const request of requests.slice(0, 50)) {
      expect(none.getPath(request)).toEqual(unbounded.getPath(request));
    }
    expect(none.getCachedFieldCount()).toBe(0);
    expect(none.getCachedTargetFieldCount()).toBe(0);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
