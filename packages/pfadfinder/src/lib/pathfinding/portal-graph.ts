import { tileEuclidean } from '../../shared/coordinates.js';
import type { PortalId, SectorId, TileDelta } from '../../shared/types.js';
import type { Grid } from '../graph/grid.js';
import type { Portal } from '../graph/portal.js';
import { BinaryHeap } from '../internal/binary-heap.js';

export interface PortalStarResult {
  readonly found: boolean
  readonly portals: Portal[]
  readonly partial: boolean
}

/**
 * Node in the portal graph A* search.
 * Represents a portal with accumulated cost and heuristic.
 */
export class PortalNode {
  readonly portal: Portal;
  entrySector: SectorId | undefined;
  futureCost = 0;
  currentCost = 0;
  heuristicCost = 0;
  wasBest = false;
  prevPortal: PortalNode | undefined;
  /**
   * Distance cost to each exit, per side of this portal: two portals between
   * the same two sectors are exits of each other on both sides, at different
   * distances.
   */
  readonly exits: Map<SectorId, Map<PortalId, number>> = new Map();

  constructor(portal: Portal);
  constructor(
    portal: Portal,
    entrySector: SectorId,
    prev: PortalNode | undefined,
    pastCost: number,
    heuristicCost: number,
  );
  constructor(
    portal: Portal,
    entrySector?: SectorId,
    prev?: PortalNode,
    pastCost?: number,
    heuristicCost?: number,
  ) {
    this.portal = portal;
    this.entrySector = entrySector;
    this.prevPortal = prev;
    if (pastCost !== undefined && heuristicCost !== undefined) {
      this.currentCost = pastCost;
      this.heuristicCost = heuristicCost;
      this.futureCost = pastCost + heuristicCost;
    }
  }

  /**
   * Initialize exit list — reachable portals from this node
   * and their distance costs.
   */
  initExits(nodeMap: Map<PortalId, PortalNode>): void {
    this.exits.clear();
    for (const sector of [this.portal.getSector0(), this.portal.getSector1()]) {
      const costs = new Map<PortalId, number>();
      // both centers in the local frame of the sector the exits lie in
      const from = this.portal.getEntryCenter(sector);
      for (const exit of this.portal.getConnected(sector)) {
        if (nodeMap.has(exit.getId())) {
          costs.set(exit.getId(), PortalNode.distanceCost(from, exit.getEntryCenter(sector)));
        }
      }
      this.exits.set(sector, costs);
    }
  }

  /**
   * Get exits for a specific sector.
   */
  getExits(sectorId: SectorId): Map<PortalId, number> {
    const costs = this.exits.get(sectorId);
    const result = new Map<PortalId, number>();
    for (const exit of this.portal.getConnected(sectorId)) {
      const cost = costs?.get(exit.getId());
      if (cost !== undefined) {
        result.set(exit.getId(), cost);
      }
    }
    return result;
  }

  /**
   * Backtrace from this node to the start, collecting portals.
   */
  generateBacktrace(): Portal[] {
    const path: Portal[] = [];
    let node: PortalNode | undefined = this;
    while (node) {
      path.unshift(node.portal);
      node = node.prevPortal;
    }
    return path;
  }

  static distanceCost(a: TileDelta, b: TileDelta): number {
    return Math.round(tileEuclidean(a, b) * 10);
  }

  static heuristicCost(a: TileDelta, b: TileDelta): number {
    return Math.round(tileEuclidean(a, b) * 10);
  }

  /**
   * Convert sector-local coordinates to global tile coordinates.
   */
  static localToGlobal(
    grid: Grid,
    sectorId: SectorId,
    localNe: number,
    localSe: number,
  ): TileDelta {
    const sectorSize = grid.getSectorSize();
    const sectorPos = grid.getSectorPosition(sectorId);
    return { ne: sectorPos.x * sectorSize + localNe, se: sectorPos.y * sectorSize + localSe };
  }
}

/**
 * A* search on the portal graph.
 * Finds the shortest sequence of portals from start portals to target portals.
 *
 * Uses the pre-initialized PortalNode objects from nodeMap (which have exits
 * populated by initExits). Search state (cost, prev, entrySector) is stored
 * in lightweight wrapper objects to avoid mutating the shared nodeMap nodes.
 */
interface SearchNode {
  portalNode: PortalNode
  entrySector: SectorId
  currentCost: number
  heuristicCost: number
  futureCost: number
  prev: SearchNode | undefined
}

export function portalAStar(
  grid: Grid,
  startPortals: Portal[],
  targetPortals: Portal[],
  nodeMap: Map<PortalId, PortalNode>,
  targetPosGlobal: TileDelta,
  startSectorId: SectorId,
  startPosGlobal?: TileDelta,
): PortalStarResult {
  if (startPortals.length === 0 || targetPortals.length === 0) {
    return { found: false, portals: [], partial: false };
  }

  // A start portal can be a target portal too (start and target sectors are
  // neighbors); it is found like any other node once popped, so the best of
  // several such portals wins, not the first one listed.
  const targetIds = new Set(targetPortals.map(p => p.getId()));

  const openSet = new BinaryHeap<SearchNode>();
  const closedSet = new Set<PortalId>();
  const searchNodes = new Map<PortalId, SearchNode>();

  // Track closest node for partial-path fallback
  let closestNode: SearchNode | undefined;

  // Initialize start nodes — use nodeMap's PortalNode for exit lookups
  for (const startPortal of startPortals) {
    const portalNode = nodeMap.get(startPortal.getId());
    if (!portalNode) {
      continue;
    }

    // After crossing the start portal, we arrive in the exit sector
    const entrySector = startPortal.getExitSector(startSectorId);
    const center = startPortal.getEntryCenter(entrySector);
    const centerGlobal = PortalNode.localToGlobal(grid, entrySector, center.ne, center.se);
    const h = PortalNode.heuristicCost(centerGlobal, targetPosGlobal);
    // the walk from the start to the portal, when the start is known
    const g = startPosGlobal ? PortalNode.heuristicCost(startPosGlobal, centerGlobal) : 0;

    const sn: SearchNode = {
      portalNode,
      entrySector,
      currentCost: g,
      heuristicCost: h,
      futureCost: g + h,
      prev: undefined,
    };
    searchNodes.set(startPortal.getId(), sn);
    openSet.push(sn, sn.futureCost);

    if (!closestNode || h < closestNode.heuristicCost) {
      closestNode = sn;
    }
  }

  while (!openSet.isEmpty) {
    const current = openSet.pop()!;

    if (targetIds.has(current.portalNode.portal.getId())) {
      const portals: Portal[] = [];
      let node: SearchNode | undefined = current;
      while (node) {
        portals.unshift(node.portalNode.portal);
        node = node.prev;
      }
      return { found: true, portals, partial: false };
    }

    closedSet.add(current.portalNode.portal.getId());

    // Update closest node (minimum heuristic to target)
    if (!closestNode || current.heuristicCost < closestNode.heuristicCost) {
      closestNode = current;
    }

    // entrySector is the sector we arrive in after crossing this portal.
    // Exits are reachable from within this sector.
    const exits = current.portalNode.getExits(current.entrySector);

    for (const [exitId, distanceCost] of exits) {
      if (closedSet.has(exitId)) {
        continue;
      }

      const exitPortalNode = nodeMap.get(exitId);
      if (!exitPortalNode) {
        continue;
      }
      const exitPortal = exitPortalNode.portal;

      // When we exit through this portal, we arrive in the other sector.
      // We enter the exit portal from current.entrySector (where we are now),
      // and arrive in exitPortal.getExitSector(current.entrySector).
      const exitEntrySector = exitPortal.getExitSector(current.entrySector);
      const exitCenter = exitPortal.getEntryCenter(current.entrySector);
      const exitCenterGlobal = PortalNode.localToGlobal(
        grid,
        current.entrySector,
        exitCenter.ne,
        exitCenter.se,
      );
      const newCost = current.currentCost + distanceCost;
      const h = PortalNode.heuristicCost(exitCenterGlobal, targetPosGlobal);
      const futureCost = newCost + h;

      const existing = searchNodes.get(exitId);
      if (!existing) {
        const sn: SearchNode = {
          portalNode: exitPortalNode,
          entrySector: exitEntrySector,
          currentCost: newCost,
          heuristicCost: h,
          futureCost,
          prev: current,
        };
        searchNodes.set(exitId, sn);
        openSet.push(sn, futureCost);

        if (!closestNode || h < closestNode.heuristicCost) {
          closestNode = sn;
        }
      }
      else if (newCost < existing.currentCost) {
        existing.currentCost = newCost;
        existing.heuristicCost = h;
        existing.futureCost = futureCost;
        existing.prev = current;
        existing.entrySector = exitEntrySector;
        openSet.updatePriority(existing, futureCost);

        if (!closestNode || h < closestNode.heuristicCost) {
          closestNode = existing;
        }
      }
      else if (existing.prev === undefined && existing.entrySector !== exitEntrySector) {
        // A start node reached internally via a sibling start portal, from a
        // different sector side than its initial (uncrossed) state. This
        // represents genuinely crossing the portal — a different traversal
        // state than "haven't moved yet" — so it must adopt this path's cost,
        // not silently keep its stale 0-cost/priority.
        existing.currentCost = newCost;
        existing.heuristicCost = h;
        existing.futureCost = futureCost;
        existing.prev = current;
        existing.entrySector = exitEntrySector;
        openSet.updatePriority(existing, futureCost);

        if (!closestNode || h < closestNode.heuristicCost) {
          closestNode = existing;
        }
      }
    }
  }

  // No path found — return partial path to closest node if available
  if (closestNode && closestNode.prev !== undefined) {
    const portals: Portal[] = [];
    let node: SearchNode | undefined = closestNode;
    while (node) {
      portals.unshift(node.portalNode.portal);
      node = node.prev;
    }
    return { found: false, portals, partial: true };
  }

  return { found: false, portals: [], partial: false };
}
