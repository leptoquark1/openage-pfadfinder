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

describe('FieldCache target fields', () => {
  it('returns the entry it drops beyond MAX_TARGETS', () => {
    const cache = new FieldCache();
    const entries = Array.from({ length: FieldCache.MAX_TARGETS + 1 }, () => entry(0));
    for (let cell = 0; cell < FieldCache.MAX_TARGETS; cell++) {
      expect(cache.addTarget(cell, entries[cell]!)).toBeUndefined();
    }
    expect(cache.getTarget(0)).toBe(entries[0]); // now the most recently used
    expect(cache.addTarget(99, entries[FieldCache.MAX_TARGETS]!)).toBe(entries[1]);
    expect(cache.targetCount).toBe(FieldCache.MAX_TARGETS);
    expect(cache.getTarget(1)).toBeUndefined();
  });

  it('returns a replaced entry of the same cell, but not a re-added one', () => {
    const cache = new FieldCache();
    const first = entry(0);
    const second = entry(1);
    cache.addTarget(5, first);
    expect(cache.addTarget(5, first)).toBeUndefined();
    expect(cache.addTarget(5, second)).toBe(first);
    expect(cache.getTarget(5)).toBe(second);
  });

  it('evicts single targets and lists what it holds', () => {
    const cache = new FieldCache();
    const portal = entry(0);
    const target = entry(0);
    cache.add(makeCacheKey(1, 2), portal);
    cache.addTarget(7, target);

    expect([...cache.portalEntries()]).toEqual([[makeCacheKey(1, 2), portal]]);
    expect([...cache.targetEntries()]).toEqual([[7, target]]);
    expect(cache.evictTarget(7)).toBe(true);
    expect(cache.evictTarget(7)).toBe(false);
    expect(cache.targetCount).toBe(0);
    expect(cache.size).toBe(1);
  });
});
