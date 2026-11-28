import type { Grid, GridId, Pathfinder, Sector, SectorId, TileDelta } from '@leptoquark1/openage-pfadfinder';
import { AgentStore, stateCode } from './agents.js';
import { OverlapResolver } from './collision/overlap.js';
import { moveWithWalls, resolveWalls } from './collision/walls.js';
import type { CongestionModel, CostChange } from './congestion/types.js';
import type { AgentView, CrowdContext, DensityFieldView, NavigationView, NeighborQuery } from './context.js';
import { FlowRouteGuidance } from './guidance/flow-route.js';
import { type GuidanceProvider, GuidanceStatus, Invalidation } from './guidance/types.js';
import { GridNavigation } from './navigation.js';
import { NeighborBuffer, SpatialHash } from './spatial-hash.js';
import { PowerLawAvoidance } from './steering/power-law.js';
import { Separation } from './steering/separation.js';
import { SideRule } from './steering/side-rule.js';
import type { PreferredVelocityModifier, SteeringForce } from './steering/types.js';
import { type AgentId, type AgentParams, AgentState } from './types.js';
import { positive } from './options.js';
import type { Vec2 } from './vec2.js';

export interface CrowdOptions {
  /** Fixed simulation timestep in seconds, e.g. 1/20. Every `step()` advances exactly this. */
  readonly timestep: number;
  /** Global guidance; default `new FlowRouteGuidance(pathfinder, gridId)`. */
  readonly guidance?: GuidanceProvider;
  /** Applied to the preferred velocity, in order; default `[new SideRule()]`. */
  readonly preferredModifiers?: readonly PreferredVelocityModifier[];
  /** Accelerations added to the goal force; default `[new PowerLawAvoidance(), new Separation()]`. */
  readonly forces?: readonly SteeringForce[];
  /** Positional overlap resolution; default `new OverlapResolver()`, `null` to turn it off. */
  readonly overlap?: OverlapResolver | null;
  /** Congestion feedback into the costs; off by default, e.g. `new DensityCostModel()`. */
  readonly congestion?: CongestionModel | null;
  /** Neighbors are looked for within this distance (cells). Default 4. */
  readonly neighborRadius?: number;
  /** At most this many nearest neighbors per agent. Default 10. */
  readonly maxNeighbors?: number;
  /**
   * Bucket size of the neighbor grid (cells); grows to the largest body
   * diameter. Small buckets keep dense crowds cheap. Default 2.
   */
  readonly hashCellSize?: number;
  /** ξ: the goal force `(v_pref − v)/ξ` closes the gap to the preferred velocity in about this time (seconds). Default 0.5. */
  readonly relaxationTime?: number;
  /** An agent arrives when its center is this close to the goal cell's center (cells). Default 0.5. */
  readonly arrivalRadius?: number;
  /**
   * An agent also arrives when its body is within this gap of an arrived
   * agent of its group with the same goal, so a crowd does not push for one
   * cell. 0 turns it off. Default 0.2.
   */
  readonly arrivalChainGap?: number;
  /**
   * An agent counts as stuck when it moved less than this (cells) ...
   * Default 0.5. For slow agents the distance shrinks to a quarter of what
   * they could cover at top speed in `stuckTime`, so walking slowly (e.g.
   * through costly terrain) is not mistaken for being stuck; an agent with
   * top speed 0 never counts as stuck.
   */
  readonly stuckDistance?: number;
  /** ... within this time (seconds). Default 2. */
  readonly stuckTime?: number;
}

/**
 * A crowd on one grid of a pathfinder, advanced in fixed timesteps.
 *
 * Per tick: congestion observes and commits, the guidance prepares its
 * routes, then for every agent (ascending id, all from the state at the
 * start of the tick): preferred velocity → modifiers (side rule) → goal
 * force `(v_pref − v)/ξ` plus steering forces (avoidance, separation) →
 * acceleration clamp → velocity and speed clamp. Then all agents move
 * against the walls, overlaps are resolved and states updated.
 *
 * Deterministic for identical inputs, timestep, call order and JavaScript
 * engine. Bit-identical lockstep across engines is not guaranteed
 * (`Math.exp`, `Math.cos` are not correctly rounded everywhere).
 *
 * Lengths are in cells, times in seconds; cell (ne, se) covers
 * `[ne, ne + 1) × [se, se + 1)`.
 */
export class CrowdSimulation {
  readonly timestep: number;
  private readonly grid: Grid;
  private readonly nav: GridNavigation;
  private readonly store = new AgentStore();
  private readonly guidance: GuidanceProvider;
  private readonly modifiers: readonly PreferredVelocityModifier[];
  private readonly forces: readonly SteeringForce[];
  private readonly overlap: OverlapResolver | null;
  private readonly congestion: CongestionModel | null;
  private readonly neighborRadius: number;
  private readonly maxNeighbors: number;
  private readonly relaxation: number;
  private readonly arrivalRadius: number;
  private readonly chainGap: number;
  private readonly stuckDistance: number;
  private readonly stuckTime: number;

  private hash: SpatialHash;
  private hashCellSize: number;
  private hashDirty = true;
  private readonly neighbors = new NeighborBuffer();
  private readonly ctx: MutableContext;
  private tickCount = 0;
  private disposed = false;

  // per-tick scratch
  private nvx = new Float64Array(16);
  private nvy = new Float64Array(16);
  private status = new Uint8Array(16);
  private readonly pref: Vec2 = { x: 0, y: 0 };
  private readonly acc: Vec2 = { x: 0, y: 0 };
  private readonly pos: Vec2 = { x: 0, y: 0 };
  private readonly vel: Vec2 = { x: 0, y: 0 };
  private readonly found: number[] = [];

  constructor(pathfinder: Pathfinder, gridId: GridId, options: CrowdOptions) {
    const grid = pathfinder.getGrid(gridId);
    if (!grid) {
      throw new RangeError(`no grid ${gridId} in the pathfinder`);
    }
    if (!(options.timestep > 0) || !Number.isFinite(options.timestep)) {
      throw new RangeError(`timestep must be a positive number, got ${options.timestep}`);
    }
    this.timestep = options.timestep;
    this.grid = grid;
    this.nav = new GridNavigation(grid);
    this.guidance = options.guidance ?? new FlowRouteGuidance(pathfinder, gridId);
    this.modifiers = options.preferredModifiers ?? [new SideRule()];
    this.forces = options.forces ?? [new PowerLawAvoidance(), new Separation()];
    this.overlap = options.overlap === undefined ? new OverlapResolver() : options.overlap;
    this.congestion = options.congestion ?? null;
    this.neighborRadius = options.neighborRadius ?? 4;
    this.maxNeighbors = options.maxNeighbors ?? 10;
    this.relaxation = options.relaxationTime ?? 0.5;
    this.arrivalRadius = options.arrivalRadius ?? 0.5;
    this.chainGap = options.arrivalChainGap ?? 0.2;
    this.stuckDistance = options.stuckDistance ?? 0.5;
    this.stuckTime = options.stuckTime ?? 2;

    this.hashCellSize = positive('hashCellSize', options.hashCellSize ?? 2);
    this.hash = new SpatialHash(this.nav.width, this.nav.height, this.hashCellSize);
    this.congestion?.attach(grid, this.nav, this.timestep);
    this.ctx = {
      tick: 0,
      dt: this.timestep,
      agents: this.store,
      neighbors: this.hash,
      navigation: this.nav,
      density: this.congestion?.field,
    };
  }

  /** Ticks run so far. */
  get tick(): number {
    return this.tickCount;
  }

  /** Number of agents. */
  get agentCount(): number {
    this.store.compact();
    return this.store.count;
  }

  /** The map as the simulation sees it. */
  get navigation(): NavigationView {
    return this.nav;
  }

  /** Read-only view of the agents by dense index (ascending id); see `AgentView`. */
  get agents(): AgentView {
    this.store.compact();
    return this.store;
  }

  /** Density of the congestion model, if it has one. */
  get density(): DensityFieldView | undefined {
    return this.congestion?.field;
  }

  /**
   * Add an agent. A position inside a wall (or outside the map) is moved to
   * the nearest free cell. Returns its id; ids are never reused.
   */
  addAgent(params: AgentParams): AgentId {
    this.assertUsable();
    const { radius, maxSpeed } = params;
    const maxAccel = params.maxAccel ?? Infinity;
    const group = params.group ?? 0;
    if (!(radius > 0) || !Number.isFinite(radius)) {
      throw new RangeError(`radius must be a positive number, got ${radius}`);
    }
    if (!(maxSpeed >= 0) || !Number.isFinite(maxSpeed)) {
      throw new RangeError(`maxSpeed must be a non-negative number, got ${maxSpeed}`);
    }
    if (!(maxAccel > 0)) {
      throw new RangeError(`maxAccel must be positive, got ${maxAccel}`);
    }
    if (!Number.isSafeInteger(group) || group < 0) {
      throw new RangeError(`group must be a non-negative integer, got ${group}`);
    }
    assertFinite(params.position);
    if (params.velocity) {
      assertFinite(params.velocity);
    }
    if (params.goal) {
      assertGoal(params.goal);
    }
    this.pos.x = params.position.x;
    this.pos.y = params.position.y;
    resolveWalls(this.nav, this.pos, null, radius);
    const id = this.store.add(this.pos.x, this.pos.y, radius, maxSpeed, maxAccel, group);
    if (params.velocity) {
      const i = this.store.indexOf(id);
      this.store.pvx[i] = params.velocity.x;
      this.store.pvy[i] = params.velocity.y;
    }
    if (radius * 2 > this.hashCellSize) {
      this.hashCellSize = radius * 2;
      this.hash = new SpatialHash(this.nav.width, this.nav.height, this.hashCellSize);
      this.ctx.neighbors = this.hash;
    }
    this.hashDirty = true;
    if (params.goal) {
      this.setGoal(id, params.goal);
    }
    return id;
  }

  /** Remove an agent; false if it does not exist. */
  removeAgent(id: AgentId): boolean {
    this.assertUsable();
    if (!this.store.remove(id)) {
      return false;
    }
    this.guidance.release(id);
    this.hashDirty = true;
    return true;
  }

  /** Give an agent a goal cell, or none (`null` → `IDLE`). */
  setGoal(id: AgentId, goal: TileDelta | null): void {
    const i = this.indexOf(id);
    if (goal) {
      assertGoal(goal);
    }
    const store = this.store;
    this.guidance.release(id);
    store.refX[i] = store.px[i]!;
    store.refY[i] = store.py[i]!;
    store.stall[i] = 0;
    if (!goal) {
      store.goalSet[i] = 0;
      store.stateCode[i] = stateCode(AgentState.IDLE);
      return;
    }
    store.goalSet[i] = 1;
    store.goalX[i] = goal.ne;
    store.goalY[i] = goal.se;
    store.stateCode[i] = stateCode(AgentState.MOVING);
  }

  /**
   * Change an agent's top speed, e.g. by the terrain it stands on. Takes
   * effect on the next tick.
   */
  setMaxSpeed(id: AgentId, maxSpeed: number): void {
    if (!(maxSpeed >= 0) || !Number.isFinite(maxSpeed)) {
      throw new RangeError(`maxSpeed must be a non-negative number, got ${maxSpeed}`);
    }
    this.store.speed[this.indexOf(id)] = maxSpeed;
  }

  /** Move an agent instantly; like `addAgent`, out of walls. Keeps its velocity. */
  teleport(id: AgentId, position: Readonly<Vec2>): void {
    const i = this.indexOf(id);
    assertFinite(position);
    this.pos.x = position.x;
    this.pos.y = position.y;
    resolveWalls(this.nav, this.pos, null, this.store.rad[i]!);
    this.store.px[i] = this.pos.x;
    this.store.py[i] = this.pos.y;
    this.store.refX[i] = this.pos.x;
    this.store.refY[i] = this.pos.y;
    this.store.stall[i] = 0;
    this.hashDirty = true;
  }

  /** Position of an agent: a copy, into `out` when given. */
  getPosition(id: AgentId, out: Vec2 = { x: 0, y: 0 }): Vec2 {
    const i = this.indexOf(id);
    out.x = this.store.px[i]!;
    out.y = this.store.py[i]!;
    return out;
  }

  /** Velocity of an agent (cells/s): a copy, into `out` when given. */
  getVelocity(id: AgentId, out: Vec2 = { x: 0, y: 0 }): Vec2 {
    const i = this.indexOf(id);
    out.x = this.store.pvx[i]!;
    out.y = this.store.pvy[i]!;
    return out;
  }

  getState(id: AgentId): AgentState {
    return this.store.state(this.indexOf(id));
  }

  hasAgent(id: AgentId): boolean {
    return this.store.indexOf(id) >= 0;
  }

  /** Every other agent whose center lies within `radius` of the agent's center, ascending id. */
  forEachNeighbor(id: AgentId, radius: number, cb: (neighbor: AgentId, distance: number) => void): void {
    const i = this.indexOf(id);
    this.ensureHash();
    const store = this.store;
    const x = store.px[i]!;
    const y = store.py[i]!;
    // snapshot first: the callback may change the crowd (compacting the
    // store) or query neighbors itself (reusing the shared buffer)
    const ids: AgentId[] = [];
    const distances: number[] = [];
    for (const j of this.hash.within(x, y, radius, this.found)) {
      if (j !== i) {
        ids.push(store.ids[j]!);
        distances.push(Math.hypot(store.px[j]! - x, store.py[j]! - y));
      }
    }
    for (let k = 0; k < ids.length; k++) {
      cb(ids[k]!, distances[k]!);
    }
  }

  /**
   * Change terrain costs, instead of `Grid.updateCosts()` while a congestion
   * model holds surcharges (it keeps base and surcharge apart). Routes
   * through sectors whose costs changed are replanned at once (changes to
   * the cost a cell already has are ignored); agents now inside a wall are
   * pushed out on the next tick.
   */
  applyTerrain(changes: readonly CostChange[]): void {
    this.assertUsable();
    let touched: ReadonlySet<SectorId>;
    if (this.congestion?.applyTerrain) {
      touched = this.congestion.applyTerrain(changes);
    } else {
      // cost field versions before the update: only sectors whose costs
      // really changed invalidate routes
      const before = new Map<Sector, number>();
      for (const { ne, se } of changes) {
        const sector = this.nav.sectorObjectAt(ne, se);
        if (sector && !before.has(sector)) {
          before.set(sector, sector.getCostField().getVersion());
        }
      }
      this.grid.updateCosts(changes);
      const ids = new Set<SectorId>();
      for (const [sector, version] of before) {
        if (sector.getCostField().getVersion() !== version) {
          ids.add(sector.getId());
        }
      }
      touched = ids;
    }
    this.guidance.invalidate(touched, Invalidation.UNSAFE);
  }

  /**
   * Plan without moving: let the guidance find routes for every agent with
   * a goal, e.g. right after goals or terrain changed, so routes are ready
   * (to draw, or to report `UNREACHABLE`) before the next `step()`. Counts as
   * a planning round of its own for the guidance's budget. Positions,
   * velocities and the tick stay as they are.
   */
  plan(): void {
    this.assertUsable();
    const store = this.store;
    store.compact();
    this.ensureHash();
    this.guidance.prepare(this.ctx);
    const arrived = stateCode(AgentState.ARRIVED);
    const unreachable = stateCode(AgentState.UNREACHABLE);
    for (let i = 0; i < store.count; i++) {
      if (!store.goalSet[i] || store.stateCode[i] === arrived) {
        continue;
      }
      const status = this.guidance.preferredVelocity(this.ctx, i, this.pref);
      if (status === GuidanceStatus.UNREACHABLE) {
        store.stateCode[i] = unreachable;
      } else if (store.stateCode[i] === unreachable) {
        store.stateCode[i] = stateCode(AgentState.MOVING);
      }
    }
  }

  /** Advance the simulation by one `timestep`. */
  step(): void {
    this.assertUsable();
    const store = this.store;
    store.compact();
    this.tickCount++;
    this.ctx.tick = this.tickCount;
    const dt = this.timestep;
    const n = store.count;
    this.ensureScratch(n);
    this.ensureHash();

    if (this.congestion) {
      this.congestion.observe(this.ctx);
      const { stale, unsafe } = this.congestion.commit(this.ctx);
      this.guidance.invalidate(stale, Invalidation.STALE);
      this.guidance.invalidate(unsafe, Invalidation.UNSAFE);
    }
    this.guidance.prepare(this.ctx);

    // velocities from the state at the start of the tick (Jacobi)
    const arrivedCode = stateCode(AgentState.ARRIVED);
    for (let i = 0; i < n; i++) {
      const neighbors = this.hash.nearest(i, this.neighborRadius, this.maxNeighbors, this.neighbors);
      const pref = this.pref;
      pref.x = 0;
      pref.y = 0;
      let status: number = STATUS_NONE;
      if (store.goalSet[i] && store.stateCode[i] !== arrivedCode) {
        status =
          this.guidance.preferredVelocity(this.ctx, i, pref) === GuidanceStatus.UNREACHABLE
            ? STATUS_UNREACHABLE
            : STATUS_OK;
      }
      for (const modifier of this.modifiers) {
        modifier.apply(this.ctx, i, neighbors, pref);
      }
      const acc = this.acc;
      acc.x = (pref.x - store.pvx[i]!) / this.relaxation;
      acc.y = (pref.y - store.pvy[i]!) / this.relaxation;
      for (const force of this.forces) {
        force.accumulate(this.ctx, i, neighbors, acc);
      }
      clamp(acc, store.accel[i]!);
      let vx = store.pvx[i]! + acc.x * dt;
      let vy = store.pvy[i]! + acc.y * dt;
      const speed = Math.sqrt(vx * vx + vy * vy);
      const max = store.speed[i]!;
      if (speed > max) {
        vx *= max / speed;
        vy *= max / speed;
      }
      this.nvx[i] = vx;
      this.nvy[i] = vy;
      this.status[i] = status;
    }

    // move against the walls
    for (let i = 0; i < n; i++) {
      this.pos.x = store.px[i]!;
      this.pos.y = store.py[i]!;
      this.vel.x = this.nvx[i]!;
      this.vel.y = this.nvy[i]!;
      moveWithWalls(this.nav, this.pos, this.vel, store.rad[i]!, this.vel.x * dt, this.vel.y * dt);
      store.px[i] = this.pos.x;
      store.py[i] = this.pos.y;
      store.pvx[i] = this.vel.x;
      store.pvy[i] = this.vel.y;
    }

    this.overlap?.resolve(store, this.hash, this.nav);
    this.hash.build(store);
    this.hashDirty = false;
    this.updateStates(dt);
  }

  /**
   * FNV-1a hash over ids, positions, velocities and states: equal states
   * hash equal, for regression tests and replay checks.
   */
  stateHash(): number {
    const store = this.store;
    store.compact();
    let h = 0x811c9dc5;
    const mix = (word: number) => {
      for (let b = 0; b < 4; b++) {
        h ^= (word >>> (b * 8)) & 0xff;
        h = Math.imul(h, 0x01000193);
      }
    };
    for (let i = 0; i < store.count; i++) {
      for (const v of [store.ids[i]!, store.px[i]!, store.py[i]!, store.pvx[i]!, store.pvy[i]!]) {
        F64[0] = v;
        mix(U32[0]!);
        mix(U32[1]!);
      }
      mix(store.stateCode[i]!);
    }
    return h >>> 0;
  }

  /**
   * Remove every agent, the routes kept for them and the congestion
   * surcharges (restoring the base costs). The simulation cannot be used
   * afterwards.
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.congestion?.dispose();
    this.guidance.dispose();
    this.store.clear();
    this.hash.build(this.store);
  }

  private updateStates(dt: number): void {
    const store = this.store;
    const arrived = stateCode(AgentState.ARRIVED);
    for (let i = 0; i < store.count; i++) {
      if (!store.goalSet[i]) {
        store.stateCode[i] = stateCode(AgentState.IDLE);
        continue;
      }
      if (store.stateCode[i] === arrived) {
        continue;
      }
      const x = store.px[i]!;
      const y = store.py[i]!;
      const gx = store.goalX[i]! + 0.5 - x;
      const gy = store.goalY[i]! + 0.5 - y;
      if (gx * gx + gy * gy <= this.arrivalRadius * this.arrivalRadius || this.touchesArrived(i)) {
        store.stateCode[i] = arrived;
        continue;
      }
      if (this.status[i] === STATUS_UNREACHABLE) {
        store.stateCode[i] = stateCode(AgentState.UNREACHABLE);
        store.refX[i] = x;
        store.refY[i] = y;
        store.stall[i] = 0;
        continue;
      }
      const mx = x - store.refX[i]!;
      const my = y - store.refY[i]!;
      const limit = Math.min(this.stuckDistance, STUCK_PROGRESS * store.speed[i]! * this.stuckTime);
      if (mx * mx + my * my >= limit * limit) {
        store.refX[i] = x;
        store.refY[i] = y;
        store.stall[i] = 0;
      } else {
        store.stall[i]! += dt;
      }
      store.stateCode[i] = stateCode(store.stall[i]! >= this.stuckTime ? AgentState.STUCK : AgentState.MOVING);
    }
  }

  /** True when agent i's body is within the chain gap of an arrived agent with its group and goal. */
  private touchesArrived(i: number): boolean {
    if (this.chainGap <= 0) {
      return false;
    }
    const store = this.store;
    const arrived = stateCode(AgentState.ARRIVED);
    const ri = store.rad[i]!;
    const reach = ri + store.maxRadius + this.chainGap;
    const n = this.hash.gather(store.px[i]!, store.py[i]!, reach);
    const cand = this.hash.candidates();
    for (let c = 0; c < n; c++) {
      const j = cand[c]!;
      if (
        j === i ||
        store.stateCode[j] !== arrived ||
        store.grp[j] !== store.grp[i] ||
        store.goalX[j] !== store.goalX[i] ||
        store.goalY[j] !== store.goalY[i]
      ) {
        continue;
      }
      const limit = ri + store.rad[j]! + this.chainGap;
      const dx = store.px[j]! - store.px[i]!;
      const dy = store.py[j]! - store.py[i]!;
      if (dx * dx + dy * dy <= limit * limit) {
        return true;
      }
    }
    return false;
  }

  private ensureHash(): void {
    this.store.compact();
    if (this.hashDirty) {
      this.hash.build(this.store);
      this.hashDirty = false;
    }
  }

  private ensureScratch(n: number): void {
    if (this.nvx.length < n) {
      this.nvx = new Float64Array(n * 2);
      this.nvy = new Float64Array(n * 2);
      this.status = new Uint8Array(n * 2);
    }
  }

  private indexOf(id: AgentId): number {
    this.assertUsable();
    this.store.compact();
    const i = this.store.indexOf(id);
    if (i < 0) {
      throw new RangeError(`no agent ${id}`);
    }
    return i;
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new Error('the crowd simulation was disposed');
    }
  }
}

interface MutableContext extends CrowdContext {
  tick: number;
  neighbors: NeighborQuery;
}

const STATUS_NONE = 0;
const STATUS_OK = 1;
const STATUS_UNREACHABLE = 2;

const F64 = new Float64Array(1);
const U32 = new Uint32Array(F64.buffer);

function clamp(v: Vec2, max: number): void {
  if (max === Infinity) {
    return;
  }
  const len = Math.sqrt(v.x * v.x + v.y * v.y);
  if (len > max) {
    v.x *= max / len;
    v.y *= max / len;
  }
}

/** Share of its possible distance an agent must cover within `stuckTime` to not count as stuck. */
const STUCK_PROGRESS = 0.25;

function assertGoal(goal: TileDelta): void {
  if (!Number.isSafeInteger(goal.ne) || !Number.isSafeInteger(goal.se)) {
    throw new RangeError(`goal must be integer cell coordinates, got (${goal.ne}, ${goal.se})`);
  }
}

function assertFinite(p: Readonly<Vec2>): void {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
    throw new RangeError(`position must be finite, got (${p.x}, ${p.y})`);
  }
}
