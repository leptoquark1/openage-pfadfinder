import {
  CostField,
  type Grid,
  IntegrationField,
  type Portal,
  type PortalNode,
  type PortalStarResult,
  portalAStar,
} from '@leptoquark1/openage-pfadfinder';
import {
  INTEGRATED_COST_UNREACHABLE,
  type PortalId,
  type SectorId,
  type TileDelta,
} from '@leptoquark1/openage-pfadfinder/shared';

/**
 * The guide animates what the library really does instead of re-implementing
 * it. The algorithms run unchanged on the public API; these wrappers only
 * watch them: a cost field that reports each read, and a node map that
 * reports each visit of the A* search.
 */

/** One cell of an integration field after a write, in the order they happened. */
export interface FieldWrite {
  readonly idx: number;
  readonly cost: number;
  readonly flags: number;
}

class ObservedCostField extends CostField {
  onRead: () => void = () => {};

  override getCosts(): Uint8Array {
    return new Proxy(super.getCosts(), {
      get: (cells, key) => {
        if (typeof key === 'string' && /^\d+$/.test(key)) {
          this.onRead();
        }
        const value = Reflect.get(cells, key, cells);
        return typeof value === 'function' ? value.bind(cells) : value;
      },
    });
  }
}

export interface ObservedField {
  readonly field: IntegrationField;
  readonly writes: readonly FieldWrite[];
  /** Number of writes after each stage. */
  readonly stageEnds: readonly number[];
}

/**
 * Run integration stages on a fresh field and record every cell they change.
 * The field is compared whenever the algorithm reads a cost, which it does
 * between its writes, so the recorded order is the order of the wave.
 */
export function observeField(
  costs: Uint8Array,
  size: number,
  stages: readonly ((costField: CostField, field: IntegrationField) => void)[],
): ObservedField {
  const costField = new ObservedCostField(size);
  costField.setCosts(costs);
  const field = new IntegrationField(size);
  const knownCosts = field.getCosts().slice();
  const knownFlags = field.getFlagsArray().slice();
  const writes: FieldWrite[] = [];

  const collect = () => {
    const fieldCosts = field.getCosts();
    const fieldFlags = field.getFlagsArray();
    for (let idx = 0; idx < fieldCosts.length; idx++) {
      if (fieldCosts[idx] !== knownCosts[idx] || fieldFlags[idx] !== knownFlags[idx]) {
        knownCosts[idx] = fieldCosts[idx]!;
        knownFlags[idx] = fieldFlags[idx]!;
        writes.push({ idx, cost: fieldCosts[idx]!, flags: fieldFlags[idx]! });
      }
    }
  };
  costField.onRead = collect;

  const stageEnds: number[] = [];
  for (const stage of stages) {
    stage(costField, field);
    collect();
    stageEnds.push(writes.length);
  }
  return { field, writes, stageEnds };
}

/** Field contents after the first `count` writes. */
export function replayField(
  writes: readonly FieldWrite[],
  count: number,
  size: number,
): { costs: Uint16Array; flags: Uint8Array } {
  const costs = new Uint16Array(size * size).fill(INTEGRATED_COST_UNREACHABLE);
  const flags = new Uint8Array(size * size);
  const end = Math.min(count, writes.length);
  for (let i = 0; i < end; i++) {
    const write = writes[i]!;
    costs[write.idx] = write.cost;
    flags[write.idx] = write.flags;
  }
  return { costs, flags };
}

type SearchNode = NonNullable<PortalNode['search']>;

export interface AStarNodeState {
  readonly id: PortalId;
  readonly g: number;
  readonly h: number;
  readonly f: number;
  readonly closed: boolean;
  readonly prev: PortalId | null;
  readonly entry: SectorId;
}

export type AStarEvent =
  | { readonly kind: 'seed'; readonly portal: PortalId; readonly states: readonly AStarNodeState[] }
  | { readonly kind: 'pop'; readonly portal: PortalId; readonly states: readonly AStarNodeState[] }
  | {
      readonly kind: 'relax';
      readonly portal: PortalId;
      readonly from: PortalId;
      readonly outcome: 'added' | 'improved' | 'skipped';
      readonly states: readonly AStarNodeState[];
    };

/** Node map that reports visits and the search state set on its nodes. */
class ObservedNodes extends Map<PortalId, PortalNode> {
  onVisit: (id: PortalId) => void = () => {};
  onSearch: (id: PortalId, node: SearchNode) => void = () => {};

  override get(id: PortalId): PortalNode | undefined {
    const node = super.get(id);
    if (!node) {
      return undefined;
    }
    this.onVisit(id);
    return new Proxy(node, {
      set: (target, key, value) => {
        if (key === 'search' && value) {
          this.onSearch(id, value as SearchNode);
        }
        return Reflect.set(target, key, value);
      },
    });
  }
}

const stateOf = (id: PortalId, node: SearchNode): AStarNodeState => ({
  id,
  g: node.currentCost,
  h: node.heuristicCost,
  f: node.priority,
  closed: node.closed,
  prev: node.prev?.portalNode.portal.getId() ?? null,
  entry: node.entrySector,
});

const sameState = (a: AStarNodeState, b: AStarNodeState): boolean =>
  a.g === b.g && a.h === b.h && a.prev === b.prev && a.entry === b.entry;

export interface ObservedSearch {
  readonly result: PortalStarResult;
  readonly events: readonly AStarEvent[];
}

/** Run the real `portalAStar()` and record its seeds, pops and relaxations. */
export function observeAStar(
  grid: Grid,
  startPortals: Portal[],
  targetPortals: Portal[],
  target: TileDelta,
  startSector: SectorId,
  start: TileDelta,
): ObservedSearch {
  const observed = new ObservedNodes(grid.getPortalMap());
  const nodes = new Map<PortalId, SearchNode>();
  const events: AStarEvent[] = [];
  const closed = new Set<PortalId>();
  let current: PortalId | null = null;
  let pending: { id: PortalId; before: Map<PortalId, AStarNodeState> } | null = null;

  const snapshot = (): Map<PortalId, AStarNodeState> => {
    const states = new Map<PortalId, AStarNodeState>();
    for (const [id, node] of nodes) {
      states.set(id, stateOf(id, node));
    }
    return states;
  };

  /** Turn what changed since the last visit into events. */
  const settle = () => {
    const after = snapshot();
    if (pending) {
      const { id, before } = pending;
      const was = before.get(id);
      const now = after.get(id);
      const states = new Map(before);
      if (now) {
        states.set(id, { ...now, closed: was?.closed ?? false });
      }
      const list = [...states.values()];
      if (current === null) {
        events.push({ kind: 'seed', portal: id, states: list });
      } else {
        const outcome = !was ? 'added' : now && !sameState(was, now) ? 'improved' : 'skipped';
        events.push({ kind: 'relax', portal: id, from: current, outcome, states: list });
      }
      pending = null;
    }

    const popped = [...after.values()].filter(state => state.closed && !closed.has(state.id));
    popped.sort((a, b) => a.f - b.f);
    for (const state of popped) {
      closed.add(state.id);
      current = state.id;
      events.push({ kind: 'pop', portal: state.id, states: [...after.values()] });
    }
  };

  observed.onSearch = (id, node) => nodes.set(id, node);
  observed.onVisit = id => {
    settle();
    pending = { id, before: snapshot() };
  };

  const result = portalAStar(grid, startPortals, targetPortals, observed, target, startSector, start);
  settle();

  // The search returns on popping a target, before it marks the node closed.
  const last = result.portals[result.portals.length - 1];
  if (result.found && last) {
    const id = last.getId();
    const states = [...snapshot().values()].map(state => (state.id === id ? { ...state, closed: true } : state));
    events.push({ kind: 'pop', portal: id, states });
  }
  return { result, events };
}
