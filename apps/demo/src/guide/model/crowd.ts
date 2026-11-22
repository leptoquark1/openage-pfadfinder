import type { FlowRoute, Grid } from '@leptoquark1/openage-pfadfinder';
import { COST_IMPASSABLE } from '@leptoquark1/openage-pfadfinder/shared';
import { type Cell, COLS, ROWS, type Scenario } from '../scenarios.js';
import type { UnitPath } from './types.js';

const CROWD_SIZE = 56;

/** A crowd spread over the route's sectors, each unit following `route.next()`. */
export function spawnUnits(scenario: Scenario, route: FlowRoute, grid: Grid): UnitPath[] {
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
