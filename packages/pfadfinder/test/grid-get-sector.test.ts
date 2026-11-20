import { describe, expect, it } from 'vitest';
import { CostField } from '../src/lib/core/cost-field.js';
import { Grid } from '../src/lib/graph/grid.js';
import { Sector } from '../src/lib/graph/sector.js';

const sector = (id: number, x: number, y: number) => new Sector(id, { x, y }, new CostField(4));

describe('Grid.getSector by id', () => {
  it('finds sectors whose id is their index', () => {
    const sectors = [sector(0, 0, 0), sector(1, 1, 0), sector(2, 0, 1), sector(3, 1, 1)];
    const grid = new Grid(0, { width: 2, height: 2 }, sectors);

    for (const s of sectors) {
      expect(grid.getSector(s.getId())).toBe(s);
    }
    expect(grid.getSector(4)).toBeUndefined();
    expect(grid.getSector(-1)).toBeUndefined();
  });

  it('still finds sectors with ids of their own', () => {
    // 1 is both an id and an index here, of different sectors
    const sectors = [sector(7, 0, 0), sector(40, 1, 0), sector(1, 0, 1)];
    const grid = new Grid(0, { width: 2, height: 2 }, 4);
    for (const s of sectors) {
      grid.addSector(s);
    }

    for (const s of sectors) {
      expect(grid.getSector(s.getId())).toBe(s);
    }
    expect(grid.getSector(0)).toBeUndefined();
    expect(grid.getSector(2)).toBeUndefined();
  });
});
