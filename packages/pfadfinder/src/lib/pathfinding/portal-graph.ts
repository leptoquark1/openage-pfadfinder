import { tileEuclidean } from '../../shared/coordinates.js';
import type { PortalId, SectorId, TileDelta } from '../../shared/types.js';
import type { Grid } from '../graph/grid.js';
import { type Portal, portalDistanceCost } from '../graph/portal.js';
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
  /** The node map `initExits()` was given; exits are limited to its nodes. */
  private nodeMap: ReadonlyMap<PortalId, PortalNode> | undefined;
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
   * Distance cost to each exit, per side of this portal: two portals between
   * the same two sectors are exits of each other on both sides, at different
   * distances. Lists the exits that have a node in the map given to
   * `initExits()`, none before.
   *
   * Built on every read from the sector exit tables (`Sector.connectExits()`),
   * which hold the exits once per sector for all its portals; A* reads those
   * tables directly. Meant for inspection, e.g. a debug view.
   */
  get exits(): Map<SectorId, Map<PortalId, number>> {
    const exits = new Map<SectorId, Map<PortalId, number>>();
    if (this.nodeMap) {
      for (const sector of [this.portal.getSector0(), this.portal.getSector1()]) {
        exits.set(sector, this.getExits(sector));
      }
    }
    return exits;
  }

  /**
   * Limit the exits to portals with a node in `nodeMap`. The exits and their
   * costs themselves come from the sectors (`Sector.connectExits()`).
   */
  initExits(nodeMap: Map<PortalId, PortalNode>): void {
    this.nodeMap = nodeMap;
  }

  /**
   * The node map exits are limited to (see `initExits()`), `undefined` before.
   *
   * @internal
   */
  getExitNodes(): ReadonlyMap<PortalId, PortalNode> | undefined {
    return this.nodeMap;
  }

  /**
   * Get exits for a specific sector.
   */
  getExits(sectorId: SectorId): Map<PortalId, number> {
    const result = new Map<PortalId, number>();
    const nodeMap = this.nodeMap;
    const row = this.portal.getExitRow(sectorId);
    if (!nodeMap || row < 0) {
      return result;
    }
    const { portals, costs } = this.portal.getExitTable(sectorId);
    for (let j = 0, at = row * portals.length; j < portals.length; j++, at++) {
      const id = portals[j]!.getId();
      if (costs[at] !== 0 && nodeMap.has(id)) {
        result.set(id, costs[at]! - 1);
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
    return portalDistanceCost(a, b);
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

  // Portal centers in global coordinates and their distance costs, computed
  // from numbers: PortalNode.localToGlobal() and heuristicCost() would make
  // two objects per edge. Same formulas: sectors row-major, round(euclidean × 10).
  const gridWidth = grid.getSize().width;
  const sectorSize = grid.getSectorSize();
  const centerNe = (portal: Portal, sector: SectorId): number =>
    (sector % gridWidth) * sectorSize + portal.getEntryCenterNe(sector);
  const centerSe = (portal: Portal, sector: SectorId): number =>
    Math.floor(sector / gridWidth) * sectorSize + portal.getEntryCenterSe(sector);
  const cost = (dNe: number, dSe: number): number => Math.round(Math.sqrt(dNe * dNe + dSe * dSe) * 10);

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
    const ne = centerNe(startPortal, entrySector);
    const se = centerSe(startPortal, entrySector);
    const h = cost(ne - targetPosGlobal.ne, se - targetPosGlobal.se);
    // the walk from the start to the portal, when the start is known
    const g = startPosGlobal ? cost(startPosGlobal.ne - ne, startPosGlobal.se - se) : 0;

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
    // Exits are reachable from within this sector: the portals with a cost
    // in this portal's row of the sector's exit table, in table order.
    // Like `PortalNode.getExits()`, only exits with a node in the map the
    // node's exits were initialized with count; none before `initExits()`.
    const portal = current.portalNode.portal;
    const exitNodes = current.portalNode.getExitNodes();
    const row = exitNodes ? portal.getExitRow(current.entrySector) : -1;
    const { portals: exits, costs: exitCosts } = portal.getExitTable(current.entrySector);
    const exitCount = row < 0 ? 0 : exits.length;
    const limited = exitNodes !== nodeMap;

    for (let j = 0, at = row * exitCount; j < exitCount; j++, at++) {
      const stored = exitCosts[at]!;
      if (stored === 0) {
        continue;
      }
      const distanceCost = stored - 1;
      const exitId = exits[j]!.getId();
      if (limited && !exitNodes!.has(exitId)) {
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

      const h = cost(
        centerNe(exitPortal, current.entrySector) - targetPosGlobal.ne,
        centerSe(exitPortal, current.entrySector) - targetPosGlobal.se,
      );
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
