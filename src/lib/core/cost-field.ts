import { COST_IMPASSABLE, COST_MIN } from '../../shared/constants.js';
import { tileToIndex, xyToIndex } from '../../shared/coordinates.js';
import type { TileDelta } from '../../shared/types.js';

/**
 * Cost field storing per-cell movement cost (1-254, 255=impassable).
 * Backed by Uint8Array for cache efficiency.
 *
 * Dirty tracking: a version counter increments on every modification,
 * allowing the Integrator/FieldCache to detect stale cached fields.
 */
export class CostField {
  private readonly size: number;
  private readonly cells: Uint8Array;
  private version: number = 0;

  constructor(size: number) {
    this.size = size;
    this.cells = new Uint8Array(size * size).fill(COST_MIN);
  }

  getSize(): number {
    return this.size;
  }

  getCost(pos: TileDelta): number;
  getCost(x: number, y: number): number;
  getCost(idx: number): number;
  getCost(a: number | TileDelta, b?: number): number {
    if (typeof a === 'object') {
      return this.cells[tileToIndex(a, this.size)]!;
    }
    if (b !== undefined) {
      return this.cells[xyToIndex(a, b, this.size)]!;
    }
    return this.cells[a]!;
  }

  getCosts(): Uint8Array {
    return this.cells;
  }

  setCost(pos: TileDelta, cost: number): void;
  setCost(x: number, y: number, cost: number): void;
  setCost(idx: number, cost: number): void;
  setCost(a: number | TileDelta, b: number, c?: number): void {
    if (typeof a === 'object') {
      this.cells[tileToIndex(a, this.size)] = b;
    }
    else if (c !== undefined) {
      this.cells[xyToIndex(a, b, this.size)] = c;
    }
    else {
      this.cells[a] = b;
    }
    this.version++;
  }

  setCosts(cells: Uint8Array): void {
    this.cells.set(cells);
    this.version++;
  }

  isImpassable(idx: number): boolean {
    return this.cells[idx] === COST_IMPASSABLE;
  }

  getVersion(): number {
    return this.version;
  }

  isDirty(sinceVersion: number): boolean {
    return this.version > sinceVersion;
  }
}
