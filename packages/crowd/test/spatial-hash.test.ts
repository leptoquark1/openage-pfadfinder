import { describe, expect, it } from 'vitest';
import { AgentStore } from '../src/agents.ts';
import { NeighborBuffer, SpatialHash } from '../src/spatial-hash.ts';

function randomStore(n: number, seed0: number, size: number): AgentStore {
  const store = new AgentStore();
  let seed = seed0;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let k = 0; k < n; k++) {
    // snapped to a coarse grid, so equal distances (ties) occur
    store.add(Math.round(rnd() * size * 4) / 4, Math.round(rnd() * size * 4) / 4, 0.4, 1, Infinity, 0);
  }
  return store;
}

describe('SpatialHash', () => {
  it('finds the k nearest like brute force, ties by index', () => {
    for (const seed of [1, 2, 3]) {
      const store = randomStore(300, seed, 20);
      const hash = new SpatialHash(20, 20, 3);
      hash.build(store);
      const buf = new NeighborBuffer();
      for (let i = 0; i < store.count; i += 7) {
        const got = hash.nearest(i, 2.5, 6, buf);
        const expected = [...Array(store.count).keys()]
          .filter(j => j !== i)
          .map(j => ({ j, d2: (store.px[j]! - store.px[i]!) ** 2 + (store.py[j]! - store.py[i]!) ** 2 }))
          .filter(o => o.d2 <= 2.5 * 2.5)
          .sort((a, b) => a.d2 - b.d2 || a.j - b.j)
          .slice(0, 6);
        expect([...got.index.slice(0, got.count)]).toEqual(expected.map(o => o.j));
        expect([...got.distSq.slice(0, got.count)]).toEqual(expected.map(o => o.d2));
      }
    }
  });

  it('lists the agents within a radius in ascending index, skipping removed ones', () => {
    const store = randomStore(200, 5, 10);
    store.remove(store.id(3));
    const hash = new SpatialHash(10, 10, 2);
    hash.build(store);
    const got = hash.within(5, 5, 3, []);
    const expected = [...Array(store.count).keys()].filter(
      j => j !== 3 && (store.px[j]! - 5) ** 2 + (store.py[j]! - 5) ** 2 <= 9,
    );
    expect(got).toEqual(expected);
    expect(new SpatialHash(10, 10, 2).within(5, 5, 3, [1, 2])).toEqual([]);
  });

  it('clamps agents outside the map into the border buckets', () => {
    const store = new AgentStore();
    store.add(-5, -5, 0.4, 1, Infinity, 0);
    store.add(50, 50, 0.4, 1, Infinity, 0);
    const hash = new SpatialHash(10, 10, 2);
    hash.build(store);
    expect(hash.within(-5, -5, 1, [])).toEqual([0]);
    expect(hash.within(50, 50, 1, [])).toEqual([1]);
  });

  it('returns nothing for k = 0 and grows past its buffers', () => {
    const store = randomStore(500, 9, 4);
    const hash = new SpatialHash(4, 4, 4);
    hash.build(store);
    const buf = new NeighborBuffer();
    expect(hash.nearest(0, 10, 0, buf).count).toBe(0);
    expect(hash.nearest(0, 10, 64, buf).count).toBe(64);
    expect(hash.gather(2, 2, 10)).toBe(500);
  });
});

describe('AgentStore', () => {
  it('keeps the id order through removals and growth', () => {
    const store = new AgentStore();
    for (let k = 0; k < 40; k++) {
      store.add(k, 0, 0.4, 1, Infinity, k % 3);
    }
    for (const id of [0, 5, 6, 39]) {
      expect(store.remove(id)).toBe(true);
    }
    expect(store.remove(5)).toBe(false);
    store.compact();
    store.compact();
    expect(store.count).toBe(36);
    for (let i = 1; i < store.count; i++) {
      expect(store.id(i)).toBeGreaterThan(store.id(i - 1));
      expect(store.x(i)).toBe(store.id(i));
      expect(store.indexOf(store.id(i))).toBe(i);
    }
    expect(store.indexOf(5)).toBe(-1);
    expect(store.group(0)).toBe(1);
    expect(store.state(0)).toBe('IDLE');
    store.clear();
    expect(store.count).toBe(0);
  });
});
