import type { AgentStore } from './agents.js';
import type { NeighborList, NeighborQuery } from './context.js';

/**
 * Uniform grid over the map for neighbor queries. Every bucket lists its
 * agents in ascending index (= id), so all queries are deterministic.
 *
 * Rebuilding is O(n); a query is O(agents in the buckets it overlaps), which
 * grows with the local density, not with n.
 */
export class SpatialHash implements NeighborQuery {
  private readonly cellSize: number;
  private readonly cols: number;
  private readonly rows: number;
  /** Bucket b holds `items[starts[b] .. starts[b + 1])`. */
  private readonly starts: Int32Array;
  private items = new Int32Array(16);
  private cellOf = new Int32Array(16);
  private store: AgentStore | null = null;
  private gathered = new Int32Array(64);

  constructor(width: number, height: number, cellSize: number) {
    this.cellSize = cellSize;
    this.cols = Math.max(1, Math.ceil(width / cellSize));
    this.rows = Math.max(1, Math.ceil(height / cellSize));
    this.starts = new Int32Array(this.cols * this.rows + 1);
  }

  build(store: AgentStore): void {
    this.store = store;
    const n = store.count;
    if (this.items.length < n) {
      this.items = new Int32Array(n * 2);
      this.cellOf = new Int32Array(n * 2);
    }
    const starts = this.starts;
    starts.fill(0);
    for (let i = 0; i < n; i++) {
      if (!store.isAlive(i)) {
        this.cellOf[i] = -1;
        continue;
      }
      const c = this.bucket(store.px[i]!, store.py[i]!);
      this.cellOf[i] = c;
      starts[c + 1]!++;
    }
    for (let b = 1; b < starts.length; b++) {
      starts[b]! += starts[b - 1]!;
    }
    // Counting sort, filled in ascending index: every bucket stays sorted.
    const fill = starts.slice(0, -1);
    for (let i = 0; i < n; i++) {
      const c = this.cellOf[i]!;
      if (c >= 0) {
        this.items[fill[c]!++] = i;
      }
    }
  }

  /**
   * Indices of all agents in the buckets overlapping the square around
   * (x, y) — candidates, not yet filtered by distance. Returns the count;
   * the indices are in `candidates()` until the next call.
   */
  gather(x: number, y: number, radius: number): number {
    const cs = this.cellSize;
    const c0 = this.clampCol(Math.floor((x - radius) / cs));
    const c1 = this.clampCol(Math.floor((x + radius) / cs));
    const r0 = this.clampRow(Math.floor((y - radius) / cs));
    const r1 = this.clampRow(Math.floor((y + radius) / cs));
    let count = 0;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const b = c + r * this.cols;
        const end = this.starts[b + 1]!;
        for (let k = this.starts[b]!; k < end; k++) {
          if (count === this.gathered.length) {
            const next = new Int32Array(count * 2);
            next.set(this.gathered);
            this.gathered = next;
          }
          this.gathered[count++] = this.items[k]!;
        }
      }
    }
    return count;
  }

  candidates(): Int32Array {
    return this.gathered;
  }

  /**
   * The `k` agents nearest to agent `i` within `radius` (excluding `i`), by
   * ascending (distance, id), into `out`. Returns `out`.
   */
  nearest(i: number, radius: number, k: number, out: NeighborBuffer): NeighborList {
    const store = this.store!;
    const x = store.px[i]!;
    const y = store.py[i]!;
    const r2 = radius * radius;
    out.reserve(k);
    out.count = 0;
    if (k <= 0) {
      return out;
    }
    // Rings of buckets around the agent's bucket, nearest first. Every
    // bucket of ring ρ + 1 is at least ρ · cellSize away, so once k agents
    // are found closer than that, no later ring can hold a nearer one. The
    // result is the exact k nearest by (distance, index), whatever the
    // order the buckets are visited in.
    const cs = this.cellSize;
    const col = this.clampCol(Math.floor(x / cs));
    const row = this.clampRow(Math.floor(y / cs));
    const rings = Math.ceil(radius / cs) + 1;
    for (let ring = 0; ring <= rings; ring++) {
      const r0 = row - ring;
      const r1 = row + ring;
      for (let r = r0; r <= r1; r++) {
        if (r < 0 || r >= this.rows) {
          continue;
        }
        // full rows at the top and bottom of the ring, only the ends in between
        const step = r === r0 || r === r1 ? 1 : Math.max(1, 2 * ring);
        for (let c = col - ring; c <= col + ring; c += step) {
          if (c >= 0 && c < this.cols) {
            this.scanBucket(c + r * this.cols, i, x, y, r2, k, out);
          }
        }
      }
      const bound = ring * cs;
      if (out.count === k && out.distSq[k - 1]! < bound * bound) {
        break;
      }
      if (bound > radius) {
        break;
      }
    }
    return out;
  }

  /** Insert the agents of one bucket into the sorted, k-capped `out`. */
  private scanBucket(b: number, i: number, x: number, y: number, r2: number, k: number, out: NeighborBuffer): void {
    const store = this.store!;
    const end = this.starts[b + 1]!;
    for (let s = this.starts[b]!; s < end; s++) {
      const j = this.items[s]!;
      if (j === i) {
        continue;
      }
      const dx = store.px[j]! - x;
      const dy = store.py[j]! - y;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) {
        continue;
      }
      let count = out.count;
      let p = count;
      if (count === k) {
        if (!before(d2, j, out.distSq[k - 1]!, out.index[k - 1]!)) {
          continue;
        }
        p = k - 1; // the last one drops out
      } else {
        count++;
      }
      while (p > 0 && before(d2, j, out.distSq[p - 1]!, out.index[p - 1]!)) {
        out.distSq[p] = out.distSq[p - 1]!;
        out.index[p] = out.index[p - 1]!;
        p--;
      }
      out.distSq[p] = d2;
      out.index[p] = j;
      out.count = count;
    }
  }

  within(x: number, y: number, radius: number, out: number[]): number[] {
    out.length = 0;
    const store = this.store;
    if (!store) {
      return out;
    }
    const r2 = radius * radius;
    const n = this.gather(x, y, radius);
    for (let c = 0; c < n; c++) {
      const j = this.gathered[c]!;
      const dx = store.px[j]! - x;
      const dy = store.py[j]! - y;
      if (dx * dx + dy * dy <= r2 && store.isAlive(j)) {
        out.push(j);
      }
    }
    return out.sort((a, b) => a - b);
  }

  private bucket(x: number, y: number): number {
    const c = this.clampCol(Math.floor(x / this.cellSize));
    const r = this.clampRow(Math.floor(y / this.cellSize));
    return c + r * this.cols;
  }

  private clampCol(c: number): number {
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  private clampRow(r: number): number {
    return r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r;
  }
}

/** (d2, j) sorts before (d2b, jb): nearer first, lower index on ties. */
function before(d2: number, j: number, d2b: number, jb: number): boolean {
  return d2 < d2b || (d2 === d2b && j < jb);
}

/** Reusable storage for one `NeighborList`. */
export class NeighborBuffer implements NeighborList {
  count = 0;
  index = new Int32Array(16);
  distSq = new Float64Array(16);

  reserve(k: number): void {
    if (this.index.length < k) {
      this.index = new Int32Array(k);
      this.distSq = new Float64Array(k);
    }
  }
}
