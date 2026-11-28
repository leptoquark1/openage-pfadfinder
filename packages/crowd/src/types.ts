import type { TileDelta } from '@leptoquark1/openage-pfadfinder';
import type { Vec2 } from './vec2.js';

/** Handle of an agent in a crowd simulation; ids are never reused within one simulation. */
export type AgentId = number;

/**
 * What an agent is doing after the last tick.
 *
 * - `IDLE`: no goal.
 * - `MOVING`: on its way to the goal.
 * - `ARRIVED`: within the arrival radius of its goal.
 * - `UNREACHABLE`: the guidance has no route to the goal.
 * - `STUCK`: has a route, but made too little progress over the last window
 *   (held back by other agents or walls); it keeps trying.
 */
export const AgentState = {
  IDLE: 'IDLE',
  MOVING: 'MOVING',
  ARRIVED: 'ARRIVED',
  UNREACHABLE: 'UNREACHABLE',
  STUCK: 'STUCK',
} as const;
export type AgentState = (typeof AgentState)[keyof typeof AgentState];

/** Everything needed to add an agent. Lengths are in cells, times in seconds. */
export interface AgentParams {
  /** Center of the agent's body. */
  readonly position: Readonly<Vec2>;
  /** Body radius in cells. */
  readonly radius: number;
  /** Top speed in cells per second. */
  readonly maxSpeed: number;
  /** Top acceleration in cells per second²; unbounded when omitted. */
  readonly maxAccel?: number;
  /** Agents of one group with the same goal share one route. */
  readonly group?: number;
  /** Initial velocity (cells/s); at rest when omitted. */
  readonly velocity?: Readonly<Vec2>;
  /** Target cell; the agent starts `IDLE` without one. */
  readonly goal?: TileDelta;
}
