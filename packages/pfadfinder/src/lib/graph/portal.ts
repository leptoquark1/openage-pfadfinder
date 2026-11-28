import { tileEuclidean } from '../../shared/coordinates.js';
import { type CacheKey, PortalDirection, type PortalId, type SectorId, type TileDelta } from '../../shared/types.js';

/**
 * Typed array an `ExitTable` keeps its costs in, the smallest that fits the sector size.
 *
 * @internal
 */
export type ExitCosts = Uint8Array | Uint16Array | Uint32Array;

/**
 * The exits of a sector's portals with their distance costs, as
 * `Sector.connectExits()` leaves them: row `i` belongs to `portals[i]`, and
 * `costs[i * portals.length + j]` is the cost from it to exit `portals[j]`
 * plus one, or 0 where `portals[j]` is no exit of it. One table serves all
 * portals of a sector instead of a list and a cost map per portal side.
 *
 * Read-only; replaced as a whole when the exits change.
 *
 * @internal
 */
export interface ExitTable {
  readonly portals: readonly Portal[];
  readonly costs: ExitCosts;
}

/** Distance cost of the walk between two portal centers in one sector frame: `round(euclidean × 10)`. */
export function portalDistanceCost(a: TileDelta, b: TileDelta): number {
  return Math.round(tileEuclidean(a, b) * 10);
}

/**
 * An empty table (no exits yet) for these portals, sized for costs up to `maxCost`.
 *
 * @internal
 */
export function makeExitTable(portals: readonly Portal[], maxCost: number): ExitTable {
  const cells = portals.length * portals.length;
  // costs are stored plus one, so 0 is left for "no exit"
  const costs =
    maxCost < 0xff ? new Uint8Array(cells) : maxCost < 0xffff ? new Uint16Array(cells) : new Uint32Array(cells);
  return { portals, costs };
}

const NO_EXITS: ExitTable = { portals: [], costs: new Uint8Array(0) };

/**
 * Bidirectional gateway connecting two adjacent sectors.
 * Stores entry/exit cell ranges for both sides.
 *
 * The cell range is kept as four numbers, not as objects: a grid holds
 * thousands of portals. The getters derive each side's coordinates from them
 * and return a new object on every call.
 *
 * Port of openage's Portal class.
 */
export class Portal {
  private id: PortalId;
  private readonly sector0: SectorId;
  private readonly sector1: SectorId;
  private readonly direction: PortalDirection;
  /** The cell range in sector0's local frame (`cellStart`/`cellEnd` of the constructor). */
  private readonly startNe: number;
  private readonly startSe: number;
  private readonly endNe: number;
  private readonly endSe: number;
  /** The exit table of each side and this portal's row in it (see `ExitTable`). */
  private exits0: ExitTable = NO_EXITS;
  private exits1: ExitTable = NO_EXITS;
  private row0 = -1;
  private row1 = -1;
  /** Derived from the immutable cell range on first use, per sector side. */
  private rangeKey0: CacheKey | undefined;
  private rangeKey1: CacheKey | undefined;

  constructor(
    id: PortalId,
    sector0: SectorId,
    sector1: SectorId,
    direction: PortalDirection,
    cellStart: TileDelta,
    cellEnd: TileDelta,
  ) {
    this.id = id;
    this.sector0 = sector0;
    this.sector1 = sector1;
    this.direction = direction;
    this.startNe = cellStart.ne;
    this.startSe = cellStart.se;
    this.endNe = cellEnd.ne;
    this.endSe = cellEnd.se;
  }

  getId(): PortalId {
    return this.id;
  }

  /**
   * Give the portal another id (by `Grid.renumberPortals()`, which keeps the
   * grid's node map in step).
   *
   * @internal
   */
  setId(id: PortalId): void {
    this.id = id;
  }

  getDirection(): PortalDirection {
    return this.direction;
  }

  getSector0(): SectorId {
    return this.sector0;
  }

  getSector1(): SectorId {
    return this.sector1;
  }

  /**
   * The exits on one side: portals of that sector reachable from this one
   * inside it, in the sector's portal order. A fresh array on every call.
   */
  getConnected(sectorId: SectorId): Portal[] {
    const table = this.getExitTable(sectorId);
    const row = this.getExitRow(sectorId);
    const exits: Portal[] = [];
    if (row < 0) {
      return exits;
    }
    const count = table.portals.length;
    for (let j = 0, at = row * count; j < count; j++, at++) {
      if (table.costs[at] !== 0) {
        exits.push(table.portals[j]!);
      }
    }
    return exits;
  }

  getExits(sectorId: SectorId): Portal[] {
    return this.getConnected(sectorId);
  }

  getExitSector(sectorId: SectorId): SectorId {
    if (sectorId === this.sector0) {
      return this.sector1;
    }
    if (sectorId === this.sector1) {
      return this.sector0;
    }
    return -1;
  }

  /**
   * Replace the exits on one side.
   *
   * @deprecated `Sector.connectExits()` sets the exits of all portals of a
   * sector at once and keeps them more compactly; this gives the portal a
   * table of its own. Kept for compatibility.
   */
  setExits(sectorId: SectorId, exits: Portal[]): void {
    if (sectorId !== this.sector0 && sectorId !== this.sector1) {
      return;
    }
    const portals = [this, ...exits];
    const from = this.getEntryCenter(sectorId);
    const costs = exits.map(exit => portalDistanceCost(from, exit.getEntryCenter(sectorId)));
    const table = makeExitTable(portals, Math.max(0, ...costs));
    for (const [j, cost] of costs.entries()) {
      table.costs[j + 1] = cost + 1;
    }
    this.setExitRow(sectorId, table, 0);
  }

  /**
   * The exit table of one side; empty for a sector this portal does not
   * connect or before its exits were set.
   *
   * @internal
   */
  getExitTable(sectorId: SectorId): ExitTable {
    return sectorId === this.sector0 ? this.exits0 : sectorId === this.sector1 ? this.exits1 : NO_EXITS;
  }

  /**
   * This portal's row in the exit table of one side, -1 without one.
   *
   * @internal
   */
  getExitRow(sectorId: SectorId): number {
    return sectorId === this.sector0 ? this.row0 : sectorId === this.sector1 ? this.row1 : -1;
  }

  /**
   * Point one side at its row of an exit table (by `Sector.connectExits()`).
   *
   * @internal
   */
  setExitRow(sectorId: SectorId, table: ExitTable, row: number): void {
    if (sectorId === this.sector0) {
      this.exits0 = table;
      this.row0 = row;
    } else if (sectorId === this.sector1) {
      this.exits1 = table;
      this.row1 = row;
    }
  }

  /**
   * True when both portals span the identical passable range between the
   * same sectors — used by `Grid.rebuildPortals()` to keep a surviving
   * portal's identity across incremental rebuilds.
   */
  matches(other: Portal): boolean {
    return (
      this.direction === other.direction &&
      this.sector0 === other.sector0 &&
      this.sector1 === other.sector1 &&
      this.startNe === other.startNe &&
      this.startSe === other.startSe &&
      this.endNe === other.endNe &&
      this.endSe === other.endSe
    );
  }

  /**
   * True when this portal spans exactly the given range between the given
   * sectors. Lets a candidate range be compared before a portal (and an id)
   * is created for it.
   */
  spans(
    sector0: SectorId,
    sector1: SectorId,
    direction: PortalDirection,
    cellStart: TileDelta,
    cellEnd: TileDelta,
  ): boolean {
    return (
      this.direction === direction &&
      this.sector0 === sector0 &&
      this.sector1 === sector1 &&
      this.startNe === cellStart.ne &&
      this.startSe === cellStart.se &&
      this.endNe === cellEnd.ne &&
      this.endSe === cellEnd.se
    );
  }

  // Coordinates on the side of `sectorId`. sector0's side is the stored
  // range; sector1's side sits on row/column 0 of the connecting axis
  // (also for a sector the portal does not connect, as before).

  /** Whether the ne coordinate of the entry cells on that side is the stored one (else 0). */
  private entryKeepsNe(sectorId: SectorId): boolean {
    return sectorId === this.sector0 || this.direction === PortalDirection.NORTH_SOUTH;
  }

  /** Whether the se coordinate of the entry cells on that side is the stored one (else 0). */
  private entryKeepsSe(sectorId: SectorId): boolean {
    return sectorId === this.sector0 || this.direction !== PortalDirection.NORTH_SOUTH;
  }

  /** The exit cells of a side are the entry cells of the other side. */
  private exitKeepsNe(sectorId: SectorId): boolean {
    return sectorId !== this.sector0 || this.direction === PortalDirection.NORTH_SOUTH;
  }

  private exitKeepsSe(sectorId: SectorId): boolean {
    return sectorId !== this.sector0 || this.direction !== PortalDirection.NORTH_SOUTH;
  }

  /**
   * Entry start coordinate (in the entry sector's local space).
   */
  getEntryStart(sectorId: SectorId): TileDelta {
    return {
      ne: this.entryKeepsNe(sectorId) ? this.startNe : 0,
      se: this.entryKeepsSe(sectorId) ? this.startSe : 0,
    };
  }

  /**
   * Entry center coordinate.
   */
  getEntryCenter(sectorId: SectorId): TileDelta {
    return { ne: this.getEntryCenterNe(sectorId), se: this.getEntryCenterSe(sectorId) };
  }

  /**
   * The ne coordinate of `getEntryCenter()`, without an object.
   *
   * @internal
   */
  getEntryCenterNe(sectorId: SectorId): number {
    return this.entryKeepsNe(sectorId) ? Math.floor((this.startNe + this.endNe) / 2) : 0;
  }

  /**
   * The se coordinate of `getEntryCenter()`, without an object.
   *
   * @internal
   */
  getEntryCenterSe(sectorId: SectorId): number {
    return this.entryKeepsSe(sectorId) ? Math.floor((this.startSe + this.endSe) / 2) : 0;
  }

  /**
   * Entry end coordinate.
   */
  getEntryEnd(sectorId: SectorId): TileDelta {
    return {
      ne: this.entryKeepsNe(sectorId) ? this.endNe : 0,
      se: this.entryKeepsSe(sectorId) ? this.endSe : 0,
    };
  }

  /**
   * Exit start coordinate (in the exit sector's local space).
   */
  getExitStart(sectorId: SectorId): TileDelta {
    return {
      ne: this.exitKeepsNe(sectorId) ? this.startNe : 0,
      se: this.exitKeepsSe(sectorId) ? this.startSe : 0,
    };
  }

  /**
   * Exit end coordinate.
   */
  getExitEnd(sectorId: SectorId): TileDelta {
    return {
      ne: this.exitKeepsNe(sectorId) ? this.endNe : 0,
      se: this.exitKeepsSe(sectorId) ? this.endSe : 0,
    };
  }

  /**
   * Key of the cells this portal occupies in the sector entered from
   * `sectorId`: portals spanning the same range there share it.
   */
  getExitRangeKey(sectorId: SectorId): CacheKey {
    if (sectorId === this.sector0) {
      this.rangeKey0 ??= this.makeRangeKey(sectorId);
      return this.rangeKey0;
    }
    if (sectorId === this.sector1) {
      this.rangeKey1 ??= this.makeRangeKey(sectorId);
      return this.rangeKey1;
    }
    return this.makeRangeKey(sectorId);
  }

  private makeRangeKey(sectorId: SectorId): CacheKey {
    const start = this.getExitStart(sectorId);
    const end = this.getExitEnd(sectorId);
    return `${sectorId}:${start.ne},${start.se}:${end.ne},${end.se}`;
  }

  /**
   * Exit center coordinate.
   */
  getExitCenter(sectorId: SectorId): TileDelta {
    const start = this.getExitStart(sectorId);
    const end = this.getExitEnd(sectorId);
    return {
      ne: Math.floor((start.ne + end.ne) / 2),
      se: Math.floor((start.se + end.se) / 2),
    };
  }
}
