import { tileEuclidean } from '../../shared/coordinates.js';
import type { PortalId, SectorId, TileDelta } from '../../shared/types.js';
import type { Grid } from '../graph/grid.js';
import type { Portal } from '../graph/portal.js';
import { type HeapEntry, IntrusiveHeap } from '../internal/binary-heap.js';

export interface PortalStarResult {
  readonly found: boolean;
  readonly portals: Portal[];
  readonly partial: boolean;
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
  /** This node's state in the running `portalAStar()`; unset between searches. */
  search: PortalSearchNode | undefined;

  constructor(portal: Portal);
  constructor(
    portal: Portal,
    entrySector: SectorId,
    prev: PortalNode | undefined,
    pastCost: number,
    heuristicCost: number,
  );
  constructor(portal: Portal, entrySector?: SectorId, prev?: PortalNode, pastCost?: number, heuristicCost?: number) {
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
  static localToGlobal(grid: Grid, sectorId: SectorId, localNe: number, localSe: number): TileDelta {
    const sectorSize = grid.getSectorSize();
    const sectorPos = grid.getSectorPosition(sectorId);
    return { ne: sectorPos.x * sectorSize + localNe, se: sectorPos.y * sectorSize + localSe };
  }
}

/** State of one portal during a `portalAStar()` run; `priority` is its f-cost. */
export interface PortalSearchNode extends HeapEntry {
  portalNode: PortalNode;
  entrySector: SectorId;
  currentCost: number;
  heuristicCost: number;
  prev: PortalSearchNode | undefined;
  /** Popped from the open set: its cost is final and it is not visited again. */
  closed: boolean;
}

/** The portals from the search's start to this node. */
function backtrace(end: PortalSearchNode): Portal[] {
  const portals: Portal[] = [];
  for (let node: PortalSearchNode | undefined = end; node; node = node.prev) {
    portals.push(node.portalNode.portal);
  }
  return portals.reverse();
}

/**
 * A* search on the portal graph.
 * Finds the shortest sequence of portals from start portals to target portals.
 *
 * Uses the pre-initialized PortalNode objects from nodeMap (which have exits
 * populated by initExits). Search state (cost, prev, entrySector) lives in
 * lightweight objects that a node only refers to while the search runs, so
 * no per-search lookup table is needed and the nodes keep nothing afterwards.
 */
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

  const reached: PortalNode[] = [];
  try {
    return search(grid, startPortals, targetPortals, nodeMap, targetPosGlobal, startSectorId, startPosGlobal, reached);
  } finally {
    for (const node of reached) {
      node.search = undefined;
    }
  }
}

function search(
  grid: Grid,
  startPortals: Portal[],
  targetPortals: Portal[],
  nodeMap: Map<PortalId, PortalNode>,
  targetPosGlobal: TileDelta,
  startSectorId: SectorId,
  startPosGlobal: TileDelta | undefined,
  reached: PortalNode[],
): PortalStarResult {
  // A start portal can be a target portal too (start and target sectors are
  // neighbors); it is found like any other node once popped, so the best of
  // several such portals wins, not the first one listed.
  const targetIds = new Set(targetPortals.map(p => p.getId()));

  const openSet = new IntrusiveHeap<PortalSearchNode>();

  // Track closest node for partial-path fallback
  let closestNode: PortalSearchNode | undefined;

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

    const sn: PortalSearchNode = {
      portalNode,
      entrySector,
      currentCost: g,
      heuristicCost: h,
      priority: g + h,
      index: 0,
      prev: undefined,
      closed: false,
    };
    portalNode.search = sn;
    reached.push(portalNode);
    openSet.push(sn, sn.priority);

    if (!closestNode || h < closestNode.heuristicCost) {
      closestNode = sn;
    }
  }

  while (!openSet.isEmpty) {
    const current = openSet.pop()!;

    if (targetIds.has(current.portalNode.portal.getId())) {
      return { found: true, portals: backtrace(current), partial: false };
    }

    current.closed = true;

    // Update closest node (minimum heuristic to target)
    if (!closestNode || current.heuristicCost < closestNode.heuristicCost) {
      closestNode = current;
    }

    // entrySector is the sector we arrive in after crossing this portal.
    // Exits are reachable from within this sector: the portal's current
    // exits that have a cost, as PortalNode.getExits() lists them, read
    // in place instead of into a new map per node.
    const exitCosts = current.portalNode.exits.get(current.entrySector);

    for (const exit of current.portalNode.portal.getConnected(current.entrySector)) {
      const exitId = exit.getId();
      const distanceCost = exitCosts?.get(exitId);
      if (distanceCost === undefined) {
        continue;
      }

      const exitPortalNode = nodeMap.get(exitId);
      if (!exitPortalNode) {
        continue;
      }
      const existing = exitPortalNode.search;
      if (existing?.closed) {
        continue;
      }
      const exitPortal = exitPortalNode.portal;

      // When we exit through this portal, we arrive in the other sector.
      // We enter the exit portal from current.entrySector (where we are now),
      // and arrive in exitPortal.getExitSector(current.entrySector).
      const exitEntrySector = exitPortal.getExitSector(current.entrySector);
      const newCost = current.currentCost + distanceCost;

      // A node already reached at no higher cost stays as it is (but see the
      // start node case below); skip the heuristic for it.
      if (
        existing &&
        newCost >= existing.currentCost &&
        !(existing.prev === undefined && existing.entrySector !== exitEntrySector)
      ) {
        continue;
      }

      const exitCenter = exitPortal.getEntryCenter(current.entrySector);
      const exitCenterGlobal = PortalNode.localToGlobal(grid, current.entrySector, exitCenter.ne, exitCenter.se);
      const h = PortalNode.heuristicCost(exitCenterGlobal, targetPosGlobal);
      const futureCost = newCost + h;

      if (!existing) {
        const sn: PortalSearchNode = {
          portalNode: exitPortalNode,
          entrySector: exitEntrySector,
          currentCost: newCost,
          heuristicCost: h,
          priority: futureCost,
          index: 0,
          prev: current,
          closed: false,
        };
        exitPortalNode.search = sn;
        reached.push(exitPortalNode);
        openSet.push(sn, futureCost);

        if (!closestNode || h < closestNode.heuristicCost) {
          closestNode = sn;
        }
      } else {
        // Reached at a lower cost, or a start node reached internally via a
        // sibling start portal, from a different sector side than its initial
        // (uncrossed) state. That represents genuinely crossing the portal —
        // a different traversal state than "haven't moved yet" — so it must
        // adopt this path's cost, not silently keep its stale 0-cost/priority.
        existing.currentCost = newCost;
        existing.heuristicCost = h;
        existing.prev = current;
        existing.entrySector = exitEntrySector;
        openSet.update(existing, futureCost);

        if (!closestNode || h < closestNode.heuristicCost) {
          closestNode = existing;
        }
      }
    }
  }

  // No path found — return partial path to closest node if available
  if (closestNode && closestNode.prev !== undefined) {
    return { found: false, portals: backtrace(closestNode), partial: true };
  }

  return { found: false, portals: [], partial: false };
}
