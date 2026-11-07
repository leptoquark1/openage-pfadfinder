# @leptoquark1/openage-pfadfinder

## 1.1.0

### Minor Changes

- 3cb69f2: `Grid.rebuildPortals()` no longer uses up portal ids on portals that survive a rebuild; only new portals take an id. `Sector.findPortals()` accepts an id allocator `() => PortalId` instead of a start id, and an optional list of existing portals (`reuse`) that are returned again when they span a found range. `Portal.spans()` compares a portal with a cell range. Existing calls with a start id keep working; see "Portal ids with `findPortals`" in docs/API.md for when to use the new parameters and how to migrate.
- ddd9e79: The portal field cache of a `Pathfinder` mixed up grids: with several grids, or a grid replaced under the same id via `addGrid()`, a route could follow a cached flow field of another grid and step onto impassable cells. Each cost field now has its own cache, keyed by the portal's cell range: several grids no longer evict each other's fields, and fields of dropped portals or replaced grids no longer pile up. `FieldCache` gains a `version` field for the cost field version its contents belong to.

### Patch Changes

- ddd9e79: `Grid.updateCosts()`/`rebuildPortals()` gave out portal ids twice after repeated updates, or right away for a grid built from existing sectors (`new Grid(id, size, sectors)`); routes could not be found until the grid was rebuilt.

## 1.0.0

### Major Changes

- 00d4875: Initial public release of the library extracted from the OpenAge pathfinding work — a dependency-free TypeScript port of [openage](https://github.com/SFTtech/openage)'s flow-field pathfinding, based on _Crowd Pathfinding and Steering Using Flow Field Tiles_ by Elijah Emerson.
  
  Highlights:
  
  - Two-stage hierarchical pathfinding: high-level Portal A* over the sector/portal graph, followed by low-level per-sector flow fields
  - Full field pipeline — `CostField` → `IntegrationField` (Dijkstra-like wavefront with Bresenham line-of-sight shadowcasting) → `FlowField` (8-connected gradient descent) — with integration/flow fields cached per portal-sector pair
  - Public API (`.`): `Pathfinder`, `Grid`, `Sector`, `Portal`, `CostField`; shared subpath (`./shared`): constants, enums/types and coordinate/cost-map helpers
  - Typed-array-backed field storage matching the C++ `uint8_t`/`uint16_t` data layout, `BinaryHeap` priority queue for A*
  - ESM-only package shipping TypeScript declarations; requires Node.js >= 20
