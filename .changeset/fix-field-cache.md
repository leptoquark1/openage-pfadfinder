---
"@leptoquark1/openage-pfadfinder": minor
---

The portal field cache of a `Pathfinder` mixed up grids: with several grids, or a grid replaced under the same id via `addGrid()`, a route could follow a cached flow field of another grid and step onto impassable cells. Each cost field now has its own cache, keyed by the portal's cell range: several grids no longer evict each other's fields, and fields of dropped portals or replaced grids no longer pile up. `FieldCache` gains a `version` field for the cost field version its contents belong to.
