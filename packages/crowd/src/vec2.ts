/**
 * A 2D vector in cell units: `x` along the `ne` axis, `y` along the `se`
 * axis of the pathfinder's grid. Cell (ne, se) covers `[ne, ne + 1) × [se, se + 1)`,
 * so its center is `(ne + 0.5, se + 0.5)`.
 */
export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Below this squared length a vector counts as zero, e.g. for `normalize()`.
 */
export const VEC2_EPSILON_SQ = 1e-18;

/** A new vector. */
export function vec2(x = 0, y = 0): Vec2 {
  return { x, y };
}

/*
 * The helpers below write into `out` and return it, so the hot path of a
 * simulation tick allocates nothing. `out` may be one of the inputs.
 */

export function set(out: Vec2, x: number, y: number): Vec2 {
  out.x = x;
  out.y = y;
  return out;
}

export function copy(out: Vec2, a: Readonly<Vec2>): Vec2 {
  out.x = a.x;
  out.y = a.y;
  return out;
}

export function add(out: Vec2, a: Readonly<Vec2>, b: Readonly<Vec2>): Vec2 {
  out.x = a.x + b.x;
  out.y = a.y + b.y;
  return out;
}

export function sub(out: Vec2, a: Readonly<Vec2>, b: Readonly<Vec2>): Vec2 {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  return out;
}

export function scale(out: Vec2, a: Readonly<Vec2>, s: number): Vec2 {
  out.x = a.x * s;
  out.y = a.y * s;
  return out;
}

/** `out = a + b · s` */
export function addScaled(out: Vec2, a: Readonly<Vec2>, b: Readonly<Vec2>, s: number): Vec2 {
  out.x = a.x + b.x * s;
  out.y = a.y + b.y * s;
  return out;
}

export function dot(a: Readonly<Vec2>, b: Readonly<Vec2>): number {
  return a.x * b.x + a.y * b.y;
}

/** z component of the 3D cross product; > 0 when `b` lies counter-clockwise of `a`. */
export function cross(a: Readonly<Vec2>, b: Readonly<Vec2>): number {
  return a.x * b.y - a.y * b.x;
}

export function lengthSq(a: Readonly<Vec2>): number {
  return a.x * a.x + a.y * a.y;
}

export function length(a: Readonly<Vec2>): number {
  return Math.sqrt(a.x * a.x + a.y * a.y);
}

export function distanceSq(a: Readonly<Vec2>, b: Readonly<Vec2>): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** Unit vector of `a`; the zero vector when `a` is (almost) zero. */
export function normalize(out: Vec2, a: Readonly<Vec2>): Vec2 {
  const lenSq = a.x * a.x + a.y * a.y;
  if (lenSq <= VEC2_EPSILON_SQ) {
    return set(out, 0, 0);
  }
  return scale(out, a, 1 / Math.sqrt(lenSq));
}

/** `a` shortened to at most `max`; unchanged when it is shorter. */
export function clampLength(out: Vec2, a: Readonly<Vec2>, max: number): Vec2 {
  const lenSq = a.x * a.x + a.y * a.y;
  if (lenSq <= max * max) {
    return copy(out, a);
  }
  return scale(out, a, max / Math.sqrt(lenSq));
}

/**
 * `a` rotated by 90° towards the right of its own heading, in the grid's
 * frame (`x` = ne, `y` = se). With `se` pointing down on screen, as in the
 * demo, this is the right-hand side as seen by a unit walking along `a`.
 */
export function perpRight(out: Vec2, a: Readonly<Vec2>): Vec2 {
  const { x, y } = a;
  out.x = -y;
  out.y = x;
  return out;
}
