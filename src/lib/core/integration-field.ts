import { clearFlag, hasFlag, setFlag } from '../../shared/bit-ops.js';
import {
  COST_IMPASSABLE,
  COST_MIN,
  INTEGRATE_FOUND_MASK,
  INTEGRATE_LOS_MASK,
  INTEGRATE_TARGET_MASK,
  INTEGRATE_WAVEFRONT_BLOCKED_MASK,
  INTEGRATED_COST_START,
  INTEGRATED_COST_UNREACHABLE,
} from '../../shared/constants.js';
import { indexToX, indexToY, tileToIndex, xyToIndex } from '../../shared/coordinates.js';
import type { SectorId, TileDelta } from '../../shared/types.js';
import type { Portal } from '../graph/portal.js';
import { bresenhamLine } from '../internal/bresenham.js';
import type { CostField } from './cost-field.js';

interface LosCorner {
  readonly x: number
  readonly y: number
}

/**
 * Integration field for flow-field pathfinding.
 * Stores accumulated cost (Uint16Array) and per-cell flags (Uint8Array).
 *
 * Two-phase integration:
 * 1. LOS pass — marks cells in line-of-sight to target, finds wavefront-blocked cells
 * 2. Cost integration — Dijkstra-like wavefront expansion from target outward
 */
export class IntegrationField {
  private readonly size: number;
  private readonly costs: Uint16Array;
  private readonly flags: Uint8Array;

  constructor(size: number) {
    this.size = size;
    this.costs = new Uint16Array(size * size).fill(INTEGRATED_COST_UNREACHABLE);
    this.flags = new Uint8Array(size * size);
  }

  getSize(): number {
    return this.size;
  }

  getCost(idx: number): number {
    return this.costs[idx]!;
  }

  getFlags(idx: number): number {
    return this.flags[idx]!;
  }

  getCosts(): Uint16Array {
    return this.costs;
  }

  getFlagsArray(): Uint8Array {
    return this.flags;
  }

  reset(): void {
    this.costs.fill(INTEGRATED_COST_UNREACHABLE);
    this.flags.fill(0);
  }

  /**
   * Create a copy of this field (costs + flags).
   * Used for copy-on-read cache semantics.
   */
  clone(): IntegrationField {
    const copy = new IntegrationField(this.size);
    copy.costs.set(this.costs);
    copy.flags.set(this.flags);
    return copy;
  }

  resetDynamicFlags(): void {
    const mask
      = ~(INTEGRATE_LOS_MASK | INTEGRATE_WAVEFRONT_BLOCKED_MASK | INTEGRATE_FOUND_MASK) & 0xff;
    for (let i = 0; i < this.flags.length; i++) {
      this.flags[i] = this.flags[i]! & mask;
    }
  }

  /**
   * LOS integration from a target cell within this sector.
   * Returns indices of wavefront-blocked cells for subsequent cost integration.
   */
  integrateLos(costField: CostField, target: TileDelta): number[] {
    const targetIdx = tileToIndex(target, this.size);
    let startCost = INTEGRATED_COST_START;

    this.costs[targetIdx] = startCost;
    this.flags[targetIdx] = setFlag(this.flags[targetIdx]!, INTEGRATE_TARGET_MASK);

    const startCells: number[] = [];

    if (costField.getCost(targetIdx) > COST_MIN) {
      this.flags[targetIdx] = setFlag(this.flags[targetIdx]!, INTEGRATE_FOUND_MASK);
      this.flags[targetIdx] = setFlag(this.flags[targetIdx]!, INTEGRATE_LOS_MASK);

      const tx = indexToX(targetIdx, this.size);
      const ty = indexToY(targetIdx, this.size);

      if (ty > 0) {
        startCells.push(targetIdx - this.size);
      }
      if (tx > 0) {
        startCells.push(targetIdx - 1);
      }
      if (ty < this.size - 1) {
        startCells.push(targetIdx + this.size);
      }
      if (tx < this.size - 1) {
        startCells.push(targetIdx + 1);
      }

      startCost += 1;
    }
    else {
      startCells.push(targetIdx);
    }

    return this.integrateLosWave(costField, target, startCost, startCells);
  }

  /**
   * LOS integration from a portal boundary.
   * Transfers LOS/wavefront flags from the other sector's integration field.
   */
  integrateLosPortal(
    costField: CostField,
    other: IntegrationField,
    otherSectorId: SectorId,
    portal: Portal,
    target: TileDelta,
  ): number[] {
    const wavefrontBlockedPortal: number[] = [];
    const startCells: number[] = [];

    const exitStart = portal.getExitStart(otherSectorId);
    const exitEnd = portal.getExitEnd(otherSectorId);
    const entryStart = portal.getEntryStart(otherSectorId);

    const xDiff = exitStart.ne - entryStart.ne;
    const yDiff = exitStart.se - entryStart.se;

    const costCells = costField.getCosts();
    const otherFlags = other.getFlagsArray();

    const transferMask = INTEGRATE_LOS_MASK | INTEGRATE_WAVEFRONT_BLOCKED_MASK;

    for (let y = exitStart.se; y <= exitEnd.se; y++) {
      for (let x = exitStart.ne; x <= exitEnd.ne; x++) {
        const targetIdx = xyToIndex(x, y, this.size);
        const entryIdx = xyToIndex(x - xDiff, y - yDiff, this.size);

        this.costs[targetIdx] = INTEGRATED_COST_START;
        this.flags[targetIdx] = otherFlags[entryIdx]! & transferMask;
        this.flags[targetIdx] = setFlag(this.flags[targetIdx]!, INTEGRATE_TARGET_MASK);

        if ((this.flags[targetIdx]! & transferMask) === 0) {
          continue;
        }

        const cellCost = costCells[targetIdx]!;

        if (
          cellCost > COST_MIN
          || hasFlag(this.flags[targetIdx]!, INTEGRATE_WAVEFRONT_BLOCKED_MASK)
        ) {
          this.flags[targetIdx] = setFlag(this.flags[targetIdx]!, INTEGRATE_WAVEFRONT_BLOCKED_MASK);
          wavefrontBlockedPortal.push(targetIdx);
          this.flags[targetIdx] = setFlag(this.flags[targetIdx]!, INTEGRATE_FOUND_MASK);

          const corners = this.getLosCorners(costField, target, { ne: x, se: y });
          for (const corner of corners) {
            const blockedCells = bresenhamLine(target, corner.x, corner.y, this.size);
            for (const blockedIdx of blockedCells) {
              if (costCells[blockedIdx]! > COST_MIN) {
                break;
              }
              this.flags[blockedIdx] = setFlag(
                this.flags[blockedIdx]!,
                INTEGRATE_WAVEFRONT_BLOCKED_MASK,
              );
              this.flags[blockedIdx] = clearFlag(this.flags[blockedIdx]!, INTEGRATE_LOS_MASK);
              wavefrontBlockedPortal.push(blockedIdx);
            }
          }
          continue;
        }

        startCells.push(targetIdx);
      }
    }

    if (startCells.length === 0) {
      return wavefrontBlockedPortal;
    }

    const wavefrontBlockedMain = this.integrateLosWave(
      costField,
      target,
      INTEGRATED_COST_START,
      startCells,
    );
    return [...wavefrontBlockedMain, ...wavefrontBlockedPortal];
  }

  /**
   * Core LOS wavefront algorithm. Expands from start cells outward,
   * marking LOS cells and detecting wavefront-blocked cells via Bresenham.
   */
  private integrateLosWave(
    costField: CostField,
    target: TileDelta,
    startCost: number,
    startWave: number[],
  ): number[] {
    const wavefrontBlocked: number[] = [];
    let currentWave = startWave;
    let nextWave: number[] = [];

    const costCells = costField.getCosts();
    let waveCost = startCost;

    do {
      for (let i = 0; i < currentWave.length; i++) {
        const idx = currentWave[i]!;
        const flags = this.flags[idx]!;

        if (hasFlag(flags, INTEGRATE_FOUND_MASK)) {
          continue;
        }
        else if (hasFlag(flags, INTEGRATE_WAVEFRONT_BLOCKED_MASK)) {
          // Clamp: see updateNeighbor for the overflow rationale.
          this.costs[idx] = Math.min(
            waveCost - 1 + costCells[idx]!,
            INTEGRATED_COST_UNREACHABLE - 1,
          );
          this.flags[idx] = setFlag(flags, INTEGRATE_FOUND_MASK);
          continue;
        }

        this.flags[idx] = setFlag(flags, INTEGRATE_FOUND_MASK);

        const x = indexToX(idx, this.size);
        const y = indexToY(idx, this.size);
        const cellCost = costCells[idx]!;

        if (cellCost > COST_MIN) {
          if (cellCost !== COST_IMPASSABLE) {
            wavefrontBlocked.push(idx);
            // Clamp: see updateNeighbor for the overflow rationale.
            this.costs[idx] = Math.min(waveCost - 1 + cellCost, INTEGRATED_COST_UNREACHABLE - 1);
            this.flags[idx] = setFlag(this.flags[idx]!, INTEGRATE_WAVEFRONT_BLOCKED_MASK);
          }

          const corners = this.getLosCorners(costField, target, { ne: x, se: y });
          for (const corner of corners) {
            const blockedCells = bresenhamLine(target, corner.x, corner.y, this.size);
            for (const blockedIdx of blockedCells) {
              if (costCells[blockedIdx]! > COST_MIN) {
                break;
              }
              this.flags[blockedIdx] = setFlag(
                this.flags[blockedIdx]!,
                INTEGRATE_WAVEFRONT_BLOCKED_MASK,
              );
              this.flags[blockedIdx] = clearFlag(this.flags[blockedIdx]!, INTEGRATE_LOS_MASK);
              wavefrontBlocked.push(blockedIdx);
            }
          }
          continue;
        }

        this.costs[idx] = waveCost;
        this.flags[idx] = setFlag(this.flags[idx]!, INTEGRATE_LOS_MASK);

        if (y > 0) {
          nextWave.push(idx - this.size);
        }
        if (x > 0) {
          nextWave.push(idx - 1);
        }
        if (y < this.size - 1) {
          nextWave.push(idx + this.size);
        }
        if (x < this.size - 1) {
          nextWave.push(idx + 1);
        }
      }

      waveCost += 1;
      currentWave = nextWave;
      nextWave = [];
    } while (currentWave.length > 0);

    return wavefrontBlocked;
  }

  /**
   * Cost integration from a target cell within this sector.
   * Dijkstra-like wavefront expansion using 4-connected neighbors.
   */
  integrateCost(costField: CostField, target: TileDelta): void {
    const targetIdx = tileToIndex(target, this.size);
    this.costs[targetIdx] = INTEGRATED_COST_START;
    this.flags[targetIdx] = setFlag(this.flags[targetIdx]!, INTEGRATE_TARGET_MASK);
    this.integrateCostWave(costField, [targetIdx]);
  }

  /**
   * Cost integration from a portal boundary.
   * Portal cells act as multiple target/start cells.
   */
  integrateCostPortal(costField: CostField, otherSectorId: SectorId, portal: Portal): void {
    const startCells: number[] = [];
    const exitStart = portal.getExitStart(otherSectorId);
    const exitEnd = portal.getExitEnd(otherSectorId);

    for (let y = exitStart.se; y <= exitEnd.se; y++) {
      for (let x = exitStart.ne; x <= exitEnd.ne; x++) {
        const targetIdx = xyToIndex(x, y, this.size);
        this.costs[targetIdx] = INTEGRATED_COST_START;
        this.flags[targetIdx] = setFlag(this.flags[targetIdx]!, INTEGRATE_TARGET_MASK);
        startCells.push(targetIdx);
      }
    }

    this.integrateCostWave(costField, startCells);
  }

  /**
   * Cost integration from wavefront-blocked cells (after LOS pass).
   *
   * Only cells the LOS wave gave a cost can seed it: a shadow line can run
   * diagonally through a wall corner into a pocket the wave never reaches,
   * and such a cell would spread the "unreachable" sentinel (clamped to
   * 65534) as if it were a real cost, making the pocket look walkable.
   */
  integrateCostFromWavefront(costField: CostField, startCells: number[]): void {
    this.integrateCostWave(
      costField,
      startCells.filter(idx => this.costs[idx]! < INTEGRATED_COST_UNREACHABLE),
    );
  }

  private integrateCostWave(costField: CostField, startCells: number[]): void {
    let currentWave = startCells;
    let nextWave: number[] = [];

    const costCells = costField.getCosts();

    while (currentWave.length > 0) {
      for (let i = 0; i < currentWave.length; i++) {
        const idx = currentWave[i]!;
        const x = indexToX(idx, this.size);
        const y = indexToY(idx, this.size);
        const integratedCurrent = this.costs[idx]!;

        if (y > 0) {
          this.updateNeighbor(
            idx - this.size,
            costCells[idx - this.size]!,
            integratedCurrent,
            nextWave,
          );
        }
        if (x > 0) {
          this.updateNeighbor(idx - 1, costCells[idx - 1]!, integratedCurrent, nextWave);
        }
        if (y < this.size - 1) {
          this.updateNeighbor(
            idx + this.size,
            costCells[idx + this.size]!,
            integratedCurrent,
            nextWave,
          );
        }
        if (x < this.size - 1) {
          this.updateNeighbor(idx + 1, costCells[idx + 1]!, integratedCurrent, nextWave);
        }
      }

      currentWave = nextWave;
      nextWave = [];
    }
  }

  private updateNeighbor(
    idx: number,
    cellCost: number,
    integratedCost: number,
    wave: number[],
  ): void {
    if (cellCost === COST_IMPASSABLE) {
      return;
    }

    // Clamp to 65534: INTEGRATED_COST_UNREACHABLE (65535) is the sentinel
    // for "not yet integrated" and must never appear as a real cost. A
    // wrapped Uint16 would otherwise make cells past the wrap look closer
    // than they are and corrupt the flow field.
    const cost = Math.min(integratedCost + cellCost, INTEGRATED_COST_UNREACHABLE - 1);
    if (cost < this.costs[idx]!) {
      this.costs[idx] = cost;
      wave.push(idx);
    }
  }

  /**
   * Identifies LOS corner points around a blocking cell.
   * Corners are positions where the blocking cell's edge neighbors
   * are passable (min cost), creating a shadow edge.
   */
  private getLosCorners(costField: CostField, target: TileDelta, blocker: TileDelta): LosCorner[] {
    const corners: LosCorner[] = [];

    let topCost = COST_IMPASSABLE;
    let leftCost = COST_IMPASSABLE;
    let bottomCost = COST_IMPASSABLE;
    let rightCost = COST_IMPASSABLE;

    const topLeft = { x: blocker.ne, y: blocker.se };
    const topRight = { x: blocker.ne + 1, y: blocker.se };
    const bottomLeft = { x: blocker.ne, y: blocker.se + 1 };
    const bottomRight = { x: blocker.ne + 1, y: blocker.se + 1 };

    if (blocker.se > 0) {
      topCost = costField.getCost(blocker.ne, blocker.se - 1);
    }
    if (blocker.ne > 0) {
      leftCost = costField.getCost(blocker.ne - 1, blocker.se);
    }
    if (blocker.se < this.size - 1) {
      bottomCost = costField.getCost(blocker.ne, blocker.se + 1);
    }
    if (blocker.ne < this.size - 1) {
      rightCost = costField.getCost(blocker.ne + 1, blocker.se);
    }

    if (blocker.ne === target.ne) {
      if (blocker.se < target.se) {
        if (leftCost === COST_MIN) {
          corners.push(bottomLeft);
        }
        if (rightCost === COST_MIN) {
          corners.push(bottomRight);
        }
      }
      else {
        if (leftCost === COST_MIN) {
          corners.push(topLeft);
        }
        if (rightCost === COST_MIN) {
          corners.push(topRight);
        }
      }
    }
    else if (blocker.se === target.se) {
      if (blocker.ne < target.ne) {
        if (topCost === COST_MIN) {
          corners.push(topRight);
        }
        if (bottomCost === COST_MIN) {
          corners.push(bottomRight);
        }
      }
      else {
        if (topCost === COST_MIN) {
          corners.push(topLeft);
        }
        if (bottomCost === COST_MIN) {
          corners.push(bottomLeft);
        }
      }
    }
    else {
      if (blocker.ne < target.ne) {
        if (blocker.se < target.se) {
          if (topCost === COST_MIN && rightCost === COST_MIN) {
            corners.push(topRight);
          }
          if (leftCost === COST_MIN && bottomCost === COST_MIN) {
            corners.push(bottomLeft);
          }
        }
        else {
          if (bottomCost === COST_MIN && rightCost === COST_MIN) {
            corners.push(bottomRight);
          }
          if (leftCost === COST_MIN && topCost === COST_MIN) {
            corners.push(topLeft);
          }
        }
      }
      else {
        if (blocker.se < target.se) {
          if (topCost === COST_MIN && leftCost === COST_MIN) {
            corners.push(topLeft);
          }
          if (rightCost === COST_MIN && bottomCost === COST_MIN) {
            corners.push(bottomRight);
          }
        }
        else {
          if (bottomCost === COST_MIN && leftCost === COST_MIN) {
            corners.push(bottomLeft);
          }
          if (rightCost === COST_MIN && topCost === COST_MIN) {
            corners.push(topRight);
          }
        }
      }
    }

    return corners;
  }
}
