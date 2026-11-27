import { describe, expect, it } from 'vitest';
import { CostField } from '../src/lib/core/cost-field.js';
import { Grid } from '../src/lib/graph/grid.js';
import type { Portal } from '../src/lib/graph/portal.js';
import { Sector } from '../src/lib/graph/sector.js';
import { Pathfinder } from '../src/lib/pathfinding/pathfinder.js';
import { PortalNode, portalAStar } from '../src/lib/pathfinding/portal-graph.js';
import { COST_IMPASSABLE, COST_MIN } from '../src/shared/constants.js';
import { buildGrid } from '../src/shared/cost-map/cost-map.js';
import { PathResult, type PortalId } from '../src/shared/types.js';
import { makeRandom } from './helpers.js';

/** A row of open sectors with portals but no portal graph yet. */
function row(sectors: number, size: number): Grid {
  const grid = new Grid(0, { width: sectors, height: 1 }, size);
  for (let x = 0; x < sectors; x++) {
    const field = new CostField(size);
    field.setCosts(new Uint8Array(size * size).fill(COST_MIN));
    grid.addSector(new Sector(x, { x, y: 0 }, field));
  }
  grid.initPortals();
  return grid;
}

describe('sector exit tables', () => {
  it('give all portals of a sector one table, with a row per portal in list order', () => {
    const cells = 24;
    const rand = makeRandom(5);
    const costs = new Uint8Array(cells * cells).map(() => (rand() < 0.2 ? COST_IMPASSABLE : COST_MIN));
    const grid = buildGrid(costs, { width: cells, height: cells }, 8, 0);

    for (const sector of grid.getSectors()) {
      const portals = sector.getPortals();
      if (portals.length === 0) {
        continue;
      }
      const table = portals[0]!.getExitTable(sector.getId());
      expect(table.portals).toEqual(portals);
      for (const [i, portal] of portals.entries()) {
        expect(portal.getExitTable(sector.getId())).toBe(table);
        expect(portal.getExitRow(sector.getId())).toBe(i);
      }
    }
  });

  it('keep costs beyond one byte for large sectors', () => {
    const size = 32;
    const grid = buildGrid(new Uint8Array(size * 2 * size).fill(COST_MIN), { width: size * 2, height: size }, size, 0);
    const portal = grid.getSector(0)!.getPortals()[0]!;
    expect(portal.getExitTable(0).costs).toBeInstanceOf(Uint16Array);

    // Open 3×3 sectors: the top and bottom portal of the middle sector are 31 cells apart.
    const big = buildGrid(new Uint8Array(9 * size * size).fill(COST_MIN), { width: 3 * size, height: 3 * size }, size);
    const middle = big.getSector(4)!;
    const [top, , bottom] = middle.getPortals();
    const node = big.getPortalMap().get(top!.getId())!;
    const expected = PortalNode.distanceCost(top!.getEntryCenter(4), bottom!.getEntryCenter(4));
    expect(expected).toBeGreaterThan(255);
    expect(node.getExits(4).get(bottom!.getId())).toBe(expected);
  });

  it('still route through exits set with the deprecated setExits()', () => {
    const grid = row(3, 4);
    grid.initPortalNodes();
    const pf = new Pathfinder();
    pf.addGrid(grid);
    const request = { gridId: 0, start: { ne: 1, se: 1 }, target: { ne: 10, se: 1 } };
    const [p01, p12] = grid.getSector(1)!.getPortals() as [Portal, Portal];
    expect(pf.getPath(request).result).toBe(PathResult.FOUND);

    p01.setExits(1, []);
    expect(p01.getConnected(1)).toEqual([]);
    expect(pf.getPath(request).result).toBe(PathResult.NOT_FOUND);

    p01.setExits(1, [p12]);
    expect(p01.getConnected(1)).toEqual([p12]);
    expect(grid.getPortalMap().get(p01.getId())!.getExits(1)).toEqual(
      new Map([[p12.getId(), PortalNode.distanceCost(p01.getEntryCenter(1), p12.getEntryCenter(1))]]),
    );
    expect(pf.getPath(request).result).toBe(PathResult.FOUND);
  });

  it('limit the exits of a node to the node map given to initExits()', () => {
    const grid = row(3, 4);
    const [p01, p12] = grid.getSector(1)!.getPortals() as [Portal, Portal];
    const nodes = new Map<PortalId, PortalNode>([
      [p01.getId(), new PortalNode(p01)],
      [p12.getId(), new PortalNode(p12)],
    ]);
    const start = nodes.get(p01.getId())!;
    const search = () => portalAStar(grid, [p01], [p12], nodes, { ne: 10, se: 1 }, 0, { ne: 1, se: 1 });

    // no exits before initExits()
    expect(start.exits).toEqual(new Map());
    expect(search().found).toBe(false);

    // only exits with a node in the given map
    start.initExits(new Map([[p01.getId(), start]]));
    expect(start.getExits(1)).toEqual(new Map());
    expect(search().found).toBe(false);

    start.initExits(nodes);
    expect([...start.getExits(1).keys()]).toEqual([p12.getId()]);
    expect(search()).toMatchObject({ found: true, portals: [p01, p12] });
  });
});
