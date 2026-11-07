import type { FlowRoute } from '../src/lib/pathfinding/flow-route.js';
import type { Waypoint } from '../src/shared/types.js';

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
