import { hasFlag } from '../../shared/bit-ops.js';
import {
  COST_IMPASSABLE,
  FLOW_LOS_MASK,
  FLOW_PATHABLE_MASK,
  FLOW_TARGET_MASK,
} from '../../shared/constants.js';
import { xyToIndex } from '../../shared/coordinates.js';
import type { FlowDir, Path, SectorId, TileDelta, Waypoint } from '../../shared/types.js';
import type { FlowField } from '../core/flow-field.js';
import type { Grid } from '../graph/grid.js';
import type { Sector } from '../graph/sector.js';
import { pathFound, pathNotFound } from './path-result.js';

/** One sector of a route and the flow field that leads through it. */
export interface FlowStep {
  readonly sector: Sector
  readonly flowField: FlowField
}

/**
 * The flow fields of one planned route, from the start sector through every
 * transit sector to the target. Many units can follow it at once: `next()`
 * tells any unit standing on the route which cell to step to, which is how
 * a group shares one set of fields instead of planning a path per unit.
 */
export class FlowRoute {
  private readonly grid: Grid;
  private readonly steps: readonly FlowStep[];
  private readonly target: TileDelta;
  /**
   * Steps per sector, closest to the target first. A route can leave a
   * sector and come back (around a wall), so a sector may have several.
   */
  private readonly stepsOfSector: Map<SectorId, number[]>;

  constructor(grid: Grid, steps: readonly FlowStep[], target: TileDelta) {
    this.grid = grid;
    this.steps = steps;
    this.target = target;
    this.stepsOfSector = new Map();
    for (let i = steps.length - 1; i >= 0; i--) {
      const id = steps[i]!.sector.getId();
      this.stepsOfSector.set(id, [...(this.stepsOfSector.get(id) ?? []), i]);
    }
  }

  getTarget(): TileDelta {
    return this.target;
  }

  /** The route's sectors with their flow fields, from the start sector to the target sector (e.g. to draw them). */
  getSteps(): readonly FlowStep[] {
    return this.steps;
  }

  /** Sectors along the route, from the start sector to the target sector. */
  getSectorIds(): SectorId[] {
    return this.steps.map(s => s.sector.getId());
  }

  /**
   * The cell to step to from global cell (ne, se), following the flow
   * towards the target; the target itself when it is in clear straight
   * sight. `null` at the target, outside the route's sectors, and on cells
   * the route does not reach (e.g. behind a wall inside a route sector).
   */
  next(ne: number, se: number): TileDelta | null {
    if (ne === this.target.ne && se === this.target.se) {
      return null;
    }
    const sector = this.grid.getSectorAt(ne, se);
    // the first of the sector's steps whose field reaches the cell; the
    // others belong to a part of the sector behind a wall
    for (const step of (sector && this.stepsOfSector.get(sector.getId())) ?? []) {
      const cell = this.cellAt(step, ne, se);
      if (
        this.isLastStep(step)
        && hasFlag(cell, FLOW_LOS_MASK)
        && isLineWalkable(this.grid, ne, se, this.target.ne, this.target.se)
      ) {
        return { ne: this.target.ne, se: this.target.se };
      }
      if (this.isPathable(step, cell)) {
        const [dNe, dSe] = DIR_DELTAS[this.dirAt(step, ne, se)]!;
        return { ne: ne + dNe, se: se + dSe };
      }
    }
    return null;
  }

  /**
   * Follow the flow fields cell by cell in global coordinates, from `start`
   * through every route sector to the target. A waypoint is emitted at each
   * direction change; once a LOS-flagged cell is reached the target is in
   * straight sight (string-pulling) and the walk ends there.
   *
   * Portal cells point out of their sector, so leaving a sector always
   * enters the next route step.
   */
  walk(start: TileDelta): Path {
    const total = this.grid.getTotalCells();
    const target = this.target;
    const waypoints: Waypoint[] = [{ ne: start.ne, se: start.se }];

    let ne = start.ne;
    let se = start.se;
    let step = 0;
    let lastDir: FlowDir | -1 = -1;
    const maxSteps = total.width * total.height * 2;

    for (let n = 0; n < maxSteps; n++) {
      if (ne === target.ne && se === target.se) {
        pushWaypoint(waypoints, ne, se);
        return pathFound(waypoints);
      }

      const { sector } = this.steps[step]!;
      const cell = this.cellAt(step, ne, se);

      // The LOS flags come from corner shadowcasting, which can graze an
      // obstacle corner; only shortcut when the straight line is clear.
      if (
        this.isLastStep(step)
        && hasFlag(cell, FLOW_LOS_MASK)
        && isLineWalkable(this.grid, ne, se, target.ne, target.se)
      ) {
        pushWaypoint(waypoints, ne, se);
        pushWaypoint(waypoints, target.ne, target.se);
        return pathFound(waypoints);
      }

      if (!this.isPathable(step, cell)) {
        return pathNotFound();
      }

      const dir = this.dirAt(step, ne, se);
      if (dir !== lastDir) {
        pushWaypoint(waypoints, ne, se);
        lastDir = dir;
      }

      const [dNe, dSe] = DIR_DELTAS[dir]!;
      ne += dNe;
      se += dSe;
      if (ne < 0 || se < 0 || ne >= total.width || se >= total.height) {
        return pathNotFound();
      }

      const next = this.grid.getSectorAt(ne, se);
      if (next !== sector) {
        step++;
        if (step >= this.steps.length || this.steps[step]!.sector !== next) {
          return pathNotFound();
        }
      }
    }

    return pathNotFound();
  }

  private isLastStep(step: number): boolean {
    return step === this.steps.length - 1;
  }

  /** Portal cells are integration targets too, but carry a fixed direction out of the sector; only the goal cell has none. */
  private isPathable(step: number, cell: number): boolean {
    return (
      hasFlag(cell, FLOW_PATHABLE_MASK)
      && !(this.isLastStep(step) && hasFlag(cell, FLOW_TARGET_MASK))
    );
  }

  private cellAt(step: number, ne: number, se: number): number {
    return this.steps[step]!.flowField.getCell(this.localIndex(step, ne, se));
  }

  private dirAt(step: number, ne: number, se: number): FlowDir {
    return this.steps[step]!.flowField.getDir(this.localIndex(step, ne, se));
  }

  private localIndex(step: number, ne: number, se: number): number {
    const size = this.grid.getSectorSize();
    const pos = this.steps[step]!.sector.getPosition();
    return xyToIndex(ne - pos.x * size, se - pos.y * size, size);
  }
}

/**
 * True when the straight segment between two cell centers only crosses
 * passable cells (grid traversal; touching a corner counts as crossing
 * both cells next to it).
 */
export function isLineWalkable(
  grid: Grid,
  fromNe: number,
  fromSe: number,
  toNe: number,
  toSe: number,
): boolean {
  const dNe = toNe - fromNe;
  const dSe = toSe - fromSe;
  const stepNe = Math.sign(dNe);
  const stepSe = Math.sign(dSe);
  // Parametric distance (0..1) between successive cell borders per axis
  const tDeltaNe = dNe === 0 ? Infinity : 1 / Math.abs(dNe);
  const tDeltaSe = dSe === 0 ? Infinity : 1 / Math.abs(dSe);
  let tMaxNe = tDeltaNe / 2;
  let tMaxSe = tDeltaSe / 2;
  let ne = fromNe;
  let se = fromSe;

  while (ne !== toNe || se !== toSe) {
    if (Math.abs(tMaxNe - tMaxSe) < 1e-9) {
      if (!isPassable(grid, ne + stepNe, se) || !isPassable(grid, ne, se + stepSe)) {
        return false;
      }
      ne += stepNe;
      se += stepSe;
      tMaxNe += tDeltaNe;
      tMaxSe += tDeltaSe;
    }
    else if (tMaxNe < tMaxSe) {
      ne += stepNe;
      tMaxNe += tDeltaNe;
    }
    else {
      se += stepSe;
      tMaxSe += tDeltaSe;
    }

    if (!isPassable(grid, ne, se)) {
      return false;
    }
  }

  return true;
}

function isPassable(grid: Grid, ne: number, se: number): boolean {
  const sector = grid.getSectorAt(ne, se);
  if (!sector) {
    return false;
  }
  const { localNe, localSe } = grid.globalToLocal(ne, se);
  return sector.getCostField().getCost(localNe, localSe) !== COST_IMPASSABLE;
}

function pushWaypoint(waypoints: Waypoint[], ne: number, se: number): void {
  const last = waypoints[waypoints.length - 1]!;
  if (last.ne !== ne || last.se !== se) {
    waypoints.push({ ne, se });
  }
}

/** (ne, se) step per flow direction, indexed by `FlowDir`. */
const DIR_DELTAS: readonly (readonly [number, number])[] = [
  [0, -1], // NORTH
  [1, -1], // NORTH_EAST
  [1, 0], // EAST
  [1, 1], // SOUTH_EAST
  [0, 1], // SOUTH
  [-1, 1], // SOUTH_WEST
  [-1, 0], // WEST
  [-1, -1], // NORTH_WEST
];
