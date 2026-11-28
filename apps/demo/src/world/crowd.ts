import type { Pathfinder } from '@leptoquark1/openage-pfadfinder';
import {
  type CrowdContext,
  CrowdSimulation,
  DensityCostModel,
  FlowRouteGuidance,
  type NeighborList,
  PowerLawAvoidance,
  Separation,
  SideRule,
  type SteeringForce,
  type Vec2,
} from '@leptoquark1/openage-pfadfinder-crowd';

/** Fixed timestep of the crowd simulation; the world feeds it from the frame time. */
export const CROWD_TIMESTEP = 1 / 60;
/** Crowd steps per frame at most, so a slow frame does not snowball. */
export const MAX_CROWD_STEPS = 3;

/** How the crowd behaves, switched from the toolbar. */
export interface CrowdSettings {
  /** Side rule: dodge right in counter-flow, overtake left — lanes form. */
  readonly lanes: boolean;
  /** Density surcharge on the cost fields: crowds make cells more expensive. */
  readonly congestion: boolean;
}

export const DEFAULT_CROWD_SETTINGS: CrowdSettings = { lanes: true, congestion: false };

/** A moving obstacle as the crowd sees it: center and half its box, in cells. */
export interface ObstacleView {
  readonly x: number;
  readonly y: number;
  readonly half: number;
}

/**
 * Keeps agents off the demo's moving obstacles between planning ticks: the
 * obstacles are walls only once the next tick stamps them into the cost
 * layer, so they push agents away with a force that grows towards the box.
 * An example of a `SteeringForce` outside the plugin.
 */
export class ObstacleRepulsion implements SteeringForce {
  private readonly obstacles: () => readonly ObstacleView[];
  private readonly margin: number;
  private readonly strength: number;

  /**
   * @param obstacles read on every call, so the force always sees the current positions
   * @param margin distance (cells) beyond the box at which the push starts
   * @param strength acceleration (cells/s²) right at the box
   */
  constructor(obstacles: () => readonly ObstacleView[], margin = 0.25, strength = 40) {
    this.obstacles = obstacles;
    this.margin = margin;
    this.strength = strength;
  }

  accumulate(ctx: CrowdContext, i: number, _neighbors: NeighborList, out: Vec2): void {
    const x = ctx.agents.x(i);
    const y = ctx.agents.y(i);
    const reach = ctx.agents.radius(i) + this.margin;
    for (const o of this.obstacles()) {
      const dx = x - o.x;
      const dy = y - o.y;
      const dist = Math.hypot(dx, dy);
      const range = o.half + reach;
      if (dist < range && dist > 1e-6) {
        const push = (range - dist) / range;
        out.x += (dx / dist) * push * this.strength;
        out.y += (dy / dist) * push * this.strength;
      }
    }
  }
}

/** A crowd simulation on the world's grid, with its guidance kept for drawing the routes. */
export function createCrowd(
  pathfinder: Pathfinder,
  gridId: number,
  settings: CrowdSettings,
  obstacles: () => readonly ObstacleView[],
  arrivalRadius: number,
): { crowd: CrowdSimulation; guidance: FlowRouteGuidance } {
  const guidance = new FlowRouteGuidance(pathfinder, gridId);
  const crowd = new CrowdSimulation(pathfinder, gridId, {
    timestep: CROWD_TIMESTEP,
    guidance,
    preferredModifiers: settings.lanes ? [new SideRule()] : [],
    forces: [new PowerLawAvoidance(), new Separation(), new ObstacleRepulsion(obstacles)],
    congestion: settings.congestion ? new DensityCostModel() : null,
    arrivalRadius,
  });
  return { crowd, guidance };
}
