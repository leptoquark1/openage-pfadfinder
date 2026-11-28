import type { NavigationView } from '../context.js';
import type { Vec2 } from '../vec2.js';

/** Resolution passes per call: a push out of one cell can touch the next. */
const PASSES = 3;
/** Cells searched at most for a free cell when an agent's center is inside a wall. */
const PUSH_OUT_LIMIT = 4096;

/**
 * Move a circle by (dx, dy) against the blocked cells, in sub-steps of at
 * most `min(radius / 2, 0.25)` cells so it cannot tunnel through a wall one
 * cell thick: after each sub-step the body is pushed back out, so its
 * center never gets further into a wall than half a sub-step. Should a
 * center still end up inside a wall cell, the sub-step is undone (per axis,
 * so the circle still slides). Sliding: at each contact the velocity loses
 * its component into the wall (pass `vel` = null to leave velocities alone).
 */
export function moveWithWalls(
  nav: NavigationView,
  pos: Vec2,
  vel: Vec2 | null,
  radius: number,
  dx: number,
  dy: number,
): void {
  const maxStep = Math.max(0.02, Math.min(radius / 2, 0.25));
  const steps = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy) / maxStep));
  const sx = dx / steps;
  const sy = dy / steps;
  for (let s = 0; s < steps; s++) {
    const x = pos.x;
    const y = pos.y;
    pos.x += sx;
    pos.y += sy;
    if (nav.isBlocked(Math.floor(pos.x), Math.floor(pos.y)) && !nav.isBlocked(Math.floor(x), Math.floor(y))) {
      // keep whichever axis of the move stays free, drop the rest
      pos.y = y;
      if (nav.isBlocked(Math.floor(pos.x), Math.floor(pos.y))) {
        pos.x = x;
        pos.y = y + sy;
        if (nav.isBlocked(Math.floor(pos.x), Math.floor(pos.y))) {
          pos.y = y;
        }
      }
    }
    resolveWalls(nav, pos, vel, radius);
  }
}

/**
 * Push a circle out of every blocked cell it overlaps: against the cell's
 * AABB, so edges and corners are both handled. A center inside a blocked
 * cell (or outside the map) is first moved to the nearest free cell.
 * Returns true when it touched a wall.
 */
export function resolveWalls(nav: NavigationView, pos: Vec2, vel: Vec2 | null, radius: number): boolean {
  let touched = false;
  if (nav.isBlocked(Math.floor(pos.x), Math.floor(pos.y))) {
    pushOut(nav, pos);
    touched = true;
  }
  const r2 = radius * radius;
  for (let pass = 0; pass < PASSES; pass++) {
    let hit = false;
    const ne0 = Math.floor(pos.x - radius);
    const ne1 = Math.floor(pos.x + radius);
    const se0 = Math.floor(pos.y - radius);
    const se1 = Math.floor(pos.y + radius);
    for (let se = se0; se <= se1; se++) {
      for (let ne = ne0; ne <= ne1; ne++) {
        if (!nav.isBlocked(ne, se)) {
          continue;
        }
        // closest point of the cell to the center
        const cx = pos.x < ne ? ne : Math.min(pos.x, ne + 1);
        const cy = pos.y < se ? se : Math.min(pos.y, se + 1);
        const ox = pos.x - cx;
        const oy = pos.y - cy;
        const d2 = ox * ox + oy * oy;
        if (d2 >= r2) {
          continue;
        }
        let nx: number;
        let ny: number;
        let d: number;
        if (d2 > 0) {
          d = Math.sqrt(d2);
          nx = ox / d;
          ny = oy / d;
        } else {
          // center exactly on the cell's border (it is not inside: that was
          // pushed out above): push away from the cell, out of the border
          nx = pos.x >= ne + 1 ? 1 : pos.x <= ne ? -1 : 0;
          ny = pos.y >= se + 1 ? 1 : pos.y <= se ? -1 : 0;
          const len = Math.sqrt(nx * nx + ny * ny);
          if (len === 0) {
            // pushed into another blocked cell's interior in a tight spot
            pushOut(nav, pos);
            hit = true;
            continue;
          }
          nx /= len;
          ny /= len;
          d = 0;
        }
        pos.x += nx * (radius - d);
        pos.y += ny * (radius - d);
        if (vel) {
          const vn = vel.x * nx + vel.y * ny;
          if (vn < 0) {
            vel.x -= vn * nx;
            vel.y -= vn * ny;
          }
        }
        hit = true;
      }
    }
    if (!hit) {
      break;
    }
    touched = true;
  }
  return touched;
}

/**
 * Move a point inside a blocked cell (or outside the map) to the center of
 * the nearest free cell, by breadth-first search in a fixed neighbor order.
 * Returns false (and leaves the point) when no free cell is near.
 */
export function pushOut(nav: NavigationView, pos: Vec2): boolean {
  const startNe = clamp(Math.floor(pos.x), 0, nav.width - 1);
  const startSe = clamp(Math.floor(pos.y), 0, nav.height - 1);
  const seen = new Set<number>([startNe + startSe * nav.width]);
  const queue: number[] = [startNe, startSe];
  for (let head = 0; head < queue.length && seen.size <= PUSH_OUT_LIMIT; head += 2) {
    const ne = queue[head]!;
    const se = queue[head + 1]!;
    if (!nav.isBlocked(ne, se)) {
      pos.x = ne + 0.5;
      pos.y = se + 0.5;
      return true;
    }
    for (const [dNe, dSe] of NEIGHBORS) {
      const n = ne + dNe;
      const s = se + dSe;
      if (n < 0 || s < 0 || n >= nav.width || s >= nav.height) {
        continue;
      }
      const key = n + s * nav.width;
      if (!seen.has(key)) {
        seen.add(key);
        queue.push(n, s);
      }
    }
  }
  return false;
}

const NEIGHBORS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : Math.min(v, hi);
}
