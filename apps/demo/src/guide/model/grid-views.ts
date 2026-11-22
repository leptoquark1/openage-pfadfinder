import { COST_IMPASSABLE, type Grid, type Portal, type Sector, type SectorId } from '@leptoquark1/openage-pfadfinder';
import { type Cell, COLS, SECTOR_SIZE, SECTORS_X, SECTORS_Y } from '../scenarios.js';
import type { EdgeScan, GraphEdge, PortalView } from './types.js';

function localCells(portal: Portal, sectorId: SectorId): Cell[] {
  const start = portal.getEntryStart(sectorId);
  const end = portal.getEntryEnd(sectorId);
  const cells: Cell[] = [];
  for (let se = start.se; se <= end.se; se++) {
    for (let ne = start.ne; ne <= end.ne; ne++) {
      cells.push({ ne, se });
    }
  }
  return cells;
}

export function sliceSector(costs: Uint8Array, x: number, y: number): Uint8Array {
  const local = new Uint8Array(SECTOR_SIZE * SECTOR_SIZE);
  for (let row = 0; row < SECTOR_SIZE; row++) {
    const from = (y * SECTOR_SIZE + row) * COLS + x * SECTOR_SIZE;
    local.set(costs.subarray(from, from + SECTOR_SIZE), row * SECTOR_SIZE);
  }
  return local;
}

export function floodRanks(areas: Uint16Array | Int32Array): { ranks: Int16Array; max: number; count: number } {
  const size = SECTOR_SIZE;
  const ranks = new Int16Array(size * size).fill(-1);
  let max = 0;
  let count = 0;
  for (let seed = 0; seed < ranks.length; seed++) {
    if (areas[seed] === 0 || ranks[seed]! >= 0) {
      continue;
    }
    count++;
    ranks[seed] = 0;
    const queue = [seed];
    for (let head = 0; head < queue.length; head++) {
      const idx = queue[head]!;
      const x = idx % size;
      const around = [idx - size, x > 0 ? idx - 1 : -1, idx + size, x < size - 1 ? idx + 1 : -1];
      for (const next of around) {
        if (next >= 0 && next < ranks.length && areas[next] === areas[idx] && ranks[next]! < 0) {
          ranks[next] = ranks[idx]! + 1;
          max = Math.max(max, ranks[next]!);
          queue.push(next);
        }
      }
    }
  }
  return { ranks, max, count };
}

export function portalView(grid: Grid, portal: Portal): PortalView {
  const toGlobal = (sectorId: SectorId): Cell[] => {
    const { x, y } = grid.getSector(sectorId)!.getPosition();
    return localCells(portal, sectorId).map(c => ({ ne: x * SECTOR_SIZE + c.ne, se: y * SECTOR_SIZE + c.se }));
  };
  const first = toGlobal(portal.getSector0());
  const second = toGlobal(portal.getSector1());
  const northSouth = first[0]!.se !== second[0]!.se;
  const head = first[0]!;
  const tail = first[first.length - 1]!;
  return {
    id: portal.getId(),
    sectors: [portal.getSector0(), portal.getSector1()],
    northSouth,
    cells: [first, second],
    x: northSouth ? (head.ne + tail.ne + 1) / 2 : head.ne + 1,
    y: northSouth ? head.se + 1 : (head.se + tail.se + 1) / 2,
  };
}

/** The borders in the order `Grid.initPortals()` visits them. */
export function scanEdges(grid: Grid, costs: Uint8Array): EdgeScan[] {
  const edges: EdgeScan[] = [];
  const open = (a: Cell, b: Cell) =>
    costs[a.ne + a.se * COLS] !== COST_IMPASSABLE && costs[b.ne + b.se * COLS] !== COST_IMPASSABLE;
  const portalsBetween = (a: Sector, b: Sector) =>
    a
      .getPortals()
      .filter(p => p.getExitSector(a.getId()) === b.getId())
      .map(p => p.getId())
      .sort((p, q) => p - q);

  const scan = (sector: Sector, next: Sector, northSouth: boolean, cellAt: (i: number) => Cell): EdgeScan => ({
    a: sector.getId(),
    b: next.getId(),
    northSouth,
    pairs: Array.from({ length: SECTOR_SIZE }, (_, i) => {
      const a = cellAt(i);
      const b = northSouth ? { ne: a.ne, se: a.se + 1 } : { ne: a.ne + 1, se: a.se };
      return { a, b, open: open(a, b) };
    }),
    portalIds: portalsBetween(sector, next),
  });

  for (let y = 0; y < SECTORS_Y; y++) {
    for (let x = 0; x < SECTORS_X; x++) {
      const sector = grid.getSector(x, y)!;
      if (y < SECTORS_Y - 1) {
        edges.push(
          scan(sector, grid.getSector(x, y + 1)!, true, i => ({
            ne: x * SECTOR_SIZE + i,
            se: (y + 1) * SECTOR_SIZE - 1,
          })),
        );
      }
      if (x < SECTORS_X - 1) {
        edges.push(
          scan(sector, grid.getSector(x + 1, y)!, false, i => ({
            ne: (x + 1) * SECTOR_SIZE - 1,
            se: y * SECTOR_SIZE + i,
          })),
        );
      }
    }
  }
  return edges;
}

export function graphEdges(grid: Grid): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (const [id, node] of grid.getPortalMap()) {
    for (const [sector, exits] of node.exits) {
      for (const [other, cost] of exits) {
        if (id < other) {
          edges.push({ a: id, b: other, sector, cost });
        }
      }
    }
  }
  return edges;
}

export function portalsReachableFrom(sector: Sector, local: Cell): Portal[] {
  const areas = sector.getAreas();
  const area = areas[local.ne + local.se * SECTOR_SIZE];
  return sector
    .getPortals()
    .filter(portal => localCells(portal, sector.getId()).some(cell => areas[cell.ne + cell.se * SECTOR_SIZE] === area));
}
