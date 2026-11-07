---
"@leptoquark1/openage-pfadfinder": patch
---

- `Grid.updateCosts()`/`rebuildPortals()` gave out portal ids twice after repeated updates; routes could not be found until the grid was rebuilt.
- The portal field cache of a `Pathfinder` mixed up grids: with several grids, or a grid replaced under the same id via `addGrid()`, a route could follow a cached flow field of another grid and step onto impassable cells. Cache entries are now bound to the cost field they were computed from (`CacheEntry.costField`, optional).
