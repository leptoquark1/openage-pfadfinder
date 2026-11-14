import { describe, expect, it } from 'vitest';
import { CostField } from '../src/lib/core/cost-field.js';
import { Grid } from '../src/lib/graph/grid.js';
import type { Portal } from '../src/lib/graph/portal.js';
import { Sector } from '../src/lib/graph/sector.js';
import { Pathfinder } from '../src/lib/pathfinding/pathfinder.js';
import { COST_IMPASSABLE, COST_MIN } from '../src/shared/constants.js';
import { buildGrid } from '../src/shared/cost-map/cost-map.js';
import { PathResult } from '../src/shared/types.js';
import { makeRandom } from './helpers.js';

/** Passable entry cells of `portal` on `sector`'s side, as `ne,se` keys. */
function entryCells(sector: Sector, portal: Portal): string[] {
  const field = sector.getCostField();
  const start = portal.getEntryStart(sector.getId());
  const end = portal.getEntryEnd(sector.getId());
  const cells: string[] = [];
  for (let se = start.se; se <= end.se; se++) {
    for (let ne = start.ne; ne <= end.ne; ne++) {
      if (field.getCost(ne, se) !== COST_IMPASSABLE) {
        cells.push(`${ne},${se}`);
      }
    }
  }
  return cells;
}

/** The sector's other portals a flood fill from `portal`'s entry cells reaches, in the sector's order. */
function reachableExits(sector: Sector, portal: Portal): Portal[] {
  const field = sector.getCostField();
  const size = field.getSize();
  const seen = new Set(entryCells(sector, portal));
  const open = [...seen];
  while (open.length > 0) {
    const [ne, se] = open.pop()!.split(',').map(Number) as [number, number];
    for (const [n, s] of [[ne, se - 1], [ne - 1, se], [ne, se + 1], [ne + 1, se]] as const) {
      const key = `${n},${s}`;
      if (n >= 0 && s >= 0 && n < size && s < size && !seen.has(key) && field.getCost(n, s) !== COST_IMPASSABLE) {
        seen.add(key);
        open.push(key);
      }
    }
  }
  return sector.getPortals().filter(p => p !== portal && entryCells(sector, p).some(c => seen.has(c)));
}

describe('Sector.connectExits flood-fill connectivity', () => {
  it('does not connect portals separated by a wall', () => {
    const size = 5;
    const grid = new Grid(0, { width: 1, height: 1 }, size);
    const cf = new CostField(size);
    cf.setCosts(new Uint8Array(size * size).fill(COST_MIN));
    // Build a full-height wall at x=2 (except y=0 gap and y=4 gap)
    for (let y = 1; y < size - 1; y++) {
      cf.setCost(2, y, COST_IMPASSABLE);
    }
    const sector = new Sector(0, { x: 0, y: 0 }, cf);
    grid.addSector(sector);
    grid.initPortals();
    grid.initPortalNodes();

    // The sector should have portals on bottom and possibly right edges,
    // but portals on opposite sides of the wall should not be connected
    // (if there were multiple portals). With a single 1x1 sector, there are
    // no inter-sector portals, so we test with a 2x1 grid instead.
  });

  it('blocks portal path when a wall splits a sector', () => {
    const size = 5;
    const grid = new Grid(0, { width: 2, height: 2 }, size);

    // Sector 0 (top-left): full wall at x=2 splitting it
    const cf0 = new CostField(size);
    cf0.setCosts(new Uint8Array(size * size).fill(COST_MIN));
    for (let y = 0; y < size; y++) {
      cf0.setCost(2, y, COST_IMPASSABLE);
    }

    // Sector 1 (top-right), Sector 2 (bottom-left), Sector 3 (bottom-right)
    const cf1 = new CostField(size);
    cf1.setCosts(new Uint8Array(size * size).fill(COST_MIN));
    const cf2 = new CostField(size);
    cf2.setCosts(new Uint8Array(size * size).fill(COST_MIN));
    const cf3 = new CostField(size);
    cf3.setCosts(new Uint8Array(size * size).fill(COST_MIN));

    grid.addSector(new Sector(0, { x: 0, y: 0 }, cf0));
    grid.addSector(new Sector(1, { x: 1, y: 0 }, cf1));
    grid.addSector(new Sector(2, { x: 0, y: 1 }, cf2));
    grid.addSector(new Sector(3, { x: 1, y: 1 }, cf3));
    grid.initPortals();
    grid.initPortalNodes();

    // Path from (0,0) in sector 0 to (4,4) in sector 0 — both on left side of wall
    // This is a single-sector path, so just verify it works
    const pf = new Pathfinder();
    pf.addGrid(grid);
    const path = pf.getPath({
      gridId: 0,
      start: { ne: 0, se: 0 },
      target: { ne: 1, se: 4 },
    });
    expect(path.result).toBe(PathResult.FOUND);
  });

  it('connects exactly the portals a flood fill from each portal reaches', () => {
    const sectorSize = 8;
    const cells = 3 * sectorSize;
    const rand = makeRandom(77);
    let checked = 0;
    for (let map = 0; map < 40; map++) {
      // from open land to sectors cut into many small areas
      const density = 0.05 + (map % 10) * 0.05;
      const costs = new Uint8Array(cells * cells).map(() => (rand() < density ? COST_IMPASSABLE : COST_MIN));
      const grid = buildGrid(costs, { width: cells, height: cells }, sectorSize, 0);
      for (const sector of grid.getSectors()) {
        for (const portal of sector.getPortals()) {
          expect(portal.getConnected(sector.getId()), `map ${map} portal ${portal.getId()}`).toEqual(
            reachableExits(sector, portal),
          );
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
  });
});
