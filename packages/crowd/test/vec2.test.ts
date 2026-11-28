import { describe, expect, it } from 'vitest';
import {
  add,
  addScaled,
  clampLength,
  copy,
  cross,
  distanceSq,
  dot,
  length,
  lengthSq,
  normalize,
  perpRight,
  scale,
  set,
  sub,
  vec2,
} from '../src/vec2.ts';

describe('vec2', () => {
  it('creates vectors, zero by default', () => {
    expect(vec2()).toEqual({ x: 0, y: 0 });
    expect(vec2(1, -2)).toEqual({ x: 1, y: -2 });
  });

  it('writes into out and returns it', () => {
    const out = vec2();
    expect(set(out, 3, 4)).toBe(out);
    expect(out).toEqual({ x: 3, y: 4 });
    expect(copy(vec2(), out)).toEqual({ x: 3, y: 4 });
  });

  it('allows out to alias an input', () => {
    const a = vec2(1, 2);
    add(a, a, a);
    expect(a).toEqual({ x: 2, y: 4 });
    sub(a, a, vec2(1, 1));
    expect(a).toEqual({ x: 1, y: 3 });
    scale(a, a, 2);
    expect(a).toEqual({ x: 2, y: 6 });
    addScaled(a, a, vec2(1, -1), 0.5);
    expect(a).toEqual({ x: 2.5, y: 5.5 });
  });

  it('computes products and lengths', () => {
    const a = vec2(3, 4);
    const b = vec2(-4, 3);
    expect(dot(a, b)).toBe(0);
    expect(cross(vec2(1, 0), vec2(0, 1))).toBe(1);
    expect(lengthSq(a)).toBe(25);
    expect(length(a)).toBe(5);
    expect(distanceSq(a, b)).toBe(50);
  });

  it('normalizes, and maps (almost) zero to zero', () => {
    expect(normalize(vec2(), vec2(0, -5))).toEqual({ x: 0, y: -1 });
    expect(normalize(vec2(), vec2(1e-10, 0))).toEqual({ x: 0, y: 0 });
  });

  it('clamps only vectors longer than max', () => {
    expect(clampLength(vec2(), vec2(3, 4), 10)).toEqual({ x: 3, y: 4 });
    expect(clampLength(vec2(), vec2(3, 4), 2.5)).toEqual({ x: 1.5, y: 2 });
  });

  it('turns right of the heading in the grid frame (se pointing down)', () => {
    // walking east, right is south; walking south, right is west
    expect(perpRight(vec2(), vec2(1, 0))).toEqual({ x: -0, y: 1 });
    expect(perpRight(vec2(), vec2(0, 1))).toEqual({ x: -1, y: 0 });
    const a = vec2(2, 1);
    perpRight(a, a);
    expect(a).toEqual({ x: -1, y: 2 });
  });
});
