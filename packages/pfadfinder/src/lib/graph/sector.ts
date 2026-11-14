import { COST_IMPASSABLE } from '../../shared/constants.js';
import { xyToIndex } from '../../shared/coordinates.js';
import { PortalDirection, type PortalId, type SectorId, type Vector2s } from '../../shared/types.js';
import type { CostField } from '../core/cost-field.js';
import { Portal } from './portal.js';

/**
 * Sector — a square subdivision of a Grid.
 * Contains a CostField and a list of Portals connecting to neighboring sectors.
 * The position is the sector's (x, y) coordinate in the grid.
 */
export class Sector {
  private readonly id: SectorId;
  private readonly position: Vector2s;
  private readonly costField: CostField;
  private portals: Portal[] = [];

  constructor(id: SectorId, position: Vector2s, costField: CostField) {
    this.id = id;
    this.position = position;
    this.costField = costField;
  }

  getId(): SectorId {
    return this.id;
  }

  getPosition(): Vector2s {
    return this.position;
  }

  getCostField(): CostField {
    return this.costField;
  }

  /**
   * The sector's portals in edge order: top, left, bottom, right edge, and
   * along each edge by position. `addPortal()` keeps that order, so the list
   * depends only on which portals exist, not on when each was added. A grid
   * updated step by step therefore lists them exactly like one built from
   * scratch, and A*, which visits portals in list order, plans the same routes
   * on both.
   */
  getPortals(): Portal[] {
    return this.portals;
  }

  /** Add a portal at its place in edge order (see `getPortals()`). */
  addPortal(portal: Portal): void {
    const rank = this.edgeRank(portal);
    let at = this.portals.length;
    while (at > 0 && this.edgeRank(this.portals[at - 1]!) > rank) {
      at--;
    }
    this.portals.splice(at, 0, portal);
  }

  /**
   * Sort key of a portal of this sector: its edge (top, left, bottom, right),
   * then where it starts along that edge. This is the order `Grid.initPortals()`
   * adds portals in.
   */
  private edgeRank(portal: Portal): number {
    const northSouth = portal.getDirection() === PortalDirection.NORTH_SOUTH;
    // sector0 is the northern/western side, so its portal lies on the bottom/right edge
    const first = portal.getSector0() === this.id;
    const edge = northSouth ? (first ? 2 : 0) : first ? 3 : 1;
    const start = portal.getEntryStart(this.id);
    return edge * this.costField.getSize() + (northSouth ? start.ne : start.se);
  }

  /**
   * Remove a portal by identity. Returns true when it was held.
   * Used by `Grid.rebuildPortals()` during incremental portal updates.
   */
  removePortal(portal: Portal): boolean {
    const idx = this.portals.indexOf(portal);
    if (idx < 0) {
      return false;
    }
    this.portals.splice(idx, 1);
    return true;
  }

  /**
   * Find portals along the edge between this sector and a neighbor.
   * Scans the shared edge for contiguous passable cell ranges.
   *
   * `nextId` is either the first id to number new portals from, or an
   * allocator called once per new portal. A found range that one of the
   * `reuse` portals already spans returns that portal instead, without
   * taking an id — `Grid.rebuildPortals()` uses this to keep survivors.
   */
  findPortals(
    other: Sector,
    direction: PortalDirection,
    nextId: PortalId | (() => PortalId),
    reuse: readonly Portal[] = [],
  ): Portal[] {
    let firstId = typeof nextId === 'number' ? nextId : 0;
    const allocate = typeof nextId === 'number' ? () => firstId++ : nextId;
    const size = this.costField.getSize();
    const otherCostField = other.getCostField();
    const northSouth = direction === PortalDirection.NORTH_SOUTH;
    const portals: Portal[] = [];

    // this is north/west of other → scan the bottom/right edge of this and
    // the top/left edge of other.
    const edge = size - 1;
    const emit = (from: number, to: number): void => {
      const cellStart = northSouth ? { ne: from, se: edge } : { ne: edge, se: from };
      const cellEnd = northSouth ? { ne: to, se: edge } : { ne: edge, se: to };
      const previous = reuse.find(p => p.spans(this.id, other.getId(), direction, cellStart, cellEnd));
      portals.push(previous ?? new Portal(allocate(), this.id, other.getId(), direction, cellStart, cellEnd));
    };

    let runStart = -1;
    for (let i = 0; i < size; i++) {
      const thisPassable = northSouth
        ? this.costField.getCost(i, edge) !== COST_IMPASSABLE
        : this.costField.getCost(edge, i) !== COST_IMPASSABLE;
      const otherPassable = northSouth
        ? otherCostField.getCost(i, 0) !== COST_IMPASSABLE
        : otherCostField.getCost(0, i) !== COST_IMPASSABLE;
      const passable = thisPassable && otherPassable;

      if (passable && runStart < 0) {
        runStart = i;
      } else if (!passable && runStart >= 0) {
        emit(runStart, i - 1);
        runStart = -1;
      }
    }

    if (runStart >= 0) {
      emit(runStart, size - 1);
    }

    return portals;
  }

  /**
   * Connect mutually reachable portals within this sector.
   * Floods the 4-connected areas of passable cells the portals' entry cells
   * lie in, once for the whole sector; two portals are exits of each other
   * when their entry cells share an area (not split by walls).
   * Must be called after all sectors and portals are initialized.
   */
  connectExits(): void {
    const size = this.costField.getSize();
    const costCells = this.costField.getCosts();
    // Area of each cell, 0 while no flood reached it; every cell is queued once.
    const areas = new Int32Array(size * size);
    const queue = new Int32Array(size * size);
    let areaCount = 0;

    // The areas each portal's passable entry cells on this side lie in
    const portalAreas = this.portals.map(portal => {
      const entryStart = portal.getEntryStart(this.id);
      const entryEnd = portal.getEntryEnd(this.id);
      const found = new Set<number>();
      for (let y = entryStart.se; y <= entryEnd.se; y++) {
        for (let x = entryStart.ne; x <= entryEnd.ne; x++) {
          const idx = xyToIndex(x, y, size);
          if (costCells[idx]! === COST_IMPASSABLE) {
            continue;
          }
          if (areas[idx] === 0) {
            floodArea(costCells, size, idx, ++areaCount, areas, queue);
          }
          found.add(areas[idx]!);
        }
      }
      return found;
    });

    for (const [i, portal] of this.portals.entries()) {
      const own = portalAreas[i]!;
      const connectedPortals = this.portals.filter(
        (other, j) => other.getId() !== portal.getId() && sharesArea(own, portalAreas[j]!),
      );
      portal.setExits(this.id, connectedPortals);
    }
  }
}

function sharesArea(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  for (const area of a) {
    if (b.has(area)) {
      return true;
    }
  }
  return false;
}

/**
 * Give the 4-connected passable cells around `start` (all still 0 in
 * `areas`) the area `area`, breadth first through `queue`.
 */
function floodArea(
  costCells: Uint8Array,
  size: number,
  start: number,
  area: number,
  areas: Int32Array,
  queue: Int32Array,
): void {
  let head = 0;
  let tail = 0;
  const visit = (idx: number): void => {
    if (areas[idx] === 0 && costCells[idx] !== COST_IMPASSABLE) {
      areas[idx] = area;
      queue[tail++] = idx;
    }
  };
  visit(start);
  while (head < tail) {
    const idx = queue[head++]!;
    const x = idx % size;
    if (idx >= size) {
      visit(idx - size);
    }
    if (x > 0) {
      visit(idx - 1);
    }
    if (idx < size * (size - 1)) {
      visit(idx + size);
    }
    if (x < size - 1) {
      visit(idx + 1);
    }
  }
}
