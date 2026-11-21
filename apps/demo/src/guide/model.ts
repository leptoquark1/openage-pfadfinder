import { CostField, type FlowRoute, Grid, Pathfinder, type Portal, Sector } from '@leptoquark1/openage-pfadfinder';
import {
  COST_IMPASSABLE,
  INTEGRATED_COST_UNREACHABLE,
  type Path,
  PathResult,
  type PortalId,
  type SectorId,
  type Waypoint,
} from '@leptoquark1/openage-pfadfinder/shared';
import { type AStarEvent, type FieldWrite, observeAStar, observeField } from './observe.js';
import { type Cell, COLS, ROWS, type Scenario, SECTOR_SIZE, SECTORS_X, SECTORS_Y } from './scenarios.js';

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

const CROWD_SIZE = 56;

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

function sliceSector(costs: Uint8Array, x: number, y: number): Uint8Array {
  const local = new Uint8Array(SECTOR_SIZE * SECTOR_SIZE);
  for (let row = 0; row < SECTOR_SIZE; row++) {
    const from = (y * SECTOR_SIZE + row) * COLS + x * SECTOR_SIZE;
    local.set(costs.subarray(from, from + SECTOR_SIZE), row * SECTOR_SIZE);
  }
  return local;
}

function floodRanks(areas: Uint16Array | Int32Array): { ranks: Int16Array; max: number; count: number } {
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

function portalView(grid: Grid, portal: Portal): PortalView {
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
function scanEdges(grid: Grid, costs: Uint8Array): EdgeScan[] {
  const edges: EdgeScan[] = [];
  const open = (a: Cell, b: Cell) =>
    costs[a.ne + a.se * COLS] !== COST_IMPASSABLE && costs[b.ne + b.se * COLS] !== COST_IMPASSABLE;
  const portalsBetween = (a: Sector, b: Sector) =>
    a
      .getPortals()
      .filter(p => p.getExitSector(a.getId()) === b.getId())
      .map(p => p.getId())
      .sort((p, q) => p - q);

  for (let y = 0; y < SECTORS_Y; y++) {
    for (let x = 0; x < SECTORS_X; x++) {
      const sector = grid.getSector(x, y)!;
      if (y < SECTORS_Y - 1) {
        const below = grid.getSector(x, y + 1)!;
        const pairs = Array.from({ length: SECTOR_SIZE }, (_, i) => {
          const a = { ne: x * SECTOR_SIZE + i, se: (y + 1) * SECTOR_SIZE - 1 };
          const b = { ne: a.ne, se: a.se + 1 };
          return { a, b, open: open(a, b) };
        });
        edges.push({
          a: sector.getId(),
          b: below.getId(),
          northSouth: true,
          pairs,
          portalIds: portalsBetween(sector, below),
        });
      }
      if (x < SECTORS_X - 1) {
        const right = grid.getSector(x + 1, y)!;
        const pairs = Array.from({ length: SECTOR_SIZE }, (_, i) => {
          const a = { ne: (x + 1) * SECTOR_SIZE - 1, se: y * SECTOR_SIZE + i };
          const b = { ne: a.ne + 1, se: a.se };
          return { a, b, open: open(a, b) };
        });
        edges.push({
          a: sector.getId(),
          b: right.getId(),
          northSouth: false,
          pairs,
          portalIds: portalsBetween(sector, right),
        });
      }
    }
  }
  return edges;
}

function graphEdges(grid: Grid): GraphEdge[] {
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

function portalsReachableFrom(sector: Sector, local: Cell): Portal[] {
  const areas = sector.getAreas();
  const area = areas[local.ne + local.se * SECTOR_SIZE];
  return sector
    .getPortals()
    .filter(portal => localCells(portal, sector.getId()).some(cell => areas[cell.ne + cell.se * SECTOR_SIZE] === area));
}

function buildFields(grid: Grid, scenario: Scenario, route: FlowRoute, chain: readonly Portal[]): FieldTrace[] {
  const steps = route.getSteps();
  const fields: FieldTrace[] = [];
  const { localNe, localSe } = grid.globalToLocal(scenario.target.ne, scenario.target.se);
  const finite = (writes: readonly FieldWrite[]) =>
    writes.reduce((max, w) => (w.cost < INTEGRATED_COST_UNREACHABLE ? Math.max(max, w.cost) : max), 1);

  const last = steps[steps.length - 1]!;
  let blocked: number[] = [];
  const targetField = observeField(last.sector.getCostField().getCosts(), SECTOR_SIZE, [
    (costField, field) => {
      blocked = field.integrateLos(costField, { ne: localNe, se: localSe });
    },
    (costField, field) => field.integrateCostFromWavefront(costField, blocked),
  ]);
  fields.push({
    kind: 'target',
    sector: last.sector.getId(),
    portal: null,
    nextSector: null,
    writes: targetField.writes,
    losWrites: targetField.stageEnds[0]!,
    maxCost: finite(targetField.writes),
    flow: last.flowField.getCells(),
  });

  for (let i = chain.length - 1; i >= 0; i--) {
    const step = steps[i]!;
    const portal = chain[i]!;
    const nextSector = steps[i + 1]!.sector.getId();
    const portalField = observeField(step.sector.getCostField().getCosts(), SECTOR_SIZE, [
      (costField, field) => field.integrateCostPortal(costField, nextSector, portal),
    ]);
    fields.push({
      kind: 'portal',
      sector: step.sector.getId(),
      portal: portal.getId(),
      nextSector,
      writes: portalField.writes,
      losWrites: 0,
      maxCost: finite(portalField.writes),
      flow: step.flowField.getCells(),
    });
  }
  return fields;
}

/** A crowd spread over the route's sectors, each unit following `route.next()`. */
function spawnUnits(scenario: Scenario, route: FlowRoute, grid: Grid): UnitPath[] {
  const routeSectors = new Set(route.getSectorIds());
  const candidates: Cell[] = [];
  for (let se = 0; se < ROWS; se++) {
    for (let ne = 0; ne < COLS; ne++) {
      const free = scenario.costs[ne + se * COLS] !== COST_IMPASSABLE;
      if (free && routeSectors.has(grid.getSectorAt(ne, se)!.getId())) {
        candidates.push({ ne, se });
      }
    }
  }

  // Deterministic shuffle: the same map always gets the same crowd.
  let seed = 0x2f6e2b1;
  for (let i = candidates.length - 1; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
  }

  const units: UnitPath[] = [];
  for (const from of candidates) {
    if (units.length >= CROWD_SIZE) {
      break;
    }
    const cells: Cell[] = [from];
    const dist = [0];
    const seen = new Set([from.ne + from.se * COLS]);
    let cell = from;
    while (true) {
      const next = route.next(cell.ne, cell.se);
      if (!next || seen.has(next.ne + next.se * COLS)) {
        break;
      }
      seen.add(next.ne + next.se * COLS);
      dist.push(dist[dist.length - 1]! + Math.hypot(next.ne - cell.ne, next.se - cell.se));
      cells.push(next);
      cell = next;
    }
    if (cell.ne === scenario.target.ne && cell.se === scenario.target.se && cells.length > 1) {
      units.push({ cells, dist, total: dist[dist.length - 1]! });
    }
  }
  return units;
}

/**
 * Build the real grid and run the real pathfinder for a scenario, recording
 * everything the guide needs to replay it.
 */
export function buildModel(scenario: Scenario): GuideModel {
  const { costs, start, target } = scenario;

  const grid = new Grid(0, { width: SECTORS_X, height: SECTORS_Y }, SECTOR_SIZE);
  for (let y = 0, id = 0; y < SECTORS_Y; y++) {
    for (let x = 0; x < SECTORS_X; x++, id++) {
      const field = new CostField(SECTOR_SIZE);
      field.setCosts(sliceSector(costs, x, y));
      grid.addSector(new Sector(id, { x, y }, field));
    }
  }
  grid.initPortals();
  grid.initPortalNodes();

  const sectors: SectorView[] = grid.getSectors().map(sector => {
    const { x, y } = sector.getPosition();
    const areas = sector.getAreas();
    const flood = floodRanks(areas);
    return {
      id: sector.getId(),
      x,
      y,
      ne: x * SECTOR_SIZE,
      se: y * SECTOR_SIZE,
      areas,
      areaCount: flood.count,
      floodRank: flood.ranks,
      floodMax: flood.max,
      portalIds: sector.getPortals().map(p => p.getId()),
    };
  });

  const portals = new Map<PortalId, PortalView>();
  for (const sector of grid.getSectors()) {
    for (const portal of sector.getPortals()) {
      if (!portals.has(portal.getId())) {
        portals.set(portal.getId(), portalView(grid, portal));
      }
    }
  }

  const pathfinder = new Pathfinder();
  pathfinder.addGrid(grid);
  const request = { gridId: 0, start, target };
  const route = pathfinder.getFlowRoute(request);
  const path = pathfinder.getPath(request);

  const startSector = grid.getSectorAt(start.ne, start.se)!;
  const targetSector = grid.getSectorAt(target.ne, target.se)!;
  const startLocal = grid.globalToLocal(start.ne, start.se);
  const targetLocal = grid.globalToLocal(target.ne, target.se);
  const startCell = { ne: startLocal.localNe, se: startLocal.localSe };
  const targetCell = { ne: targetLocal.localNe, se: targetLocal.localSe };
  const sameArea =
    startSector === targetSector &&
    startSector.getAreas()[startCell.ne + startCell.se * SECTOR_SIZE] ===
      startSector.getAreas()[targetCell.ne + targetCell.se * SECTOR_SIZE];

  const startPortals = sameArea ? [] : portalsReachableFrom(startSector, startCell);
  const targetPortals = sameArea ? [] : portalsReachableFrom(targetSector, targetCell);

  let search: SearchTrace | null = null;
  let chain: Portal[] = [];
  if (!sameArea && startPortals.length > 0 && targetPortals.length > 0) {
    const observed = observeAStar(grid, startPortals, targetPortals, target, startSector.getId(), start);
    chain = observed.result.portals;
    search = {
      events: observed.events,
      found: observed.result.found,
      partial: observed.result.partial,
      chain: chain.map(p => p.getId()),
    };
  }

  const fields = route ? buildFields(grid, scenario, route, chain) : [];

  return {
    scenario,
    grid,
    sectors,
    portals,
    edges: scanEdges(grid, costs),
    graphEdges: graphEdges(grid),
    startSector: startSector.getId(),
    targetSector: targetSector.getId(),
    sameArea,
    startPortals: startPortals.map(p => p.getId()),
    targetPortals: targetPortals.map(p => p.getId()),
    search,
    route,
    routeSectors: route?.getSectorIds() ?? [],
    fields,
    path,
    waypoints: path.result === PathResult.FOUND ? path.waypoints : [],
    units: route ? spawnUnits(scenario, route, grid) : [],
  };
}
