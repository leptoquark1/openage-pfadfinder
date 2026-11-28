import type { DensityFieldView } from '../context.js';

/** Densities below this count as zero and leave the active set. */
const EPSILON = 1e-4;

/**
 * Crowd density in agents per cell, smoothed over time.
 *
 * Each tick, agents are splatted bilinearly onto the four cells around
 * their center (weights summing to the agent's weight, also at the map
 * border, so mass is conserved), then every cell moves towards the observed
 * value: `ρ ← ρ + α(ρ_obs − ρ)` with `α = 1 − e^(−dt/T)`, so the time
 * constant `T` holds whatever the timestep.
 *
 * Only cells with density are visited (an active list), so a tick costs
 * O(agents + occupied cells), not O(map). The same field can serve a
 * Continuum Crowds style guidance later.
 */
export class DensityField implements DensityFieldView {
  readonly width: number;
  readonly height: number;
  private readonly rho: Float64Array;
  private readonly obs: Float64Array;
  private readonly inList: Uint8Array;
  private active: Int32Array;
  private activeCount = 0;
  private readonly alpha: number;

  constructor(width: number, height: number, dt: number, smoothingTime: number) {
    this.width = width;
    this.height = height;
    this.rho = new Float64Array(width * height);
    this.obs = new Float64Array(width * height);
    this.inList = new Uint8Array(width * height);
    this.active = new Int32Array(64);
    this.alpha = smoothingTime > 0 ? 1 - Math.exp(-dt / smoothingTime) : 1;
  }

  at(ne: number, se: number): number {
    if (ne < 0 || se < 0 || ne >= this.width || se >= this.height) {
      return 0;
    }
    return this.rho[ne + se * this.width]!;
  }

  /** Add an agent at (x, y) (cell units) with the given weight to this tick's observation. */
  splat(x: number, y: number, weight = 1): void {
    const fx = x - 0.5;
    const fy = y - 0.5;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    this.deposit(ix, iy, weight * (1 - tx) * (1 - ty));
    this.deposit(ix + 1, iy, weight * tx * (1 - ty));
    this.deposit(ix, iy + 1, weight * (1 - tx) * ty);
    this.deposit(ix + 1, iy + 1, weight * tx * ty);
  }

  /** Blend this tick's observation into the density and clear it. */
  update(): void {
    let w = 0;
    for (let k = 0; k < this.activeCount; k++) {
      const c = this.active[k]!;
      const next = this.rho[c]! + this.alpha * (this.obs[c]! - this.rho[c]!);
      this.obs[c] = 0;
      if (next < EPSILON) {
        this.rho[c] = 0;
        this.inList[c] = 0;
      } else {
        this.rho[c] = next;
        this.active[w++] = c;
      }
    }
    this.activeCount = w;
  }

  /** Cells with density, in a fixed order; valid until the next `splat()`/`update()`. */
  activeCells(): { readonly cells: Int32Array; readonly count: number } {
    return { cells: this.active, count: this.activeCount };
  }

  /** Total density over the map (for tests: equals the splatted weight in steady state). */
  total(): number {
    let sum = 0;
    for (let k = 0; k < this.activeCount; k++) {
      sum += this.rho[this.active[k]!]!;
    }
    return sum;
  }

  clear(): void {
    for (let k = 0; k < this.activeCount; k++) {
      const c = this.active[k]!;
      this.rho[c] = 0;
      this.obs[c] = 0;
      this.inList[c] = 0;
    }
    this.activeCount = 0;
  }

  private deposit(ne: number, se: number, w: number): void {
    if (w === 0) {
      return;
    }
    const x = ne < 0 ? 0 : ne >= this.width ? this.width - 1 : ne;
    const y = se < 0 ? 0 : se >= this.height ? this.height - 1 : se;
    const c = x + y * this.width;
    this.obs[c]! += w;
    if (!this.inList[c]) {
      this.inList[c] = 1;
      if (this.activeCount === this.active.length) {
        const next = new Int32Array(this.activeCount * 2);
        next.set(this.active);
        this.active = next;
      }
      this.active[this.activeCount++] = c;
    }
  }
}
