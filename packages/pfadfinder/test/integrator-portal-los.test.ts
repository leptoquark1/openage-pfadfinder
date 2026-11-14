import { describe, expect, it } from 'vitest';
import { type IntegrationFlowPair, Integrator } from '../src/lib/core/integrator.js';
import type { Grid } from '../src/lib/graph/grid.js';
import {
  COST_IMPASSABLE,
  COST_MIN,
  FLOW_LOS_MASK,
  INTEGRATED_COST_UNREACHABLE,
  INTEGRATE_LOS_MASK,
} from '../src/shared/constants.js';
import { buildGrid } from '../src/shared/cost-map/cost-map.js';

const SECTOR = 8;
const CELLS = SECTOR * SECTOR;
/** The target, in the right sector's local frame. */
const TARGET = { ne: 6, se: 0 };
/** The same cell seen from the left sector, which the portal field is built for. */
const TARGET_FROM_LEFT = { ne: SECTOR + TARGET.ne, se: TARGET.se };

/** Two sectors side by side; the portal field of the left one leads into the right one. */
function twoSectors(walls: readonly (readonly [number, number])[]): Grid {
  const width = SECTOR * 2;
  const costs = new Uint8Array(width * SECTOR).fill(COST_MIN);
  for (const [ne, se] of walls) {
    costs[ne + se * width] = COST_IMPASSABLE;
  }
  return buildGrid(costs, { width, height: SECTOR }, SECTOR);
}

/** No walls: every cell of the left sector sees the target. */
const open = () => twoSectors([]);

/**
 * A wall right behind the border, open only in the bottom row: the sectors
 * stay connected, but no portal cell sees the target.
 */
const hidden = () => twoSectors(Array.from({ length: SECTOR - 1 }, (_, se) => [SECTOR + 1, se] as const));

/** One wall cell in the left sector, on the target's row: the cells behind it lie in its shadow. */
const shadowed = () => twoSectors([[4, TARGET.se]]);

/** The portal field of the left sector, entered from the target field of the right one. */
function portalField(integrator: Integrator, grid: Grid, withLos: boolean): IntegrationFlowPair {
  const [left, right] = grid.getSectors() as [
    ReturnType<Grid['getSectors']>[number],
    ReturnType<Grid['getSectors']>[number],
  ];
  const portal = left.getPortals()[0]!;
  const targetField = new Integrator().integrate(right.getCostField(), TARGET, true);
  return integrator.getPortal(left.getCostField(), targetField, right.getId(), portal, TARGET_FROM_LEFT, withLos);
}

const snapshot = ({ integrationField, flowField }: IntegrationFlowPair) => ({
  costs: [...integrationField.getCosts()],
  flags: [...integrationField.getFlagsArray()],
  flow: [...flowField.getCells()],
});

const reached = (pair: IntegrationFlowPair) =>
  pair.integrationField.getCosts().filter(cost => cost < INTEGRATED_COST_UNREACHABLE).length;

const inSight = (pair: IntegrationFlowPair) =>
  pair.flowField.getCells().filter(cell => (cell & FLOW_LOS_MASK) !== 0).length;

/** Costs and directions only: what a field holds besides the line-of-sight marks. */
const route = (pair: IntegrationFlowPair) => ({
  costs: [...pair.integrationField.getCosts()],
  flow: [...pair.flowField.getCells()].map(cell => cell & ~FLOW_LOS_MASK),
});

describe('Integrator.getPortal with line of sight', () => {
  it('integrates the whole sector when no portal cell sees the target', () => {
    const grid = hidden();
    const withLos = portalField(new Integrator(), grid, true);

    expect(reached(withLos)).toBe(CELLS);
    expect(inSight(withLos)).toBe(0);
    expect(route(withLos)).toEqual(route(portalField(new Integrator(), grid, false)));
  });

  it('marks the cells that see the target through the portal', () => {
    const grid = open();
    const withLos = portalField(new Integrator(), grid, true);

    expect(reached(withLos)).toBe(CELLS);
    expect(inSight(withLos)).toBe(CELLS);
    expect(route(withLos)).toEqual(route(portalField(new Integrator(), grid, false)));
  });

  it('leaves the cells in the shadow of a wall unmarked but reachable', () => {
    const withLos = portalField(new Integrator(), shadowed(), true);

    expect(reached(withLos)).toBe(CELLS - 1);
    expect(inSight(withLos)).toBeGreaterThan(0);
    expect(inSight(withLos)).toBeLessThan(CELLS - 1);
    // straight behind the wall cell, seen from the target
    expect(withLos.flowField.getCell(0, TARGET.se) & FLOW_LOS_MASK).toBe(0);
  });

  it.each([
    ['open', open],
    ['hidden', hidden],
    ['shadowed', shadowed],
  ])('returns the same fields from the cache as without it (%s)', (_name, build) => {
    const grid = build();
    const fresh = (withLos: boolean) => snapshot(portalField(new Integrator(), grid, withLos));

    for (const order of [
      [true, false, true],
      [false, true, false],
    ]) {
      const integrator = new Integrator();
      for (const withLos of order) {
        expect(snapshot(portalField(integrator, grid, withLos)), `${order} at ${withLos}`).toEqual(fresh(withLos));
      }
      expect(integrator.getCachedFieldCount()).toBe(1);
    }
  });

  it('keeps line-of-sight marks out of the fields a later request without them gets', () => {
    const grid = open();
    const integrator = new Integrator();
    portalField(integrator, grid, true);
    const plain = portalField(integrator, grid, false);

    expect(inSight(plain)).toBe(0);
    expect(plain.integrationField.getFlagsArray().some(flags => (flags & INTEGRATE_LOS_MASK) !== 0)).toBe(false);
  });
});

describe('Integrator.integratePortal with line of sight', () => {
  it('integrates the whole sector when no portal cell sees the target', () => {
    const grid = hidden();
    const [left, right] = grid.getSectors();
    const integrator = new Integrator();
    const targetField = integrator.integrate(right!.getCostField(), TARGET, true);
    const field = integrator.integratePortal(
      left!.getCostField(),
      targetField,
      right!.getId(),
      left!.getPortals()[0]!,
      TARGET_FROM_LEFT,
      true,
    );

    expect(field.getCosts().filter(cost => cost < INTEGRATED_COST_UNREACHABLE).length).toBe(CELLS);
  });
});
