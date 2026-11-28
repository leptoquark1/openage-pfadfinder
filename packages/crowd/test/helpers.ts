import { buildGrid, COST_IMPASSABLE, COST_MIN, type Grid, Pathfinder } from '@leptoquark1/openage-pfadfinder';
import { AgentStore } from '../src/agents.ts';
import type { CrowdContext } from '../src/context.ts';
import { type CrowdOptions, CrowdSimulation } from '../src/simulation.ts';
import { NeighborBuffer } from '../src/spatial-hash.ts';

export interface World {
  readonly costs: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly grid: Grid;
  readonly pathfinder: Pathfinder;
}

/**
 * A world from rows of `.` (free) and `#` (wall), padded with free cells to
 * a multiple of the sector size.
 */
export function worldFromRows(rows: readonly string[], sectorSize = 8): World {
  const width = Math.ceil(Math.max(...rows.map(r => r.length)) / sectorSize) * sectorSize;
  const height = Math.ceil(rows.length / sectorSize) * sectorSize;
  const costs = new Uint8Array(width * height).fill(COST_MIN);
  rows.forEach((row, se) => {
    for (let ne = 0; ne < row.length; ne++) {
      if (row[ne] === '#') {
        costs[ne + se * width] = COST_IMPASSABLE;
      }
    }
  });
  return worldFromCosts(costs, width, height, sectorSize);
}

/** An open world of the given size. */
export function openWorld(width: number, height: number, sectorSize = 8): World {
  return worldFromCosts(new Uint8Array(width * height).fill(COST_MIN), width, height, sectorSize);
}

export function worldFromCosts(costs: Uint8Array, width: number, height: number, sectorSize = 8): World {
  const grid = buildGrid(costs, { width, height }, sectorSize);
  const pathfinder = new Pathfinder();
  pathfinder.addGrid(grid);
  return { costs, width, height, grid, pathfinder };
}

export function simulation(world: World, options: Partial<CrowdOptions> = {}): CrowdSimulation {
  return new CrowdSimulation(world.pathfinder, 0, { timestep: 1 / 20, ...options });
}

/** Run until `done()` or `maxTicks`; returns the ticks run. */
export function runUntil(sim: CrowdSimulation, done: () => boolean, maxTicks: number): number {
  for (let t = 0; t < maxTicks; t++) {
    if (done()) {
      return t;
    }
    sim.step();
  }
  return maxTicks;
}

/** Smallest gap between the bodies of any two agents over the agents' current positions. */
export function minGap(sim: CrowdSimulation): number {
  const agents = sim.agents;
  let min = Infinity;
  for (let i = 0; i < agents.count; i++) {
    for (let j = i + 1; j < agents.count; j++) {
      const d = Math.hypot(agents.x(i) - agents.x(j), agents.y(i) - agents.y(j));
      min = Math.min(min, d - agents.radius(i) - agents.radius(j));
    }
  }
  return min;
}

/** True when some agent's body overlaps a wall cell by more than `tolerance`. */
export function anyInWall(sim: CrowdSimulation, tolerance = 1e-6): boolean {
  const nav = sim.navigation;
  const agents = sim.agents;
  for (let i = 0; i < agents.count; i++) {
    const x = agents.x(i);
    const y = agents.y(i);
    const r = agents.radius(i) - tolerance;
    for (let se = Math.floor(y - r); se <= Math.floor(y + r); se++) {
      for (let ne = Math.floor(x - r); ne <= Math.floor(x + r); ne++) {
        if (!nav.isBlocked(ne, se)) {
          continue;
        }
        const cx = Math.min(Math.max(x, ne), ne + 1);
        const cy = Math.min(Math.max(y, se), se + 1);
        if (Math.hypot(x - cx, y - cy) < r) {
          return true;
        }
      }
    }
  }
  return false;
}

export interface Body {
  readonly x: number;
  readonly y: number;
  readonly vx?: number;
  readonly vy?: number;
  readonly r?: number;
}

/** A context over loose agents (no grid), with every other agent as neighbor, for unit tests of forces and modifiers. */
export function contextOf(bodies: readonly Body[]): {
  ctx: CrowdContext;
  store: AgentStore;
  neighborsOf: (i: number) => NeighborBuffer;
} {
  const store = new AgentStore();
  for (const b of bodies) {
    const id = store.add(b.x, b.y, b.r ?? 0.4, 2, Infinity, 0);
    const i = store.indexOf(id);
    store.pvx[i] = b.vx ?? 0;
    store.pvy[i] = b.vy ?? 0;
  }
  const nav = {
    width: 1000,
    height: 1000,
    sectorSize: 1000,
    isBlocked: () => false,
    cost: () => COST_MIN,
    sectorAt: () => 0,
  };
  const ctx: CrowdContext = {
    tick: 1,
    dt: 1 / 20,
    agents: store,
    neighbors: { within: (_x, _y, _r, out) => out },
    navigation: nav,
    density: undefined,
  };
  const neighborsOf = (i: number) => {
    const buf = new NeighborBuffer();
    const others = bodies
      .map((b, j) => ({ j, d2: (b.x - bodies[i]!.x) ** 2 + (b.y - bodies[i]!.y) ** 2 }))
      .filter(o => o.j !== i)
      .sort((a, b) => a.d2 - b.d2 || a.j - b.j);
    buf.reserve(others.length);
    others.forEach((o, k) => {
      buf.index[k] = o.j;
      buf.distSq[k] = o.d2;
    });
    buf.count = others.length;
    return buf;
  };
  return { ctx, store, neighborsOf };
}
