import type { Vec2 } from '../vec2.js';

/**
 * A unit direction to separate two agents that stand on exactly the same
 * spot, derived from their ids only: the lower id gets the direction, the
 * higher id its opposite, so the pair always splits the same way.
 */
export function fallbackDirection(self: number, other: number, out: Vec2): Vec2 {
  const lo = Math.min(self, other);
  const hi = Math.max(self, other);
  let h = Math.imul(lo ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(hi ^ 0xc2b2ae35, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  const angle = ((h >>> 0) / 0x100000000) * Math.PI * 2;
  const sign = self === lo ? 1 : -1;
  out.x = Math.cos(angle) * sign;
  out.y = Math.sin(angle) * sign;
  return out;
}
