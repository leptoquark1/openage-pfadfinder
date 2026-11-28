import type { Waypoint } from '@leptoquark1/openage-pfadfinder';
import { CELL_SIZE, type Mob, World } from './world.js';

/** Settings of one crowd group. */
export interface GroupConfig {
  readonly name: string;
  readonly color: string;
  /** Cell the group gathers around before the start. */
  readonly start: Waypoint;
  /** Cell the group walks to; it comes to rest around it. */
  readonly goal: Waypoint;
  /** Mobs placed around the start. */
  readonly count: number;
  /** Mean walking speed on free ground, in cells per second. */
  readonly speed: number;
  /** Spread of the individual speeds around the mean, 0..0.5 (±). */
  readonly speedVariance: number;
  /** Seconds after the start before the group sets off. */
  readonly delay: number;
}

/** A group with its live statistics. */
export interface CrowdGroup extends GroupConfig {
  readonly id: number;
  /** Mobs of the group, arrived ones, stuck ones. */
  readonly total: number;
  readonly arrived: number;
  readonly stuck: number;
  /** Simulated seconds until the last mob arrived, null until then. */
  readonly finishedAt: number | null;
  /** True once the group's delay has passed. */
  readonly released: boolean;
}

/** Phase of the scene: placed, running, paused by the user, or over. */
export type ScenePhase = 'setup' | 'running' | 'paused' | 'ended';
/** Why a run ended: everybody arrived, or nobody who has not arrived can move on. */
export type EndReason = 'arrived' | 'stuck';

/** Simulation speeds offered in the panel. */
export const SCENE_SPEEDS = [0.25, 0.5, 1, 2, 4] as const;

/** Value ranges of the numeric group settings. */
export const GROUP_RANGES = {
  count: { min: 1, max: 120, step: 1 },
  speed: { min: 0.5, max: 6, step: 0.1 },
  speedVariance: { min: 0, max: 0.5, step: 0.05 },
  delay: { min: 0, max: 30, step: 0.5 },
} as const satisfies Partial<Record<keyof GroupConfig, { min: number; max: number; step: number }>>;

/** Group colors, in the order new groups take them. */
export const GROUP_COLORS = ['#4FD1C5', '#F5A623', '#F472B6', '#A78BFA', '#60A5FA', '#A3E635'] as const;

/** Mobs of a "medium" group in the templates, before the ±20 % spread. */
const MEDIUM_GROUP = 30;
/** Cells between a corner group and the map edge. */
const CORNER_INSET = 2;
/** All remaining mobs must be stuck this long (simulated seconds) before a run counts as stuck. */
const STUCK_GRACE = 2;
/** Mob offsets within a spawn cell (px from its center): four mobs per cell. */
const CELL_SLOTS: readonly [number, number][] = [
  [-8, -8],
  [8, -8],
  [-8, 8],
  [8, 8],
];

interface GroupState {
  readonly id: number;
  config: GroupConfig;
  released: boolean;
  finishedAt: number | null;
}

/**
 * The crowd simulation scene: groups of mobs with a start, a goal, a size,
 * a speed and a start delay walk to their goals and stay there. Unlike the
 * playground, a run has a beginning and an end: `start()`, `pause()`,
 * `resume()`, `restart()`, at an adjustable speed, ending once every group
 * arrived or every mob that has not arrived is stuck.
 *
 * Walls, terrain and moving obstacles are edited as in the playground (it
 * is the same world): the Target tool sets the selected group's goal, the
 * Start tool its start. Mobs come from the groups only; single mobs cannot
 * be placed or removed.
 */
export class CrowdScene extends World {
  private groups: GroupState[] = [];
  private nextGroupId = 0;
  private selected = -1;
  private phase: ScenePhase = 'setup';
  private endReason: EndReason | null = null;
  private simTime = 0;
  private speed = 1;
  private stuckSince: number | null = null;
  private viewCols = 0;
  private viewRows = 0;
  /** What the mobs were placed from at the last setup: group id → its placement settings. */
  private placedFrom = new Map<number, string>();

  // --- groups ---

  getGroups(): readonly CrowdGroup[] {
    return this.groups.map(g => {
      let total = 0;
      let arrived = 0;
      let stuck = 0;
      for (const mob of this.mobs) {
        if (mob.group !== g.id) {
          continue;
        }
        total++;
        const state = this.agentState(mob);
        if (state === 'ARRIVED') {
          arrived++;
        } else if (state === 'STUCK' || state === 'UNREACHABLE') {
          stuck++;
        }
      }
      return { ...g.config, id: g.id, total, arrived, stuck, finishedAt: g.finishedAt, released: g.released };
    });
  }

  /** Color of a group's mobs. */
  colorOf(group: number): string {
    return this.groups.find(g => g.id === group)?.config.color ?? GROUP_COLORS[0];
  }

  getSelectedGroup(): number {
    return this.selected;
  }

  selectGroup(id: number): void {
    if (this.groups.some(g => g.id === id)) {
      this.selected = id;
    }
  }

  /** A new group in the middle of the view, selected. */
  addGroup(): number {
    const midSe = Math.floor(this.viewRows / 2);
    const id = this.createGroup({
      name: `Group ${this.nextGroupId + 1}`,
      color: GROUP_COLORS[this.groups.length % GROUP_COLORS.length]!,
      start: this.freeNear({ ne: CORNER_INSET, se: midSe }),
      goal: this.freeNear({ ne: Math.max(0, this.viewCols - 1 - CORNER_INSET), se: midSe }),
      count: 20,
      speed: 3,
      speedVariance: 0.15,
      delay: 0,
    });
    this.selected = id;
    this.afterGroupEdit();
    return id;
  }

  removeGroup(id: number): void {
    this.groups = this.groups.filter(g => g.id !== id);
    this.dropMobs(m => m.group === id);
    this.placedFrom.delete(id); // gone at once, nothing left to apply
    if (this.selected === id) {
      this.selected = this.groups[0]?.id ?? -1;
    }
    this.afterGroupEdit();
  }

  /**
   * Change a group's settings; numbers are clamped into their ranges. Before
   * the start the mobs are placed again; during a run size, start, speed and
   * delay apply from the next restart (`hasPendingChanges()`), a new goal
   * and the name at once.
   */
  updateGroup(id: number, patch: Partial<GroupConfig>): void {
    const group = this.groups.find(g => g.id === id);
    if (!group) {
      return;
    }
    const prevGoal = group.config.goal;
    group.config = clampGroup({ ...group.config, ...patch });
    if (group.released && (prevGoal.ne !== group.config.goal.ne || prevGoal.se !== group.config.goal.se)) {
      this.resendGroup(group);
    }
    this.afterGroupEdit();
  }

  /** The Start tool: move the selected group's start to the clicked cell. */
  setStartAt(px: number, py: number): boolean {
    const cell = this.cellAt(px, py);
    if (!cell || this.cellBlocked(cell.ne, cell.se) || this.selected < 0) {
      return false;
    }
    this.updateGroup(this.selected, { start: cell });
    return true;
  }

  /** The Target tool: move the selected group's goal to the clicked cell. */
  override setTargetAt(px: number, py: number): boolean {
    const cell = this.cellAt(px, py);
    if (!cell || this.cellBlocked(cell.ne, cell.se) || this.selected < 0) {
      return false;
    }
    this.updateGroup(this.selected, { goal: cell });
    return true;
  }

  override canPlaceTarget(px: number, py: number): boolean {
    const cell = this.cellAt(px, py);
    return cell !== null && !this.cellBlocked(cell.ne, cell.se) && this.selected >= 0;
  }

  /** Mobs come from the groups only. */
  override canPlaceMob(_px: number, _py: number): boolean {
    return false;
  }

  override addMob(_px: number, _py: number): void {}

  override removeMob(_px: number, _py: number): void {}

  override mobAt(_px: number, _py: number): Mob | null {
    return null;
  }

  /** Replace the groups with a template; "crossing": four groups, corner to opposite corner. */
  applyTemplate(name: 'crossing'): void {
    if (name !== 'crossing') {
      return;
    }
    this.groups = [];
    this.nextGroupId = 0;
    const right = Math.max(0, this.viewCols - 1 - CORNER_INSET);
    const bottom = Math.max(0, this.viewRows - 1 - CORNER_INSET);
    const corners: Waypoint[] = [
      { ne: CORNER_INSET, se: CORNER_INSET },
      { ne: right, se: CORNER_INSET },
      { ne: right, se: bottom },
      { ne: CORNER_INSET, se: bottom },
    ];
    const names = ['North-west', 'North-east', 'South-east', 'South-west'];
    corners.forEach((corner, k) => {
      this.createGroup({
        name: names[k]!,
        color: GROUP_COLORS[k]!,
        start: this.freeNear(corner),
        goal: this.freeNear(corners[(k + 2) % 4]!),
        count: Math.round(MEDIUM_GROUP * (0.8 + Math.random() * 0.4)),
        speed: 3,
        speedVariance: 0.15,
        delay: 0,
      });
    });
    this.selected = this.groups[0]!.id;
    this.toSetup();
  }

  // --- the run ---

  getPhase(): ScenePhase {
    return this.phase;
  }

  getEndReason(): EndReason | null {
    return this.endReason;
  }

  /** Simulated seconds since the start. */
  getSimTime(): number {
    return this.simTime;
  }

  getSpeed(): number {
    return this.speed;
  }

  /** Simulation speed, e.g. 0.5 for half speed; at most 8×. */
  setSpeed(speed: number): void {
    this.speed = Math.min(8, Math.max(0.1, speed));
  }

  /** Start from the setup; groups without delay set off at once. */
  start(): void {
    if (this.phase !== 'setup' || this.mobs.length === 0) {
      return;
    }
    this.phase = 'running';
    this.releaseDue();
  }

  pause(): void {
    if (this.phase === 'running') {
      this.phase = 'paused';
    }
  }

  resume(): void {
    if (this.phase === 'paused') {
      this.phase = 'running';
    }
  }

  /** Every group back to its start, then run again. */
  restart(): void {
    this.toSetup();
    this.start();
  }

  /**
   * True when groups were added or their size, start, speed or delay changed
   * since the mobs were placed: a restart applies them.
   */
  hasPendingChanges(): boolean {
    if (this.phase === 'setup') {
      return false;
    }
    return this.groups.some(g => this.placedFrom.get(g.id) !== placementKey(g.config));
  }

  /** Back to the start positions, waiting for `start()`. */
  toSetup(): void {
    this.phase = 'setup';
    this.endReason = null;
    this.simTime = 0;
    this.stuckSince = null;
    for (const group of this.groups) {
      group.released = false;
      group.finishedAt = null;
    }
    this.placeMobs();
  }

  /** One line for the status badge. */
  statusText(): string {
    const groups = this.getGroups();
    const total = groups.reduce((n, g) => n + g.total, 0);
    const arrived = groups.reduce((n, g) => n + g.arrived, 0);
    const time = `${this.simTime.toFixed(1)} s`;
    switch (this.phase) {
      case 'setup':
        return total > 0 ? '' : 'Add a group to start';
      case 'running':
        return `Running ${time} · ${arrived}/${total} arrived`;
      case 'paused':
        return `Paused at ${time} · ${arrived}/${total} arrived`;
      case 'ended':
        return this.endReason === 'arrived'
          ? `All groups arrived in ${time}`
          : `Stopped at ${time}: ${total - arrived} mobs stuck`;
    }
  }

  override step(dtMs: number, nowMs: number): void {
    this.paused = this.phase !== 'running';
    this.timeScale = this.speed;
    super.step(dtMs, nowMs);
    if (this.phase !== 'running') {
      return;
    }
    this.simTime += (Math.min(dtMs, 50) / 1000) * this.speed;
    this.releaseDue();
    this.checkEnd();
  }

  override resize(viewCols: number, viewRows: number): void {
    const first = this.viewCols === 0;
    this.viewCols = viewCols;
    this.viewRows = viewRows;
    super.resize(viewCols, viewRows);
    if (first || this.groups.length === 0) {
      this.applyTemplate('crossing');
      return;
    }
    // keep starts and goals inside the (smaller) view
    for (const group of this.groups) {
      const clamp = (c: Waypoint) =>
        this.freeNear({ ne: Math.min(c.ne, viewCols - 1), se: Math.min(c.se, viewRows - 1) });
      const prevGoal = group.config.goal;
      group.config = { ...group.config, start: clamp(group.config.start), goal: clamp(group.config.goal) };
      // groups under way head for the moved goal at once, as with updateGroup()
      if (group.released && (prevGoal.ne !== group.config.goal.ne || prevGoal.se !== group.config.goal.se)) {
        this.resendGroup(group);
      }
    }
    if (this.phase === 'setup') {
      this.placeMobs();
    }
  }

  /** Clear the map and start over with the crossing. */
  override reset(): void {
    super.reset();
    this.applyTemplate('crossing');
  }

  protected override goalFor(mob: Mob): Waypoint | null {
    const group = this.groups.find(g => g.id === mob.group);
    return group?.released ? group.config.goal : null;
  }

  /** Arrived mobs stay where they came to rest. */
  protected override onArrived(_mob: Mob): void {}

  // --- internals ---

  private createGroup(config: GroupConfig): number {
    const id = this.nextGroupId++;
    this.groups.push({ id, config: clampGroup(config), released: false, finishedAt: null });
    return id;
  }

  private afterGroupEdit(): void {
    if (this.phase === 'setup') {
      this.placeMobs();
    }
  }

  /** Every group's mobs around its start: four per free cell, nearest cells first. */
  private placeMobs(): void {
    this.dropMobs(() => true);
    this.placedFrom = new Map(this.groups.map(g => [g.id, placementKey(g.config)]));
    const taken = new Set<number>();
    for (const group of this.groups) {
      const cells = this.spawnCells(group.config.start, Math.ceil(group.config.count / CELL_SLOTS.length), taken);
      let placed = 0;
      for (const cell of cells) {
        for (const [dx, dy] of CELL_SLOTS) {
          if (placed >= group.config.count) {
            break;
          }
          const x = cell.ne * CELL_SIZE + CELL_SIZE / 2 + dx;
          const y = cell.se * CELL_SIZE + CELL_SIZE / 2 + dy;
          this.spawnMob(x, y, this.mobSpeed(group.config), group.id);
          placed++;
        }
      }
    }
  }

  /** `count` free cells around `start` by breadth-first search, skipping cells another group uses. */
  private spawnCells(start: Waypoint, count: number, taken: Set<number>): Waypoint[] {
    const cols = this.getCols();
    const cells: Waypoint[] = [];
    const seen = new Set<number>([start.ne + start.se * cols]);
    const queue: Waypoint[] = [start];
    while (queue.length > 0 && cells.length < count) {
      const cell = queue.shift()!;
      const key = cell.ne + cell.se * cols;
      if (!this.cellBlocked(cell.ne, cell.se) && !taken.has(key) && this.inView(cell)) {
        cells.push(cell);
        taken.add(key);
      }
      for (const [dNe, dSe] of [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ] as const) {
        const next = { ne: cell.ne + dNe, se: cell.se + dSe };
        const nextKey = next.ne + next.se * cols;
        if (this.inView(next) && !seen.has(nextKey)) {
          seen.add(nextKey);
          queue.push(next);
        }
      }
    }
    return cells;
  }

  private inView(cell: Waypoint): boolean {
    return cell.ne >= 0 && cell.se >= 0 && cell.ne < this.viewCols && cell.se < this.viewRows;
  }

  /** The cell itself when free, else the nearest free one. */
  private freeNear(cell: Waypoint): Waypoint {
    return this.nearestFreeCell(cell) ?? cell;
  }

  /** A mob's speed in px/s: the group's mean, spread by its variance. */
  private mobSpeed(config: GroupConfig): number {
    const factor = 1 + config.speedVariance * (Math.random() * 2 - 1);
    return config.speed * factor * CELL_SIZE;
  }

  /** Groups whose delay has passed set off. */
  private releaseDue(): void {
    let released = false;
    for (const group of this.groups) {
      if (!group.released && this.simTime >= group.config.delay) {
        group.released = true;
        this.resendGroup(group);
        released = true;
      }
    }
    if (released) {
      this.goalsChanged();
    }
  }

  private resendGroup(group: GroupState): void {
    for (const mob of this.mobs) {
      if (mob.group === group.id) {
        this.sendToTarget(mob);
      }
    }
    this.goalsChanged();
  }

  /**
   * End the run once every mob arrived, or once every mob that has not
   * arrived has been stuck (or without a route) for a while, with every
   * group under way.
   */
  private checkEnd(): void {
    let open = 0;
    let stuck = 0;
    for (const group of this.groups) {
      let total = 0;
      let arrived = 0;
      for (const mob of this.mobs) {
        if (mob.group !== group.id) {
          continue;
        }
        total++;
        const state = this.agentState(mob);
        if (state === 'ARRIVED') {
          arrived++;
        } else {
          open++;
          if (group.released && (state === 'STUCK' || state === 'UNREACHABLE')) {
            stuck++;
          }
        }
      }
      if (group.finishedAt === null && total > 0 && arrived === total) {
        group.finishedAt = this.simTime;
      }
    }
    if (this.mobs.length === 0) {
      return;
    }
    if (open === 0) {
      this.end('arrived');
      return;
    }
    if (stuck === open) {
      this.stuckSince ??= this.simTime;
      if (this.simTime - this.stuckSince >= STUCK_GRACE) {
        this.end('stuck');
      }
    } else {
      this.stuckSince = null;
    }
  }

  private end(reason: EndReason): void {
    this.phase = 'ended';
    this.endReason = reason;
  }
}

/** The settings mobs are placed from; a change to them needs a restart during a run. */
function placementKey(config: GroupConfig): string {
  const { count, start, speed, speedVariance, delay } = config;
  return JSON.stringify([count, start.ne, start.se, speed, speedVariance, delay]);
}

function clampGroup(config: GroupConfig): GroupConfig {
  const clamp = (key: keyof typeof GROUP_RANGES, value: number) => {
    const { min, max } = GROUP_RANGES[key];
    return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
  };
  return {
    ...config,
    count: Math.round(clamp('count', config.count)),
    speed: clamp('speed', config.speed),
    speedVariance: clamp('speedVariance', config.speedVariance),
    delay: clamp('delay', config.delay),
  };
}
