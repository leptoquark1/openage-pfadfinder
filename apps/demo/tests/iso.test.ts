import { describe, expect, it } from 'vitest';
import { cornerHeights, fitIso, pickSurface, project, surfaceHeight } from '../src/view/iso.js';
import { MAX_HEIGHT } from '../src/world/elevation.js';

const cols = 16;
const rows = 12;
const width = 800;
const height = 600;

function hill(): Uint8Array {
  return Uint8Array.from({ length: cols * rows }, (_, idx) => {
    const distance = Math.hypot((idx % cols) - 8, Math.floor(idx / cols) - 6);
    return Math.max(0, Math.round(MAX_HEIGHT - distance * 40));
  });
}

function roundTrip(heights: Uint8Array, u: number, v: number) {
  const projection = fitIso(cols, rows, width, height);
  const corners = cornerHeights(heights, cols, rows);
  const screen = project(projection, u, v, surfaceHeight(corners, cols, rows, u, v));
  return pickSurface(projection, corners, cols, rows, screen);
}

describe('isometric projection', () => {
  it('keeps the whole map inside the viewport', () => {
    const projection = fitIso(cols, rows, width, height);
    const points = [
      project(projection, 0, 0, MAX_HEIGHT),
      project(projection, cols, 0, 0),
      project(projection, 0, rows, 0),
      project(projection, cols, rows, 0),
    ];
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(width);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(height);
    }
  });

  it('picks the projected cell back on flat ground', () => {
    const hit = roundTrip(new Uint8Array(cols * rows), 3.5, 7.25);
    expect(hit!.u).toBeCloseTo(3.5, 1);
    expect(hit!.v).toBeCloseTo(7.25, 1);
  });

  it('picks the projected cell back on the near side of a hill', () => {
    const hit = roundTrip(hill(), 9.5, 7.5);
    expect(Math.floor(hit!.u)).toBe(9);
    expect(Math.floor(hit!.v)).toBe(7);
  });

  it('picks the front cell when a hill hides the cell behind it', () => {
    const heights = hill();
    const projection = fitIso(cols, rows, width, height);
    const corners = cornerHeights(heights, cols, rows);
    const behind = project(projection, 5.5, 3.5, surfaceHeight(corners, cols, rows, 5.5, 3.5));
    const hit = pickSurface(projection, corners, cols, rows, behind)!;
    expect(hit.u + hit.v).toBeGreaterThan(5.5 + 3.5);
  });

  it('returns null outside the map', () => {
    const projection = fitIso(cols, rows, width, height);
    const corners = cornerHeights(new Uint8Array(cols * rows), cols, rows);
    expect(pickSurface(projection, corners, cols, rows, { x: 2, y: 2 })).toBeNull();
  });
});
