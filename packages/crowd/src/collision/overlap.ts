import type { AgentStore } from '../agents.js';
import type { NavigationView } from '../context.js';
import type { SpatialHash } from '../spatial-hash.js';
import { fallbackDirection } from '../steering/fallback.js';
import type { Vec2 } from '../vec2.js';
import { resolveWalls } from './walls.js';

export interface OverlapResolverOptions {
  /** Solver passes per tick. Default 4. */
  readonly iterations?: number;
  /** Share of an overlap removed per pass (0..1]. Default 1. */
  readonly stiffness?: number;
}

/**
 * Removes the overlaps between agents that are left after the forces:
 * positional correction, each agent of a pair moved half the overlap apart.
 *
 * Gauss–Seidel passes over the pairs in ascending (lower, higher) index, a
 * fixed order, so the result is deterministic. One pass is not enough in
 * a jam (fixing one pair can push into the next), hence several, each
 * followed by pushing the agents back out of the walls.
 */
export class OverlapResolver {
  private readonly iterations: number;
  private readonly stiffness: number;
  private readonly pos: Vec2 = { x: 0, y: 0 };
  private readonly vel: Vec2 = { x: 0, y: 0 };
  private readonly dir: Vec2 = { x: 0, y: 0 };

  constructor(options: OverlapResolverOptions = {}) {
    this.iterations = options.iterations ?? 4;
    this.stiffness = options.stiffness ?? 1;
  }

  /** Run the passes; `hash` is rebuilt as needed. Returns the overlap left (sum of depths). */
  resolve(store: AgentStore, hash: SpatialHash, nav: NavigationView): number {
    let left = 0;
    for (let it = 0; it < this.iterations; it++) {
      hash.build(store);
      left = this.pass(store, hash);
      for (let i = 0; i < store.count; i++) {
        this.pos.x = store.px[i]!;
        this.pos.y = store.py[i]!;
        this.vel.x = store.pvx[i]!;
        this.vel.y = store.pvy[i]!;
        if (resolveWalls(nav, this.pos, this.vel, store.rad[i]!)) {
          store.px[i] = this.pos.x;
          store.py[i] = this.pos.y;
          store.pvx[i] = this.vel.x;
          store.pvy[i] = this.vel.y;
        }
      }
      if (left === 0) {
        break;
      }
    }
    return left;
  }

  private pass(store: AgentStore, hash: SpatialHash): number {
    let total = 0;
    const maxR = store.maxRadius;
    for (let i = 0; i < store.count; i++) {
      const ri = store.rad[i]!;
      const n = hash.gather(store.px[i]!, store.py[i]!, ri + maxR);
      const cand = hash.candidates();
      for (let c = 0; c < n; c++) {
        const j = cand[c]!;
        if (j <= i) {
          continue;
        }
        const r = ri + store.rad[j]!;
        const dx = store.px[i]! - store.px[j]!;
        const dy = store.py[i]! - store.py[j]!;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r) {
          continue;
        }
        const d = Math.sqrt(d2);
        if (d > 1e-9) {
          this.dir.x = dx / d;
          this.dir.y = dy / d;
        } else {
          fallbackDirection(store.ids[i]!, store.ids[j]!, this.dir);
        }
        const depth = r - d;
        total += depth;
        const push = (depth * this.stiffness) / 2;
        store.px[i]! += this.dir.x * push;
        store.py[i]! += this.dir.y * push;
        store.px[j]! -= this.dir.x * push;
        store.py[j]! -= this.dir.y * push;
      }
    }
    return total;
  }
}
