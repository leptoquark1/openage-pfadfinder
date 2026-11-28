import { describe, expect, it } from 'vitest';
import { CostField } from '../src/lib/core/cost-field.js';
import { Grid } from '../src/lib/graph/grid.js';
import { Portal } from '../src/lib/graph/portal.js';
import { Sector } from '../src/lib/graph/sector.js';
import { Pathfinder } from '../src/lib/pathfinding/pathfinder.js';
import { COST_IMPASSABLE, COST_MIN } from '../src/shared/constants.js';
import { buildGrid } from '../src/shared/cost-map/cost-map.js';
import { PortalDirection } from '../src/shared/types.js';
import { makeRandom, portalGraphOf, portalLayoutOf } from './helpers.js';

const SECTOR = 8;

/** Every sector's portals in list order, by the cells they span and their id. */
function portalIdsOf(grid: Grid): [string, number][][] {
  return portalLayoutOf(grid).map(([, portals], i) =>
    portals.map(([name], j) => [name, grid.getSectors()[i]!.getPortals()[j]!.getId()]),
  );
}

describe('Grid.renumberPortals', () => {
  it('matches a fresh build in portals, ids and routes along fog-like reveals', () => {
    const sectors = 5;
    const cells = SECTOR * sectors;
    const rand = makeRandom(3434);
    const pick = (n: number) => Math.floor(rand() * n);

    // The true map: walls in clumps and scattered, with costlier terrain.
    const truth = new Uint8Array(cells * cells).map(() => (rand() < 0.08 ? COST_IMPASSABLE : COST_MIN));
    for (let n = 0; n < 25; n++) {
      const [cx, cy, r] = [pick(cells), pick(cells), 1 + pick(4)];
      for (let se = 0; se < cells; se++) {
        for (let ne = 0; ne < cells; ne++) {
          if ((ne - cx) ** 2 + (se - cy) ** 2 <= r * r) {
            truth[ne + se * cells] = rand() < 0.2 ? 3 : COST_IMPASSABLE;
          }
        }
      }
    }

    // What the player knows: unexplored cells cost COST_MIN.
    const known = new Uint8Array(cells * cells).fill(COST_MIN);
    const size = { width: cells, height: cells };
    const grid = buildGrid(known.slice(), size, SECTOR, 0);
    const pf = new Pathfinder();
    pf.addGrid(grid);

    for (let step = 0; step < 120; step++) {
      const changes: { ne: number; se: number; cost: number }[] = [];
      if (step % 7 === 6) {
        // a unit stops on a cell and moves on later: costs also go back down
        const [ne, se] = [pick(cells), pick(cells)];
        known[ne + se * cells] = known[ne + se * cells] === COST_IMPASSABLE ? truth[ne + se * cells]! : COST_IMPASSABLE;
        changes.push({ ne, se, cost: known[ne + se * cells]! });
      } else {
        // a sight radius reveals the true costs, across sector borders too
        const [cx, cy, r] = [pick(cells), pick(cells), 2 + pick(6)];
        for (let se = Math.max(0, cy - r); se <= Math.min(cells - 1, cy + r); se++) {
          for (let ne = Math.max(0, cx - r); ne <= Math.min(cells - 1, cx + r); ne++) {
            if ((ne - cx) ** 2 + (se - cy) ** 2 <= r * r) {
              known[ne + se * cells] = truth[ne + se * cells]!;
              changes.push({ ne, se, cost: truth[ne + se * cells]! });
            }
          }
        }
      }
      grid.updateCosts(changes);

      const freshGrid = buildGrid(known.slice(), size, SECTOR, 0);
      const fresh = new Pathfinder();
      fresh.addGrid(freshGrid);
      const label = `step ${step}`;
      // Without renumbering, only the ids may differ.
      expect(portalLayoutOf(grid), label).toEqual(portalLayoutOf(freshGrid));

      grid.renumberPortals();
      expect(portalIdsOf(grid), label).toEqual(portalIdsOf(freshGrid));
      expect([...grid.getPortalMap().keys()], label).toEqual([...freshGrid.getPortalMap().keys()]);
      expect(portalGraphOf(grid.getPortalMap()), label).toEqual(portalGraphOf(freshGrid.getPortalMap()));
      for (const [id, node] of grid.getPortalMap()) {
        expect(node.portal.getId(), label).toBe(id);
      }

      for (let k = 0; k < 4; k++) {
        const request = {
          gridId: 0,
          start: { ne: pick(cells), se: pick(cells) },
          target: { ne: pick(cells), se: pick(cells) },
        };
        expect(pf.getPath(request), `${label} ${JSON.stringify(request)}`).toEqual(fresh.getPath(request));
      }
    }
  });

  it('returns the changed ids and keeps the nodes under their new ids', () => {
    const cells = 3 * SECTOR;
    const grid = buildGrid(new Uint8Array(cells * cells).fill(COST_MIN), { width: cells, height: cells }, SECTOR, 0);
    const nodes = [...grid.getPortalMap().values()];
    const map = grid.getPortalMap();

    // Splitting the first portal (sector 0 to 1) shifts the ids of all later ones.
    grid.updateCosts([{ ne: SECTOR - 1, se: 3, cost: COST_IMPASSABLE }]);
    const before = new Map([...grid.getPortalMap()].map(([id, node]) => [node, id]));
    const changed = grid.renumberPortals();

    expect(grid.getPortalMap()).toBe(map);
    expect(changed.size).toBeGreaterThan(0);
    for (const [node, oldId] of before) {
      const id = node.portal.getId();
      expect(changed.get(oldId) ?? oldId).toBe(id);
      expect(grid.getPortalMap().get(id)).toBe(node);
    }
    // survivors are the same node objects as before the update
    const survivors = nodes.filter(node => before.has(node));
    expect(survivors.length).toBeGreaterThan(0);
    expect(grid.renumberPortals()).toEqual(new Map());

    // later portals continue after the last id
    const count = grid.getPortalMap().size;
    grid.updateCosts([{ ne: SECTOR - 1, se: 3, cost: COST_MIN }]);
    const ids = grid
      .getSectors()
      .flatMap(s => s.getPortals())
      .map(p => p.getId());
    expect(Math.max(...ids)).toBeGreaterThanOrEqual(count);
    expect(new Set(ids).size).toBe(grid.getPortalMap().size);
  });

  it('numbers portals a full build would not make after all others', () => {
    const grid = new Grid(0, { width: 2, height: 1 }, SECTOR);
    for (let x = 0; x < 2; x++) {
      const field = new CostField(SECTOR);
      field.setCosts(new Uint8Array(SECTOR * SECTOR).fill(COST_MIN));
      grid.addSector(new Sector(x, { x, y: 0 }, field));
    }
    grid.initPortals();
    const stray = new Portal(77, 9, 0, PortalDirection.EAST_WEST, { ne: 0, se: 0 }, { ne: 0, se: 1 });
    grid.getSector(0)!.addPortal(stray);
    const [border] = grid.getSector(1)!.getPortals();

    expect(grid.renumberPortals()).toEqual(new Map([[77, 1]]));
    expect(border!.getId()).toBe(0);
    expect(stray.getId()).toBe(1);
    // without a portal graph there are no nodes to keep
    expect(grid.getPortalMap().size).toBe(0);
  });
});
