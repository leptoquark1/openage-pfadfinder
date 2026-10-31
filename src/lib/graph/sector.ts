import { COST_IMPASSABLE } from '../../shared/constants.js';
import { xyToIndex } from '../../shared/coordinates.js';
import {
  PortalDirection,
  type PortalId,
  type SectorId,
  type Vector2s,
} from '../../shared/types.js';
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

  getPortals(): Portal[] {
    return this.portals;
  }

  addPortal(portal: Portal): void {
    this.portals.push(portal);
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
   */
  findPortals(other: Sector, direction: PortalDirection, nextId: PortalId): Portal[] {
    const size = this.costField.getSize();
    const otherCostField = other.getCostField();
    const portals: Portal[] = [];

    if (direction === PortalDirection.NORTH_SOUTH) {
      // this is north of other → scan bottom edge of this / top edge of other
      const yThis = size - 1;
      const yOther = 0;
      let runStart = -1;

      for (let x = 0; x < size; x++) {
        const thisPassable = this.costField.getCost(x, yThis) !== COST_IMPASSABLE;
        const otherPassable = otherCostField.getCost(x, yOther) !== COST_IMPASSABLE;
        const passable = thisPassable && otherPassable;

        if (passable && runStart < 0) {
          runStart = x;
        }
        else if (!passable && runStart >= 0) {
          portals.push(
            new Portal(
              nextId++,
              this.id,
              other.getId(),
              PortalDirection.NORTH_SOUTH,
              { ne: runStart, se: yThis },
              { ne: x - 1, se: yThis },
            ),
          );
          runStart = -1;
        }
      }

      if (runStart >= 0) {
        portals.push(
          new Portal(
            nextId++,
            this.id,
            other.getId(),
            PortalDirection.NORTH_SOUTH,
            { ne: runStart, se: yThis },
            { ne: size - 1, se: yThis },
          ),
        );
      }
    }
    else {
      // EAST_WEST: this is west of other → scan right edge of this / left edge of other
      const xThis = size - 1;
      const xOther = 0;
      let runStart = -1;

      for (let y = 0; y < size; y++) {
        const thisPassable = this.costField.getCost(xThis, y) !== COST_IMPASSABLE;
        const otherPassable = otherCostField.getCost(xOther, y) !== COST_IMPASSABLE;
        const passable = thisPassable && otherPassable;

        if (passable && runStart < 0) {
          runStart = y;
        }
        else if (!passable && runStart >= 0) {
          portals.push(
            new Portal(
              nextId++,
              this.id,
              other.getId(),
              PortalDirection.EAST_WEST,
              { ne: xThis, se: runStart },
              { ne: xThis, se: y - 1 },
            ),
          );
          runStart = -1;
        }
      }

      if (runStart >= 0) {
        portals.push(
          new Portal(
            nextId++,
            this.id,
            other.getId(),
            PortalDirection.EAST_WEST,
            { ne: xThis, se: runStart },
            { ne: xThis, se: size - 1 },
          ),
        );
      }
    }

    return portals;
  }

  /**
   * Connect mutually reachable portals within this sector.
   * Uses 4-connected BFS flood-fill from each portal's entry cells
   * to determine which other portals are actually reachable through
   * the cost field (not blocked by walls).
   * Must be called after all sectors and portals are initialized.
   */
  connectExits(): void {
    const size = this.costField.getSize();
    const costCells = this.costField.getCosts();

    // Collect entry cell indices for each portal on this sector's side
    const portalEntryCells: Map<PortalId, number[]> = new Map();

    for (const portal of this.portals) {
      const entryStart = portal.getEntryStart(this.id);
      const entryEnd = portal.getEntryEnd(this.id);
      const cells: number[] = [];

      for (let y = entryStart.se; y <= entryEnd.se; y++) {
        for (let x = entryStart.ne; x <= entryEnd.ne; x++) {
          const idx = xyToIndex(x, y, size);
          if (costCells[idx]! !== COST_IMPASSABLE) {
            cells.push(idx);
          }
        }
      }

      portalEntryCells.set(portal.getId(), cells);
    }

    // For each portal, BFS flood-fill to find reachable portals
    for (const portal of this.portals) {
      const startCells = portalEntryCells.get(portal.getId())!;
      if (startCells.length === 0) {
        portal.setExits(this.id, []);
        continue;
      }

      const visited = new Uint8Array(size * size);
      const queue: number[] = [...startCells];
      const reachablePortalIds = new Set<PortalId>();

      for (const idx of startCells) {
        visited[idx] = 1;
      }

      // Mark which portals are reachable at the start cells (excluding self)
      for (const other of this.portals) {
        if (other.getId() === portal.getId()) {
          continue;
        }
        const otherCells = portalEntryCells.get(other.getId())!;
        for (const cellIdx of startCells) {
          if (otherCells.includes(cellIdx)) {
            reachablePortalIds.add(other.getId());
            break;
          }
        }
      }

      while (queue.length > 0) {
        const idx = queue.shift()!;

        // Check 4-connected neighbors
        const x = idx % size;
        const y = Math.floor(idx / size);

        const neighbors: number[] = [];
        if (y > 0) {
          neighbors.push(idx - size);
        }
        if (x > 0) {
          neighbors.push(idx - 1);
        }
        if (y < size - 1) {
          neighbors.push(idx + size);
        }
        if (x < size - 1) {
          neighbors.push(idx + 1);
        }

        for (const nIdx of neighbors) {
          if (visited[nIdx]) {
            continue;
          }
          if (costCells[nIdx]! === COST_IMPASSABLE) {
            continue;
          }

          visited[nIdx] = 1;

          // Check if this cell belongs to another portal's entry
          for (const other of this.portals) {
            if (other.getId() === portal.getId()) {
              continue;
            }
            if (reachablePortalIds.has(other.getId())) {
              continue;
            }
            const otherCells = portalEntryCells.get(other.getId())!;
            if (otherCells.includes(nIdx)) {
              reachablePortalIds.add(other.getId());
            }
          }

          queue.push(nIdx);
        }
      }

      const connectedPortals = this.portals.filter(
        p => p.getId() !== portal.getId() && reachablePortalIds.has(p.getId()),
      );
      portal.setExits(this.id, connectedPortals);
    }
  }
}
