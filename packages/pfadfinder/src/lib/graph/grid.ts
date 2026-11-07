import {
  type GridId,
  PortalDirection,
  type PortalId,
  type SectorId,
  type Size2s,
  type Vector2s,
} from '../../shared/types.js';
import { PortalNode } from '../pathfinding/portal-graph.js';
import type { Portal } from './portal.js';
import type { Sector } from './sector.js';

/**
 * Grid — top-level structure containing sectors and managing portals.
 * Each grid can have a different sector size.
 */
export class Grid {
  private readonly id: GridId;
  private readonly size: Size2s;
  private readonly sectorSize: number;
  private readonly sectors: Sector[] = [];
  private portalNodes: Map<PortalId, PortalNode> = new Map();
  private nextPortalId: PortalId = 0;

  constructor(id: GridId, size: Size2s, sectorSize: number);
  constructor(id: GridId, size: Size2s, sectors: Sector[]);
  constructor(id: GridId, size: Size2s, param: number | Sector[]) {
    this.id = id;
    this.size = size;

    if (typeof param === 'number') {
      this.sectorSize = param;
    }
    else {
      this.sectors = param;
      this.sectorSize = param[0]?.getCostField().getSize() ?? 10;
    }
  }

  getId(): GridId {
    return this.id;
  }

  getSize(): Size2s {
    return this.size;
  }

  getSectorSize(): number {
    return this.sectorSize;
  }

  getSector(x: number, y: number): Sector | undefined;
  getSector(id: SectorId): Sector | undefined;
  getSector(a: number, b?: number): Sector | undefined {
    if (b !== undefined) {
      const idx = a + b * this.size.width;
      return this.sectors[idx];
    }
    return this.sectors.find(s => s.getId() === a);
  }

  /**
   * Return the (x, y) sector-grid position of a sector by id.
   *
   * Sector ids are allocated row-major: id = x + y * width.
   * (initPortals and tests rely on this.)
   */
  getSectorPosition(sectorId: SectorId): Vector2s {
    return { x: sectorId % this.size.width, y: Math.floor(sectorId / this.size.width) };
  }

  getSectors(): Sector[] {
    return this.sectors;
  }

  addSector(sector: Sector): void {
    this.sectors.push(sector);
  }

  /**
   * Re-derive portals after cost fields changed, restricted to the edges of
   * the dirty sectors. A portal survives when it spans the same range as
   * before (`Portal.matches`); edges outside the rebuild set are left
   * untouched, including their cached exits.
   *
   * Returns every sector whose portal list changed (including the dirty
   * sectors); their exits are flood-filled fresh. Call `rebuildPortalNodes()`
   * afterwards to sync the portal graph.
   */
  rebuildPortals(dirtySectors: Sector[]): Set<SectorId> {
    if (dirtySectors.length === 0) {
      return new Set<SectorId>();
    }

    // Every edge with at least one dirty endpoint, deduplicated. The
    // lower/left sector of each edge identifies it.
    const edgeKeys = new Set<string>();
    for (const sector of dirtySectors) {
      const { x, y } = sector.getPosition();
      if (y < this.size.height - 1) {
        edgeKeys.add(`${x}:${y}:0`);
      }
      if (y > 0) {
        edgeKeys.add(`${x}:${y - 1}:0`);
      }
      if (x < this.size.width - 1) {
        edgeKeys.add(`${x}:${y}:1`);
      }
      if (x > 0) {
        edgeKeys.add(`${x - 1}:${y}:1`);
      }
    }

    const changed = new Set<SectorId>(dirtySectors.map(s => s.getId()));

    for (const key of edgeKeys) {
      const [x, y, dir] = key.split(':').map(Number) as [number, number, number];
      const sector = this.getSector(x, y);
      const other = dir === 0 ? this.getSector(x, y + 1) : this.getSector(x + 1, y);
      if (!sector || !other) {
        continue;
      }

      const oldPortals = sector
        .getPortals()
        .filter(p =>
          this.isEdgePortal(p.getSector0(), p.getSector1(), sector.getId(), other.getId()),
        );

      const found = sector.findPortals(
        other,
        dir === 0 ? PortalDirection.NORTH_SOUTH : PortalDirection.EAST_WEST,
        this.nextPortalId,
      );
      // findPortals numbers every portal it finds; reserve them all, so a new
      // portal never takes an id handed out before.
      this.nextPortalId += found.length;

      // Match portals that span the same range so they keep identity and
      // exits; new portals get fresh ids, vanished ones are dropped.
      const survivors: Portal[] = [];
      for (const portal of found) {
        const previous = oldPortals.find(p => p.matches(portal));
        if (previous) {
          survivors.push(previous);
        }
        else {
          survivors.push(portal);
        }
      }

      for (const portal of oldPortals) {
        if (!survivors.includes(portal)) {
          sector.removePortal(portal);
          other.removePortal(portal);
          changed.add(sector.getId());
          changed.add(other.getId());
        }
      }

      for (const portal of survivors) {
        if (!sector.getPortals().includes(portal)) {
          sector.addPortal(portal);
          changed.add(sector.getId());
        }
        if (!other.getPortals().includes(portal)) {
          other.addPortal(portal);
          changed.add(other.getId());
        }
      }
    }

    for (const id of changed) {
      this.getSector(id)?.connectExits();
    }

    return changed;
  }

  /** True when the portal links exactly this pair of sectors. */
  private isEdgePortal(s0: SectorId, s1: SectorId, a: SectorId, b: SectorId): boolean {
    return (s0 === a && s1 === b) || (s0 === b && s1 === a);
  }

  /**
   * Sync portal graph nodes after `rebuildPortals()`. Nodes of dropped
   * portals are evicted, new portals get fresh nodes, and every node's exit
   * costs are recomputed. Cheaper than `initPortalNodes()` because nodes of
   * surviving portals keep their identity.
   */
  rebuildPortalNodes(): void {
    const live = new Set<PortalId>();
    for (const sector of this.sectors) {
      for (const portal of sector.getPortals()) {
        live.add(portal.getId());
        if (!this.portalNodes.has(portal.getId())) {
          this.portalNodes.set(portal.getId(), new PortalNode(portal));
        }
      }
    }

    for (const [id] of this.portalNodes) {
      if (!live.has(id)) {
        this.portalNodes.delete(id);
      }
    }

    for (const [, node] of this.portalNodes) {
      node.initExits(this.portalNodes);
    }
  }

  /**
   * Initialize portals between all adjacent sectors.
   * Must be called after all sector cost fields are set.
   */
  initPortals(): void {
    for (let y = 0; y < this.size.height; y++) {
      for (let x = 0; x < this.size.width; x++) {
        const sector = this.getSector(x, y);
        if (!sector) {
          continue;
        }

        // North-South: connect with sector below
        if (y < this.size.height - 1) {
          const below = this.getSector(x, y + 1);
          if (below) {
            const portals = sector.findPortals(
              below,
              PortalDirection.NORTH_SOUTH,
              this.nextPortalId,
            );
            for (const portal of portals) {
              sector.addPortal(portal);
              below.addPortal(portal);
              this.nextPortalId++;
            }
          }
        }

        // East-West: connect with sector to the right
        if (x < this.size.width - 1) {
          const right = this.getSector(x + 1, y);
          if (right) {
            const portals = sector.findPortals(right, PortalDirection.EAST_WEST, this.nextPortalId);
            for (const portal of portals) {
              sector.addPortal(portal);
              right.addPortal(portal);
              this.nextPortalId++;
            }
          }
        }

        sector.connectExits();
      }
    }
  }

  /**
   * Build the portal graph nodes with exit connections and distance costs.
   */
  initPortalNodes(): void {
    for (const sector of this.sectors) {
      for (const portal of sector.getPortals()) {
        if (this.portalNodes.has(portal.getId())) {
          continue;
        }

        const node = new PortalNode(portal);
        this.portalNodes.set(portal.getId(), node);
      }
    }

    // Initialize exits for each node
    for (const [, node] of this.portalNodes) {
      node.initExits(this.portalNodes);
    }
  }

  getPortalMap(): Map<PortalId, PortalNode> {
    return this.portalNodes;
  }

  /**
   * Convert global tile coordinates to sector-local coordinates.
   */
  globalToLocal(
    globalNe: number,
    globalSe: number,
  ): { sectorX: number, sectorY: number, localNe: number, localSe: number } {
    const sectorX = Math.floor(globalNe / this.sectorSize);
    const sectorY = Math.floor(globalSe / this.sectorSize);
    const localNe = globalNe % this.sectorSize;
    const localSe = globalSe % this.sectorSize;
    return { sectorX, sectorY, localNe, localSe };
  }

  /**
   * Get the sector containing a global tile coordinate.
   */
  getSectorAt(globalNe: number, globalSe: number): Sector | undefined {
    const { sectorX, sectorY } = this.globalToLocal(globalNe, globalSe);
    if (sectorX < 0 || sectorX >= this.size.width || sectorY < 0 || sectorY >= this.size.height) {
      return undefined;
    }
    return this.getSector(sectorX, sectorY);
  }

  /**
   * Change cell costs at global tile coordinates (e.g. a unit stopping on a
   * tile, a tree being cut) and bring the portal graph up to date: portals
   * of the touched sectors are rebuilt, exits flood-filled fresh, and
   * cached fields of the changed cost fields are invalidated by their
   * version. Cells outside the grid are ignored. Returns the sectors whose
   * portals changed.
   */
  updateCosts(
    changes: readonly { readonly ne: number, readonly se: number, readonly cost: number }[],
  ): Set<SectorId> {
    const dirty = new Set<Sector>();
    for (const { ne, se, cost } of changes) {
      const sector = this.getSectorAt(ne, se);
      if (!sector || ne < 0 || se < 0) {
        continue;
      }
      const { localNe, localSe } = this.globalToLocal(ne, se);
      const field = sector.getCostField();
      if (field.getCost(localNe, localSe) !== cost) {
        field.setCost(localNe, localSe, cost);
        dirty.add(sector);
      }
    }
    const changed = this.rebuildPortals([...dirty]);
    if (dirty.size > 0) {
      this.rebuildPortalNodes();
    }
    return changed;
  }

  /**
   * Get the total grid dimensions in cells.
   */
  getTotalCells(): Size2s {
    return {
      width: this.size.width * this.sectorSize,
      height: this.size.height * this.sectorSize,
    };
  }
}
