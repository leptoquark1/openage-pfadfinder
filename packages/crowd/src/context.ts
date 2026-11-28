import type { SectorId } from '@leptoquark1/openage-pfadfinder';
import type { AgentId, AgentState } from './types.js';

/**
 * Read-only view of the agents during a tick, by dense index.
 *
 * Indices run from 0 to `count - 1` in ascending agent id. They are only
 * valid within one tick: adding or removing agents renumbers them. Use
 * `id()` / `indexOf()` to translate.
 */
export interface AgentView {
  readonly count: number;
  /** Index of an agent, -1 if it does not exist. */
  indexOf(id: AgentId): number;
  id(i: number): AgentId;
  x(i: number): number;
  y(i: number): number;
  vx(i: number): number;
  vy(i: number): number;
  radius(i: number): number;
  maxSpeed(i: number): number;
  group(i: number): number;
  state(i: number): AgentState;
  hasGoal(i: number): boolean;
  /** Goal cell; only meaningful when `hasGoal(i)`. */
  goalNe(i: number): number;
  goalSe(i: number): number;
}

/**
 * The neighbors of one agent for the current tick: the nearest ones within
 * the neighbor radius, by ascending (distance, id). The buffers are reused
 * for the next agent; do not keep them.
 */
export interface NeighborList {
  readonly count: number;
  /** Agent indices (see `AgentView`). */
  readonly index: Int32Array;
  /** Squared center distances, parallel to `index`. */
  readonly distSq: Float64Array;
}

/** Spatial queries over the agents, as positioned at the start of the tick. */
export interface NeighborQuery {
  /** Indices of the agents whose centers lie within `radius` of (x, y), ascending. Clears and fills `out`. */
  within(x: number, y: number, radius: number, out: number[]): number[];
}

/** The map as the crowd sees it: cell costs and passability, in global cells. */
export interface NavigationView {
  /** Map size in cells. */
  readonly width: number;
  readonly height: number;
  readonly sectorSize: number;
  /** True for impassable cells and everything outside the map. */
  isBlocked(ne: number, se: number): boolean;
  /** Current cell cost (including congestion surcharges); `COST_IMPASSABLE` outside the map. */
  cost(ne: number, se: number): number;
  /** Id of the sector holding the cell, -1 outside the map. */
  sectorAt(ne: number, se: number): SectorId;
}

/** Smoothed crowd density in agents per cell. */
export interface DensityFieldView {
  readonly width: number;
  readonly height: number;
  /** Density of a cell; 0 outside the map. */
  at(ne: number, se: number): number;
}

/** Everything an extension point may read during a tick. */
export interface CrowdContext {
  /** Number of the running tick, from 1. */
  readonly tick: number;
  /** The simulation's fixed timestep in seconds. */
  readonly dt: number;
  readonly agents: AgentView;
  readonly neighbors: NeighborQuery;
  readonly navigation: NavigationView;
  /** Present when the congestion model provides a density field. */
  readonly density: DensityFieldView | undefined;
}
