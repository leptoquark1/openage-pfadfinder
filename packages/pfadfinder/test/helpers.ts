import type { Grid } from '../src/lib/graph/grid.js';
import type { FlowRoute } from '../src/lib/pathfinding/flow-route.js';
import { PortalNode } from '../src/lib/pathfinding/portal-graph.js';
import type { PortalId, SectorId, Waypoint } from '../src/shared/types.js';

/** Deterministic LCG so failures are reproducible. */
export function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * Follow `FlowRoute.next()` from `from` for at most `maxSteps` steps; the
 * visited cells including `from`, ending where `next()` returns null or
 * stops moving.
 */
export function followRoute(route: FlowRoute, from: Waypoint, maxSteps: number): Waypoint[] {
  const cells = [from];
  let cell = from;
  for (let n = 0; n < maxSteps; n++) {
    const next = route.next(cell.ne, cell.se);
    if (!next || (next.ne === cell.ne && next.se === cell.se)) {
      break;
    }
    cells.push(next);
    cell = next;
  }
  return cells;
}

/** Each portal node's exit costs per side, by portal id; exits keep their order (A* visits them in it). */
export function portalGraphOf(
  nodes: ReadonlyMap<PortalId, PortalNode>,
): [PortalId, [SectorId, [PortalId, number][]][]][] {
  return [...nodes]
    .sort(([a], [b]) => a - b)
    .map(([id, node]) => [id, [...node.exits].map(([sector, costs]) => [sector, [...costs]])]);
}

/** The portal graph a full build makes from the grid's portals as they are now. */
export function freshPortalGraphOf(grid: Grid): ReturnType<typeof portalGraphOf> {
  const nodes = new Map<PortalId, PortalNode>();
  for (const portal of grid.getSectors().flatMap(s => s.getPortals())) {
    nodes.set(portal.getId(), new PortalNode(portal));
  }
  for (const node of nodes.values()) {
    node.initExits(nodes);
  }
  return portalGraphOf(nodes);
}
