import {
  PortalDirection,
  type PortalId,
  type SectorId,
  type TileDelta,
} from '../../shared/types.js';

/**
 * Bidirectional gateway connecting two adjacent sectors.
 * Stores entry/exit cell ranges for both sides.
 *
 * Port of openage's Portal class.
 */
export class Portal {
  private readonly id: PortalId;
  private readonly sector0: SectorId;
  private readonly sector1: SectorId;
  private readonly direction: PortalDirection;
  private readonly cellStart: TileDelta;
  private readonly cellEnd: TileDelta;
  private sector0Exits: Portal[] = [];
  private sector1Exits: Portal[] = [];

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
    this.cellStart = cellStart;
    this.cellEnd = cellEnd;
  }

  getId(): PortalId {
    return this.id;
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

  getConnected(sectorId: SectorId): Portal[] {
    if (sectorId === this.sector0) {
      return this.sector0Exits;
    }
    if (sectorId === this.sector1) {
      return this.sector1Exits;
    }
    return [];
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

  setExits(sectorId: SectorId, exits: Portal[]): void {
    if (sectorId === this.sector0) {
      this.sector0Exits = exits;
    }
    else if (sectorId === this.sector1) {
      this.sector1Exits = exits;
    }
  }

  /**
   * True when both portals span the identical passable range between the
   * same sectors — used by `Grid.rebuildPortals()` to keep a surviving
   * portal's identity across incremental rebuilds.
   */
  matches(other: Portal): boolean {
    return (
      this.direction === other.direction
      && this.sector0 === other.sector0
      && this.sector1 === other.sector1
      && this.cellStart.ne === other.cellStart.ne
      && this.cellStart.se === other.cellStart.se
      && this.cellEnd.ne === other.cellEnd.ne
      && this.cellEnd.se === other.cellEnd.se
    );
  }

  /**
   * Entry start coordinate (in the entry sector's local space).
   */
  getEntryStart(sectorId: SectorId): TileDelta {
    if (sectorId === this.sector0) {
      return this.cellStart;
    }
    // sector1 side sits on row/column 0 of the connecting axis
    if (this.direction === PortalDirection.NORTH_SOUTH) {
      return { ne: this.cellStart.ne, se: 0 };
    }
    return { ne: 0, se: this.cellStart.se };
  }

  /**
   * Entry center coordinate.
   */
  getEntryCenter(sectorId: SectorId): TileDelta {
    const start = this.getEntryStart(sectorId);
    const end = this.getEntryEnd(sectorId);
    return {
      ne: Math.floor((start.ne + end.ne) / 2),
      se: Math.floor((start.se + end.se) / 2),
    };
  }

  /**
   * Entry end coordinate.
   */
  getEntryEnd(sectorId: SectorId): TileDelta {
    if (sectorId === this.sector0) {
      return this.cellEnd;
    }
    if (this.direction === PortalDirection.NORTH_SOUTH) {
      return { ne: this.cellEnd.ne, se: 0 };
    }
    return { ne: 0, se: this.cellEnd.se };
  }

  /**
   * Exit start coordinate (in the exit sector's local space).
   */
  getExitStart(sectorId: SectorId): TileDelta {
    if (sectorId === this.sector0) {
      // Exiting sector0 → entering sector1
      if (this.direction === PortalDirection.NORTH_SOUTH) {
        return { ne: this.cellStart.ne, se: 0 };
      }
      return { ne: 0, se: this.cellStart.se };
    }
    return this.cellStart;
  }

  /**
   * Exit end coordinate.
   */
  getExitEnd(sectorId: SectorId): TileDelta {
    if (sectorId === this.sector0) {
      if (this.direction === PortalDirection.NORTH_SOUTH) {
        return { ne: this.cellEnd.ne, se: 0 };
      }
      return { ne: 0, se: this.cellEnd.se };
    }
    return this.cellEnd;
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
