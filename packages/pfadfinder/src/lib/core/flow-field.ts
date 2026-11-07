import { hasFlag, setFlag } from '../../shared/bit-ops.js';
import {
  FLOW_DIR_MASK,
  FLOW_FLAGS_MASK,
  FLOW_INIT,
  FLOW_LOS_MASK,
  FLOW_PATHABLE_MASK,
  FLOW_TARGET_MASK,
  INTEGRATED_COST_UNREACHABLE,
} from '../../shared/constants.js';
import { xyToIndex } from '../../shared/coordinates.js';
import { FlowDir, PortalDirection, type SectorId } from '../../shared/types.js';
import type { Portal } from '../graph/portal.js';
import type { IntegrationField } from './integration-field.js';

/**
 * Flow field storing per-cell movement direction (4-bit) and flags (4-bit).
 * Built from an integration field — each cell points toward the neighbor
 * with the lowest integrated cost.
 *
 * Port of openage's FlowField class.
 */
export class FlowField {
  private readonly size: number;
  private readonly cells: Uint8Array;

  constructor(size: number) {
    this.size = size;
    this.cells = new Uint8Array(size * size).fill(FLOW_INIT);
  }

  constructorFromIntegration(integrationField: IntegrationField) {
    this.build(integrationField);
  }

  getSize(): number {
    return this.size;
  }

  getCell(idx: number): number;
  getCell(x: number, y: number): number;
  getCell(a: number, b?: number): number {
    if (b !== undefined) {
      return this.cells[xyToIndex(a, b, this.size)]!;
    }
    return this.cells[a]!;
  }

  getCells(): Uint8Array {
    return this.cells;
  }

  getDir(idx: number): FlowDir {
    return this.cells[idx]! & FLOW_DIR_MASK;
  }

  /**
   * Build flow field from an integration field.
   * For each cell, find the neighbor (8-connected) with the lowest
   * integrated cost and set the flow direction toward it.
   */
  build(integrationField: IntegrationField): void {
    const integrateCosts = integrationField.getCosts();
    const integrateFlags = integrationField.getFlagsArray();
    const size = this.size;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = y * size + x;

        if (integrateCosts[idx] === INTEGRATED_COST_UNREACHABLE) {
          continue;
        }

        // Transfer LOS/TARGET flags from integration field
        const transferFlags = integrateFlags[idx]! & FLOW_FLAGS_MASK;
        this.cells[idx] = setFlag(this.cells[idx]!, transferFlags);

        if (hasFlag(this.cells[idx]!, FLOW_TARGET_MASK)) {
          this.cells[idx] = setFlag(this.cells[idx]!, FLOW_PATHABLE_MASK);
          continue;
        }

        // Track which cardinal directions are unreachable
        // north=0x01, east=0x02, south=0x04, west=0x08
        let directionsUnreachable = 0x00;

        let direction = this.cells[idx]! & FLOW_DIR_MASK;
        let smallestCost = INTEGRATED_COST_UNREACHABLE;

        // Cardinal directions
        if (y > 0) {
          const cost = integrateCosts[idx - size]!;
          if (cost === INTEGRATED_COST_UNREACHABLE) {
            directionsUnreachable |= 0x01;
          }
          else if (cost < smallestCost) {
            smallestCost = cost;
            direction = FlowDir.NORTH;
          }
        }
        if (x < size - 1) {
          const cost = integrateCosts[idx + 1]!;
          if (cost === INTEGRATED_COST_UNREACHABLE) {
            directionsUnreachable |= 0x02;
          }
          else if (cost < smallestCost) {
            smallestCost = cost;
            direction = FlowDir.EAST;
          }
        }
        if (y < size - 1) {
          const cost = integrateCosts[idx + size]!;
          if (cost === INTEGRATED_COST_UNREACHABLE) {
            directionsUnreachable |= 0x04;
          }
          else if (cost < smallestCost) {
            smallestCost = cost;
            direction = FlowDir.SOUTH;
          }
        }
        if (x > 0) {
          const cost = integrateCosts[idx - 1]!;
          if (cost === INTEGRATED_COST_UNREACHABLE) {
            directionsUnreachable |= 0x08;
          }
          else if (cost < smallestCost) {
            smallestCost = cost;
            direction = FlowDir.WEST;
          }
        }

        // Diagonal directions (only if both adjacent cardinals are passable)
        if (
          x < size - 1
          && y > 0
          && !(directionsUnreachable & 0x01)
          && !(directionsUnreachable & 0x02)
        ) {
          const cost = integrateCosts[idx - size + 1]!;
          if (cost < smallestCost) {
            smallestCost = cost;
            direction = FlowDir.NORTH_EAST;
          }
        }
        if (
          x < size - 1
          && y < size - 1
          && !(directionsUnreachable & 0x02)
          && !(directionsUnreachable & 0x04)
        ) {
          const cost = integrateCosts[idx + size + 1]!;
          if (cost < smallestCost) {
            smallestCost = cost;
            direction = FlowDir.SOUTH_EAST;
          }
        }
        if (
          x > 0
          && y < size - 1
          && !(directionsUnreachable & 0x04)
          && !(directionsUnreachable & 0x08)
        ) {
          const cost = integrateCosts[idx + size - 1]!;
          if (cost < smallestCost) {
            smallestCost = cost;
            direction = FlowDir.SOUTH_WEST;
          }
        }
        if (x > 0 && y > 0 && !(directionsUnreachable & 0x01) && !(directionsUnreachable & 0x08)) {
          const cost = integrateCosts[idx - size - 1]!;
          if (cost < smallestCost) {
            smallestCost = cost;
            direction = FlowDir.NORTH_WEST;
          }
        }

        this.cells[idx] = setFlag(this.cells[idx]!, FLOW_PATHABLE_MASK);
        this.cells[idx] = (this.cells[idx]! & ~FLOW_DIR_MASK) | direction;
      }
    }
  }

  /**
   * Build flow field with portal direction overrides.
   * Portal cells get a fixed flow direction pointing toward the connected sector.
   */
  buildPortal(
    integrationField: IntegrationField,
    _other: IntegrationField,
    otherSectorId: SectorId,
    portal: Portal,
  ): void {
    const direction = portal.getDirection();
    const entryStart = portal.getEntryStart(otherSectorId);
    const exitStart = portal.getExitStart(otherSectorId);
    const exitEnd = portal.getExitEnd(otherSectorId);

    if (direction === PortalDirection.NORTH_SOUTH) {
      const otherIsNorth = entryStart.se > exitStart.se;
      const flowDir = otherIsNorth ? FlowDir.NORTH : FlowDir.SOUTH;
      const y = exitStart.se;
      for (let x = exitStart.ne; x <= exitEnd.ne; x++) {
        const idx = xyToIndex(x, y, this.size);
        this.cells[idx] = setFlag(this.cells[idx]!, FLOW_PATHABLE_MASK);
        this.cells[idx] = (this.cells[idx]! & ~FLOW_DIR_MASK) | flowDir;
      }
    }
    else if (direction === PortalDirection.EAST_WEST) {
      const otherIsEast = entryStart.ne < exitStart.ne;
      const flowDir = otherIsEast ? FlowDir.EAST : FlowDir.WEST;
      const x = exitStart.ne;
      for (let y = exitStart.se; y <= exitEnd.se; y++) {
        const idx = xyToIndex(x, y, this.size);
        this.cells[idx] = setFlag(this.cells[idx]!, FLOW_PATHABLE_MASK);
        this.cells[idx] = (this.cells[idx]! & ~FLOW_DIR_MASK) | flowDir;
      }
    }

    this.build(integrationField);
  }

  reset(): void {
    this.cells.fill(FLOW_INIT);
  }

  /**
   * Create a copy of this field.
   * Used for copy-on-read cache semantics.
   */
  clone(): FlowField {
    const copy = new FlowField(this.size);
    copy.cells.set(this.cells);
    return copy;
  }

  resetDynamicFlags(): void {
    const mask = 0xff & ~FLOW_LOS_MASK;
    for (let i = 0; i < this.cells.length; i++) {
      this.cells[i] = this.cells[i]! & mask;
    }
  }

  transferDynamicFlags(integrationField: IntegrationField): void {
    const integrateFlags = integrationField.getFlagsArray();
    for (let idx = 0; idx < integrateFlags.length; idx++) {
      if (hasFlag(integrateFlags[idx]!, 0x20)) {
        this.cells[idx] = setFlag(this.cells[idx]!, FLOW_LOS_MASK);
      }
    }
  }
}
