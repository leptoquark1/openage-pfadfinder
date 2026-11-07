import { describe, expect, it } from 'vitest';
import { bresenhamLine } from '../src/lib/internal/bresenham.js';

describe('bresenhamLine', () => {
  it('returns cells in bounds for corner top-left of target going up-left', () => {
    const size = 10;
    const target = { ne: 5, se: 5 };
    // corner is top-left of target, line goes left and up
    const cells = bresenhamLine(target, 4, 4, size);
    expect(cells.length).toBeGreaterThan(0);
    // All indices should be in range [0, size*size)
    for (const idx of cells) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(size * size);
    }
  });

  it('returns cells for corner bottom-right going right-down', () => {
    const size = 10;
    const target = { ne: 3, se: 3 };
    const cells = bresenhamLine(target, 6, 6, size);
    expect(cells.length).toBeGreaterThan(0);
    for (const idx of cells) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(size * size);
    }
  });

  it('returns empty or boundary cells when corner equals target', () => {
    const size = 5;
    const target = { ne: 2, se: 2 };
    const cells = bresenhamLine(target, 2, 2, size);
    // When corner == target, dx=0 → m=Infinity, special case
    // Just check we don't crash
    expect(Array.isArray(cells)).toBe(true);
  });
});
