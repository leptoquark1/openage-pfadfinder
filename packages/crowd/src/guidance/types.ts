import type { SectorId } from '@leptoquark1/openage-pfadfinder';
import type { CrowdContext } from '../context.js';
import type { AgentId } from '../types.js';
import type { Vec2 } from '../vec2.js';

/** Outcome of asking the guidance for an agent's preferred velocity. */
export const GuidanceStatus = {
  /** `out` holds the preferred velocity (possibly zero while waiting for a route). */
  OK: 'OK',
  /** There is no route to the goal; `out` is zero. */
  UNREACHABLE: 'UNREACHABLE',
} as const;
export type GuidanceStatus = (typeof GuidanceStatus)[keyof typeof GuidanceStatus];

/**
 * How a cost change affects routes through a sector.
 *
 * - `STALE`: only costs changed, passability did not. Routes through the
 *   sector are still safe to follow, just no longer the cheapest; they may
 *   be replanned later, within a budget.
 * - `UNSAFE`: passability may have changed (terrain edit, unknown external
 *   change). Routes through the sector must not be followed any more.
 */
export const Invalidation = {
  STALE: 'STALE',
  UNSAFE: 'UNSAFE',
} as const;
export type Invalidation = (typeof Invalidation)[keyof typeof Invalidation];

/**
 * Global guidance: where an agent wants to go, ignoring other agents.
 * Providers that need the pathfinder take it in their constructor.
 */
export interface GuidanceProvider {
  /** Once per tick, before any `preferredVelocity()` call. */
  prepare(ctx: CrowdContext): void;
  /**
   * Preferred velocity of agent `i` (an index, see `AgentView`) that has a
   * goal and has not arrived, into `out` (cells/s, at most its max speed).
   */
  preferredVelocity(ctx: CrowdContext, i: number, out: Vec2): GuidanceStatus;
  /** Cost fields of these sectors changed. */
  invalidate(sectors: ReadonlySet<SectorId>, level: Invalidation): void;
  /** The agent was removed or got a new goal: drop what is kept for it. */
  release(agent: AgentId): void;
  dispose(): void;
}
