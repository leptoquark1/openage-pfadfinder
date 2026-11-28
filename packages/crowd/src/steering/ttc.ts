/**
 * Time until two discs touch, from their relative position `x = pᵢ − pⱼ`,
 * relative velocity `v = vᵢ − vⱼ` and combined radius `r`.
 *
 * `Infinity` when they never touch at the current velocities (moving apart,
 * no relative motion, or passing each other), 0 when they already overlap.
 */
export function timeToCollision(x: number, y: number, vx: number, vy: number, r: number): number {
  const c = x * x + y * y - r * r;
  if (c < 0) {
    return 0;
  }
  const a = vx * vx + vy * vy;
  const b = x * vx + y * vy;
  if (a < 1e-12 || b >= 0) {
    return Infinity;
  }
  const d = b * b - a * c;
  if (d <= 0) {
    return Infinity;
  }
  return (-b - Math.sqrt(d)) / a;
}
