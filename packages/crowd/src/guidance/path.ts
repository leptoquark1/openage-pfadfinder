import {
  type Grid,
  type GridId,
  isLineWalkable,
  PathResult,
  type Pathfinder,
  type SectorId,
  type Waypoint,
} from '@leptoquark1/openage-pfadfinder';
import type { CrowdContext } from '../context.js';
import { nonNegative, positive } from '../options.js';
import type { AgentId } from '../types.js';
import type { Vec2 } from '../vec2.js';
import { type GuidanceProvider, GuidanceStatus, Invalidation } from './types.js';

export interface PathGuidanceOptions {
  /** Paths planned per tick at most; replans of a blocked path do not count (they have a cap of their own, 4×). Default 8. */
  readonly maxPlansPerTick?: number;
  /** Every agent plans again after this many seconds (0: only when its path is blocked or stale). Default 2. */
  readonly replanInterval?: number;
  /** A waypoint counts as reached within this distance of its cell center (cells). Default 0.35. */
  readonly waypointRadius?: number;
  /** Agents slow down linearly within this distance of their goal (cells). Default 1.5. */
  readonly slowRadius?: number;
  /** Ticks before an unreachable goal is tried again (any cost change retries at once). Default 20. */
  readonly retryInterval?: number;
}

interface AgentPath {
  goalNe: number;
  goalSe: number;
  waypoints: Waypoint[];
  /** Waypoint the agent heads for. */
  index: number;
  plannedTick: number;
  /** A STALE invalidation came in after planning: replan within the budget. */
  stale: boolean;
  /** Tick of the failed plan, -1 when the goal is not known to be unreachable. */
  unreachableTick: number;
  unreachableEpoch: number;
}

/**
 * Guidance along a path of its own for every agent, from
 * `Pathfinder.getPath()`: the waypoints where the route changes direction.
 * The counterpart to `FlowRouteGuidance`, which shares flow fields between
 * agents; here each agent plans and follows its own polyline, as units of
 * classic RTS games do.
 *
 * The agent heads for the center of its current waypoint, skips ahead while
 * the straight line to the next one is clear, and plans again when the line
 * to its waypoint is blocked (outside the budget), when a STALE
 * invalidation came in, or every `replanInterval` (both within the budget).
 * UNSAFE invalidations need no extra handling: a path that became blocked is
 * noticed by the line check before the agent walks into it.
 */
export class PathGuidance implements GuidanceProvider {
  private readonly pathfinder: Pathfinder;
  private readonly gridId: GridId;
  private readonly grid: Grid;
  private maxPlansPerTick = 8;
  private replanInterval = 2;
  private waypointRadius = 0.35;
  private slowRadius = 1.5;
  private retryInterval = 20;

  private readonly paths = new Map<AgentId, AgentPath>();
  private epoch = 0;
  private budget = 0;
  /** Replans of blocked paths per tick: outside the budget, but capped against spikes in a jam. */
  private urgentBudget = 0;
  private tick = 0;
  private dt = 1;
  private plans = 0;

  constructor(pathfinder: Pathfinder, gridId: GridId, options: PathGuidanceOptions = {}) {
    const grid = pathfinder.getGrid(gridId);
    if (!grid) {
      throw new RangeError(`no grid ${gridId} in the pathfinder`);
    }
    this.pathfinder = pathfinder;
    this.gridId = gridId;
    this.grid = grid;
    this.configure(options);
  }

  /** Change options while the simulation runs; omitted ones keep their value. */
  configure(options: PathGuidanceOptions): void {
    this.maxPlansPerTick = nonNegative('maxPlansPerTick', options.maxPlansPerTick ?? this.maxPlansPerTick);
    this.replanInterval = nonNegative('replanInterval', options.replanInterval ?? this.replanInterval);
    this.waypointRadius = positive('waypointRadius', options.waypointRadius ?? this.waypointRadius);
    this.slowRadius = nonNegative('slowRadius', options.slowRadius ?? this.slowRadius);
    this.retryInterval = nonNegative('retryInterval', options.retryInterval ?? this.retryInterval);
  }

  /** Paths planned so far (for tests and statistics). */
  getPlanCount(): number {
    return this.plans;
  }

  /**
   * The rest of an agent's path: the waypoints still ahead, its goal last;
   * null before its first plan or without a path.
   */
  getPath(agent: AgentId): readonly Waypoint[] | null {
    const path = this.paths.get(agent);
    return path && path.waypoints.length > 0 ? path.waypoints.slice(path.index) : null;
  }

  prepare(ctx: CrowdContext): void {
    this.tick = ctx.tick;
    this.dt = ctx.dt;
    this.budget = this.maxPlansPerTick;
    this.urgentBudget = Math.max(8, this.maxPlansPerTick * 4);
  }

  preferredVelocity(ctx: CrowdContext, i: number, out: Vec2): GuidanceStatus {
    out.x = 0;
    out.y = 0;
    const agents = ctx.agents;
    const nav = ctx.navigation;
    const goalNe = agents.goalNe(i);
    const goalSe = agents.goalSe(i);
    const id = agents.id(i);
    let path = this.paths.get(id);
    if (!path || path.goalNe !== goalNe || path.goalSe !== goalSe) {
      path = {
        goalNe,
        goalSe,
        waypoints: [],
        index: 0,
        plannedTick: -1,
        stale: false,
        unreachableTick: -1,
        unreachableEpoch: -1,
      };
      this.paths.set(id, path);
    }

    const x = agents.x(i);
    const y = agents.y(i);
    const ne = Math.floor(x);
    const se = Math.floor(y);
    const maxSpeed = agents.maxSpeed(i);

    if (goalNe < 0 || goalSe < 0 || goalNe >= nav.width || goalSe >= nav.height || nav.isBlocked(goalNe, goalSe)) {
      return GuidanceStatus.UNREACHABLE;
    }
    if (ne === goalNe && se === goalSe) {
      this.aim(x, y, goalNe, goalSe, goalNe, goalSe, maxSpeed, out);
      return GuidanceStatus.OK;
    }
    if (nav.isBlocked(ne, se)) {
      return GuidanceStatus.OK; // inside a wall: the wall resolution pushes it out first
    }
    if (
      path.unreachableTick >= 0 &&
      path.unreachableEpoch === this.epoch &&
      this.tick - path.unreachableTick < this.retryInterval
    ) {
      return GuidanceStatus.UNREACHABLE;
    }

    const has = path.waypoints.length > 0;
    const blocked = has && !this.lineClear(ne, se, path.waypoints[path.index]!);
    const due =
      has &&
      (path.stale || (this.replanInterval > 0 && (this.tick - path.plannedTick) * this.dt >= this.replanInterval));
    if (!has || blocked || due) {
      const urgent = blocked && this.urgentBudget > 0;
      if (urgent || this.budget > 0) {
        if (urgent) {
          this.urgentBudget--;
        } else {
          this.budget--;
        }
        if (!this.plan(path, ne, se)) {
          return GuidanceStatus.UNREACHABLE;
        }
      } else if (!has || blocked) {
        return GuidanceStatus.OK; // over budget: wait a tick
      }
    }

    // reached the waypoint: on to the next one; skip ahead while in straight sight
    const wps = path.waypoints;
    let wp = wps[path.index]!;
    if (path.index < wps.length - 1 && Math.hypot(wp.ne + 0.5 - x, wp.se + 0.5 - y) < this.waypointRadius) {
      path.index++;
      wp = wps[path.index]!;
    }
    if (path.index < wps.length - 1 && this.lineClear(ne, se, wps[path.index + 1]!)) {
      path.index++;
      wp = wps[path.index]!;
    }
    this.aim(x, y, wp.ne, wp.se, goalNe, goalSe, maxSpeed, out);
    return GuidanceStatus.OK;
  }

  invalidate(sectors: ReadonlySet<SectorId>, level: Invalidation): void {
    if (sectors.size === 0) {
      return;
    }
    this.epoch++;
    if (level === Invalidation.STALE) {
      for (const path of this.paths.values()) {
        path.stale = true;
      }
    }
  }

  release(agent: AgentId): void {
    this.paths.delete(agent);
  }

  dispose(): void {
    this.paths.clear();
  }

  /** Plan a fresh path from (ne, se); false when there is none. */
  private plan(path: AgentPath, ne: number, se: number): boolean {
    this.plans++;
    const result = this.pathfinder.getPath({
      gridId: this.gridId,
      start: { ne, se },
      target: { ne: path.goalNe, se: path.goalSe },
    });
    path.plannedTick = this.tick;
    path.stale = false;
    if (result.result !== PathResult.FOUND || result.waypoints.length === 0) {
      path.waypoints = [];
      path.index = 0;
      path.unreachableTick = this.tick;
      path.unreachableEpoch = this.epoch;
      return false;
    }
    path.waypoints = result.waypoints;
    path.index = Math.min(1, result.waypoints.length - 1); // the first waypoint is the start cell
    path.unreachableTick = -1;
    return true;
  }

  private lineClear(ne: number, se: number, to: Waypoint): boolean {
    return isLineWalkable(this.grid, ne, se, to.ne, to.se);
  }

  /** Velocity towards the center of the aim cell, braking near the goal center. */
  private aim(
    x: number,
    y: number,
    aimNe: number,
    aimSe: number,
    goalNe: number,
    goalSe: number,
    maxSpeed: number,
    out: Vec2,
  ): void {
    const dx = aimNe + 0.5 - x;
    const dy = aimSe + 0.5 - y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-9) {
      return;
    }
    const gx = goalNe + 0.5 - x;
    const gy = goalSe + 0.5 - y;
    const toGoal = Math.sqrt(gx * gx + gy * gy);
    const speed = this.slowRadius > 0 ? maxSpeed * Math.min(1, toGoal / this.slowRadius) : maxSpeed;
    out.x = (dx / len) * speed;
    out.y = (dy / len) * speed;
  }
}
