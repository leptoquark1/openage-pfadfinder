import {
  type CostField,
  type FlowRoute,
  type Grid,
  type GridId,
  isLineWalkable,
  type Pathfinder,
  type SectorId,
  type TileDelta,
} from '@leptoquark1/openage-pfadfinder';
import type { CrowdContext } from '../context.js';
import type { AgentId } from '../types.js';
import type { Vec2 } from '../vec2.js';
import { type GuidanceProvider, GuidanceStatus, Invalidation } from './types.js';

export interface FlowRouteGuidanceOptions {
  /** Routes planned per tick at most; replanning `UNSAFE` routes does not count. Default 8. */
  readonly maxPlansPerTick?: number;
  /** Cells followed ahead along the flow to aim at, while in straight sight. Default 3. */
  readonly lookahead?: number;
  /** Agents slow down linearly within this distance of their goal (cells). Default 1.5. */
  readonly slowRadius?: number;
  /** Ticks before an unreachable goal is tried again (any cost change retries at once). Default 20. */
  readonly retryInterval?: number;
  /** Routes no agent used for this many ticks are dropped. Default 200. */
  readonly routeTtl?: number;
}

const FRESH = 0;
const STALE = 1;
const UNSAFE = 2;

interface RouteRecord {
  readonly route: FlowRoute;
  readonly costFields: readonly CostField[];
  readonly sectorIds: readonly SectorId[];
  /** Cost field versions at planning time, parallel to `costFields`. */
  readonly versions: readonly number[];
  status: number;
  lastUsed: number;
}

interface AgentGuide {
  key: number;
  route: RouteRecord | null;
  /** Tick of the failed plan, -1 when the goal is not known to be unreachable. */
  unreachableTick: number;
  unreachableEpoch: number;
}

/**
 * Guidance along the pathfinder's flow fields (`Pathfinder.getFlowRoute()`).
 *
 * Agents of one group with the same goal share routes: an agent first tries
 * the routes already planned for its (group, goal), and only plans a new one
 * from its own cell when none of them reaches it. Planning is budgeted per
 * tick; agents over budget wait a tick.
 *
 * Staleness is tracked per route by the versions of the cost fields it was
 * planned on. A changed version is `STALE` when the sector was invalidated as
 * `STALE` at exactly that version (a congestion surcharge, passability
 * unchanged); anything else — an `UNSAFE` invalidation or a change nobody
 * announced — makes the route `UNSAFE`. Stale routes stay in use until the
 * budget replans them; unsafe ones are dropped and their agents replan at
 * once, outside the budget.
 *
 * The preferred velocity aims at the cell the flow leads to, or up to
 * `lookahead` cells further while the straight line there is clear, and
 * slows down near the goal.
 */
export class FlowRouteGuidance implements GuidanceProvider {
  private readonly pathfinder: Pathfinder;
  private readonly gridId: GridId;
  private readonly grid: Grid;
  private readonly maxPlansPerTick: number;
  private readonly lookahead: number;
  private readonly slowRadius: number;
  private readonly retryInterval: number;
  private readonly routeTtl: number;

  private readonly routes = new Map<number, RouteRecord[]>();
  private readonly guides = new Map<AgentId, AgentGuide>();
  /** Per sector: version at which only costs changed (STALE). */
  private readonly staleAt = new Map<SectorId, number>();
  /** Per sector: version at the last UNSAFE invalidation. */
  private readonly unsafeAt = new Map<SectorId, number>();
  /** Bumped by every invalidation, so unreachable goals are retried. */
  private epoch = 0;
  private budget = 0;
  private tick = 0;
  private plans = 0;

  constructor(pathfinder: Pathfinder, gridId: GridId, options: FlowRouteGuidanceOptions = {}) {
    const grid = pathfinder.getGrid(gridId);
    if (!grid) {
      throw new RangeError(`no grid ${gridId} in the pathfinder`);
    }
    this.pathfinder = pathfinder;
    this.gridId = gridId;
    this.grid = grid;
    this.maxPlansPerTick = options.maxPlansPerTick ?? 8;
    this.lookahead = Math.max(1, options.lookahead ?? 3);
    this.slowRadius = options.slowRadius ?? 1.5;
    this.retryInterval = options.retryInterval ?? 20;
    this.routeTtl = options.routeTtl ?? 200;
  }

  /** Routes planned so far (for tests and statistics). */
  getPlanCount(): number {
    return this.plans;
  }

  /** Routes currently kept. */
  getRouteCount(): number {
    let n = 0;
    for (const list of this.routes.values()) {
      n += list.length;
    }
    return n;
  }

  prepare(ctx: CrowdContext): void {
    this.tick = ctx.tick;
    this.budget = this.maxPlansPerTick;
    for (const [key, list] of this.routes) {
      let w = 0;
      for (const rec of list) {
        rec.status = this.statusOf(rec);
        if (rec.status !== UNSAFE && this.tick - rec.lastUsed <= this.routeTtl) {
          list[w++] = rec;
        } else {
          rec.status = UNSAFE;
        }
      }
      list.length = w;
      if (w === 0) {
        this.routes.delete(key);
      }
    }
  }

  preferredVelocity(ctx: CrowdContext, i: number, out: Vec2): GuidanceStatus {
    out.x = 0;
    out.y = 0;
    const agents = ctx.agents;
    const nav = ctx.navigation;
    const goalNe = agents.goalNe(i);
    const goalSe = agents.goalSe(i);
    const key = this.keyOf(agents.group(i), goalNe, goalSe, nav.width, nav.height);
    const id = agents.id(i);
    let guide = this.guides.get(id);
    if (!guide || guide.key !== key) {
      guide = { key, route: null, unreachableTick: -1, unreachableEpoch: -1 };
      this.guides.set(id, guide);
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
      guide.unreachableTick >= 0 &&
      guide.unreachableEpoch === this.epoch &&
      this.tick - guide.unreachableTick < this.retryInterval
    ) {
      return GuidanceStatus.UNREACHABLE;
    }

    const rec = this.routeFor(guide, key, ne, se, goalNe, goalSe);
    if (rec === 'unreachable') {
      return GuidanceStatus.UNREACHABLE;
    }
    if (!rec) {
      return GuidanceStatus.OK; // over budget: wait a tick
    }
    rec.lastUsed = this.tick;

    // aim at the next cell, or further along while the straight line is clear
    let next = rec.route.next(ne, se)!;
    let aimNe = next.ne;
    let aimSe = next.se;
    for (let k = 1; k < this.lookahead && !(aimNe === goalNe && aimSe === goalSe); k++) {
      const further = rec.route.next(next.ne, next.se);
      if (!further || !isLineWalkable(this.grid, ne, se, further.ne, further.se)) {
        break;
      }
      next = further;
      aimNe = further.ne;
      aimSe = further.se;
    }
    this.aim(x, y, aimNe, aimSe, goalNe, goalSe, maxSpeed, out);
    return GuidanceStatus.OK;
  }

  invalidate(sectors: ReadonlySet<SectorId>, level: Invalidation): void {
    if (sectors.size === 0) {
      return;
    }
    this.epoch++;
    for (const id of sectors) {
      const version = this.versionOf(id);
      if (version === undefined) {
        continue;
      }
      if (level === Invalidation.UNSAFE) {
        this.unsafeAt.set(id, version);
        this.staleAt.delete(id);
      } else {
        this.staleAt.set(id, version);
      }
    }
  }

  release(agent: AgentId): void {
    this.guides.delete(agent);
  }

  dispose(): void {
    this.routes.clear();
    this.guides.clear();
    this.staleAt.clear();
    this.unsafeAt.clear();
  }

  /**
   * The route an agent on (ne, se) follows: its own while fresh, else a fresh
   * one of its (group, goal), else a new plan within the budget, else its
   * own stale one. null to wait.
   */
  private routeFor(
    guide: AgentGuide,
    key: number,
    ne: number,
    se: number,
    goalNe: number,
    goalSe: number,
  ): RouteRecord | null | 'unreachable' {
    const own = guide.route;
    if (own && own.status === FRESH && own.route.next(ne, se)) {
      return own;
    }
    const list = this.routes.get(key);
    if (list) {
      for (const rec of list) {
        if (rec.status === FRESH && rec !== own && rec.route.next(ne, se)) {
          guide.route = rec;
          return rec;
        }
      }
    }
    const urgent = own !== null && own.status === UNSAFE;
    if (this.budget > 0 || urgent) {
      if (!urgent) {
        this.budget--;
      }
      const planned = this.plan(key, ne, se, goalNe, goalSe);
      if (!planned) {
        guide.route = null;
        guide.unreachableTick = this.tick;
        guide.unreachableEpoch = this.epoch;
        return 'unreachable';
      }
      guide.unreachableTick = -1;
      guide.route = planned;
      return planned.route.next(ne, se) ? planned : null;
    }
    if (own && own.status === STALE && own.route.next(ne, se)) {
      return own;
    }
    return null;
  }

  private plan(key: number, ne: number, se: number, goalNe: number, goalSe: number): RouteRecord | null {
    this.plans++;
    const target: TileDelta = { ne: goalNe, se: goalSe };
    const route = this.pathfinder.getFlowRoute({ gridId: this.gridId, start: { ne, se }, target });
    if (!route) {
      return null;
    }
    const costFields: CostField[] = [];
    const sectorIds: SectorId[] = [];
    for (const step of route.getSteps()) {
      const cf = step.sector.getCostField();
      if (!costFields.includes(cf)) {
        costFields.push(cf);
        sectorIds.push(step.sector.getId());
      }
    }
    const rec: RouteRecord = {
      route,
      costFields,
      sectorIds,
      versions: costFields.map(cf => cf.getVersion()),
      status: FRESH,
      lastUsed: this.tick,
    };
    const list = this.routes.get(key);
    if (list) {
      list.push(rec);
    } else {
      this.routes.set(key, [rec]);
    }
    return rec;
  }

  private statusOf(rec: RouteRecord): number {
    let status = FRESH;
    for (let k = 0; k < rec.costFields.length; k++) {
      const current = rec.costFields[k]!.getVersion();
      const planned = rec.versions[k]!;
      if (current === planned) {
        continue;
      }
      const id = rec.sectorIds[k]!;
      if ((this.unsafeAt.get(id) ?? -1) > planned || this.staleAt.get(id) !== current) {
        return UNSAFE;
      }
      status = STALE;
    }
    return status;
  }

  private versionOf(sectorId: SectorId): number | undefined {
    return this.grid.getSector(sectorId)?.getCostField().getVersion();
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

  private keyOf(group: number, ne: number, se: number, width: number, height: number): number {
    return (group * height + se) * width + ne;
  }
}
