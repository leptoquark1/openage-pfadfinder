import type { Portal } from '@leptoquark1/openage-pfadfinder';
import {
  BinaryHeap,
  Grid,
  Integrator,
  Sector,
} from '@leptoquark1/openage-pfadfinder';
import type { PortalId, SectorId, TileDelta, Waypoint } from '@leptoquark1/openage-pfadfinder/shared';
import {
  buildGrid,
  COST_IMPASSABLE,
  COST_MIN,
  FLOW_DIR_MASK,
  FLOW_PATHABLE_MASK,
  FlowDir,
  PortalDirection,
  tileEuclidean,
} from '@leptoquark1/openage-pfadfinder/shared';
import { PerfMeter } from './perf.js';

/** Edge length of one grid cell in CSS pixels. */
export const CELL_SIZE = 32;

/** Cells per sector edge — the subdivision the portal graph is built on. */
export const SECTOR_SIZE = 8;

/** Cell delta per flow direction, matching `FlowField.build()`. */
const FLOW_DELTAS: Record<number, readonly [number, number]> = {
  [FlowDir.NORTH]: [0, -1],
  [FlowDir.NORTH_EAST]: [1, -1],
  [FlowDir.EAST]: [1, 0],
  [FlowDir.SOUTH_EAST]: [1, 1],
  [FlowDir.SOUTH]: [0, 1],
  [FlowDir.SOUTH_WEST]: [-1, 1],
  [FlowDir.WEST]: [-1, 0],
  [FlowDir.NORTH_WEST]: [-1, -1],
};

/** A unit steered by the flow fields towards the target. */
export interface Mob {
  x: number
  y: number
  /** Spawn position — a mob returns here after reaching the target. */
  readonly spawnX: number
  readonly spawnY: number
  /** Individual travel speed in px/s, drawn at spawn time. */
  readonly speed: number
  /** Cells the mob will pass through, traced along the flow fields. */
  trace: Waypoint[]
  /** World version the trace was built against; -1 forces a refresh. */
  traceVersion: number
  /** True when the flow fields offer no route to the target. */
  blocked: boolean
}

/** Endpoints of a patrol route, in canvas pixels. */
export interface PatrolRoute {
  ax: number
  ay: number
  bx: number
  by: number
}

/** A free-floating obstacle that bounces around and re-stamps the cost field. */
export interface MovingObstacle {
  x: number
  y: number
  angle: number
  readonly speed: number
  readonly size: number
  /** Route the obstacle pendles between; null for free-floating ones. */
  readonly patrol: PatrolRoute | null
  /** True while the obstacle heads for endpoint B, false back towards A. */
  headingToB: boolean
}

/** The flow fields of one sector, merged across its walkable components. */
export interface SectorFlow {
  /** Raw `FlowField` cells, local to the sector. */
  readonly cells: Uint8Array
  /**
     * Portal crossings at the sinks of the fields, by local cell index. A field
     * converges on its sink; leaving the sector is a step no direction inside
     * the field encodes.
     */
  readonly exits: Map<number, readonly [number, number]>
  /**
     * Integration sink per component (component id → local cell index, -1 when
     * no route to the target exists). Two flows with equal sinks are equal, so
     * this is what makes a cached field reusable.
     */
  readonly sinks: ReadonlyMap<number, number>
  /** `CostField` version of the sector the cells were integrated against. */
  readonly costVersion: number
  /** Components version of the sector the cells were integrated against. */
  readonly componentsVersion: number
}

export interface WorldStats {
  readonly mobs: number
  readonly obstacles: number
  readonly blocked: number
  readonly hasTarget: boolean
}

/** Milliseconds between planning ticks — grid rebuild plus flow-field refresh. */
const PLAN_INTERVAL_MS = 100;

/** Mob traces refreshed per planning tick, so a large crowd spreads over ticks. */
const TRACES_PER_TICK = 12;

/** Cells a single trace follows before giving up on reaching the target. */
const MAX_TRACE_LENGTH = 256;

const MOB_SPEED_MIN = 70; // px/s
const MOB_SPEED_MAX = 160; // px/s
export const MOB_RADIUS = 6;
const OBSTACLE_SPEED = 42; // px/s
export const OBSTACLE_SIZE = 26;
const REPULSION_STRENGTH = 260; // px/s at full overlap

/** Radius in cells around the target that `scatterWallsAroundTarget` rewrites. */
export const SCATTER_RADIUS = 12;
/** Share of the scatter area's cells that end up as wall. */
const SCATTER_WALL_DENSITY = 0.22;
/** Cell-count range of one scattered wall segment. */
const SCATTER_SEGMENT_MIN = 2;
const SCATTER_SEGMENT_MAX = 5;

/** Chance a carved maze passage grows a second lane (two-cell-wide corridor). */
const MAZE_WIDEN_CHANCE = 0.25;
/** Chance a maze dead end is opened into a neighbouring corridor (braiding). */
const MAZE_BRAID_CHANCE = 0.5;
/** Share of maze lattice cells that becomes open rooms. */
const MAZE_ROOM_DENSITY = 0.03;
/** Lattice cells per room edge — a room spans `2 * extent - 1` cells. */
const MAZE_ROOM_MIN = 2;
const MAZE_ROOM_MAX = 3;

/**
 * Simulation state of the playground, kept outside the React render cycle.
 *
 * The world owns a global cost layer (painted walls plus the cells currently
 * covered by moving obstacles) and rebuilds a `Grid` from it whenever that
 * layer changes — portals are derived from cost fields, so they have to be
 * re-derived rather than patched.
 *
 * Mobs are steered by flow fields, not by a per-mob path: every walkable
 * component of every sector gets one field, integrated towards the target if it
 * holds the target, otherwise towards the portal that starts the cheapest route
 * to it. That is the field a crowd follows, and it is the same data the Flow
 * overlay draws.
 */
export class World {
  private sectorsX = 0;
  private sectorsY = 0;
  private cols = 0;
  private rows = 0;

  /** Painted walls — the persistent part of the cost layer. */
  private staticCost = new Uint8Array(0);
  /** Impassable cells in `staticCost`, kept in step with every write to it. */
  private wallCount = 0;
  /**
     * Wall layer right after the active labyrinth was generated, so
     * `removeLabyrinth()` can tell its walls from later edits. null while no
     * labyrinth is active.
     */
  private labyrinth: Uint8Array | null = null;
  /** Static walls plus moving obstacles, the layer sectors are built from. */
  private dynamicCost = new Uint8Array(0);

  private grid: Grid | null = null;
  private readonly integrator = new Integrator();

  private target: Waypoint | null = null;
  private readonly mobs: Mob[] = [];
  private readonly obstacles: MovingObstacle[] = [];

  /** First endpoint of the patrol route being placed — pending until the second click. */
  private patrolAnchor: { x: number, y: number } | null = null;

  /** Bumped whenever anything invalidates the flow fields. */
  private version = 0;
  private costDirty = true;
  private lastPlanMs = 0;
  private traceCursor = 0;
  /** Dirty cells in dynamic-layer coordinates, accumulated since the last planning tick. */
  private dirtyMinNe = 0;
  private dirtyMaxNe = -1;
  private dirtyMinSe = 0;
  private dirtyMaxSe = -1;
  /** True when the next planning tick must rebuild the whole grid, not just dirty sectors. */
  private gridDirtyAll = true;

  /** One flow field per sector, keyed by sector id. */
  private readonly flowFields: Map<SectorId, SectorFlow> = new Map();
  /** Walkable components per sector, rebuilt together with the grid. */
  private readonly sectorComponents: Map<SectorId, SectorComponents> = new Map();
  /** World version at which each sector's components were last computed. */
  private readonly sectorComponentsVersion: Map<SectorId, number> = new Map();
  private flowVersion = -1;

  /** Pulse phase for the target ring, advanced by `step()`. */
  private elapsedMs = 0;

  /** Phase timings behind the performance panel. */
  private readonly perf = new PerfMeter();

  getGrid(): Grid | null {
    return this.grid;
  }

  getCols(): number {
    return this.cols;
  }

  getRows(): number {
    return this.rows;
  }

  getTarget(): Waypoint | null {
    return this.target;
  }

  getMobs(): readonly Mob[] {
    return this.mobs;
  }

  getObstacles(): readonly MovingObstacle[] {
    return this.obstacles;
  }

  getStaticCost(): Uint8Array {
    return this.staticCost;
  }

  /** Flow field per sector — the data behind both steering and the overlay. */
  getFlowFields(): ReadonlyMap<SectorId, SectorFlow> {
    return this.flowFields;
  }

  getElapsedMs(): number {
    return this.elapsedMs;
  }

  /** Timing collector — the render loop feeds it too, the panel reads it. */
  getPerf(): PerfMeter {
    return this.perf;
  }

  getStats(): WorldStats {
    let blocked = 0;
    for (const mob of this.mobs) {
      if (mob.blocked) {
        blocked++;
      }
    }
    return {
      mobs: this.mobs.length,
      obstacles: this.wallCount + this.obstacles.length,
      blocked,
      hasTarget: this.target !== null,
    };
  }

  /**
     * Fit the world to a viewport measured in cells. The grid is rounded up to
     * whole sectors, so it may extend slightly past the visible area.
     */
  resize(viewCols: number, viewRows: number): void {
    const sectorsX = Math.max(1, Math.ceil(viewCols / SECTOR_SIZE));
    const sectorsY = Math.max(1, Math.ceil(viewRows / SECTOR_SIZE));
    if (sectorsX === this.sectorsX && sectorsY === this.sectorsY) {
      return;
    }

    const cols = sectorsX * SECTOR_SIZE;
    const rows = sectorsY * SECTOR_SIZE;

    // Carry painted walls over into the resized layer, and the labyrinth's
    // snapshot with them so it can still be removed. New cells are free in
    // both, so removal leaves them alone.
    const next = resizeLayer(this.staticCost, this.cols, this.rows, cols, rows);
    if (this.labyrinth) {
      this.labyrinth = resizeLayer(this.labyrinth, this.cols, this.rows, cols, rows);
    }

    this.sectorsX = sectorsX;
    this.sectorsY = sectorsY;
    this.cols = cols;
    this.rows = rows;
    this.staticCost = next;
    this.dynamicCost = new Uint8Array(cols * rows);
    this.recountWalls();

    // Mobs and obstacles keep pixel positions when the world shrinks —
    // pull anything now outside the smaller grid back inside, so a mob
    // never freezes forever beyond cellAt's bounds.
    const worldW = cols * CELL_SIZE;
    const worldH = rows * CELL_SIZE;
    for (const mob of this.mobs) {
      mob.x = Math.min(Math.max(mob.x, CELL_SIZE / 2), worldW - CELL_SIZE / 2);
      mob.y = Math.min(Math.max(mob.y, CELL_SIZE / 2), worldH - CELL_SIZE / 2);
    }
    for (const o of this.obstacles) {
      const margin = o.size / 2 + 2;
      o.x = Math.min(Math.max(o.x, margin), worldW - margin);
      o.y = Math.min(Math.max(o.y, margin), worldH - margin);
      if (o.patrol) {
        o.patrol.ax = Math.min(Math.max(o.patrol.ax, margin), worldW - margin);
        o.patrol.ay = Math.min(Math.max(o.patrol.ay, margin), worldH - margin);
        o.patrol.bx = Math.min(Math.max(o.patrol.bx, margin), worldW - margin);
        o.patrol.by = Math.min(Math.max(o.patrol.by, margin), worldH - margin);
      }
    }

    // The target is a cell, not a pixel position: pull it back inside as
    // well, onto the nearest free cell if the clamped one is a wall. Left
    // outside, no sector would hold it and every mob would turn blocked.
    if (this.target && (this.target.ne >= cols || this.target.se >= rows)) {
      const clamped = { ne: Math.min(this.target.ne, cols - 1), se: Math.min(this.target.se, rows - 1) };
      this.target = this.nearestFreeCell(clamped);
    }

    // The layer size changed, so the grid needs a full rebuild.
    this.gridDirtyAll = true;
    this.markCellsDirty(0, 0, cols - 1, rows - 1);
  }

  reset(): void {
    this.staticCost.fill(COST_MIN);
    this.wallCount = 0;
    this.labyrinth = null;
    this.mobs.length = 0;
    this.obstacles.length = 0;
    this.patrolAnchor = null;
    this.target = null;
    this.gridDirtyAll = true;
    this.markCellsDirty(0, 0, this.cols - 1, this.rows - 1);
  }

  /**
     * Overwrite the wall layer with a randomly generated labyrinth: a
     * randomized depth-first backtracker over the odd-cell lattice, then
     * loosened up — some passages widen to two lanes, dead ends braid into
     * loops, and a few small open rooms are carved. Corridor widths vary
     * between one and two cells, walls between one and a few cells.
     *
     * The loosening passes only ever carve, never stamp, so the walkable
     * cells stay fully connected: everything the DFS reached stays
     * reachable, and every carve joins onto it.
     *
     * Every existing obstacle — painted walls, moving and patrolling
     * obstacles, a half-placed patrol route — is removed first; the UI asks
     * for confirmation before calling this. The target and mobs stay: the
     * target cell, every cell a mob's body overlaps and every mob's spawn
     * cell are kept free together with their four neighbours, and each gets
     * a passage to the nearest lattice cell, so nothing is buried and every
     * one of them can reach every other.
     */
  generateLabyrinth(): void {
    if (this.cols === 0 || this.rows === 0) {
      return;
    }

    const mazeW = Math.floor((this.cols - 1) / 2);
    const mazeH = Math.floor((this.rows - 1) / 2);
    if (mazeW < 1 || mazeH < 1) {
      return;
    }

    const inWorld = (ne: number, se: number) => ne >= 0 && se >= 0 && ne < this.cols && se < this.rows;
    const carve = (ne: number, se: number) => {
      this.staticCost[ne + se * this.cols] = COST_MIN;
    };

    // The labyrinth replaces every obstacle; painted walls go with the
    // fill below.
    this.obstacles.length = 0;
    this.patrolAnchor = null;

    // Everything is wall first; the walk carves corridors and the
    // passages between them.
    this.staticCost.fill(COST_IMPASSABLE);

    const carveLattice = (idx: number) => {
      const ne = ((idx % mazeW) * 2 + 1) | 0;
      const se = (Math.floor(idx / mazeW) * 2 + 1) | 0;
      this.staticCost[ne + se * this.cols] = COST_MIN;
    };

    const visited = new Uint8Array(mazeW * mazeH);
    const start = Math.floor(Math.random() * mazeW * mazeH);
    visited[start] = 1;
    carveLattice(start);

    const stack: number[] = [start];
    while (stack.length > 0) {
      const current = stack[stack.length - 1]!;
      const ci = current % mazeW;
      const cj = Math.floor(current / mazeW);

      const candidates: number[] = [];
      if (ci > 0 && !visited[current - 1]) {
        candidates.push(current - 1);
      }
      if (ci < mazeW - 1 && !visited[current + 1]) {
        candidates.push(current + 1);
      }
      if (cj > 0 && !visited[current - mazeW]) {
        candidates.push(current - mazeW);
      }
      if (cj < mazeH - 1 && !visited[current + mazeW]) {
        candidates.push(current + mazeW);
      }

      if (candidates.length === 0) {
        stack.pop();
        continue;
      }

      const next = candidates[Math.floor(Math.random() * candidates.length)]!;
      visited[next] = 1;
      carveLattice(next);

      // The passage is the even cell between both lattice cells…
      const passageNe = ci + (next % mazeW) + 1;
      const passageSe = cj + Math.floor(next / mazeW) + 1;
      carve(passageNe, passageSe);

      // …and sometimes grows a second lane alongside, doubling the
      // corridor for its whole lattice step.
      if (Math.random() < MAZE_WIDEN_CHANCE) {
        const horizontal = passageSe % 2 === 1;
        const offNe = horizontal ? 0 : 1;
        const offSe = horizontal ? 1 : 0;
        for (const [dn, ds] of [
          [-offNe, -offSe],
          [offNe, offSe],
        ] as const) {
          const wNe = passageNe + dn;
          const wSe = passageSe + ds;
          if (inWorld(wNe, wSe)) {
            carve(wNe, wSe);
          }
        }
      }

      stack.push(next);
    }

    // A few open rooms on the lattice, so the maze has places to breathe.
    const rooms = Math.floor(mazeW * mazeH * MAZE_ROOM_DENSITY);
    for (let r = 0; r < rooms; r++) {
      const extent = MAZE_ROOM_MIN + Math.floor(Math.random() * (MAZE_ROOM_MAX - MAZE_ROOM_MIN + 1));
      const li = Math.floor(Math.random() * (mazeW - extent + 1));
      const lj = Math.floor(Math.random() * (mazeH - extent + 1));
      // The room spans `2 * extent - 1` cells with the lattice cell
      // `li, lj` as its odd/odd corner.
      for (let se = 2 * lj; se <= 2 * (lj + extent - 1); se++) {
        for (let ne = 2 * li; ne <= 2 * (li + extent - 1); ne++) {
          if (inWorld(ne, se)) {
            carve(ne, se);
          }
        }
      }
    }

    // Braiding: a dead-end lattice cell opens one wall towards a free
    // neighbour, turning dangling corridors into loops.
    for (let idx = 0; idx < mazeW * mazeH; idx++) {
      const ci = idx % mazeW;
      const cj = Math.floor(idx / mazeW);
      const ne = ci * 2 + 1;
      const se = cj * 2 + 1;

      let free = 0;
      if (inWorld(ne - 1, se) && this.staticCost[ne - 1 + se * this.cols] === COST_MIN) {
        free++;
      }
      if (inWorld(ne + 1, se) && this.staticCost[ne + 1 + se * this.cols] === COST_MIN) {
        free++;
      }
      if (inWorld(ne, se - 1) && this.staticCost[ne + (se - 1) * this.cols] === COST_MIN) {
        free++;
      }
      if (inWorld(ne, se + 1) && this.staticCost[ne + (se + 1) * this.cols] === COST_MIN) {
        free++;
      }
      if (free > 1 || Math.random() >= MAZE_BRAID_CHANCE) {
        continue;
      }

      const options: Array<[number, number]> = [];
      for (const [dn, ds] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const) {
        const wNe = ne + dn * 2;
        const wSe = se + ds * 2;
        // The wall's far side must be a lattice cell — walls widened
        // to two lanes or room rims never braid, their far side is
        // already free.
        if (!inWorld(wNe, wSe) || wNe % 2 !== 1 || wSe % 2 !== 1) {
          continue;
        }
        if (this.staticCost[wNe + wSe * this.cols] === COST_MIN) {
          options.push([dn, ds]);
        }
      }
      if (options.length > 0) {
        const [dn, ds] = options[Math.floor(Math.random() * options.length)]!;
        carve(ne + dn, se + ds);
      }
    }

    // Objects keep their footing: their cells and direct neighbours stay
    // free, and each such pocket gets an L-shaped, 4-connected passage to
    // the nearest lattice cell. Every lattice cell is on the DFS tree, so
    // that connects the pocket to every other one — also near the right and
    // bottom edges, where the lattice stops short of the last column or row.
    const keepClear = (ne: number, se: number) => {
      if (!inWorld(ne, se)) {
        return;
      }
      this.staticCost[ne + se * this.cols] = COST_MIN;
    };
    const nearestLattice = (v: number, size: number) => Math.min(Math.max(v % 2 === 1 ? v : v - 1, 1), size * 2 - 1);
    const anchor = (ne: number, se: number) => {
      if (!inWorld(ne, se)) {
        return;
      }
      keepClear(ne, se);
      keepClear(ne - 1, se);
      keepClear(ne + 1, se);
      keepClear(ne, se - 1);
      keepClear(ne, se + 1);
      const toNe = nearestLattice(ne, mazeW);
      const toSe = nearestLattice(se, mazeH);
      for (let n = Math.min(ne, toNe); n <= Math.max(ne, toNe); n++) {
        keepClear(n, se);
      }
      for (let s = Math.min(se, toSe); s <= Math.max(se, toSe); s++) {
        keepClear(toNe, s);
      }
    };

    if (this.target) {
      anchor(this.target.ne, this.target.se);
    }
    for (const mob of this.mobs) {
      // Every cell the mob's body overlaps, not just its centre — a mob
      // standing near a cell edge must not end up half inside a wall.
      const neStart = Math.floor((mob.x - MOB_RADIUS) / CELL_SIZE);
      const neEnd = Math.floor((mob.x + MOB_RADIUS) / CELL_SIZE);
      const seStart = Math.floor((mob.y - MOB_RADIUS) / CELL_SIZE);
      const seEnd = Math.floor((mob.y + MOB_RADIUS) / CELL_SIZE);
      for (let se = seStart; se <= seEnd; se++) {
        for (let ne = neStart; ne <= neEnd; ne++) {
          anchor(ne, se);
        }
      }
      // The spawn point too: a mob returns there after reaching the target.
      const spawn = this.cellAt(mob.spawnX, mob.spawnY);
      if (spawn) {
        anchor(spawn.ne, spawn.se);
      }
    }

    this.labyrinth = this.staticCost.slice();
    this.recountWalls();
    this.markCellsDirty(0, 0, this.cols - 1, this.rows - 1);
  }

  /** True while a generated labyrinth is active and can be removed. */
  hasLabyrinth(): boolean {
    return this.labyrinth !== null;
  }

  /**
     * Undo the active labyrinth: every cell it walled that is still a wall
     * turns free. Walls painted or scattered since onto cells the labyrinth
     * left free stay. The obstacles removed by `generateLabyrinth()` do not
     * come back.
     */
  removeLabyrinth(): void {
    const labyrinth = this.labyrinth;
    if (!labyrinth) {
      return;
    }
    this.labyrinth = null;

    for (let idx = 0; idx < this.staticCost.length; idx++) {
      if (labyrinth[idx] === COST_IMPASSABLE && this.staticCost[idx] === COST_IMPASSABLE) {
        this.staticCost[idx] = COST_MIN;
      }
    }

    this.recountWalls();
    this.markCellsDirty(0, 0, this.cols - 1, this.rows - 1);
  }

  /**
     * Scatter random wall segments and corridors around the target: no
     * closed maze, just loose obstacles. Everything within `SCATTER_RADIUS`
     * cells of the target is rewritten — walls cleared first, then short
     * straight segments stamped until roughly `SCATTER_WALL_DENSITY` of the
     * area is wall.
     *
     * The target, mobs and moving obstacles keep their cells plus the four
     * neighbours free (no object buried, every pocket open), and a straight
     * corridor is carved from the target to every mob inside the area — so a
     * route to the target always exists, whatever the dice rolled.
     *
     * Returns false when there is no target yet or the world is empty.
     */
  scatterWallsAroundTarget(): boolean {
    const target = this.target;
    if (!target || this.cols === 0 || this.rows === 0) {
      return false;
    }

    const minNe = Math.max(0, target.ne - SCATTER_RADIUS);
    const maxNe = Math.min(this.cols - 1, target.ne + SCATTER_RADIUS);
    const minSe = Math.max(0, target.se - SCATTER_RADIUS);
    const maxSe = Math.min(this.rows - 1, target.se + SCATTER_RADIUS);

    // Start from a clean slate inside the scatter area.
    for (let se = minSe; se <= maxSe; se++) {
      for (let ne = minNe; ne <= maxNe; ne++) {
        this.staticCost[ne + se * this.cols] = COST_MIN;
      }
    }

    const protectedSet = new Set<number>();
    const keepFree = (ne: number, se: number) => {
      if (ne < 0 || se < 0 || ne >= this.cols || se >= this.rows) {
        return;
      }
      protectedSet.add(ne + se * this.cols);
    };
    const protectAround = (ne: number, se: number) => {
      keepFree(ne, se);
      keepFree(ne - 1, se);
      keepFree(ne + 1, se);
      keepFree(ne, se - 1);
      keepFree(ne, se + 1);
    };

    protectAround(target.ne, target.se);
    for (const mob of this.mobs) {
      const cell = this.cellAt(mob.x, mob.y);
      if (cell) {
        protectAround(cell.ne, cell.se);
      }
    }
    for (const o of this.obstacles) {
      const half = o.size / 2;
      const neStart = Math.max(0, Math.floor((o.x - half) / CELL_SIZE));
      const neEnd = Math.min(this.cols - 1, Math.floor((o.x + half) / CELL_SIZE));
      const seStart = Math.max(0, Math.floor((o.y - half) / CELL_SIZE));
      const seEnd = Math.min(this.rows - 1, Math.floor((o.y + half) / CELL_SIZE));
      for (let se = seStart; se <= seEnd; se++) {
        for (let ne = neStart; ne <= neEnd; ne++) {
          protectAround(ne, se);
        }
      }
    }

    const area = (maxNe - minNe + 1) * (maxSe - minSe + 1);
    const wallBudget = Math.floor(area * SCATTER_WALL_DENSITY);

    // Stamp random straight segments until the density target is met.
    let stamped = 0;
    let guard = 0;
    while (stamped < wallBudget && guard < wallBudget * 20) {
      guard++;
      const horizontal = Math.random() < 0.5;
      const len = SCATTER_SEGMENT_MIN + Math.floor(Math.random() * (SCATTER_SEGMENT_MAX - SCATTER_SEGMENT_MIN + 1));
      const ne = minNe + Math.floor(Math.random() * (maxNe - minNe + 1));
      const se = minSe + Math.floor(Math.random() * (maxSe - minSe + 1));

      for (let i = 0; i < len; i++) {
        const cNe = horizontal ? ne + i : ne;
        const cSe = horizontal ? se : se + i;
        if (cNe < minNe || cNe > maxNe || cSe < minSe || cSe > maxSe) {
          break;
        }
        const idx = cNe + cSe * this.cols;
        if (this.staticCost[idx] === COST_IMPASSABLE || protectedSet.has(idx)) {
          continue;
        }
        this.staticCost[idx] = COST_IMPASSABLE;
        stamped++;
      }
    }

    // Corridor from the target to every mob inside the area, so the flow
    // fields always find a route no matter how the segments landed.
    for (const mob of this.mobs) {
      const cell = this.cellAt(mob.x, mob.y);
      if (!cell) {
        continue;
      }
      if (Math.abs(cell.ne - target.ne) > SCATTER_RADIUS || Math.abs(cell.se - target.se) > SCATTER_RADIUS) {
        continue;
      }
      this.carveCorridor(target.ne, target.se, cell.ne, cell.se);
    }

    this.recountWalls();
    this.markCellsDirty(minNe, minSe, maxNe, maxSe);
    return true;
  }

  /** Clear the cells along the straight line between two points (Bresenham). */
  private carveCorridor(fromNe: number, fromSe: number, toNe: number, toSe: number): void {
    let ne = fromNe;
    let se = fromSe;
    const dNe = Math.abs(toNe - fromNe);
    const dSe = Math.abs(toSe - fromSe);
    const sNe = fromNe < toNe ? 1 : -1;
    const sSe = fromSe < toSe ? 1 : -1;
    let err = dNe - dSe;

    for (;;) {
      this.staticCost[ne + se * this.cols] = COST_MIN;
      if (ne === toNe && se === toSe) {
        break;
      }
      const e2 = 2 * err;
      if (e2 > -dSe) {
        err -= dSe;
        ne += sNe;
      }
      if (e2 < dNe) {
        err += dNe;
        se += sSe;
      }
    }
  }

  /**
     * Recount the wall cells after a bulk rewrite of the wall layer (resize,
     * labyrinth, scatter). Single-cell edits adjust `wallCount` directly.
     */
  private recountWalls(): void {
    let walls = 0;
    for (let i = 0; i < this.staticCost.length; i++) {
      if (this.staticCost[i] === COST_IMPASSABLE) {
        walls++;
      }
    }
    this.wallCount = walls;
  }

  /** Place the target at a pixel position. Only free cells are valid. Returns true when placed. */
  setTargetAt(px: number, py: number): boolean {
    if (!this.canPlaceTarget(px, py)) {
      return false;
    }
    this.target = this.cellAt(px, py)!;
    this.markDirty();
    return true;
  }

  /** Spawn a mob at a pixel position. Only free cells are valid. */
  addMob(px: number, py: number): void {
    if (!this.canPlaceMob(px, py)) {
      return;
    }
    this.mobs.push({
      x: px,
      y: py,
      spawnX: px,
      spawnY: py,
      speed: MOB_SPEED_MIN + Math.random() * (MOB_SPEED_MAX - MOB_SPEED_MIN),
      trace: [],
      traceVersion: -1,
      blocked: false,
    });
  }

  /** Paint a wall cell. Drag-painting calls this repeatedly. Only free cells are valid. */
  paintWall(px: number, py: number): void {
    if (!this.canPlaceWall(px, py)) {
      return;
    }
    const cell = this.cellAt(px, py)!;
    const idx = cell.ne + cell.se * this.cols;
    if (this.staticCost[idx] !== COST_IMPASSABLE) {
      this.wallCount++;
    }
    this.staticCost[idx] = COST_IMPASSABLE;
    this.markCellsDirty(cell.ne, cell.se, cell.ne, cell.se);
  }

  /** Erase a wall cell. Right-click erasing calls this repeatedly. */
  eraseWall(px: number, py: number): void {
    const cell = this.cellAt(px, py);
    if (!cell) {
      return;
    }
    const idx = cell.ne + cell.se * this.cols;
    if (this.staticCost[idx] !== COST_IMPASSABLE) {
      return;
    }
    this.staticCost[idx] = COST_MIN;
    this.wallCount--;
    this.markCellsDirty(cell.ne, cell.se, cell.ne, cell.se);
  }

  addMovingObstacle(px: number, py: number): void {
    if (!this.canPlaceMovingObstacle(px, py)) {
      return;
    }
    this.obstacles.push({
      x: px,
      y: py,
      angle: Math.random() * Math.PI * 2,
      speed: OBSTACLE_SPEED,
      size: OBSTACLE_SIZE,
      patrol: null,
      headingToB: true,
    });
    this.markObstacleCellsDirty(px, py, OBSTACLE_SIZE);
  }

  /** First endpoint of the patrol route being placed, null once complete or cancelled. */
  getPatrolAnchor(): { x: number, y: number } | null {
    return this.patrolAnchor;
  }

  /**
     * First click of the patrol placement: anchors endpoint A. The second
     * click (`addPatrolObstacle`) sets endpoint B and spawns the obstacle.
     */
  beginPatrolObstacle(px: number, py: number): void {
    if (!this.canPlacePatrolObstacle(px, py)) {
      return;
    }
    this.patrolAnchor = { x: px, y: py };
  }

  /**
     * Second click of the patrol placement: sets endpoint B and spawns an
     * obstacle pendling between A and B. Without an anchor it begins the
     * route instead. Returns true when the obstacle was spawned.
     */
  addPatrolObstacle(px: number, py: number): boolean {
    const anchor = this.patrolAnchor;
    if (!anchor) {
      this.beginPatrolObstacle(px, py);
      return false;
    }
    if (!this.canPlacePatrolObstacle(px, py)) {
      return false;
    }

    this.obstacles.push({
      x: anchor.x,
      y: anchor.y,
      angle: 0,
      speed: OBSTACLE_SPEED,
      size: OBSTACLE_SIZE,
      patrol: { ax: anchor.x, ay: anchor.y, bx: px, by: py },
      headingToB: true,
    });
    this.patrolAnchor = null;
    this.markObstacleCellsDirty(anchor.x, anchor.y, OBSTACLE_SIZE);
    return true;
  }

  /** Abandon a half-placed patrol route (mode switch, pointer leaving the canvas). */
  cancelPatrolAnchor(): void {
    this.patrolAnchor = null;
  }

  /**
     * True when a patrol endpoint can sit at the pixel position: the click
     * must be inside the world and the endpoint's obstacle-sized box must not
     * cover the target or another obstacle. Walls are allowed — the patrol
     * slides along them like a free-floating obstacle.
     */
  canPlacePatrolObstacle(px: number, py: number): boolean {
    if (!this.cellAt(px, py)) {
      return false;
    }
    if (this.coversTarget(px, py)) {
      return false;
    }
    const half = OBSTACLE_SIZE / 2;
    for (const o of this.obstacles) {
      const dx = Math.abs(o.x - px);
      const dy = Math.abs(o.y - py);
      if (dx < half + o.size / 2 && dy < half + o.size / 2) {
        return false;
      }
    }
    return true;
  }

  /** Remove the moving obstacle covering the position, if any. */
  removeMovingObstacle(px: number, py: number): void {
    const idx = this.obstacles.findIndex(o => coversObstacle(o, px, py));
    if (idx < 0) {
      return;
    }
    const removed = this.obstacles.splice(idx, 1)[0];
    if (removed === undefined) {
      return;
    }
    this.markObstacleCellsDirty(removed.x, removed.y, removed.size);
  }

  /** Remove the mob covering the position, if any. */
  removeMob(px: number, py: number): void {
    const next = this.mobs.filter(m => Math.hypot(m.x - px, m.y - py) > MOB_RADIUS);
    if (next.length === this.mobs.length) {
      return;
    }
    this.mobs.length = 0;
    this.mobs.push(...next);
  }

  // --- Placement previews: the predicates behind the canvas cursor overlay. ---

  /**
     * True when the cell is taken: wall, moving obstacle, target or mob —
     * nothing can be placed on top of another object.
     */
  private cellOccupied(ne: number, se: number): boolean {
    if (this.cellBlocked(ne, se)) {
      return true;
    }
    if (this.target && this.target.ne === ne && this.target.se === se) {
      return true;
    }

    for (const m of this.mobs) {
      if (Math.floor(m.x / CELL_SIZE) === ne && Math.floor(m.y / CELL_SIZE) === se) {
        return true;
      }
    }

    return false;
  }

  /**
     * True when a cell is impassable to mobs: outside the world, a painted wall
     * or a cell currently covered by a moving obstacle. Checked against live
     * positions, not the cost layer — that is only re-stamped on the planning
     * tick, and steering must react between ticks.
     */
  private cellBlocked(ne: number, se: number): boolean {
    if (ne < 0 || se < 0 || ne >= this.cols || se >= this.rows) {
      return true;
    }
    if (this.staticCost[ne + se * this.cols] === COST_IMPASSABLE) {
      return true;
    }
    for (const o of this.obstacles) {
      const half = o.size / 2;
      if (
        ne >= Math.floor((o.x - half) / CELL_SIZE)
        && ne <= Math.floor((o.x + half) / CELL_SIZE)
        && se >= Math.floor((o.y - half) / CELL_SIZE)
        && se <= Math.floor((o.y + half) / CELL_SIZE)
      ) {
        return true;
      }
    }
    return false;
  }

  /** True when the target can be placed at the pixel position. */
  canPlaceTarget(px: number, py: number): boolean {
    const cell = this.cellAt(px, py);
    if (!cell) {
      return false;
    }
    return !this.cellOccupied(cell.ne, cell.se);
  }

  /** True when a mob can be spawned at the pixel position. */
  canPlaceMob(px: number, py: number): boolean {
    const cell = this.cellAt(px, py);
    if (!cell) {
      return false;
    }
    return !this.cellOccupied(cell.ne, cell.se);
  }

  /** True when a wall can be painted at the pixel position. */
  canPlaceWall(px: number, py: number): boolean {
    const cell = this.cellAt(px, py);
    if (!cell) {
      return false;
    }
    return !this.cellOccupied(cell.ne, cell.se);
  }

  /**
     * True when a moving obstacle can be added at the pixel position: every
     * cell its box covers must be free.
     */
  canPlaceMovingObstacle(px: number, py: number): boolean {
    if (!this.cellAt(px, py)) {
      return false;
    }
    const half = OBSTACLE_SIZE / 2;
    const neStart = Math.max(0, Math.floor((px - half) / CELL_SIZE));
    const neEnd = Math.min(this.cols - 1, Math.floor((px + half) / CELL_SIZE));
    const seStart = Math.max(0, Math.floor((py - half) / CELL_SIZE));
    const seEnd = Math.min(this.rows - 1, Math.floor((py + half) / CELL_SIZE));
    for (let se = seStart; se <= seEnd; se++) {
      for (let ne = neStart; ne <= neEnd; ne++) {
        if (this.cellOccupied(ne, se)) {
          return false;
        }
      }
    }
    return true;
  }

  /** Wall cell at the pixel position — the erase candidate of the obstacle mode. */
  wallAt(px: number, py: number): Waypoint | null {
    const cell = this.cellAt(px, py);
    if (!cell) {
      return null;
    }
    if (this.staticCost[cell.ne + cell.se * this.cols] !== COST_IMPASSABLE) {
      return null;
    }
    return cell;
  }

  /** Moving obstacle covering the pixel position, if any. */
  movingObstacleAt(px: number, py: number): MovingObstacle | null {
    for (const o of this.obstacles) {
      if (coversObstacle(o, px, py)) {
        return o;
      }
    }
    return null;
  }

  /** Mob covering the pixel position, if any. */
  mobAt(px: number, py: number): Mob | null {
    for (const m of this.mobs) {
      if (Math.hypot(m.x - px, m.y - py) <= MOB_RADIUS) {
        return m;
      }
    }
    return null;
  }

  /**
     * Advance the simulation. Movement runs every frame; grid rebuild and
     * flow-field refresh run on the slower planning tick.
     */
  step(dtMs: number, nowMs: number): void {
    const dt = Math.min(dtMs, 50) / 1000;
    this.elapsedMs += dtMs;

    this.perf.begin('Obstacles');
    this.moveObstacles(dt);
    this.perf.end('Obstacles');

    this.plan(nowMs);

    this.perf.begin('Mobs');
    this.moveMobs(dt);
    this.perf.end('Mobs');
  }

  private markDirty(): void {
    this.costDirty = true;
    this.version++;
  }

  /**
     * Mark a cell range as changed and invalidate the flow fields. The range
     * is accumulated across frames and consumed by the planning tick, which
     * rebuilds only the sectors under it.
     */
  private markCellsDirty(minNe: number, minSe: number, maxNe: number, maxSe: number): void {
    if (this.dirtyMaxNe < this.dirtyMinNe) {
      this.dirtyMinNe = minNe;
      this.dirtyMaxNe = maxNe;
      this.dirtyMinSe = minSe;
      this.dirtyMaxSe = maxSe;
    }
    else {
      this.dirtyMinNe = Math.min(this.dirtyMinNe, minNe);
      this.dirtyMaxNe = Math.max(this.dirtyMaxNe, maxNe);
      this.dirtyMinSe = Math.min(this.dirtyMinSe, minSe);
      this.dirtyMaxSe = Math.max(this.dirtyMaxSe, maxSe);
    }
    this.costDirty = true;
    this.version++;
  }

  /** Mark the cells covered by an obstacle's bounding box as dirty. */
  private markObstacleCellsDirty(px: number, py: number, size: number): void {
    const half = size / 2;
    const neStart = Math.max(0, Math.floor((px - half) / CELL_SIZE));
    const neEnd = Math.min(this.cols - 1, Math.floor((px + half) / CELL_SIZE));
    const seStart = Math.max(0, Math.floor((py - half) / CELL_SIZE));
    const seEnd = Math.min(this.rows - 1, Math.floor((py + half) / CELL_SIZE));
    if (neEnd < neStart || seEnd < seStart) {
      return;
    }
    this.markCellsDirty(neStart, seStart, neEnd, seEnd);
  }

  /** True when a cell range is tracked as dirty, and its covering sectors. */
  private popDirtySectors(): Sector[] | null {
    if (this.dirtyMaxNe < this.dirtyMinNe || !this.grid) {
      this.dirtyMinNe = 0;
      this.dirtyMaxNe = -1;
      return null;
    }

    const minSectorX = Math.floor(this.dirtyMinNe / SECTOR_SIZE);
    const maxSectorX = Math.floor(this.dirtyMaxNe / SECTOR_SIZE);
    const minSectorY = Math.floor(this.dirtyMinSe / SECTOR_SIZE);
    const maxSectorY = Math.floor(this.dirtyMaxSe / SECTOR_SIZE);

    const sectors: Sector[] = [];
    for (let sy = minSectorY; sy <= maxSectorY; sy++) {
      for (let sx = minSectorX; sx <= maxSectorX; sx++) {
        const sector = this.grid.getSector(sx, sy);
        if (sector) {
          sectors.push(sector);
        }
      }
    }

    this.dirtyMinNe = 0;
    this.dirtyMaxNe = -1;
    return sectors;
  }

  private cellAt(px: number, py: number): Waypoint | null {
    const ne = Math.floor(px / CELL_SIZE);
    const se = Math.floor(py / CELL_SIZE);
    if (ne < 0 || se < 0 || ne >= this.cols || se >= this.rows) {
      return null;
    }
    return { ne, se };
  }

  /** True when an obstacle-sized box at (px, py) overlaps the target cell. */
  private coversTarget(px: number, py: number): boolean {
    const target = this.target;
    if (!target) {
      return false;
    }
    const half = OBSTACLE_SIZE / 2;
    return (
      target.ne >= Math.floor((px - half) / CELL_SIZE)
      && target.ne <= Math.floor((px + half) / CELL_SIZE)
      && target.se >= Math.floor((py - half) / CELL_SIZE)
      && target.se <= Math.floor((py + half) / CELL_SIZE)
    );
  }

  /** True when a position is blocked for a moving obstacle: wall or target cell. */
  private blockedForObstacle(px: number, py: number): boolean {
    return this.hitsWall(px, py) || this.coversTarget(px, py);
  }

  private moveObstacles(dt: number): void {
    const w = this.cols * CELL_SIZE;
    const h = this.rows * CELL_SIZE;
    const margin = OBSTACLE_SIZE / 2 + 2;

    for (const o of this.obstacles) {
      const prevNe = Math.floor(o.x / CELL_SIZE);
      const prevSe = Math.floor(o.y / CELL_SIZE);
      // A wall painted on top of an obstacle must not trap it: moves out of
      // an already-hit wall are allowed, only fresh entries bounce.
      const stuck = this.hitsWall(o.x, o.y);

      if (o.patrol) {
        this.movePatrolObstacle(o, stuck, dt);
      }
      else {
        const stepX = Math.cos(o.angle) * o.speed * dt;
        const stepY = Math.sin(o.angle) * o.speed * dt;

        // Walls and the target cell are checked one axis at a time, so a
        // diagonal hit still lets the obstacle slide along the blocker
        // instead of sticking to it.
        o.x += stepX;
        if (!stuck && this.blockedForObstacle(o.x, o.y)) {
          o.x -= stepX;
          o.angle = Math.PI - o.angle;
        }

        o.y += stepY;
        if (!stuck && this.blockedForObstacle(o.x, o.y)) {
          o.y -= stepY;
          o.angle = -o.angle;
        }

        // Bounce off the world edges.
        if (o.x < margin || o.x > w - margin) {
          o.angle = Math.PI - o.angle;
          o.x = Math.min(Math.max(o.x, margin), w - margin);
        }
        if (o.y < margin || o.y > h - margin) {
          o.angle = -o.angle;
          o.y = Math.min(Math.max(o.y, margin), h - margin);
        }
      }

      // Only a cell change alters the cost layer, so only that needs a rebuild.
      const nextNe = Math.floor(o.x / CELL_SIZE);
      const nextSe = Math.floor(o.y / CELL_SIZE);
      if (nextNe !== prevNe || nextSe !== prevSe) {
        // Both the cells the box left and the ones it now covers changed.
        const half = o.size / 2;
        const minNe = Math.max(0, Math.min(prevNe, nextNe) - Math.ceil(half / CELL_SIZE));
        const maxNe = Math.min(this.cols - 1, Math.max(prevNe, nextNe) + Math.ceil(half / CELL_SIZE));
        const minSe = Math.max(0, Math.min(prevSe, nextSe) - Math.ceil(half / CELL_SIZE));
        const maxSe = Math.min(this.rows - 1, Math.max(prevSe, nextSe) + Math.ceil(half / CELL_SIZE));
        this.markCellsDirty(minNe, minSe, maxNe, maxSe);
      }
    }
  }

  /**
     * Move a patrolling obstacle along its route, at most to the endpoint it
     * is heading for — the remainder of a frame's step carries into the swing
     * back, so the speed stays constant through the turn. Walls block like
     * they do for free-floating obstacles: the slide stops at the blocker and
     * continues (or turns) once it is past.
     */
  private movePatrolObstacle(o: MovingObstacle, stuck: boolean, dt: number): void {
    const route = o.patrol!;
    let remaining = o.speed * dt;

    // Turn leftovers of an oversized frame step into the next swing.
    while (remaining > 0) {
      const toX = o.headingToB ? route.bx : route.ax;
      const toY = o.headingToB ? route.by : route.ay;
      const dx = toX - o.x;
      const dy = toY - o.y;
      const dist = Math.hypot(dx, dy);

      if (dist <= remaining) {
        o.x = toX;
        o.y = toY;
        remaining -= dist;
        o.headingToB = !o.headingToB;
        // A degenerate route (both endpoints equal) must not spin the loop.
        if (dist < 0.001) {
          break;
        }
        continue;
      }

      const stepX = (dx / dist) * remaining;
      const stepY = (dy / dist) * remaining;

      o.x += stepX;
      if (!stuck && this.blockedForObstacle(o.x, o.y)) {
        o.x -= stepX;
        break;
      }

      o.y += stepY;
      if (!stuck && this.blockedForObstacle(o.x, o.y)) {
        o.y -= stepY;
        break;
      }

      remaining = 0;
    }
  }

  private plan(nowMs: number): void {
    if (nowMs - this.lastPlanMs < PLAN_INTERVAL_MS) {
      return;
    }
    this.lastPlanMs = nowMs;

    if (this.costDirty) {
      this.costDirty = false;
      this.perf.begin('Grid');
      this.rebuildGrid();
      this.perf.end('Grid');
    }

    this.refreshFlowFields();

    this.updateGraphCounters();

    if (this.mobs.length === 0) {
      this.perf.setCounter('Traces', 0);
      return;
    }

    // Round-robin, so a large crowd spreads over ticks. Mobs whose trace
    // predates the current version go first: a fresh spawn (traceVersion
    // -1) or a mob whose route a repaint invalidated must not wait a full
    // round-robin cycle for its first valid flow.
    const staleFirst: Mob[] = [];
    const rest: Mob[] = [];
    for (const mob of this.mobs) {
      (mob.traceVersion < this.version ? staleFirst : rest).push(mob);
    }

    this.perf.begin('Traces');
    let traced = 0;
    for (const mob of staleFirst) {
      if (traced >= TRACES_PER_TICK) {
        break;
      }
      this.traceMob(mob);
      traced++;
    }
    // The round-robin cursor only walks the up-to-date mobs, so it never
    // skips past the stale ones above.
    const roundRobin = Math.min(TRACES_PER_TICK - traced, rest.length);
    for (let i = 0; i < roundRobin; i++) {
      this.traceMob(rest[(this.traceCursor + i) % rest.length]!);
    }
    traced += roundRobin;
    this.perf.end('Traces');
    this.perf.setCounter('Traces', traced);
    if (rest.length > 0) {
      this.traceCursor = (this.traceCursor + roundRobin) % rest.length;
    }
  }

  /**
     * Sync the grid to the current cost layer, rebuilding only the sectors under
     * the dirty cells.
     */
  private rebuildGrid(): void {
    if (this.cols === 0 || this.rows === 0) {
      return;
    }

    // First build ever, or the layer size changed — create every sector from scratch.
    const dirtyAll = this.gridDirtyAll;
    this.gridDirtyAll = false;
    if (!this.grid || dirtyAll) {
      this.dirtyMinNe = 0;
      this.dirtyMaxNe = -1;
      this.restampAndBuildFullGrid();
      return;
    }

    const dirtySectors = this.popDirtySectors() ?? [];
    if (dirtySectors.length === 0) {
      // No cell changed (e.g. a target move): the cost fields and portals
      // are current.
      return;
    }

    // Cells that left an obstacle's box turn walkable again; cells it now
    // covers turn impassable. Everything else keeps its stamped value.
    this.restampDirtyCells(dirtySectors);

    // Hand every cell of the dirty sectors to the grid. updateCosts writes
    // only cells whose cost differs, through setCost(), so each touched
    // CostField bumps its version; sectors left unchanged keep theirs.
    const rect = this.dirtyRectOf(dirtySectors);
    const changes: { ne: number, se: number, cost: number }[] = [];
    for (let se = rect.minSe; se <= rect.maxSe; se++) {
      for (let ne = rect.minNe; ne <= rect.maxNe; ne++) {
        changes.push({ ne, se, cost: this.dynamicCost[ne + se * this.cols]! });
      }
    }
    const changed = this.grid.updateCosts(changes);

    // Components only shift inside the sectors whose costs changed, but a
    // portal change also alters which component a neighbor's portal sits
    // in — recompute components for every sector the update touched.
    for (const id of changed) {
      const sector = this.grid.getSector(id);
      if (sector) {
        this.computeSectorComponents(sector);
      }
    }
  }

  /** Build the initial grid: full cost copy, portals, components, portal nodes. */
  private restampAndBuildFullGrid(): void {
    this.dynamicCost.set(this.staticCost);
    this.stampObstacles();

    const grid = buildGrid(this.dynamicCost, { width: this.cols, height: this.rows }, SECTOR_SIZE);
    this.sectorComponents.clear();
    for (const sector of grid.getSectors()) {
      this.computeSectorComponents(sector);
    }
    // Cached flows refer to the old grid's cost fields, whose versions the
    // fresh ones restart from — never reuse them.
    this.flowFields.clear();
    this.grid = grid;
  }

  /**
     * Re-stamp the dynamic cost layer under the dirty sectors: clear the
     * covered rectangle to the static layer, then stamp every obstacle that
     * intersects it.
     */
  private restampDirtyCells(dirtySectors: Sector[]): void {
    const rect = this.dirtyRectOf(dirtySectors);
    for (let se = rect.minSe; se <= rect.maxSe; se++) {
      const rowStart = se * this.cols;
      for (let ne = rect.minNe; ne <= rect.maxNe; ne++) {
        this.dynamicCost[rowStart + ne] = this.staticCost[rowStart + ne]!;
      }
    }
    for (const o of this.obstacles) {
      const half = o.size / 2;
      const neStart = Math.max(rect.minNe, Math.floor((o.x - half) / CELL_SIZE));
      const neEnd = Math.min(rect.maxNe, Math.floor((o.x + half) / CELL_SIZE));
      const seStart = Math.max(rect.minSe, Math.floor((o.y - half) / CELL_SIZE));
      const seEnd = Math.min(rect.maxSe, Math.floor((o.y + half) / CELL_SIZE));
      if (neEnd < neStart || seEnd < seStart) {
        continue;
      }
      for (let se = seStart; se <= seEnd; se++) {
        for (let ne = neStart; ne <= neEnd; ne++) {
          this.dynamicCost[ne + se * this.cols] = COST_IMPASSABLE;
        }
      }
    }
  }

  /** Bounding rectangle of the dirty sectors, in cells. */
  private dirtyRectOf(dirtySectors: Sector[]): { minNe: number, minSe: number, maxNe: number, maxSe: number } {
    let minNe = this.cols;
    let minSe = this.rows;
    let maxNe = -1;
    let maxSe = -1;
    for (const sector of dirtySectors) {
      const position = sector.getPosition();
      minNe = Math.min(minNe, position.x * SECTOR_SIZE);
      minSe = Math.min(minSe, position.y * SECTOR_SIZE);
      maxNe = Math.max(maxNe, position.x * SECTOR_SIZE + SECTOR_SIZE - 1);
      maxSe = Math.max(maxSe, position.y * SECTOR_SIZE + SECTOR_SIZE - 1);
    }
    return { minNe, minSe, maxNe, maxSe };
  }

  /**
     * Recompute the walkable components of one sector: each one gets its own
     * flow field. Portal exits need no patching, `Sector.connectExits()`
     * already links only portals that reach each other inside the sector.
     */
  private computeSectorComponents(sector: Sector): void {
    const portals = sector.getPortals();
    const cells = componentsOf(sector.getCostField().getCosts());
    const portalComponent: Map<PortalId, number> = new Map();

    for (const portal of portals) {
      for (const cell of entryCells(sector.getId(), portal)) {
        const component = cells[cell.ne + cell.se * SECTOR_SIZE]!;
        if (component >= 0) {
          portalComponent.set(portal.getId(), component);
          break;
        }
      }
    }

    this.sectorComponents.set(sector.getId(), { cells, portalComponent });
    this.sectorComponentsVersion.set(sector.getId(), this.version);
  }

  /** True when any cell covered by the obstacle's bounding box is a wall. */
  private hitsWall(px: number, py: number): boolean {
    const half = OBSTACLE_SIZE / 2;
    const neStart = Math.max(0, Math.floor((px - half) / CELL_SIZE));
    const neEnd = Math.min(this.cols - 1, Math.floor((px + half) / CELL_SIZE));
    const seStart = Math.max(0, Math.floor((py - half) / CELL_SIZE));
    const seEnd = Math.min(this.rows - 1, Math.floor((py + half) / CELL_SIZE));
    for (let se = seStart; se <= seEnd; se++) {
      for (let ne = neStart; ne <= neEnd; ne++) {
        if (this.staticCost[ne + se * this.cols] === COST_IMPASSABLE) {
          return true;
        }
      }
    }
    return false;
  }

  /** Write the cells covered by moving obstacles into the dynamic layer. */
  private stampObstacles(): void {
    for (const o of this.obstacles) {
      const half = o.size / 2;
      const neStart = Math.max(0, Math.floor((o.x - half) / CELL_SIZE));
      const neEnd = Math.min(this.cols - 1, Math.floor((o.x + half) / CELL_SIZE));
      const seStart = Math.max(0, Math.floor((o.y - half) / CELL_SIZE));
      const seEnd = Math.min(this.rows - 1, Math.floor((o.y + half) / CELL_SIZE));
      for (let se = seStart; se <= seEnd; se++) {
        for (let ne = neStart; ne <= neEnd; ne++) {
          this.dynamicCost[ne + se * this.cols] = COST_IMPASSABLE;
        }
      }
    }
  }

  /**
     * Integrate the flow fields every mob follows: one per walkable component of
     * every sector. The component holding the target flows towards it, all
     * others towards the portal that starts their cheapest route to it.
     *
     * Every sector is revisited: a target move or a portal change anywhere can
     * flip which exit is cheapest in a sector far from the change. That is
     * cheap — `buildSectorFlow` re-integrates only components whose sink,
     * cost field or components changed, and keeps the cells of the rest.
     */
  private refreshFlowFields(): void {
    // Timed inside the guard: an unchanged version does no work, and
    // sampling that would average the real integration cost away.
    if (this.flowVersion === this.version) {
      return;
    }
    this.perf.begin('Flow');
    this.flowVersion = this.version;
    let integrations = 0;

    const grid = this.grid;
    const target = this.target;
    if (!grid || !target) {
      this.flowFields.clear();
      this.perf.end('Flow');
      this.perf.setCounter('Fields', 0);
      return;
    }

    const targetSector = grid.getSectorAt(target.ne, target.se);
    if (!targetSector) {
      this.flowFields.clear();
      this.perf.end('Flow');
      this.perf.setCounter('Fields', 0);
      return;
    }

    const targetLocal = grid.globalToLocal(target.ne, target.se);
    const targetIdx = targetLocal.localNe + targetLocal.localSe * SECTOR_SIZE;
    const targetComponent = this.sectorComponents.get(targetSector.getId())?.cells[targetIdx] ?? -1;
    const routeCosts = routeCostsToTarget(grid, targetSector, target, (portal) => {
      return this.sectorComponents.get(targetSector.getId())?.portalComponent.get(portal.getId()) === targetComponent;
    });

    for (const sector of grid.getSectors()) {
      this.buildSectorFlow(sector, targetSector, targetIdx, routeCosts, (n) => {
        integrations += n;
      });
    }

    this.perf.end('Flow');
    this.perf.setCounter('Fields', integrations);
  }

  /**
     * Integrate and store the flow of one sector. Components whose sink is
     * unchanged since the last integration keep their cells — two flows into
     * the same sink through the same cost field are equal.
     */
  private buildSectorFlow(
    sector: Sector,
    targetSector: Sector,
    targetIdx: number,
    routeCosts: Map<string, number>,
    countIntegration: (n: number) => void,
  ): void {
    const components = this.sectorComponents.get(sector.getId());
    if (!components) {
      this.flowFields.delete(sector.getId());
      return;
    }

    const previous = this.flowFields.get(sector.getId());
    const holdsTarget = sector.getId() === targetSector.getId();
    const holdsTargetComponent = holdsTarget && components.cells[targetIdx]! >= 0;

    // Sink per component first: it decides reuse before any integration.
    const sinks: Map<number, number> = new Map();
    const exits: Map<number, readonly [number, number]> = new Map();
    for (const component of new Set(components.cells)) {
      if (component < 0) {
        continue;
      }

      if (holdsTargetComponent && components.cells[targetIdx] === component) {
        sinks.set(component, targetIdx);
        continue;
      }

      const portal = this.cheapestExit(sector, component, components, routeCosts);
      if (!portal) {
        continue;
      }
      const entry = portal.getEntryCenter(sector.getId());
      sinks.set(component, entry.ne + entry.se * SECTOR_SIZE);
      exits.set(entry.ne + entry.se * SECTOR_SIZE, portalExitDelta(sector.getId(), portal));
    }

    const reused: Map<number, number> = new Map();
    const costVersion = sector.getCostField().getVersion();
    const componentsVersion = this.sectorComponentsVersion.get(sector.getId()) ?? -1;
    if (previous && previous.costVersion === costVersion && previous.componentsVersion === componentsVersion) {
      // Components and cost field are unchanged since the previous
      // integration — component ids are stable, so equal sinks mean
      // equal flows and the cells can be kept as they are.
      for (const [component, sink] of sinks) {
        if (previous.sinks.get(component) === sink) {
          reused.set(component, sink);
        }
      }
    }

    // Merge the per-component fields into one cell array. Components are
    // disjoint, so merging is lossless; reused components keep their cells.
    const cells = previous?.cells.slice() ?? new Uint8Array(SECTOR_SIZE * SECTOR_SIZE);
    let integrated = 0;
    for (const [component, sink] of sinks) {
      if (reused.has(component)) {
        continue;
      }

      const { flowField } = this.integrator.get(sector.getCostField(), {
        ne: sink % SECTOR_SIZE,
        se: Math.floor(sink / SECTOR_SIZE),
      });
      integrated++;

      const fieldCells = flowField.getCells();
      for (let i = 0; i < cells.length; i++) {
        if (components.cells[i] === component) {
          cells[i] = fieldCells[i]!;
        }
      }
    }

    // Cells of components without a route keep no stale flow — a vanished
    // route must leave its cells empty, and cells that turned impassable
    // must not keep direction bits from the previous integration.
    for (let i = 0; i < cells.length; i++) {
      const component = components.cells[i]!;
      if (component < 0 || !sinks.has(component)) {
        cells[i] = 0;
      }
    }

    countIntegration(integrated);
    this.flowFields.set(sector.getId(), { cells, exits, sinks, costVersion, componentsVersion });
  }

  /** Size of the structures the planning tick works on, for the perf panel. */
  private updateGraphCounters(): void {
    const sectors = this.grid?.getSectors() ?? [];
    let portals = 0;
    for (const sector of sectors) {
      portals += sector.getPortals().length;
    }
    // Every portal belongs to two sectors, so the per-sector sum counts it twice.
    this.perf.setCounter('Sectors', sectors.length);
    this.perf.setCounter('Portals', portals / 2);
    this.perf.setCounter('Cells', this.cols * this.rows);
    this.perf.setCounter('Mobs', this.mobs.length);
  }

  /** Portal of one sector component with the cheapest route to the target. */
  private cheapestExit(sector: Sector, component: number, components: SectorComponents, routeCosts: Map<string, number>): Portal | undefined {
    let best: Portal | undefined;
    let bestCost = Infinity;

    for (const portal of sector.getPortals()) {
      if (components.portalComponent.get(portal.getId()) !== component) {
        continue;
      }
      const cost = routeCosts.get(crossingKey(portal.getId(), sector.getId()));
      if (cost !== undefined && cost < bestCost) {
        bestCost = cost;
        best = portal;
      }
    }

    return best;
  }

  /** Flow direction for a global cell, or null where there is no flow. */
  private flowAt(cell: Waypoint): readonly [number, number] | null {
    const grid = this.grid;
    if (!grid) {
      return null;
    }

    const sector = grid.getSectorAt(cell.ne, cell.se);
    if (!sector) {
      return null;
    }

    const flow = this.flowFields.get(sector.getId());
    if (!flow) {
      return null;
    }

    const { localNe, localSe } = grid.globalToLocal(cell.ne, cell.se);
    const idx = localNe + localSe * SECTOR_SIZE;

    const exit = flow.exits.get(idx);
    if (exit) {
      return exit;
    }

    const value = flow.cells[idx]!;
    if ((value & FLOW_PATHABLE_MASK) === 0) {
      return null;
    }

    return FLOW_DELTAS[value & FLOW_DIR_MASK] ?? null;
  }

  /**
     * Follow the flow fields from the mob's cell to the target. The trace is the
     * route drawn on the canvas, and reaching the target is what clears the
     * mob's blocked flag.
     */
  private traceMob(mob: Mob): void {
    mob.traceVersion = this.version;

    const target = this.target;
    const start = this.cellAt(mob.x, mob.y);
    if (!target || !start) {
      mob.trace = [];
      mob.blocked = target !== null;
      return;
    }

    const trace: Waypoint[] = [start];
    let current = start;

    for (let i = 0; i < MAX_TRACE_LENGTH; i++) {
      if (current.ne === target.ne && current.se === target.se) {
        mob.trace = trace;
        mob.blocked = false;
        return;
      }

      const delta = this.flowAt(current);
      if (!delta) {
        break;
      }

      const next = { ne: current.ne + delta[0], se: current.se + delta[1] };
      if (next.ne < 0 || next.se < 0 || next.ne >= this.cols || next.se >= this.rows) {
        break;
      }

      trace.push(next);
      current = next;
    }

    mob.trace = trace;
    mob.blocked = true;
  }

  /** Nearest cell a mob in a blocked cell can walk to, by breadth-first search. */
  private nearestFreeCell(from: Waypoint): Waypoint | null {
    if (!this.cellBlocked(from.ne, from.se)) {
      return from;
    }

    const visited = new Set<number>([from.ne + from.se * this.cols]);
    const queue: Waypoint[] = [from];

    while (queue.length > 0) {
      const cell = queue.shift()!;
      for (const neighbour of [
        { ne: cell.ne - 1, se: cell.se },
        { ne: cell.ne + 1, se: cell.se },
        { ne: cell.ne, se: cell.se - 1 },
        { ne: cell.ne, se: cell.se + 1 },
      ]) {
        if (neighbour.ne < 0 || neighbour.se < 0 || neighbour.ne >= this.cols || neighbour.se >= this.rows) {
          continue;
        }
        const key = neighbour.ne + neighbour.se * this.cols;
        if (visited.has(key)) {
          continue;
        }
        visited.add(key);
        if (!this.cellBlocked(neighbour.ne, neighbour.se)) {
          return neighbour;
        }
        queue.push(neighbour);
      }
    }

    return null;
  }

  private moveMobs(dt: number): void {
    const target = this.target;
    if (!target) {
      return;
    }

    const targetX = target.ne * CELL_SIZE + CELL_SIZE / 2;
    const targetY = target.se * CELL_SIZE + CELL_SIZE / 2;

    for (const mob of this.mobs) {
      let vx = 0;
      let vy = 0;

      const cell = this.cellAt(mob.x, mob.y);
      // A mob can end up inside a blocked cell — a wall painted on top of
      // it, an obstacle drifting over it, a stale flow field steering into
      // a cell that just turned impassable. Movement out of a blocked cell
      // must stay possible, otherwise the mob freezes there forever.
      const stuck = cell !== null && this.cellBlocked(cell.ne, cell.se);

      if (cell) {
        // Inside the target cell steer straight at it, otherwise follow the
        // flow field into the centre of the next cell.
        let aimX = targetX;
        let aimY = targetY;
        if (cell.ne !== target.ne || cell.se !== target.se) {
          if (stuck) {
            // Blocked cells carry no flow, so aim for the nearest free
            // cell instead of standing still.
            const nearestFree = this.nearestFreeCell(cell);
            if (nearestFree) {
              aimX = nearestFree.ne * CELL_SIZE + CELL_SIZE / 2;
              aimY = nearestFree.se * CELL_SIZE + CELL_SIZE / 2;
            }
            else {
              aimX = mob.x;
              aimY = mob.y;
            }
          }
          else {
            const delta = this.flowAt(cell);
            if (delta) {
              aimX = (cell.ne + delta[0]) * CELL_SIZE + CELL_SIZE / 2;
              aimY = (cell.se + delta[1]) * CELL_SIZE + CELL_SIZE / 2;
            }
            else {
              aimX = mob.x;
              aimY = mob.y;
            }
          }
        }

        const dx = aimX - mob.x;
        const dy = aimY - mob.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 0.001) {
          vx = (dx / dist) * mob.speed;
          vy = (dy / dist) * mob.speed;
        }
      }

      // Local avoidance keeps mobs off moving obstacles between planning ticks.
      for (const o of this.obstacles) {
        const dx = mob.x - o.x;
        const dy = mob.y - o.y;
        const dist = Math.hypot(dx, dy);
        const minDist = o.size / 2 + MOB_RADIUS + 8;
        if (dist < minDist && dist > 0.001) {
          const push = (minDist - dist) / minDist;
          vx += (dx / dist) * push * REPULSION_STRENGTH;
          vy += (dy / dist) * push * REPULSION_STRENGTH;
        }
      }

      // Walls and moving obstacles are checked one axis at a time, so a mob
      // pushed diagonally against a blocker still slides along it instead of
      // sticking — the same sliding moveObstacles() uses.
      const prevX = mob.x;
      mob.x += vx * dt;
      if (!stuck && this.cellBlocked(Math.floor(mob.x / CELL_SIZE), Math.floor(mob.y / CELL_SIZE))) {
        mob.x = prevX;
      }

      const prevY = mob.y;
      mob.y += vy * dt;
      if (!stuck && this.cellBlocked(Math.floor(mob.x / CELL_SIZE), Math.floor(mob.y / CELL_SIZE))) {
        mob.y = prevY;
      }

      // Reaching the target sends the mob back to its spawn for another run.
      // The spawn cell may have been painted over or covered since — fall
      // back to the nearest free cell so the respawn never lands the mob
      // inside a blocked cell.
      if (Math.hypot(mob.x - targetX, mob.y - targetY) < MOB_RADIUS + 4) {
        mob.x = mob.spawnX;
        mob.y = mob.spawnY;
        const spawnCell = this.cellAt(mob.x, mob.y);
        if (spawnCell && this.cellBlocked(spawnCell.ne, spawnCell.se)) {
          const nearestFree = this.nearestFreeCell(spawnCell);
          if (nearestFree) {
            mob.x = nearestFree.ne * CELL_SIZE + CELL_SIZE / 2;
            mob.y = nearestFree.se * CELL_SIZE + CELL_SIZE / 2;
          }
        }
        mob.trace = [];
        mob.traceVersion = -1;
      }
    }
  }
}

/**
 * Copy a cell layer into a new size, keeping the overlapping top-left part.
 * Cells outside the old layer are free.
 */
function resizeLayer(layer: Uint8Array, oldCols: number, oldRows: number, cols: number, rows: number): Uint8Array<ArrayBuffer> {
  const next = new Uint8Array(cols * rows).fill(COST_MIN);
  const copyCols = Math.min(cols, oldCols);
  const copyRows = Math.min(rows, oldRows);
  for (let y = 0; y < copyRows; y++) {
    next.set(layer.subarray(y * oldCols, y * oldCols + copyCols), y * cols);
  }
  return next;
}

/** Cells of a portal inside one of its two sectors, in that sector's local space. */
function entryCells(sectorId: SectorId, portal: Portal): TileDelta[] {
  const start = portal.getEntryStart(sectorId);
  const end = portal.getEntryEnd(sectorId);
  const cells: TileDelta[] = [];
  for (let se = start.se; se <= end.se; se++) {
    for (let ne = start.ne; ne <= end.ne; ne++) {
      cells.push({ ne, se });
    }
  }
  return cells;
}

/** Walkable components of one sector and which of them each portal sits in. */
interface SectorComponents {
  /** Component id per local cell; -1 for impassable cells. */
  readonly cells: Int16Array
  readonly portalComponent: Map<PortalId, number>
}

/** Key of a portal crossing: leaving `sectorId` through `portalId`. */
function crossingKey(portalId: PortalId, sectorId: SectorId): string {
  return `${portalId}:${sectorId}`;
}

/**
 * Cost of every portal crossing to the target, by Dijkstra backwards from the
 * target sector over the portal graph.
 *
 * A state is "leave sector S through portal p", which is what a sector's flow
 * field has to commit to. `portalAStar()` answers a different question — one
 * route for one request — while the crowd needs the exit of every sector at
 * once; one backward search gives all of them, and they agree with each other.
 */
function routeCostsToTarget(
  grid: Grid,
  targetSector: Sector,
  target: Waypoint,
  reachesTarget: (portal: Portal) => boolean,
): Map<string, number> {
  const costs = new Map<string, number>();
  const heap = new BinaryHeap<string>();

  const push = (key: string, cost: number) => {
    const known = costs.get(key);
    if (known !== undefined && known <= cost) {
      return;
    }
    costs.set(key, cost);
    if (heap.has(key)) {
      heap.updatePriority(key, cost);
    }
    else {
      heap.push(key, cost);
    }
  };

  const portalsById: Map<PortalId, Portal> = new Map();
  for (const sector of grid.getSectors()) {
    for (const portal of sector.getPortals()) {
      portalsById.set(portal.getId(), portal);
    }
  }

  // Crossing into the target sector costs the walk from the portal to the
  // target. Only portals in the target's own component lead there; one in a
  // walled-off pocket of the target sector would be a dead end.
  for (const portal of targetSector.getPortals()) {
    if (!reachesTarget(portal)) {
      continue;
    }
    const from = portal.getExitSector(targetSector.getId());
    const center = globalPortalCenter(grid, targetSector.getId(), portal);
    push(crossingKey(portal.getId(), from), tileEuclidean(center, target));
  }

  while (true) {
    const key = heap.pop();
    if (key === undefined) {
      break;
    }

    const [portalId, sectorId] = key.split(':').map(Number) as [PortalId, SectorId];
    const portal = portalsById.get(portalId);
    if (!portal) {
      continue;
    }
    const cost = costs.get(key)!;

    // To cross `portal` out of `sectorId`, a mob first has to enter that
    // sector — through any portal connected to it inside the sector.
    const center = globalPortalCenter(grid, sectorId, portal);
    for (const previous of portal.getConnected(sectorId)) {
      const previousCenter = globalPortalCenter(grid, sectorId, previous);
      push(crossingKey(previous.getId(), previous.getExitSector(sectorId)), cost + tileEuclidean(center, previousCenter));
    }
  }

  return costs;
}

/** Middle cell of a portal inside one of its sectors, in global coordinates. */
function globalPortalCenter(grid: Grid, sectorId: SectorId, portal: Portal): Waypoint {
  const sector = grid.getSector(sectorId);
  const local = portal.getEntryCenter(sectorId);
  const origin = sector?.getPosition() ?? { x: 0, y: 0 };
  return {
    ne: origin.x * SECTOR_SIZE + local.ne,
    se: origin.y * SECTOR_SIZE + local.se,
  };
}

/** Cell step that crosses a portal, leaving the given sector. */
function portalExitDelta(sectorId: SectorId, portal: Portal): readonly [number, number] {
  const forward = portal.getSector0() === sectorId;
  if (portal.getDirection() === PortalDirection.NORTH_SOUTH) {
    return forward ? [0, 1] : [0, -1];
  }
  return forward ? [1, 0] : [-1, 0];
}

/** True when a click at (px, py) lands inside the obstacle's bounding box. */
function coversObstacle(o: MovingObstacle, px: number, py: number): boolean {
  const half = o.size / 2;
  return px >= o.x - half && px <= o.x + half && py >= o.y - half && py <= o.y + half;
}

/**
 * Label the passable cells of a sector cost field with 4-connected component
 * ids. Impassable cells get -1.
 */
function componentsOf(costs: Uint8Array): Int16Array {
  const components = new Int16Array(costs.length).fill(-1);
  const queue: number[] = [];
  let nextComponent = 0;

  for (let seed = 0; seed < costs.length; seed++) {
    if (costs[seed] === COST_IMPASSABLE || components[seed] !== -1) {
      continue;
    }

    const component = nextComponent++;
    components[seed] = component;
    queue.push(seed);

    while (queue.length > 0) {
      const idx = queue.pop()!;
      const ne = idx % SECTOR_SIZE;
      const se = Math.floor(idx / SECTOR_SIZE);

      const neighbours = [
        ne > 0 ? idx - 1 : -1,
        ne < SECTOR_SIZE - 1 ? idx + 1 : -1,
        se > 0 ? idx - SECTOR_SIZE : -1,
        se < SECTOR_SIZE - 1 ? idx + SECTOR_SIZE : -1,
      ];

      for (const neighbour of neighbours) {
        if (neighbour < 0) {
          continue;
        }
        if (costs[neighbour] === COST_IMPASSABLE || components[neighbour] !== -1) {
          continue;
        }
        components[neighbour] = component;
        queue.push(neighbour);
      }
    }
  }

  return components;
}
