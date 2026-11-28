import { COST_IMPASSABLE, COST_MAX, type Grid, type Sector, type SectorId } from '@leptoquark1/openage-pfadfinder';
import type { CrowdContext, DensityFieldView, NavigationView } from '../context.js';
import { nonNegative, positive } from '../options.js';
import { DensityField } from './density-field.js';
import { type CongestionCommit, type CongestionModel, type CostChange, EMPTY_COMMIT } from './types.js';

export interface DensityCostOptions {
  /** Time constant of the density smoothing (seconds). Default 2. */
  readonly smoothingTime?: number;
  /** Density (agents per cell) up to which crowding costs nothing. Default 0.4. */
  readonly freeDensity?: number;
  /** Surcharge per agent per cell above `freeDensity`. Default 40. */
  readonly costPerDensity?: number;
  /** Largest surcharge on a cell. Default 60. */
  readonly maxSurcharge?: number;
  /** A surcharge rises only once the target exceeds it by this much. Default 3. */
  readonly riseThreshold?: number;
  /** ... and falls only once the target is this much below it (larger: slow to forget a jam). Default 6. */
  readonly fallThreshold?: number;
  /** Largest change of a cell's surcharge per write. Default 15. */
  readonly maxStep?: number;
  /** Seconds between two commits. Default 0.5. */
  readonly commitInterval?: number;
  /** Seconds a sector keeps its costs after a write before it is written again. Default 1. */
  readonly dwellTime?: number;
}

interface SectorState {
  readonly sector: Sector;
  /** Base (terrain) costs, without surcharges. */
  readonly base: Uint8Array;
  /** Surcharge per cell (0 on impassable cells). */
  readonly surcharge: Uint8Array;
  /** Cost field version after our last write; another version means someone else wrote. */
  written: number;
  lastWriteTick: number;
}

/**
 * Congestion costs as a density surcharge on the cost fields.
 *
 * Every tick the agents are splatted onto a `DensityField`. Every
 * `commitInterval` the target surcharge of a cell,
 * `round(costPerDensity · max(0, ρ − freeDensity))` capped at
 * `maxSurcharge`, is approached — with asymmetric hysteresis, at most
 * `maxStep` per write and at most one write per sector per `dwellTime` —
 * and `base + surcharge` (capped at `COST_MAX`) is written into the
 * sector's cost field with one version bump. These dampen the feedback
 * loop jam → detour → jam elsewhere; they do not rule it out.
 *
 * Impassable cells are never touched and a passable cell never becomes
 * impassable, so no portal rebuild is needed: the pathfinder's cache for
 * the sector is dropped and the flow fields steer around the crowd. The
 * portal graph's costs are geometric, so the surcharge does not change
 * which sectors a route passes, only how it crosses them.
 *
 * **Ownership:** the model keeps the base costs of every sector it wrote
 * to. While it is active, change terrain through
 * `CrowdSimulation.applyTerrain()`. As a safety net, a cost field changed
 * behind its back (other version than written) is re-based: every cell that
 * differs from `base + surcharge` is taken as its new base, and the sector
 * is reported `unsafe`. `dispose()` therefore never restores outdated
 * terrain.
 */
export class DensityCostModel implements CongestionModel {
  private smoothingTime = 2;
  private freeDensity = 0.4;
  private costPerDensity = 40;
  private maxSurcharge = 60;
  private riseThreshold = 3;
  private fallThreshold = 6;
  private maxStep = 15;
  private commitIntervalSec = 0.5;
  private dwellTimeSec = 1;
  private dt = 0;

  private grid: Grid | null = null;
  private nav: NavigationView | null = null;
  private density: DensityField | null = null;
  private commitTicks = 1;
  private dwellTicks = 0;
  private readonly sectors = new Map<SectorId, SectorState>();

  constructor(options: DensityCostOptions = {}) {
    this.configure(options);
  }

  /**
   * Change options while the simulation runs; omitted ones keep their
   * value. Surcharges already written move towards the new targets with the
   * next commits, within the usual hysteresis and step limits.
   */
  configure(options: DensityCostOptions): void {
    // validate everything first: an invalid option changes nothing
    const smoothingTime = nonNegative('smoothingTime', options.smoothingTime ?? this.smoothingTime);
    const freeDensity = nonNegative('freeDensity', options.freeDensity ?? this.freeDensity);
    const costPerDensity = nonNegative('costPerDensity', options.costPerDensity ?? this.costPerDensity);
    const maxSurcharge = Math.min(COST_MAX, nonNegative('maxSurcharge', options.maxSurcharge ?? this.maxSurcharge));
    const riseThreshold = Math.max(1, nonNegative('riseThreshold', options.riseThreshold ?? this.riseThreshold));
    const fallThreshold = Math.max(1, nonNegative('fallThreshold', options.fallThreshold ?? this.fallThreshold));
    const maxStep = Math.max(1, nonNegative('maxStep', options.maxStep ?? this.maxStep));
    const commitIntervalSec = positive('commitInterval', options.commitInterval ?? this.commitIntervalSec);
    const dwellTimeSec = nonNegative('dwellTime', options.dwellTime ?? this.dwellTimeSec);
    this.smoothingTime = smoothingTime;
    this.freeDensity = freeDensity;
    this.costPerDensity = costPerDensity;
    this.maxSurcharge = maxSurcharge;
    this.riseThreshold = riseThreshold;
    this.fallThreshold = fallThreshold;
    this.maxStep = maxStep;
    this.commitIntervalSec = commitIntervalSec;
    this.dwellTimeSec = dwellTimeSec;
    if (this.dt > 0) {
      this.applyTiming();
    }
  }

  /** Current options. */
  get options(): Required<DensityCostOptions> {
    return {
      smoothingTime: this.smoothingTime,
      freeDensity: this.freeDensity,
      costPerDensity: this.costPerDensity,
      maxSurcharge: this.maxSurcharge,
      riseThreshold: this.riseThreshold,
      fallThreshold: this.fallThreshold,
      maxStep: this.maxStep,
      commitInterval: this.commitIntervalSec,
      dwellTime: this.dwellTimeSec,
    };
  }

  get field(): DensityFieldView | undefined {
    return this.density ?? undefined;
  }

  attach(grid: Grid, navigation: NavigationView, dt: number): void {
    this.grid = grid;
    this.nav = navigation;
    this.density = new DensityField(navigation.width, navigation.height, dt, this.smoothingTime);
    this.dt = dt;
    this.applyTiming();
  }

  private applyTiming(): void {
    this.density?.setSmoothing(this.dt, this.smoothingTime);
    this.commitTicks = Math.max(1, Math.round(this.commitIntervalSec / this.dt));
    this.dwellTicks = Math.max(0, Math.round(this.dwellTimeSec / this.dt));
  }

  /** Surcharge currently written on a cell (0 when none). */
  surchargeAt(ne: number, se: number): number {
    const found = this.locate(ne, se);
    if (!found) {
      return 0;
    }
    return this.sectors.get(found.sector.getId())?.surcharge[found.idx] ?? 0;
  }

  /** Base (terrain) cost of a cell as the model knows it. */
  baseCostAt(ne: number, se: number): number {
    const found = this.locate(ne, se);
    if (!found) {
      return COST_IMPASSABLE;
    }
    const state = this.sectors.get(found.sector.getId());
    return state ? state.base[found.idx]! : found.sector.getCostField().getCost(found.idx);
  }

  observe(ctx: CrowdContext): void {
    const density = this.density!;
    const agents = ctx.agents;
    for (let i = 0; i < agents.count; i++) {
      density.splat(agents.x(i), agents.y(i));
    }
    density.update();
  }

  commit(ctx: CrowdContext): CongestionCommit {
    if (ctx.tick % this.commitTicks !== 0) {
      return EMPTY_COMMIT;
    }
    const nav = this.nav!;
    const density = this.density!;
    const stale = new Set<SectorId>();
    const unsafe = new Set<SectorId>();

    // external changes first, so no write builds on outdated base costs
    for (const [id, state] of this.sectors) {
      if (this.rebase(state)) {
        unsafe.add(id);
      }
    }

    // sectors where a surcharge may be due or still held, ascending
    const candidates = new Set<SectorId>(this.sectors.keys());
    const { cells, count } = density.activeCells();
    for (let k = 0; k < count; k++) {
      const c = cells[k]!;
      if (density.at(c % nav.width, Math.floor(c / nav.width)) > this.freeDensity) {
        const id = nav.sectorAt(c % nav.width, Math.floor(c / nav.width));
        if (id >= 0) {
          candidates.add(id);
        }
      }
    }

    for (const id of [...candidates].sort((a, b) => a - b)) {
      const state = this.stateFor(id);
      if (!state) {
        continue;
      }
      if (state.lastWriteTick >= 0 && ctx.tick - state.lastWriteTick < this.dwellTicks) {
        continue;
      }
      if (this.write(state, density)) {
        state.lastWriteTick = ctx.tick;
        if (!unsafe.has(id)) {
          stale.add(id);
        }
      }
      if (!state.surcharge.some(s => s !== 0)) {
        this.sectors.delete(id);
      }
    }
    return { stale, unsafe };
  }

  applyTerrain(changes: readonly CostChange[]): ReadonlySet<SectorId> {
    const grid = this.grid!;
    /** Cost field version per touched sector before the update. */
    const before = new Map<Sector, number>();
    const effective: CostChange[] = [];
    for (const change of changes) {
      const found = this.locate(change.ne, change.se);
      if (!found) {
        continue;
      }
      const sector = found.sector;
      const state = this.sectors.get(sector.getId());
      if (!before.has(sector)) {
        // a field someone else wrote since our last write counts as changed
        const version = sector.getCostField().getVersion();
        before.set(sector, state && state.written !== version ? -1 : version);
      }
      if (!state) {
        effective.push(change);
        continue;
      }
      this.rebase(state);
      state.base[found.idx] = change.cost;
      if (change.cost === COST_IMPASSABLE) {
        state.surcharge[found.idx] = 0;
      }
      effective.push({ ne: change.ne, se: change.se, cost: compose(change.cost, state.surcharge[found.idx]!) });
    }
    grid.updateCosts(effective);
    const changed = new Set<SectorId>();
    for (const [sector, version] of before) {
      const now = sector.getCostField().getVersion();
      if (now !== version) {
        changed.add(sector.getId());
      }
      const state = this.sectors.get(sector.getId());
      if (state) {
        state.written = now;
      }
    }
    return changed;
  }

  dispose(): void {
    for (const state of this.sectors.values()) {
      this.rebase(state);
      if (state.surcharge.some(s => s !== 0)) {
        state.sector.getCostField().setCosts(state.base);
      }
    }
    this.sectors.clear();
    this.density?.clear();
  }

  /** Re-base cells someone else changed; true when there were any. */
  private rebase(state: SectorState): boolean {
    const costField = state.sector.getCostField();
    if (costField.getVersion() === state.written) {
      return false;
    }
    const costs = costField.getCosts();
    for (let c = 0; c < costs.length; c++) {
      const current = costs[c]!;
      if (current !== compose(state.base[c]!, state.surcharge[c]!)) {
        state.base[c] = current;
        state.surcharge[c] = 0;
      }
    }
    state.written = costField.getVersion();
    return true;
  }

  /** Move the sector's surcharges towards their targets; true when its cost field was written. */
  private write(state: SectorState, density: DensityField): boolean {
    const size = this.nav!.sectorSize;
    const pos = state.sector.getPosition();
    const ne0 = pos.x * size;
    const se0 = pos.y * size;
    const next = new Uint8Array(size * size);
    let changed = false;
    for (let c = 0; c < size * size; c++) {
      const base = state.base[c]!;
      const current = state.surcharge[c]!;
      let s = current;
      if (base !== COST_IMPASSABLE) {
        const rho = density.at(ne0 + (c % size), se0 + Math.floor(c / size));
        const target = Math.min(
          this.maxSurcharge,
          Math.round(this.costPerDensity * Math.max(0, rho - this.freeDensity)),
        );
        if (target > current && target - current >= this.riseThreshold) {
          s = Math.min(target, current + this.maxStep);
        } else if (target < current && (current - target >= this.fallThreshold || target === 0)) {
          s = Math.max(target, current - this.maxStep);
        }
      }
      if (s !== current) {
        state.surcharge[c] = s;
        changed = true;
      }
      next[c] = compose(base, state.surcharge[c]!);
    }
    if (!changed) {
      return false;
    }
    const costField = state.sector.getCostField();
    costField.setCosts(next);
    state.written = costField.getVersion();
    return true;
  }

  private stateFor(id: SectorId): SectorState | null {
    const existing = this.sectors.get(id);
    if (existing) {
      return existing;
    }
    const sector = this.grid!.getSector(id);
    if (!sector) {
      return null;
    }
    const costField = sector.getCostField();
    const state: SectorState = {
      sector,
      base: costField.getCosts().slice(),
      surcharge: new Uint8Array(costField.getSize() * costField.getSize()),
      written: costField.getVersion(),
      lastWriteTick: -1,
    };
    this.sectors.set(id, state);
    return state;
  }

  private locate(ne: number, se: number): { sector: Sector; idx: number } | null {
    const nav = this.nav;
    const grid = this.grid;
    if (!nav || !grid || ne < 0 || se < 0 || ne >= nav.width || se >= nav.height) {
      return null;
    }
    const size = nav.sectorSize;
    const sector = grid.getSector(Math.floor(ne / size), Math.floor(se / size));
    if (!sector) {
      return null;
    }
    return { sector, idx: (ne % size) + (se % size) * size };
  }
}

/** Cost with surcharge: impassable stays impassable, passable never reaches it. */
function compose(base: number, surcharge: number): number {
  return base === COST_IMPASSABLE ? COST_IMPASSABLE : Math.min(COST_MAX, base + surcharge);
}
