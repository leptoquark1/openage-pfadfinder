import { describe, expect, it } from 'vitest';
import { BinaryHeap, type HeapEntry, IntrusiveHeap } from '../src/lib/internal/binary-heap.js';
import { portalAStar } from '../src/lib/pathfinding/portal-graph.js';
import { COST_IMPASSABLE, COST_MIN } from '../src/shared/constants.js';
import { buildGrid } from '../src/shared/cost-map/cost-map.js';
import { makeRandom } from './helpers.js';

const SECTOR = 8;

describe('IntrusiveHeap', () => {
  it('pops in the same order as BinaryHeap, also for equal priorities', () => {
    const rand = makeRandom(99);
    const pick = (n: number) => Math.floor(rand() * n);
    type Entry = HeapEntry & { id: number };
    const intrusive = new IntrusiveHeap<Entry>();
    const generic = new BinaryHeap<number>();
    const live = new Map<number, Entry>();
    let nextId = 0;

    for (let step = 0; step < 5000; step++) {
      const action = rand();
      if (action < 0.5 || live.size === 0) {
        const id = nextId++;
        const priority = pick(12);
        const entry: Entry = { id, priority: 0, index: 0 };
        live.set(id, entry);
        intrusive.push(entry, priority);
        generic.push(id, priority);
      } else if (action < 0.75) {
        const entry = [...live.values()][pick(live.size)]!;
        const priority = pick(12);
        intrusive.update(entry, priority);
        generic.updatePriority(entry.id, priority);
      } else {
        const popped = intrusive.pop()!;
        live.delete(popped.id);
        expect(generic.pop(), `step ${step}`).toBe(popped.id);
      }
      expect(intrusive.size).toBe(generic.size);
      expect(intrusive.peek()?.id).toBe(generic.peek());
    }

    intrusive.clear();
    expect(intrusive.isEmpty).toBe(true);
    expect(intrusive.pop()).toBeUndefined();
  });
});

describe('portalAStar search state', () => {
  /** Three sectors in a row; `cut` splits the middle one, so its two portals do not connect. */
  function setup(cut: boolean) {
    const width = SECTOR * 3;
    const costs = new Uint8Array(width * SECTOR).fill(COST_MIN);
    if (cut) {
      for (let se = 0; se < SECTOR; se++) {
        costs[SECTOR + 4 + se * width] = COST_IMPASSABLE;
      }
    }
    const grid = buildGrid(costs, { width, height: SECTOR }, SECTOR);
    return { grid, sectors: grid.getSectors(), nodes: grid.getPortalMap() };
  }

  const leftover = (nodes: ReturnType<typeof setup>['nodes']) =>
    [...nodes.values()].filter(n => n.search !== undefined);

  it('leaves nothing on the nodes after a route was found', () => {
    const { grid, sectors, nodes } = setup(false);
    const search = () =>
      portalAStar(
        grid,
        sectors[0]!.getPortals(),
        sectors[2]!.getPortals(),
        nodes,
        { ne: SECTOR * 2 + 4, se: 4 },
        sectors[0]!.getId(),
      );
    const first = search();

    expect(first.found).toBe(true);
    expect(first.portals).toHaveLength(2);
    expect(leftover(nodes)).toEqual([]);
    expect(search()).toEqual(first);
  });

  it('leaves nothing on the nodes when no route exists', () => {
    const { grid, sectors, nodes } = setup(true);
    const result = portalAStar(
      grid,
      sectors[0]!.getPortals(),
      sectors[2]!.getPortals(),
      nodes,
      { ne: SECTOR * 2 + 4, se: 4 },
      sectors[0]!.getId(),
    );

    expect(result.found).toBe(false);
    expect(leftover(nodes)).toEqual([]);
  });

  it('clears the nodes when a search fails part way', () => {
    const { grid, sectors, nodes } = setup(false);
    const broken = { ne: 4, se: 4 };
    Object.defineProperty(broken, 'ne', {
      get() {
        throw new Error('stop');
      },
    });

    expect(() =>
      portalAStar(grid, sectors[0]!.getPortals(), sectors[2]!.getPortals(), nodes, broken, sectors[0]!.getId()),
    ).toThrow('stop');
    expect(leftover(nodes)).toEqual([]);
  });
});

describe('Portal derived values', () => {
  const grid = buildGrid(
    new Uint8Array(SECTOR * SECTOR * 2).fill(COST_MIN),
    { width: SECTOR * 2, height: SECTOR },
    SECTOR,
  );
  const portal = grid.getSectors()[0]!.getPortals()[0]!;

  it('gives each side its own range key, stable across calls', () => {
    const [left, right] = [portal.getSector0(), portal.getSector1()];

    expect(portal.getExitRangeKey(left)).toBe(`${left}:0,0:0,${SECTOR - 1}`);
    expect(portal.getExitRangeKey(right)).toBe(`${right}:${SECTOR - 1},0:${SECTOR - 1},${SECTOR - 1}`);
    expect(portal.getExitRangeKey(left)).toBe(portal.getExitRangeKey(left));
    expect(portal.getExitRangeKey(right)).toBe(portal.getExitRangeKey(right));
  });

  it('does not take a foreign sector for one of its sides', () => {
    expect(portal.getExitRangeKey(portal.getSector1())).toMatch(/^1:/);
    expect(portal.getExitRangeKey(7)).toMatch(/^7:/);
  });

  it('derives the entry center of each side, as an object and as numbers', () => {
    const [left, right] = [portal.getSector0(), portal.getSector1()];
    const middle = Math.floor((SECTOR - 1) / 2);

    expect(portal.getEntryCenter(left)).toEqual({ ne: SECTOR - 1, se: middle });
    expect(portal.getEntryCenter(right)).toEqual({ ne: 0, se: middle });
    for (const side of [left, right, 7]) {
      const center = portal.getEntryCenter(side);
      expect([portal.getEntryCenterNe(side), portal.getEntryCenterSe(side)]).toEqual([center.ne, center.se]);
    }
    // a new object per call, so no caller can change another's
    expect(portal.getEntryCenter(left)).not.toBe(portal.getEntryCenter(left));
  });
});
