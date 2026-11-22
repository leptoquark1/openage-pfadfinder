import type { FlowRoute, Grid } from '@leptoquark1/openage-pfadfinder';
import type { Path, PortalId, SectorId, Waypoint } from '@leptoquark1/openage-pfadfinder/shared';
import type { AStarEvent, FieldWrite } from '../observe.js';
import type { Cell, Scenario } from '../scenarios.js';

export interface SectorView {
  readonly id: SectorId;
  readonly x: number;
  readonly y: number;
  /** Global coordinates of the sector's first cell. */
  readonly ne: number;
  readonly se: number;
  readonly areas: Uint16Array | Int32Array;
  readonly areaCount: number;
  /** Breadth-first distance of each cell from the first cell of its area. */
  readonly floodRank: Int16Array;
  readonly floodMax: number;
  readonly portalIds: readonly PortalId[];
}

export interface PortalView {
  readonly id: PortalId;
  readonly sectors: readonly [SectorId, SectorId];
  readonly northSouth: boolean;
  /** Global cells on the sector0 and sector1 side. */
  readonly cells: readonly [readonly Cell[], readonly Cell[]];
  /** Middle of the gate on the sector border, in continuous cell coordinates. */
  readonly x: number;
  readonly y: number;
}

/** One sector border as `Grid.initPortals()` scans it. */
export interface EdgeScan {
  readonly a: SectorId;
  readonly b: SectorId;
  readonly northSouth: boolean;
  readonly pairs: readonly { readonly a: Cell; readonly b: Cell; readonly open: boolean }[];
  readonly portalIds: readonly PortalId[];
}

export interface GraphEdge {
  readonly a: PortalId;
  readonly b: PortalId;
  readonly sector: SectorId;
  readonly cost: number;
}

export interface SearchTrace {
  readonly events: readonly AStarEvent[];
  readonly found: boolean;
  readonly partial: boolean;
  readonly chain: readonly PortalId[];
}

export interface FieldTrace {
  readonly kind: 'target' | 'portal';
  readonly sector: SectorId;
  /** The portal this field leads to; null for the target field. */
  readonly portal: PortalId | null;
  readonly nextSector: SectorId | null;
  readonly writes: readonly FieldWrite[];
  /** Writes of the line-of-sight stage; 0 for portal fields. */
  readonly losWrites: number;
  readonly maxCost: number;
  /** The route's real flow field. */
  readonly flow: Uint8Array;
}

export interface UnitPath {
  readonly cells: readonly Cell[];
  /** Distance travelled when reaching each cell. */
  readonly dist: readonly number[];
  readonly total: number;
}

export interface GuideModel {
  readonly scenario: Scenario;
  readonly grid: Grid;
  readonly sectors: readonly SectorView[];
  readonly portals: ReadonlyMap<PortalId, PortalView>;
  readonly edges: readonly EdgeScan[];
  readonly graphEdges: readonly GraphEdge[];
  readonly startSector: SectorId;
  readonly targetSector: SectorId;
  readonly sameArea: boolean;
  readonly startPortals: readonly PortalId[];
  readonly targetPortals: readonly PortalId[];
  readonly search: SearchTrace | null;
  readonly route: FlowRoute | null;
  readonly routeSectors: readonly SectorId[];
  /** Fields in computation order: target first, then back to front. */
  readonly fields: readonly FieldTrace[];
  readonly path: Path;
  readonly waypoints: readonly Waypoint[];
  readonly units: readonly UnitPath[];
}
