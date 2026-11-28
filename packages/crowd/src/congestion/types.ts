import type { Grid, SectorId } from '@leptoquark1/openage-pfadfinder';
import type { CrowdContext, DensityFieldView } from '../context.js';
import type { NavigationView } from '../context.js';

/** Sectors whose cost fields a congestion model changed, by how routes through them are affected. */
export interface CongestionCommit {
  /** Only costs changed (surcharges): routes stay safe, they are just no longer the cheapest. */
  readonly stale: ReadonlySet<SectorId>;
  /** Changes the model found but did not make itself (external terrain edits): passability may differ. */
  readonly unsafe: ReadonlySet<SectorId>;
}

/** A terrain cost change at a global cell, as for `Grid.updateCosts()`. */
export interface CostChange {
  readonly ne: number;
  readonly se: number;
  readonly cost: number;
}

/**
 * Feeds crowding back into the costs routes are planned on.
 */
export interface CongestionModel {
  /** Called once by the simulation it is handed to, before the first tick. */
  attach(grid: Grid, navigation: NavigationView, dt: number): void;
  /** Every tick, at its start: take in where the agents are. Should be cheap. */
  observe(ctx: CrowdContext): void;
  /** Every tick after `observe()`: write costs when due (the model throttles itself). */
  commit(ctx: CrowdContext): CongestionCommit;
  /** The density the model works on, for other components and debugging. */
  readonly field: DensityFieldView | undefined;
  /**
   * Apply terrain changes while the model holds surcharges on top of the
   * base costs. Returns the sectors whose cost fields changed (a change to
   * the cost a cell already has is no change). Models without own cost state
   * may omit it; the simulation then calls `Grid.updateCosts()` directly.
   */
  applyTerrain?(changes: readonly CostChange[]): ReadonlySet<SectorId>;
  /** Remove every surcharge again, restoring the current base costs. */
  dispose(): void;
}

export const EMPTY_COMMIT: CongestionCommit = { stale: new Set(), unsafe: new Set() };
