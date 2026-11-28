import type { CrowdContext, NeighborList } from '../context.js';
import { nonNegative, positive } from '../options.js';
import type { Vec2 } from '../vec2.js';
import type { SteeringForce } from './types.js';

export interface PowerLawOptions {
  /** Interaction strength k. Default 1.5. */
  readonly strength?: number;
  /** Exponential cutoff τ₀ in seconds. Default 3. */
  readonly tau0?: number;
  /** Collisions further away than this (seconds) are ignored. Default 3. */
  readonly horizon?: number;
  /** τ is clamped from below to this (seconds): the energy saturates for imminent collisions. Default 0.2. */
  readonly tauMin?: number;
  /** Cap of the summed avoidance acceleration (cells/s²). Default 20. */
  readonly maxForce?: number;
}

/**
 * Predictive collision avoidance after the time-to-collision power law of
 * Karamouzas, Skinner and Guy (Phys. Rev. Lett. 113, 2014).
 *
 * Each pair has the energy `E(τ) = k/τ² · e^(−τ/τ₀)`, where τ is the time
 * until the two discs touch at their current velocities. The force on an
 * agent is `F = −∇ₓE(τ)`, the gradient with respect to its relative
 * position `x = pᵢ − pⱼ`. With `v = vᵢ − vⱼ`, `a = v·v`, `b = x·v`,
 * `c = x·x − r²` and `d = b² − ac`:
 *
 *   F = −k·e^(−τ/τ₀) / (a·τ²) · (2/τ + 1/τ₀) · (v − (a·x − b·v)/√d)
 *
 * The force has a lateral component, so agents steer around each other
 * instead of only braking. No force when the agents move apart, have no
 * relative motion, pass each other, or meet beyond the horizon. Overlapping
 * agents get none either: separation and the overlap resolver handle them.
 */
export class PowerLawAvoidance implements SteeringForce {
  private k = 1.5;
  private tau0 = 3;
  private horizon = 3;
  private tauMin = 0.2;
  private maxForce = 20;

  constructor(options: PowerLawOptions = {}) {
    this.configure(options);
  }

  /** Change options while the simulation runs; omitted ones keep their value. */
  configure(options: PowerLawOptions): void {
    this.k = nonNegative('strength', options.strength ?? this.k);
    this.tau0 = positive('tau0', options.tau0 ?? this.tau0);
    this.horizon = nonNegative('horizon', options.horizon ?? this.horizon);
    this.tauMin = positive('tauMin', options.tauMin ?? this.tauMin);
    this.maxForce = nonNegative('maxForce', options.maxForce ?? this.maxForce);
  }

  /** Current options. */
  get options(): Required<PowerLawOptions> {
    return { strength: this.k, tau0: this.tau0, horizon: this.horizon, tauMin: this.tauMin, maxForce: this.maxForce };
  }

  accumulate(ctx: CrowdContext, i: number, neighbors: NeighborList, outAccel: Vec2): void {
    const agents = ctx.agents;
    const px = agents.x(i);
    const py = agents.y(i);
    const vxi = agents.vx(i);
    const vyi = agents.vy(i);
    const ri = agents.radius(i);
    let fx = 0;
    let fy = 0;
    for (let n = 0; n < neighbors.count; n++) {
      const j = neighbors.index[n]!;
      const f = this.pairForce(
        px - agents.x(j),
        py - agents.y(j),
        vxi - agents.vx(j),
        vyi - agents.vy(j),
        ri + agents.radius(j),
      );
      if (f) {
        fx += f.x;
        fy += f.y;
      }
    }
    const len = Math.sqrt(fx * fx + fy * fy);
    if (len > this.maxForce) {
      fx *= this.maxForce / len;
      fy *= this.maxForce / len;
    }
    outAccel.x += fx;
    outAccel.y += fy;
  }

  private readonly scratch: Vec2 = { x: 0, y: 0 };

  /** Force on agent i from one neighbor, or null when there is none. Reuses one vector. */
  pairForce(x: number, y: number, vx: number, vy: number, r: number): Vec2 | null {
    const c = x * x + y * y - r * r;
    if (c < 0) {
      return null;
    }
    const a = vx * vx + vy * vy;
    const b = x * vx + y * vy;
    if (a < 1e-12 || b >= 0) {
      return null;
    }
    const d = b * b - a * c;
    if (d <= 0) {
      return null;
    }
    const sd = Math.sqrt(d);
    const tau = (-b - sd) / a;
    if (tau > this.horizon) {
      return null;
    }
    const t = Math.max(tau, this.tauMin);
    const mag = ((this.k * Math.exp(-t / this.tau0)) / (a * t * t)) * (2 / t + 1 / this.tau0);
    this.scratch.x = -mag * (vx - (a * x - b * vx) / sd);
    this.scratch.y = -mag * (vy - (a * y - b * vy) / sd);
    return this.scratch;
  }
}
