# openage Pfadfinder

> openage Pfadfinder - A TypeScript port of the Pathfinding Subsystem

A dependency-free, native ESM TypeScript library implementing two-stage hierarchical flow-field
pathfinding — a port of the [openage](https://github.com/SFTtech/openage) pathfinding system based on
_Crowd Pathfinding and Steering Using Flow Field Tiles_ by Elijah Emerson.

Learn more about Pathfinding [here](https://github.com/SFTtech/openage/tree/master/doc/code/pathfinding)

## Architecture

Two-stage hierarchical pathfinding:

1. **High-Level (Portal A\*)** — A* search on the portal graph to find which sectors to traverse
2. **Low-Level (Flow Fields)** — Per-sector cost → integration → flow field pipeline

```text
PathRequest → Grid → identify start/target sectors
  → Portal A* (high-level path through sectors)
  → Flow-Field integration per sector (low-level directions)
  → Waypoint extraction
  → Path returned
```

### Core Concepts

| Component            | Description                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------- |
| **CostField**        | Per-cell movement cost (Uint8Array, 1–254 passable, 255 impassable)                           |
| **IntegrationField** | Accumulated cost from target via wavefront + LOS (Uint16Array + Uint8Array flags)             |
| **FlowField**        | Per-cell movement direction toward lowest-cost neighbor (Uint8Array, 4-bit dir + 4-bit flags) |
| **Sector**           | Square grid subdivision with its own CostField + Portals                                      |
| **Portal**           | Bidirectional gateway between adjacent sectors                                                |
| **Grid**             | Collection of sectors, manages portal graph                                                   |
| **Integrator**       | Orchestrates field computation with caching                                                   |
| **Pathfinder**       | Main interface — `getPath()` coordinates both stages                                          |

### Algorithms

- **LOS Integration** — Wavefront with Bresenham line-of-sight shadowcasting
- **Cost Integration** — Dijkstra-like wavefront expansion (4-connected)
- **Flow Field Build** — Gradient descent on integration costs (8-connected)
- **Portal A\*** — A* on the portal graph with Euclidean heuristic
- **Field Caching** — Integration/flow fields cached per portal-sector pair

## Installation

```bash
pnpm add @leptoquark1/openage-pfadfinder
npm install @leptoquark1/openage-pfadfinder
yarn add @leptoquark1/openage-pfadfinder
```

Requires Node.js `>=20`. The package is ESM-only and ships TypeScript declarations.

## Usage

```typescript
import { Pathfinder, Grid, Sector, CostField } from '@leptoquark1/openage-pfadfinder';
import { COST_MIN, COST_IMPASSABLE } from '@leptoquark1/openage-pfadfinder/shared';

// Create a 4×4 grid with 10×10 sectors
const grid = new Grid(0, { width: 4, height: 4 }, 10);

// Populate sectors with cost fields
let sectorId = 0;
for (let sy = 0; sy < 4; sy++) {
  for (let sx = 0; sx < 4; sx++) {
    const cf = new CostField(10);
    cf.setCosts(new Uint8Array(100).fill(COST_MIN));
    grid.addSector(new Sector(sectorId++, { x: sx, y: sy }, cf));
  }
}

// Initialize portals and portal graph
grid.initPortals();
grid.initPortalNodes();

// Create pathfinder
const pathfinder = new Pathfinder();
pathfinder.addGrid(grid);

// Find a path
const path = pathfinder.getPath({
  gridId: 0,
  start: { ne: 2, se: 3 },
  target: { ne: 35, se: 28 },
});

console.log(path.result); // PathResult.FOUND (0)
console.log(path.waypoints); // [{ ne: 2, se: 3 }, { ne: 12, se: 10 }, ...]
```

For the full API reference — every class, field and helper with signatures — see [docs/API.md](docs/API.md).

## Performance

All fields use Typed Arrays (`Uint8Array`/`Uint16Array`) matching the C++ `uint8_t`/`uint16_t` data
layout. The BinaryHeap provides O(log n) priority queue operations for A*.

| Aspect            | C++ openage         | TypeScript             |
| ----------------- | ------------------- | ---------------------- |
| Cost Field        | `vector<uint8_t>`   | `Uint8Array`           |
| Integration Cost  | `uint16_t`          | `Uint16Array`          |
| Integration Flags | `uint8_t`           | `Uint8Array`           |
| Flow Field        | `uint8_t` (4+4 bit) | `Uint8Array` (4+4 bit) |
| Priority Queue    | PairingHeap         | BinaryHeap             |

## Project structure

```text
src/index.ts          Public package entry point (subpath ".")
src/lib/core/         Cost/integration/flow fields, integrator
src/lib/graph/        Grid, Sector, Portal
src/lib/internal/     BinaryHeap, Bresenham line
src/lib/pathfinding/  Pathfinder, portal graph A*, field cache, routing
src/shared/index.ts   Shared subpath entry (subpath "./shared")
src/shared/           Constants, bit ops, coordinates, cost-map helpers, types
test/                 Vitest test suite
.github/workflows/    CI and release automation
.changeset/           Changesets configuration
```

## Development

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
pnpm check:package
```

Run everything that CI runs:

```bash
pnpm check
```

## License

[GPL-3.0-or-later](LICENSE) (same as openage)
