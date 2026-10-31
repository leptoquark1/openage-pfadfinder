# @leptoquark1/openage-pfadfinder

## 1.0.0

### Major Changes

- 00d4875: Initial public release of the library extracted from the OpenAge pathfinding work — a dependency-free TypeScript port of [openage](https://github.com/SFTtech/openage)'s flow-field pathfinding, based on _Crowd Pathfinding and Steering Using Flow Field Tiles_ by Elijah Emerson.
  
  Highlights:
  
  - Two-stage hierarchical pathfinding: high-level Portal A* over the sector/portal graph, followed by low-level per-sector flow fields
  - Full field pipeline — `CostField` → `IntegrationField` (Dijkstra-like wavefront with Bresenham line-of-sight shadowcasting) → `FlowField` (8-connected gradient descent) — with integration/flow fields cached per portal-sector pair
  - Public API (`.`): `Pathfinder`, `Grid`, `Sector`, `Portal`, `CostField`; shared subpath (`./shared`): constants, enums/types and coordinate/cost-map helpers
  - Typed-array-backed field storage matching the C++ `uint8_t`/`uint16_t` data layout, `BinaryHeap` priority queue for A*
  - ESM-only package shipping TypeScript declarations; requires Node.js >= 20
