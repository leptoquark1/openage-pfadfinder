import { describe, expect, it } from 'vitest';
import { Integrator } from '../src/lib/core/integrator.js';
import { Pathfinder } from '../src/lib/pathfinding/pathfinder.js';
import { COST_IMPASSABLE, COST_MIN, FLOW_LOS_MASK } from '../src/shared/constants.js';
import { buildGrid } from '../src/shared/cost-map/cost-map.js';

const SECTOR = 8;
const WIDTH = SECTOR * 3;

/** Three sectors in a row. */
function setup() {
  const costs = new Uint8Array(WIDTH * SECTOR).fill(COST_MIN);
  costs[4 + 3 * WIDTH] = COST_IMPASSABLE;
  const grid = buildGrid(costs, { width: WIDTH, height: SECTOR }, SECTOR);
  const [left, middle] = grid.getSectors();
  const integrator = new Integrator();
  const other = integrator.integrate(middle!.getCostField(), { ne: 6, se: 0 }, true);
  const args = [
    left!.getCostField(),
    other,
    middle!.getId(),
    left!.getPortals()[0]!,
    { ne: SECTOR + 6, se: 0 },
  ] as const;
  return { grid, integrator, args };
}

describe('Integrator.getPortalShared', () => {
  it('hands out the cached fields themselves', () => {
    const { integrator, args } = setup();
    const first = integrator.getPortalShared(...args);
    const second = integrator.getPortalShared(...args);

    expect(second.integrationField).toBe(first.integrationField);
    expect(second.flowField).toBe(first.flowField);
    expect(integrator.getCachedFieldCount()).toBe(1);
  });

  it('holds what getPortal() returns without line of sight, which stays a copy', () => {
    const { integrator, args } = setup();
    const shared = integrator.getPortalShared(...args);
    const copy = integrator.getPortal(...args, false);

    expect(copy.integrationField).not.toBe(shared.integrationField);
    expect(copy.flowField).not.toBe(shared.flowField);
    expect([...copy.integrationField.getCosts()]).toEqual([...shared.integrationField.getCosts()]);
    expect([...copy.integrationField.getFlagsArray()]).toEqual([...shared.integrationField.getFlagsArray()]);
    expect([...copy.flowField.getCells()]).toEqual([...shared.flowField.getCells()]);
  });

  it('is not touched by the line-of-sight marks of other requests', () => {
    const { integrator, args } = setup();
    const before = [...integrator.getPortalShared(...args).flowField.getCells()];
    const withLos = integrator.getPortal(...args, true);

    expect(withLos.flowField.getCells().some(cell => (cell & FLOW_LOS_MASK) !== 0)).toBe(true);
    expect([...integrator.getPortalShared(...args).flowField.getCells()]).toEqual(before);
  });

  it('gives two routes through the same portal the same flow field', () => {
    const { grid } = setup();
    const pf = new Pathfinder();
    pf.addGrid(grid);
    const target = { ne: WIDTH - 2, se: 5 };
    const a = pf.getFlowRoute({ gridId: 0, start: { ne: 1, se: 1 }, target })!;
    const b = pf.getFlowRoute({ gridId: 0, start: { ne: 6, se: 6 }, target: { ne: WIDTH - 3, se: 2 } })!;

    expect(a.getSectorIds()).toEqual([0, 1, 2]);
    expect(b.getSectorIds()).toEqual([0, 1, 2]);
    // start and transit sector come from the cache, the target sector is the route's own
    expect(b.getSteps()[0]!.flowField).toBe(a.getSteps()[0]!.flowField);
    expect(b.getSteps()[1]!.flowField).toBe(a.getSteps()[1]!.flowField);
    expect(b.getSteps()[2]!.flowField).not.toBe(a.getSteps()[2]!.flowField);
  });
});
