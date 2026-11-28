import type { CrowdContext, NeighborList } from '../context.js';
import type { Vec2 } from '../vec2.js';
import { fallbackDirection } from './fallback.js';
import type { SteeringForce } from './types.js';

export interface SeparationOptions {
  /** Gap between the bodies (cells) below which agents push each other away. Default 0.2. */
  readonly range?: number;
  /** Acceleration at zero gap (cells/s²); doubles for deep overlaps. Default 8. */
  readonly strength?: number;
}

/**
 * Short-range repulsion (Reynolds' separation) for agents whose bodies
 * nearly touch or overlap: there the time-to-collision is ill-conditioned
 * (or zero), so the power law leaves them to this force.
 *
 * The push grows linearly as the gap closes, from 0 at `range` to
 * `strength` at contact and at most `2 · strength` deep in an overlap.
 */
export class Separation implements SteeringForce {
  private readonly range: number;
  private readonly strength: number;
  private readonly dir: Vec2 = { x: 0, y: 0 };

  constructor(options: SeparationOptions = {}) {
    this.range = options.range ?? 0.2;
    this.strength = options.strength ?? 8;
  }

  accumulate(ctx: CrowdContext, i: number, neighbors: NeighborList, outAccel: Vec2): void {
    const agents = ctx.agents;
    const px = agents.x(i);
    const py = agents.y(i);
    const ri = agents.radius(i);
    for (let n = 0; n < neighbors.count; n++) {
      const j = neighbors.index[n]!;
      const dist = Math.sqrt(neighbors.distSq[n]!);
      const gap = dist - ri - agents.radius(j);
      if (gap >= this.range) {
        continue;
      }
      const w = Math.min(2, 1 - gap / this.range);
      if (dist > 1e-9) {
        this.dir.x = (px - agents.x(j)) / dist;
        this.dir.y = (py - agents.y(j)) / dist;
      } else {
        fallbackDirection(agents.id(i), agents.id(j), this.dir);
      }
      outAccel.x += this.dir.x * this.strength * w;
      outAccel.y += this.dir.y * this.strength * w;
    }
  }
}
