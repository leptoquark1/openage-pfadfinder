# @leptoquark1/openage-pfadfinder

## 1.3.1

### Patch Changes

- 61f9016: Remove the Node.js `engines` constraint, since the library does not depend on any Node.js APIs.

## 1.3.0

### Minor Changes

- f5aab43: `Integrator.getPortalShared()` returns the cached integration and flow field of a portal themselves, without line of sight and without the copies `getPortal()` makes. `Pathfinder` uses it for the start and transit sectors of a route, which it only reads: a request takes about 15 % less time (0.18 ms → 0.15 ms on a 1024×1024 grid with 4096 sectors), and routes through the same portal share one flow field instead of holding a copy each. The flow fields of `FlowRoute.getSteps()` are therefore read-only outside the target sector; writing to them would change later routes. Routes stay exactly the same.
- c72c950: `Sector.getAreas()` gives the area of each cell: passable cells that reach each other inside the sector share one. The areas are kept until the cost field changes, and `Pathfinder` reads them instead of flood-filling the start and target sector on every request. A request takes about 0.054 ms instead of 0.082 ms on a 256×256 grid with sectors of 16, and about 0.105 ms instead of 0.21 ms on a 512×512 grid with sectors of 32. Routes stay exactly the same, also for a start on an impassable cell.
- b0047d7: `Integrator.getTargetShared()` returns the integration and flow field towards a target cell from a cache that keeps the four most recently used targets per sector, until its cost field changes. `Pathfinder` uses it for the target sector, so units heading for the same cell no longer integrate that sector each: with one shared target, a request takes about 0.017 ms instead of 0.034 ms on a 512×512 grid with sectors of 32, and 0.015 ms instead of 0.075 ms with sectors of 64. All flow fields of `FlowRoute.getSteps()` are therefore read-only now, including the target sector's. Routes stay exactly the same.

### Patch Changes

- f82f7b4: `Grid.getSector(id)` looks the sector up directly instead of searching all sectors, when a sector's id is its index (as `buildGrid()` numbers them). On large grids that search took most of the time: planning a route on a 1024×1024 grid with 4096 sectors takes about 0.24 ms instead of 0.27 ms, the first requests after a build about 0.54 ms instead of 0.86 ms, and `updateCosts()` gets faster as well. Grids whose sectors have other ids work as before.
- 98ffe75: `portalAStar()` does less per portal it looks at: it reads a node's exit costs in place instead of copying them into a new map, keeps the closed mark on its search node instead of in a second set, and computes the heuristic only for a portal it reaches for the first time or at a lower cost. Planning a route takes about 10 % less time (0.21 ms → 0.18 ms on a 1024×1024 grid with 4096 sectors). Routes stay exactly the same.
- 20e10cc: After `Grid.updateCosts()` or `rebuildPortals()`, a route could differ from the one a grid built from scratch from the same costs finds, and be longer: new portals went to the end of their sectors' lists, and A* breaks ties by that order. `Sector.addPortal()` now inserts a portal at its place in edge order (top, left, bottom, right, along an edge by position), so a sector lists its portals the same way however the grid got there, and both grids plan the same routes.
- ea82b30: `Integrator.getPortal()` and `integratePortal()` with line of sight (`withLos`, the default) left most of a sector without a cost when the portal cells did not see the target: only the portal cells themselves were integrated, and the flow field led nowhere. `getPortal()` then cached that field and returned it to later requests without LOS as well. The costs now always come from the whole portal and the LOS marks are added on top; the cache keeps the fields without LOS, so a request gets the same fields whether or not they were cached. `Pathfinder` never asked for LOS on portal fields, so its routes stay the same.
- 4dc91cd: `portalAStar()` keeps its search state on the portal nodes while it runs, and its open set no longer updates a lookup table on every swap. Portals also remember their entry centers and cache keys instead of deriving them per request. A route takes about 45 % less time on a 1024×1024 grid with 4096 sectors (0.14 ms → 0.077 ms), 35 % on a 256×256 grid with sectors of 16 and 27 % on a 512×512 grid with sectors of 32. Routes stay exactly the same, as the heap keeps its order for equal priorities.

## 1.2.0

### Minor Changes

- 53a740d: `Grid.updateCosts()` is up to about four times faster on large grids: it no longer recomputes the exits of every portal node, only those of the sectors whose portals changed (e.g. 2.4 ms → 0.6 ms per call on a 240×240 grid). `Grid.rebuildPortalNodes()` takes the sectors `rebuildPortals()` returned to do the same; without them it refreshes all nodes as before, and so does the first update of a grid that never built its portal graph (no `initPortalNodes()`). Routes stay exactly the same.

### Patch Changes

- 959d762: `Sector.connectExits()` floods the sector's areas of passable cells once instead of once per portal, and two portals connect when their entry cells share an area. Rebuilding one sector's portals (`Grid.rebuildPortals()`, `updateCosts()`) takes about 0.01 ms instead of 0.6 ms for a 16×16 sector, and `buildGrid()` builds a 240×240 grid in about 3 ms instead of 97 ms. The exits found stay the same.

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
