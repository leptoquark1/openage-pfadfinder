import { describe, expect, it } from 'vitest';
import { FlowField } from '../src/lib/core/flow-field.js';
import { IntegrationField } from '../src/lib/core/integration-field.js';
import { FieldCache, makeCacheKey } from '../src/lib/pathfinding/field-cache.js';

function entry(costFieldVersion: number) {
  return {
    integrationField: new IntegrationField(4),
    flowField: new FlowField(4),
    costFieldVersion,
  };
}

describe('FieldCache', () => {
  it('builds keys from portal id and sector id', () => {
    expect(makeCacheKey(3, 7)).toBe('3:7');
    expect(makeCacheKey(37, 0)).not.toBe(makeCacheKey(3, 70));
  });

  it('stores, reads and evicts entries', () => {
    const cache = new FieldCache();
    const key = makeCacheKey(1, 2);
    const stored = entry(5);

    expect(cache.isCached(key)).toBe(false);
    expect(cache.getIntegrationField(key)).toBeUndefined();
    expect(cache.getFlowField(key)).toBeUndefined();
    expect(cache.getCostFieldVersion(key)).toBeUndefined();

    cache.add(key, stored);
    expect(cache.isCached(key)).toBe(true);
    expect(cache.size).toBe(1);
    expect(cache.get(key)).toBe(stored);
    expect(cache.getIntegrationField(key)).toBe(stored.integrationField);
    expect(cache.getFlowField(key)).toBe(stored.flowField);
    expect(cache.getCostFieldVersion(key)).toBe(5);

    expect(cache.evict(key)).toBe(true);
    expect(cache.evict(key)).toBe(false);
    expect(cache.isCached(key)).toBe(false);
    expect(cache.size).toBe(0);
  });

  it('updates the cost field version of an existing entry only', () => {
    const cache = new FieldCache();
    const key = makeCacheKey(1, 2);
    cache.add(key, entry(5));

    cache.setCostFieldVersion(key, 9);
    expect(cache.getCostFieldVersion(key)).toBe(9);

    cache.setCostFieldVersion(makeCacheKey(4, 4), 9);
    expect(cache.isCached(makeCacheKey(4, 4))).toBe(false);
  });

  it('clears all entries', () => {
    const cache = new FieldCache();
    cache.add(makeCacheKey(1, 2), entry(0));
    cache.add(makeCacheKey(2, 1), entry(0));
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
