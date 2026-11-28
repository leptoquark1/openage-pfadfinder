import type { CrowdContext, NeighborList } from '../context.js';
import type { Vec2 } from '../vec2.js';

/**
 * Shapes an agent's preferred velocity before the forces act, e.g. the side
 * rule. Gets the velocity the guidance wants and changes it in place.
 */
export interface PreferredVelocityModifier {
  apply(ctx: CrowdContext, agent: number, neighbors: NeighborList, preferred: Vec2): void;
}

/**
 * Adds an acceleration (cells/s²) to an agent, e.g. collision avoidance or
 * separation. Reads the agents as they were at the start of the tick, so
 * the order of the agents does not matter. Must add to `outAccel`, never
 * overwrite it.
 */
export interface SteeringForce {
  accumulate(ctx: CrowdContext, agent: number, neighbors: NeighborList, outAccel: Vec2): void;
}
