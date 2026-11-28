import type { Pathfinder } from '@leptoquark1/openage-pfadfinder';
import {
  type CrowdContext,
  CrowdSimulation,
  DensityCostModel,
  FlowRouteGuidance,
  type NeighborList,
  PathGuidance,
  PowerLawAvoidance,
  type PreferredVelocityModifier,
  Separation,
  SideRule,
  type SteeringForce,
  type Vec2,
} from '@leptoquark1/openage-pfadfinder-crowd';

/** Fixed timestep of the crowd simulation; the world feeds it from the frame time. */
export const CROWD_TIMESTEP = 1 / 60;
/** Crowd steps per frame at most, so a slow frame does not snowball. */
export const MAX_CROWD_STEPS = 3;

/** Which side agents keep to in counter-flow; `off` turns the side rule off. */
export type SideSetting = 'right' | 'left' | 'off';
/** How agents are steered: along shared flow fields, or each along a path of its own. */
export type GuidanceMode = 'flow' | 'path';

/** How the crowd behaves, set in the crowd panel. */
export interface CrowdSettings {
  /** Side rule: dodge to this side in counter-flow, overtake on the other — lanes form. */
  readonly side: SideSetting;
  /** Shared flow fields (`FlowRouteGuidance`) or one path per agent (`PathGuidance`). */
  readonly guidance: GuidanceMode;
  /** Strength k of the predictive avoidance (power law). */
  readonly avoidance: number;
  /** Look-ahead of the avoidance in seconds: collisions further away are ignored. */
  readonly lookahead: number;
  /** Personal space in cells: gap below which agents push each other away (separation). */
  readonly personalSpace: number;
  /** Milliseconds between planning ticks (grid sync, route planning); also the path replan interval. */
  readonly replanInterval: number;
  /** Density surcharge on the cost fields: crowds make cells more expensive. */
  readonly congestion: boolean;
  /** Surcharge per agent per cell above the free density. */
  readonly congestionCost: number;
}

export const DEFAULT_CROWD_SETTINGS: CrowdSettings = {
  side: 'right',
  guidance: 'flow',
  avoidance: 1.5,
  lookahead: 3,
  personalSpace: 0.2,
  replanInterval: 100,
  congestion: false,
  congestionCost: 40,
};

/** Slider ranges of the numeric settings. */
export const CROWD_SETTING_RANGES = {
  avoidance: { min: 0, max: 5, step: 0.1 },
  lookahead: { min: 0.5, max: 6, step: 0.1 },
  personalSpace: { min: 0.05, max: 1, step: 0.05 },
  replanInterval: { min: 50, max: 2000, step: 50 },
  congestionCost: { min: 5, max: 120, step: 5 },
} as const satisfies Partial<Record<keyof CrowdSettings, { min: number; max: number; step: number }>>;

/** A moving obstacle as the crowd sees it: center and half its box, in cells. */
export interface ObstacleView {
  readonly x: number;
  readonly y: number;
  readonly half: number;
}

/**
 * Keeps agents off the demo's moving obstacles between planning ticks: the
 * obstacles are walls only once the next tick stamps them into the cost
 * layer, and the tick stamps every cell an obstacle's box touches. So the
 * force pushes agents away from those whole cells, not just from the box:
 * an agent standing in a cell that is about to be stamped is pushed out
 * beforehand instead of being moved out of the new wall at once. It grows
 * from `margin` beyond the cells towards them and is strongest inside.
 * An example of a `SteeringForce` outside the plugin.
 */
export class ObstacleRepulsion implements SteeringForce {
  private readonly obstacles: () => readonly ObstacleView[];
  private readonly margin: number;
  private readonly strength: number;

  /**
   * @param obstacles read on every call, so the force always sees the current positions
   * @param margin distance (cells) beyond the covered cells at which the push starts
   * @param strength acceleration (cells/s²) right at the cells; twice that inside them
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
      // the cells the planning tick stamps: every cell the box touches
      const x0 = Math.floor(o.x - o.half);
      const x1 = Math.floor(o.x + o.half) + 1;
      const y0 = Math.floor(o.y - o.half);
      const y1 = Math.floor(o.y + o.half) + 1;
      const cx = Math.min(Math.max(x, x0), x1);
      const cy = Math.min(Math.max(y, y0), y1);
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > 1e-9) {
        if (dist < reach) {
          const push = ((reach - dist) / reach) * this.strength;
          out.x += (dx / dist) * push;
          out.y += (dy / dist) * push;
        }
        continue;
      }
      // inside the covered cells: out through the nearest side
      const left = x - x0;
      const right = x1 - x;
      const top = y - y0;
      const bottom = y1 - y;
      const nearest = Math.min(left, right, top, bottom);
      const push = 2 * this.strength;
      if (nearest === left) {
        out.x -= push;
      } else if (nearest === right) {
        out.x += push;
      } else if (nearest === top) {
        out.y -= push;
      } else {
        out.y += push;
      }
    }
  }
}

/** A crowd simulation and the strategy instances behind it, so settings can change them live. */
export interface Crowd {
  readonly simulation: CrowdSimulation;
  readonly guidance: FlowRouteGuidance | PathGuidance;
  readonly sideRule: SideRule;
  readonly avoidance: PowerLawAvoidance;
  readonly separation: Separation;
  readonly congestion: DensityCostModel | null;
}

/** A crowd simulation on the world's grid with the given settings. */
export function createCrowd(
  pathfinder: Pathfinder,
  gridId: number,
  settings: CrowdSettings,
  obstacles: () => readonly ObstacleView[],
  arrivalRadius: number,
): Crowd {
  const guidance =
    settings.guidance === 'path'
      ? new PathGuidance(pathfinder, gridId, { replanInterval: settings.replanInterval / 1000 })
      : new FlowRouteGuidance(pathfinder, gridId);
  const sideRule = new SideRule({ side: settings.side === 'left' ? 'left' : 'right' });
  const avoidance = new PowerLawAvoidance({ strength: settings.avoidance, horizon: settings.lookahead });
  const separation = new Separation({ range: settings.personalSpace });
  const congestion = settings.congestion ? new DensityCostModel({ costPerDensity: settings.congestionCost }) : null;
  const modifiers: PreferredVelocityModifier[] = settings.side === 'off' ? [] : [sideRule];
  const simulation = new CrowdSimulation(pathfinder, gridId, {
    timestep: CROWD_TIMESTEP,
    guidance,
    preferredModifiers: modifiers,
    forces: [avoidance, separation, new ObstacleRepulsion(obstacles)],
    congestion,
    arrivalRadius,
  });
  return { simulation, guidance, sideRule, avoidance, separation, congestion };
}

/**
 * True when going from one setting to the other needs a new crowd: the side
 * rule turned on or off, another guidance, congestion on or off. Everything
 * else is changed live by `applyCrowdSettings`.
 */
export function needsNewCrowd(from: CrowdSettings, to: CrowdSettings): boolean {
  return (
    (from.side === 'off') !== (to.side === 'off') || from.guidance !== to.guidance || from.congestion !== to.congestion
  );
}

/** Change the running strategies to the settings (those `needsNewCrowd` does not cover). */
export function applyCrowdSettings(crowd: Crowd, settings: CrowdSettings): void {
  if (settings.side !== 'off') {
    crowd.sideRule.configure({ side: settings.side });
  }
  crowd.avoidance.configure({ strength: settings.avoidance, horizon: settings.lookahead });
  crowd.separation.configure({ range: settings.personalSpace });
  crowd.congestion?.configure({ costPerDensity: settings.congestionCost });
  if (crowd.guidance instanceof PathGuidance) {
    crowd.guidance.configure({ replanInterval: settings.replanInterval / 1000 });
  }
}

/** The settings with every numeric value clamped into its slider range. */
export function clampCrowdSettings(settings: CrowdSettings): CrowdSettings {
  const clamp = (key: keyof typeof CROWD_SETTING_RANGES, value: number) => {
    const { min, max } = CROWD_SETTING_RANGES[key];
    return Math.min(max, Math.max(min, value));
  };
  return {
    ...settings,
    avoidance: clamp('avoidance', settings.avoidance),
    lookahead: clamp('lookahead', settings.lookahead),
    personalSpace: clamp('personalSpace', settings.personalSpace),
    replanInterval: clamp('replanInterval', settings.replanInterval),
    congestionCost: clamp('congestionCost', settings.congestionCost),
  };
}
