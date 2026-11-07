import { COST_IMPASSABLE } from '../../shared/constants.js';
import { tileToIndex, xyToIndex } from '../../shared/coordinates.js';
import type { GridId, Path, PathRequest } from '../../shared/types.js';
import type { IntegrationField } from '../core/integration-field.js';
import { Integrator } from '../core/integrator.js';
import type { Grid } from '../graph/grid.js';
import type { Portal } from '../graph/portal.js';
import type { Sector } from '../graph/sector.js';
import { FlowRoute, type FlowStep } from './flow-route.js';
import { pathNotFound, pathOutOfBounds } from './path-result.js';
import { portalAStar } from './portal-graph.js';

/**
 * Pathfinder — main interface for flow-field pathfinding.
 * Two-stage: Portal A* (high-level) + Flow Fields (low-level).
 *
 * Multi-sector pathfinding follows openage's approach:
 * - Portal A* finds the high-level path through sectors, starting/ending
 *   only at portals reachable from the start/target inside their sector.
 * - Flow fields are built per-sector, chained through portals:
 *   - Target sector: full LOS integration toward the goal.
 *   - Transit and start sectors: cost-only integration (no LOS) from the
 *     portal that leads towards the target.
 *   Only the target sector gets LOS (los_depth = 1).
 * - Waypoints come from walking those flow fields cell by cell in global
 *   coordinates, so every segment stays on passable cells.
 *
 * `getFlowRoute()` hands out the chained fields themselves (`FlowRoute`),
 * so a whole group can steer along one route; `getPath()` walks it once.
 */
export class Pathfinder {
  private readonly grids: Map<GridId, Grid> = new Map();
  private readonly integrator: Integrator;

  constructor() {
    this.integrator = new Integrator();
  }

  addGrid(grid: Grid): void {
    this.grids.set(grid.getId(), grid);
  }

  getGrid(id: GridId): Grid | undefined {
    return this.grids.get(id);
  }

  /** Portal fields cached for reuse across requests, e.g. for a debug view. */
  getCachedFieldCount(): number {
    return this.integrator.getCachedFieldCount();
  }

  /**
   * Main entry point. Computes a path from start to target.
   */
  getPath(request: PathRequest): Path {
    const route = this.planRoute(request);
    return route instanceof FlowRoute ? route.walk(request.start) : route;
  }

  /**
   * The flow fields from start to target as a route units can follow cell
   * by cell (`FlowRoute.next()`); `null` when no path exists or a point is
   * out of bounds.
   */
  getFlowRoute(request: PathRequest): FlowRoute | null {
    const route = this.planRoute(request);
    return route instanceof FlowRoute ? route : null;
  }

  /** The route for a request, or the failed `Path` that explains why there is none. */
  private planRoute(request: PathRequest): FlowRoute | Path {
    const grid = this.grids.get(request.gridId);
    if (!grid) {
      return pathNotFound();
    }

    const totalCells = grid.getTotalCells();
    if (
      request.target.ne < 0
      || request.target.ne >= totalCells.width
      || request.target.se < 0
      || request.target.se >= totalCells.height
    ) {
      return pathOutOfBounds();
    }
    if (
      request.start.ne < 0
      || request.start.ne >= totalCells.width
      || request.start.se < 0
      || request.start.se >= totalCells.height
    ) {
      return pathOutOfBounds();
    }

    const startSector = grid.getSectorAt(request.start.ne, request.start.se);
    const targetSector = grid.getSectorAt(request.target.ne, request.target.se);
    if (!startSector || !targetSector) {
      return pathOutOfBounds();
    }

    // Check if target is passable
    const { localNe: tLocalNe, localSe: tLocalSe } = this.globalToLocalInSector(
      grid,
      request.target.ne,
      request.target.se,
    );
    const targetCostIdx = tileToIndex(
      { ne: tLocalNe, se: tLocalSe },
      targetSector.getCostField().getSize(),
    );
    if (targetSector.getCostField().getCost(targetCostIdx) === COST_IMPASSABLE) {
      return pathNotFound();
    }

    const { localNe: sLocalNe, localSe: sLocalSe } = this.globalToLocalInSector(
      grid,
      request.start.ne,
      request.start.se,
    );

    // Same sector and connected inside it → single flow field. A sector
    // split by a wall falls through to the portal route instead.
    if (
      startSector.getId() === targetSector.getId()
      && this.reachableInSector(startSector, sLocalNe, sLocalSe).has(targetCostIdx)
    ) {
      return this.getPathSingleSector(startSector, request);
    }

    // Multi-sector: portal A* + flow fields
    return this.getPathMultiSector(grid, startSector, targetSector, request);
  }

  private getPathSingleSector(sector: Sector, request: PathRequest): FlowRoute {
    const grid = this.grids.get(request.gridId)!;
    const { localNe: tLocalNe, localSe: tLocalSe } = this.globalToLocalInSector(
      grid,
      request.target.ne,
      request.target.se,
    );

    // single sector: use LOS for best path quality
    const { flowField } = this.integrator.get(
      sector.getCostField(),
      { ne: tLocalNe, se: tLocalSe },
      true,
    );

    return new FlowRoute(grid, [{ sector, flowField }], request.target);
  }

  private getPathMultiSector(
    grid: Grid,
    startSector: Sector,
    targetSector: Sector,
    request: PathRequest,
  ): FlowRoute | Path {
    const portalMap = grid.getPortalMap();

    const { localNe: sLocalNe, localSe: sLocalSe } = this.globalToLocalInSector(
      grid,
      request.start.ne,
      request.start.se,
    );
    const { localNe: tLocalNe, localSe: tLocalSe } = this.globalToLocalInSector(
      grid,
      request.target.ne,
      request.target.se,
    );

    // Only portals on the start's / target's side of any wall inside
    // their sector are valid ends of the portal route.
    const startPortals = this.portalsReachableFrom(startSector, sLocalNe, sLocalSe);
    const targetPortals = this.portalsReachableFrom(targetSector, tLocalNe, tLocalSe);

    if (startPortals.length === 0 || targetPortals.length === 0) {
      return pathNotFound();
    }

    // Portal A* search — target position as GLOBAL tile coords so the
    // heuristic compares portals across sectors in one coordinate system.
    const result = portalAStar(
      grid,
      startPortals,
      targetPortals,
      portalMap,
      { ne: request.target.ne, se: request.target.se },
      startSector.getId(),
      {
        ne: request.start.ne,
        se: request.start.se,
      },
    );

    // A partial route ends short of the target, so it cannot be walked to it.
    const portals = result.portals;
    if (!result.found || portals.length === 0) {
      return pathNotFound();
    }

    // Sectors along the route: routeSectors[i] is the sector we leave
    // through portals[i]; the last entry is the target sector.
    const routeSectors: Sector[] = [startSector];
    for (const portal of portals) {
      const next = grid.getSector(
        portal.getExitSector(routeSectors[routeSectors.length - 1]!.getId()),
      );
      if (!next) {
        return pathNotFound();
      }
      routeSectors.push(next);
    }

    // --- Target sector: LOS integration toward the goal ---
    const { flowField: targetFlow, integrationField: targetIntegration } = this.integrator.get(
      targetSector.getCostField(),
      { ne: tLocalNe, se: tLocalSe },
      true, // los_depth = 1: only the target sector gets LOS
    );

    // --- Remaining sectors, back to front: each integrates from the
    // portal leading towards the target, chained through portal fields. ---
    const steps: FlowStep[] = new Array(routeSectors.length);
    steps[portals.length] = { sector: targetSector, flowField: targetFlow };

    let nextIntegration: IntegrationField = targetIntegration;
    for (let i = portals.length - 1; i >= 0; i--) {
      const sector = routeSectors[i]!;
      const portal = portals[i]!;
      const nextSectorId = routeSectors[i + 1]!.getId();

      const { flowField, integrationField } = this.integrator.getPortal(
        sector.getCostField(),
        nextIntegration,
        nextSectorId,
        portal,
        portal.getEntryCenter(sector.getId()),
        false, // no LOS outside the target sector
      );

      steps[i] = { sector, flowField };
      nextIntegration = integrationField;
    }

    return new FlowRoute(grid, steps, request.target);
  }

  /**
   * Cell indices reachable from a local cell inside the sector
   * (4-connected flood fill over passable cells).
   */
  private reachableInSector(sector: Sector, localNe: number, localSe: number): Set<number> {
    const costField = sector.getCostField();
    const size = costField.getSize();
    const costs = costField.getCosts();
    const startIdx = xyToIndex(localNe, localSe, size);
    const visited = new Set<number>([startIdx]);
    const queue = [startIdx];

    for (let i = 0; i < queue.length; i++) {
      const idx = queue[i]!;
      const x = idx % size;
      const y = (idx - x) / size;
      const neighbours = [
        x > 0 ? idx - 1 : -1,
        x < size - 1 ? idx + 1 : -1,
        y > 0 ? idx - size : -1,
        y < size - 1 ? idx + size : -1,
      ];
      for (const nIdx of neighbours) {
        if (nIdx >= 0 && !visited.has(nIdx) && costs[nIdx] !== COST_IMPASSABLE) {
          visited.add(nIdx);
          queue.push(nIdx);
        }
      }
    }

    return visited;
  }

  /** Portals of the sector whose entry cells are reachable from a local cell. */
  private portalsReachableFrom(sector: Sector, localNe: number, localSe: number): Portal[] {
    const size = sector.getCostField().getSize();
    const reachable = this.reachableInSector(sector, localNe, localSe);

    return sector.getPortals().filter((portal) => {
      const start = portal.getEntryStart(sector.getId());
      const end = portal.getEntryEnd(sector.getId());
      for (let y = start.se; y <= end.se; y++) {
        for (let x = start.ne; x <= end.ne; x++) {
          if (reachable.has(xyToIndex(x, y, size))) {
            return true;
          }
        }
      }
      return false;
    });
  }

  private globalToLocalInSector(
    grid: Grid,
    ne: number,
    se: number,
  ): { localNe: number, localSe: number } {
    const { localNe, localSe } = grid.globalToLocal(ne, se);
    return { localNe, localSe };
  }
}
