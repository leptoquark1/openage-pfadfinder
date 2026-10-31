# API Reference

Two entry points:

| Import | Contents |
|  ------ | -------- |
| `import { Pathfinder } from '@leptoquark1/openage-pfadfinder'` | All pathfinding classes, fields, graph types and helpers |
| `import { COST_IMPASSABLE } from '@leptoquark1/openage-pfadfinder/shared'` | Types/enums used in requests & results, constants, bit ops, coordinate and cost-map helpers |

Coordinates are `{ ne, se }` tile deltas (`ne` = east/west axis, `se` = south/north axis), matching openage. Cells are indexed row-major: `idx = ne + se * size`.

## Quick start

```typescript
import { Pathfinder, Grid, Sector, CostField } from '@leptoquark1/openage-pfadfinder';
import { COST_MIN, COST_IMPASSABLE } from '@leptoquark1/openage-pfadfinder/shared';

const grid = new Grid(0, { width: 4, height: 4 }, 10); // 4×4 sectors of 10×10 cells
let id = 0;
for (let sy = 0; sy < 4; sy++) {
  for (let sx = 0; sx < 4; sx++) {
    const cf = new CostField(10);
    cf.setCosts(new Uint8Array(100).fill(COST_MIN));
    grid.addSector(new Sector(id++, { x: sx, y: sy }, cf));
  }
}
grid.initPortals();      // create portals between adjacent sectors
grid.initPortalNodes();  // build the portal graph (exits + A* node data)

const pathfinder = new Pathfinder();
pathfinder.addGrid(grid);

const path = pathfinder.getPath({ gridId: 0, start: { ne: 2, se: 3 }, target: { ne: 35, se: 28 } });
// path.result === PathResult.FOUND (0), path.waypoints: [{ ne, se }, ...]

// or get the shared flow fields for a group of units following the same route:
const route = pathfinder.getFlowRoute({ gridId: 0, start: { ne: 2, se: 3 }, target: { ne: 35, se: 28 } });
const nextCell = route?.next(12, 10); // where a unit standing on (12, 10) should step to
```

## `Pathfinder`

The main interface. Holds registered grids and coordinates both stages of pathfinding (portal A* over sectors, then flow fields per sector).

| Member | Signature | Description |
| ------ | --------- | ----------- |
| `constructor()` | — | Create an empty pathfinder. |
| `addGrid` | `(grid: Grid): void` | Register a grid for lookups by id. |
| `getGrid` | `(id: GridId): Grid \| undefined` | Look up a registered grid. |
| `getPath` | `(request: PathRequest): Path` | Plan a path and walk the flow fields once, returning waypoints (start cell, one per direction change, target). Returns `PathResult.NOT_FOUND` or `OUT_OF_BOUNDS` on failure; an unreachable target yields no route rather than a partial one. |
| `getFlowRoute` | `(request: PathRequest): FlowRoute \| null` | Plan without walking: returns the shared flow fields of the route, so many units can follow it via `route.next()`. Returns `null` when there is no route. |
| `getCachedFieldCount` | `(): number` | Number of entries in the pathfinder's field cache (integration + flow field pairs per portal-sector pair). |

## Routing: `FlowRoute`, `FlowStep`

A `FlowRoute` holds the per-sector flow fields of one planned route, from start sector through every transit sector to the target. Many units can follow it at once — no path planning per unit.

```typescript
interface FlowStep {
  readonly sector: Sector;
  readonly flowField: FlowField;
}

class FlowRoute {
  getTarget(): TileDelta;             // route target in global coordinates
  getSteps(): readonly FlowStep[];    // sectors with their fields, start → target (e.g. for rendering)
  getSectorIds(): SectorId[];         // sector ids along the route, start → target
  next(ne: number, se: number): TileDelta | null;  // cell to step to from a unit on the route
  walk(start: TileDelta): Path;       // follow the fields once, emitting waypoints (same as Pathfinder.getPath)
}
```

- `next()` returns the target itself when it is in clear straight sight (string-pulling), and `null` at the target, outside the route's sectors, or on cells the route does not reach. A sector may appear in several steps if the route leaves and re-enters it around a wall; the first step whose field reaches the cell wins.
- `walk()` emits a waypoint at each direction change and stops once the target is in straight sight (LOS-flagged cell).

```typescript
function isLineWalkable(grid: Grid, fromNe, fromSe, toNe, toSe): boolean;
// true when every cell on the Bresenham line between two global cells is passable
```

## Portal graph

```typescript
interface PortalStarResult {
  readonly found: boolean;      // a target portal was reached
  readonly portals: Portal[];   // best portal chain (empty if not found)
  readonly partial: boolean;    // true when the chain stops short of any target portal
}

function portalAStar(
  grid: Grid,
  startPortals: Portal[],       // all portals bordering the start sector (entry side = start sector)
  targetPortals: Portal[],      // all portals bordering the target sector
  nodeMap: Map<PortalId, PortalNode>, // from grid.getPortalMap()
  targetPosGlobal: TileDelta,   // heuristic goal in global coordinates
  startSectorId: SectorId,
  startPosGlobal?: TileDelta,   // optional: refines the first-step heuristic
): PortalStarResult;
```

A* on the portal graph with a Euclidean heuristic (costs are `round(euclidean × 10)`). Search state is kept in lightweight wrappers, so shared `PortalNode` objects are never mutated. If no target is reachable, the closest node's backtrace is returned with `partial: true`.

### `PortalNode`

A* search data for one portal, pre-built by `grid.initPortalNodes()`.

| Member | Description |
| ------ | ----------- |
| `constructor(portal)` / `constructor(portal, entrySector, prev, pastCost, heuristicCost)` | Two overloads: bare node (from the grid) or search-state wrapper. |
| `portal`, `entrySector` | The portal and the sector it was entered from (undefined on start nodes). |
| `currentCost`, `heuristicCost`, `futureCost`, `wasBest` | A* bookkeeping. |
| `prevPortal` | Previous node in the search tree. |
| `exits: Map<SectorId, Map<PortalId, number>>` | Distance cost to each reachable exit portal, per side of this portal (two portals between the same sectors are exits of each other on both sides at different distances). |
| `initExits(nodeMap)` | (Re)compute `exits` from the node map. Called by the grid. |
| `getExits(sectorId)` | Exit costs for one side, restricted to portals present in the graph. |
| `generateBacktrace()` | Portal chain from this node back to the start. |
| `static distanceCost(a, b)` / `static heuristicCost(a, b)` | `round(euclidean × 10)`. |
| `static localToGlobal(grid, sectorId, localNe, localSe)` | Sector-local → global tile coordinates. |

## Graph: `Grid`, `Sector`, `Portal`

### `Grid`

A rectangular collection of square sectors plus the portal graph between them. Coordinates on a grid are **global** (whole-map) cell indices; sector fields use **local** coordinates.

```typescript
new Grid(id, size: Size2s, sectorSize: number);   // empty grid, add sectors later
new Grid(id, size: Size2s, sectors: Sector[]);    // grid pre-filled with sectors
```

| Member | Description |
| ------ | ----------- |
| `getId()` / `getSize()` / `getSectorSize()` | Id (sector count `{ width, height }`), sector edge length in cells. |
| `getSectors()`, `addSector(sector)` | Access/append sectors. Sectors are indexed by their position. |
| `getSector(x, y)` / `getSector(id)` | Look up a sector by grid position or id (overloads). |
| `getSectorPosition(sectorId)` | Sector's `{ x, y }` in the grid. |
| `getSectorAt(globalNe, globalSe)` | Sector containing a global cell; `undefined` outside the map. |
| `globalToLocal(globalNe, globalSe)` | → `{ sectorX, sectorY, localNe, localSe }`. |
| `initPortals()` | Create portals on every internal edge between adjacent sectors and connect their exits (call once after all sectors are added). |
| `initPortalNodes()` | Build the `PortalNode` graph (`getPortalMap()`) with populated exits; required before A*. |
| `rebuildPortals(dirtySectors): Set<SectorId>` | Recreate portals around changed sectors and flood-fill fresh exits (e.g. after a wall appeared/disappeared). Returns the sector ids whose portal sets changed. |
| `rebuildPortalNodes()` | Re-populate exit data on all existing `PortalNode`s without recreating them. |
| `updateCosts(changes: { ne, se, cost }[]): Set<SectorId>` | High-level dynamic map edit at global coordinates: applies the changes to sector cost fields (bumping their versions so cached fields are invalidated), rebuilds portals of touched sectors and refreshes portal nodes. Returns sectors whose portals changed; out-of-bounds cells are ignored. |
| `getPortalMap()` | The `Map<PortalId, PortalNode>` used by A*. |
| `getTotalCells()` | Whole-map dimensions in cells (`sectors × sectorSize`). |

### `Sector`

```typescript
new Sector(id: SectorId, position: Vector2s, costField: CostField);
getId(), getPosition(), getCostField();          // id, grid position { x, y }, the sector's field
getPortals(): Portal[];                          // portals on this sector's edges (sorted by edge)
addPortal(portal), removePortal(portal): boolean
findPortals(other: Sector, direction: PortalDirection, nextId: PortalId): Portal[]  // create edge portals against a neighbor
connectExits();                                  // flood-fill passable exit cells across each portal into the other sector (4-connected)
```

### `Portal`

A bidirectional gateway covering one full shared edge between two adjacent sectors.

```typescript
new Portal(id, sector0, sector1, direction: PortalDirection, cellStart: TileDelta, cellEnd: TileDelta);
// cellStart/cellEnd are the local coordinates of the covered edge cells (start → end along the portal's axis)

getId(), getDirection();
getConnected(sectorId): Portal[];   // portals reachable across this edge from that side
getExits(sectorId): Portal[];       // exit cells' neighbor portals on that side (set by Sector.connectExits)
setExits(sectorId, exits);          getExitSector(sectorId): SectorId;
matches(other: Portal): boolean;    // same edge & direction (id-independent comparison for rebuilds)

// entry/exit geometry in the local frame of `sectorId` (start → end along the portal's axis):
getEntryStart/getEntryCenter/getEntryEnd(sectorId): TileDelta  // where a route enters this sector through the portal
getExitStart/getExitCenter/getExitEnd(sectorId): TileDelta     // where it leaves towards the other sector
```

## Core fields: `CostField`, `IntegrationField`, `FlowField`, `Integrator`

### `CostField`

Per-cell movement cost for one square sector (edge length `size`). Values are `0..255`; only `COST_IMPASSABLE` (255) blocks movement, and a cost of 0 is passable (it simply adds nothing to the integrated cost).

| Member | Description |
| ------ | ----------- |
| `new CostField(size)` | All cells start at `COST_INIT` (0, unset/passable). Set every cell before integrating. |
| `getSize()` | Edge length in cells. |
| `getCost(pos: TileDelta)` / `getCost(x, y)` / `getCost(idx)` | Cost overloads. |
| `getCosts(): Uint8Array` | The raw backing array (live view — prefer the setters). |
| `setCost(...)` | Same three overloads; bumps the field version on change. |
| `setCosts(cells: Uint8Array)` | Replace all cells from a same-sized buffer (bumps version once). |
| `isImpassable(idx)` | Cost ≥ `COST_IMPASSABLE`. |
| `getVersion()` / `isDirty(sinceVersion)` | Monotonic change counter used for cache invalidation. |

### `IntegrationField`

Accumulated cost from the target, per cell: `Uint16Array` costs + `Uint8Array` flags (`INTEGRATE_LOS_MASK`, `INTEGRATE_TARGET_MASK`, `INTEGRATE_FOUND_MASK`, `INTEGRATE_WAVEFRONT_BLOCKED_MASK`). Unreachable cells hold `INTEGRATED_COST_UNREACHABLE` (65535).

| Member | Description |
| ------ | ----------- |
| `new IntegrationField(size)` | Empty field. |
| `getSize()` | Edge length. |
| `getCost(idx)`, `getFlags(idx)`, `getCosts(): Uint16Array`, `getFlagsArray(): Uint8Array` | Raw accessors (live views). |
| `reset()` / `clone()` | Clear to initial state / deep copy (used by the cache's copy-on-read semantics). |
| `resetDynamicFlags()` | Clear LOS/wavefront flags but keep costs — cached fields are stored in this state and re-run on reuse. |
| `integrateLos(costField, target): number[]` | Phase 1: wavefront + Bresenham shadowcasting; marks reachable cells with the LOS flag and returns the blocked wavefront for cost integration. |
| `integrateLosPortal(costField, other, otherSectorId, portal, target)` | Same, but the wavefront also crosses into the neighboring sector's integration field through the portal (route continues past this sector). |
| `integrateCost(costField, target)` | Phase 2 without LOS: Dijkstra-like 4-connected cost accumulation from the target. |
| `integrateCostPortal(costField, otherSectorId, portal)` | Same with the portal boundary seeded from the neighbor's costs. |
| `integrateCostFromWavefront(costField, startCells)` | Phase 2 continuing from an existing (LOS) wavefront — avoids re-scanning blocked cells. |

### `FlowField`

Per-cell direction toward the lowest-cost neighbor: one byte per cell with a 4-bit `FlowDir` in the low nibble and flags (`FLOW_PATHABLE_MASK`, `FLOW_LOS_MASK`, `FLOW_TARGET_MASK`) in the high nibble. Diagonals are only offered when both adjacent cardinals are passable (no corner cutting).

| Member | Description |
| ------ | ----------- |
| `new FlowField(size)` / `FlowField.constructorFromIntegration(integrationField)` | Empty field, or a pre-built one from an integration field (static helper used by the integrator). |
| `getSize()` | Edge length. |
| `getCell(idx)` / `getCell(x, y)`, `getCells(): Uint8Array` | Raw cell access (live view). |
| `getDir(idx): FlowDir` | Direction nibble only. |
| `build(integrationField)` | Gradient-descent build over the integration costs. |
| `buildPortal(integrationField, other, otherSectorId, portal)` | Build with fixed flow directions on the portal cells pointing into the connected sector. |
| `reset()` / `clone()` | Clear to `FLOW_INIT` / deep copy. |
| `resetDynamicFlags()` | Clear LOS flags (cached fields are stored without them). |
| `transferDynamicFlags(integrationField)` | Copy the integration field's LOS marks onto this flow field. |

### `Integrator`

Orchestrates cost → integration → flow with a `FieldCache`.

```typescript
interface IntegrationFlowPair {
  readonly integrationField: IntegrationField;
  readonly flowField: FlowField;
}

class Integrator {
  getCachedFieldCount(): number;
  integrate(costField, target: TileDelta, withLos = true): IntegrationField;      // no cache
  integratePortal(costField, other, otherSectorId, portal, target, withLos = true); // no cache
  build(integrationField): FlowField;                                             // no cache
  buildPortal(integrationField, other, otherSectorId, portal, _withLos = true);   // no cache
  get(costField, target: TileDelta, withLos = true): IntegrationFlowPair;         // integration + flow, no cache
  getPortal(costField, other, otherSectorId, portal, target, withLos = true): IntegrationFlowPair;
}
```

`getPortal()` is the cached variant used by the pathfinder: lookup by `makeCacheKey(portalId, otherSectorId)`, dirty-check against the cost field version (stale entries are evicted), and **copy-on-read** — returned fields are clones with dynamic flags reset, so callers may re-run LOS/mutation freely.

## Field cache

```typescript
interface CacheEntry {
  readonly integrationField: IntegrationField;
  readonly flowField: FlowField;
  costFieldVersion: number;   // version of the cost field at cache time (dirty tracking)
}

class FieldCache {
  add(key, entry), evict(key): boolean, isCached(key): boolean, get(key);
  getIntegrationField(key), getFlowField(key);
  getCostFieldVersion(key), setCostFieldVersion(key, version);
  clear();
  get size(): number;
}

function makeCacheKey(portalId: number, sectorId: number): CacheKey; // "portalId:sectorId"
```

Cached fields are stored with dynamic flags cleared (LOS, wavefront) — they must be recomputed on reuse, which `Integrator.getPortal()` does.

## Path results

Result of a `getPath` / `walk` call. Waypoints include the start and target cells plus one per direction change; consumers interpolate between them.

```typescript
function makePath(result: PathResult, waypoints: Waypoint[] = []): Path;
function pathFound(waypoints: Waypoint[]): Path;
function pathNotFound(): Path;            // { result: NOT_FOUND, waypoints: [] }
function pathOutOfBounds(): Path;         // { result: OUT_OF_BOUNDS, waypoints: [] }
```

## Internal utilities (exported for reuse)

### `BinaryHeap<T>`

Generic binary min-heap, used as the A* priority queue. Ordering is ascending by `priority`; an item may only be pushed once while present — re-pushing acts like a priority update.

```typescript
new BinaryHeap<T>();
get size(): number;  get isEmpty(): boolean;
push(item: T, priority: number): void;   // or updates the priority of a live item
pop(): T | undefined;                    // remove and return the min item
peek(): T | undefined;                   // min item without removing
updatePriority(item: T, priority: number): boolean;
has(item: T): boolean;  getPriority(item: T): number | undefined;
clear(): void;
```

### `bresenhamLine`

Modified Bresenham line from a corner point to the field edge, away from the target — used for LOS shadowcasting (cells blocked by obstacle corners). Port of openage's `IntegrationField::bresenhams_line()`.

```typescript
function bresenhamLine(target: TileDelta, cornerX: number, cornerY: number, size: number): number[];
// returns cell indices along the ray
```

## Shared subpath (`./shared`)

Everything below is importable from `@leptoquark1/openage-pfadfinder/shared` (and re-exported through it only — not duplicated in the main entry).

### Types & enums

| Type | Description |
| ---- | ----------- |
| `PathRequest` | `{ gridId: GridId, start: TileDelta, target: TileDelta }` — input to `getPath`/`getFlowRoute`. |
| `Waypoint` / `TileDelta` | `{ ne: number, se: number }`. |
| `Path` | `{ result: PathResult, waypoints: Waypoint[] }`. |
| `Size2s`, `Vector2s` | `{ width, height }`, `{ x, y }`. |
| `GridId`, `SectorId`, `PortalId` | Numeric id aliases. |
| `CacheKey` | String (`"portalId:sectorId"`). |
| `PathResult` | Enum: `FOUND = 0`, `NOT_FOUND = 1`, `OUT_OF_BOUNDS = 2`. |
| `FlowDir` | Enum of the 8 directions (4-bit values): `NORTH_EAST = 0x00`, `EAST = 0x01`, `SOUTH_EAST = 0x02`, `SOUTH = 0x03`, `SOUTH_WEST = 0x04`, `WEST = 0x05`, `NORTH_WEST = 0x06`, `NORTH = 0x07`. |
| `PortalDirection` | Enum: `NORTH_SOUTH = 0`, `EAST_WEST = 1` (the portal's axis). |

### Constants

| Constant | Value | Meaning |
| -------- | ----- | ------- |
| `COST_INIT` | `0` | Unset cost field cell. |
| `COST_MIN` | `1` | Cheapest passable cost. |
| `COST_MAX` | `254` | Most expensive passable cost. |
| `COST_IMPASSABLE` | `255` | Blocked. |
| `INTEGRATED_COST_START` | `0` | Cost at the target cell. |
| `INTEGRATED_COST_UNREACHABLE` | `65535` | Unreachable cell sentinel (Uint16 max). |
| `INTEGRATE_LOS_MASK` | `0x20` | Cell has line of sight to the target. |
| `INTEGRATE_TARGET_MASK` | `0x40` | The target cell itself. |
| `INTEGRATE_FOUND_MASK` | `0x02` | Reached during integration. |
| `INTEGRATE_WAVEFRONT_BLOCKED_MASK` | `0x04` | Wavefront stopped here (blocked). |
| `FLOW_INIT` | `0` | Unset flow cell. |
| `FLOW_DIR_MASK` | `0x0f` | Direction nibble mask. |
| `FLOW_FLAGS_MASK` | `0xf0` | Flag bits mask. |
| `FLOW_PATHABLE_MASK` | `0x10` | Cell is passable in the flow field. |
| `FLOW_LOS_MASK` | `0x20` | Target in straight sight from this cell (string-pulling point). |
| `FLOW_TARGET_MASK` | `0x40` | The target cell. |

### Bit ops

```typescript
hasFlag(value: number, mask: number): boolean;
setFlag(value: number, mask: number): number;
clearFlag(value: number, mask: number): number;
toggleFlag(value: number, mask: number): number;
```

### Coordinate helpers

```typescript
tileToIndex(delta: TileDelta, size: number): number;   // ne + se * size
xyToIndex(x: number, y: number, size: number): number;
indexToX(idx: number, size: number): number;           // idx % size
indexToY(idx: number, size: number): number;           // floor(idx / size)
makeTileDelta(ne: number, se: number): TileDelta;
tileDistance(a: TileDelta, b: TileDelta): number;      // Manhattan distance
tileEuclidean(a: TileDelta, b: TileDelta): number;     // Euclidean distance
```

### Cost-map helpers

For applications that keep their map as one global cost array (`costs[ne + se * width]`).

```typescript
// Build a Grid (with sectors, portals and portal nodes initialized) from a global cost map.
// size is in cells and must be a multiple of sectorSize on both axes; throws otherwise.
buildGrid(costs: Uint8Array, size: Size2s, sectorSize: number, gridId?: GridId): Grid;

// 4-connected flood fill over passable cells; mask with 1 per reachable cell,
// all zeros if `start` is impassable or out of bounds.
reachableFrom(costs: Uint8Array, size: Size2s, start: TileDelta): Uint8Array;

// The reachable-from-`from` cell closest (Euclidean) to `target`; `target` itself when
// reachable, null when nothing is reachable. Ties go to the cell closer to `from`. O(width × height).
nearestReachable(costs: Uint8Array, size: Size2s, from: TileDelta, target: TileDelta): TileDelta | null;
```
