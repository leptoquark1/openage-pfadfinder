import type { CrowdContext, NeighborList } from '../context.js';
import type { Vec2 } from '../vec2.js';
import { timeToCollision } from './ttc.js';
import type { PreferredVelocityModifier } from './types.js';

export interface SideRuleOptions {
  /** `'right'` (default) or `'left'`: the side agents keep to in counter-flow. */
  readonly side?: 'right' | 'left';
  /** Largest turn, as the lateral share of the speed before renormalizing. Default 1 (45°). */
  readonly strength?: number;
  /** Counter-flow (and following, for overtaking) within this angle counts (degrees). Default 45. */
  readonly angle?: number;
  /** Look-ahead: collisions further away than this (seconds) are ignored. Default 2. */
  readonly horizon?: number;
  /** The bodies count this much wider for the collision test. Default 1.5. */
  readonly inflate?: number;
  /**
   * A neighbor already offset towards the side the agent would turn to by
   * more than this share of the combined radius is passed the natural way,
   * without bias. Default 0.5.
   */
  readonly lateral?: number;
  /** Overtake slower agents ahead on the other side (left when keeping right). Default true. */
  readonly overtake?: boolean;
  /** Only agents slower than this share of the own speed are overtaken. Default 0.75. */
  readonly overtakeBelow?: number;
}

/**
 * The side rule of pedestrian traffic: in counter-flow people dodge to the
 * same side, which turns two opposing streams into lanes (Moussaïd et al.,
 * Proc. R. Soc. B 276, 2009).
 *
 * When a neighbor comes head-on (within `angle` of opposite heading) on a
 * collision course within `horizon`, the agent's preferred velocity turns
 * towards its own right (or left), by up to `strength`, the more the sooner
 * they would collide. "Right" is relative to the agent's own heading; for
 * two agents passing each other that is opposite directions in the world,
 * so they part. A neighbor clearly on that side already is passed the
 * natural way: both agents of the pair see the same offset, so they always
 * agree.
 *
 * With `overtake`, a clearly slower agent ahead walking the same way
 * (within `angle`, below `overtakeBelow` of the own speed) is passed on the
 * other side — keep right, overtake left — unless there is counter-flow to
 * dodge. This also breaks the symmetry of an agent stuck exactly behind
 * another, where predictive avoidance has no lateral component.
 *
 * Acts on the preferred velocity, before avoidance, so avoidance keeps the
 * last word on the direction. Keeps the speed.
 */
export class SideRule implements PreferredVelocityModifier {
  private readonly side: number;
  private readonly strength: number;
  private readonly cosAngle: number;
  private readonly horizon: number;
  private readonly inflate: number;
  private readonly lateral: number;
  private readonly overtake: boolean;
  private readonly overtakeBelow: number;

  constructor(options: SideRuleOptions = {}) {
    this.side = (options.side ?? 'right') === 'right' ? 1 : -1;
    this.strength = options.strength ?? 1;
    this.cosAngle = Math.cos(((options.angle ?? 45) * Math.PI) / 180);
    this.horizon = options.horizon ?? 2;
    this.inflate = options.inflate ?? 1.5;
    this.lateral = options.lateral ?? 0.5;
    this.overtake = options.overtake ?? true;
    this.overtakeBelow = options.overtakeBelow ?? 0.75;
  }

  apply(ctx: CrowdContext, i: number, neighbors: NeighborList, v: Vec2): void {
    const speed = Math.sqrt(v.x * v.x + v.y * v.y);
    if (speed < 1e-9) {
      return;
    }
    const agents = ctx.agents;
    const fx = v.x / speed;
    const fy = v.y / speed;
    // right of the heading in the grid frame (se pointing down), see perpRight()
    const rx = -fy;
    const ry = fx;
    const px = agents.x(i);
    const py = agents.y(i);
    const ri = agents.radius(i);
    let counter = 0;
    let passing = 0;
    for (let n = 0; n < neighbors.count; n++) {
      const j = neighbors.index[n]!;
      const relX = agents.x(j) - px;
      const relY = agents.y(j) - py;
      if (fx * relX + fy * relY <= 0) {
        continue; // behind
      }
      const vjx = agents.vx(j);
      const vjy = agents.vy(j);
      const sj = Math.sqrt(vjx * vjx + vjy * vjy);
      const heading = sj < 1e-9 ? 0 : (fx * vjx + fy * vjy) / sj;
      let dir: number; // +1: turn to the kept side, -1: to the other
      if (sj >= 1e-9 && heading < -this.cosAngle) {
        dir = 1; // counter-flow
      } else if (this.overtake && sj >= 1e-9 && heading > this.cosAngle && sj < speed * this.overtakeBelow) {
        dir = -1; // slower ahead, same way
      } else {
        continue;
      }
      const r = ri + agents.radius(j);
      if (dir * this.side * (relX * rx + relY * ry) > this.lateral * r) {
        continue; // already on the side we would turn to: pass it the natural way
      }
      const tau = timeToCollision(-relX, -relY, v.x - vjx, v.y - vjy, r * this.inflate);
      if (tau < this.horizon) {
        const w = 1 - tau / this.horizon;
        if (dir === 1) {
          counter = Math.max(counter, w);
        } else {
          passing = Math.max(passing, w);
        }
      }
    }
    // counter-flow comes first: never overtake into oncoming agents
    const weight = counter > 0 ? counter : -passing;
    if (weight === 0) {
      return;
    }
    const k = this.side * this.strength * weight;
    const nx = fx + rx * k;
    const ny = fy + ry * k;
    const len = Math.sqrt(nx * nx + ny * ny);
    v.x = (nx / len) * speed;
    v.y = (ny / len) * speed;
  }
}
