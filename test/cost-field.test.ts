import { describe, expect, it } from 'vitest';
import { CostField } from '../src/lib/core/cost-field.js';
import { COST_IMPASSABLE, COST_MIN } from '../src/shared/constants.js';

describe('CostField', () => {
  it('creates a field of the correct size', () => {
    const cf = new CostField(5);
    expect(cf.getSize()).toBe(5);
    expect(cf.getCosts().length).toBe(25);
  });

  it('getCost/setCost by x,y', () => {
    const cf = new CostField(3);
    cf.setCost(1, 2, 42);
    expect(cf.getCost(1, 2)).toBe(42);
  });

  it('getCost/setCost by idx', () => {
    const cf = new CostField(3);
    cf.setCost(4, 99);
    expect(cf.getCost(4)).toBe(99);
  });

  it('getCost/setCost by TileDelta', () => {
    const cf = new CostField(3);
    cf.setCost({ ne: 2, se: 1 }, 77);
    expect(cf.getCost({ ne: 2, se: 1 })).toBe(77);
  });

  it('setCosts from Uint8Array', () => {
    const cf = new CostField(2);
    cf.setCosts(new Uint8Array([1, 2, 3, 4]));
    expect(cf.getCost(0, 0)).toBe(1);
    expect(cf.getCost(1, 1)).toBe(4);
  });

  it('isImpassable detects 255', () => {
    const cf = new CostField(2);
    cf.setCost(0, 0, COST_IMPASSABLE);
    cf.setCost(1, 0, COST_MIN);
    expect(cf.isImpassable(0)).toBe(true);
    expect(cf.isImpassable(1)).toBe(false);
  });

  it('defaults to COST_MIN (1)', () => {
    const cf = new CostField(2);
    expect(cf.getCost(0)).toBe(COST_MIN);
  });

  it('tracks version for dirty detection', () => {
    const cf = new CostField(2);
    const v0 = cf.getVersion();
    cf.setCost(0, 0, 5);
    expect(cf.getVersion()).toBe(v0 + 1);
    expect(cf.isDirty(v0)).toBe(true);

    const v1 = cf.getVersion();
    cf.setCosts(new Uint8Array([1, 2, 3, 4]));
    expect(cf.getVersion()).toBe(v1 + 1);
    expect(cf.isDirty(v1)).toBe(true);
    expect(cf.isDirty(cf.getVersion())).toBe(false);
  });
});
