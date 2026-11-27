---
'@leptoquark1/openage-pfadfinder': minor
---

Bound the field cache over all grids of a pathfinder: `new Pathfinder({ maxPortalFields, maxTargetFields })` (or `new Integrator({ … })`) keeps at most that many portal and target fields, dropping the least recently used first. Dropped fields are computed again identically, so routes do not change. Without options the cache behaves as before. `getCachedTargetFieldCount()` reports the cached target fields.

`FieldCache.addTarget()` now returns the entry it dropped, and `FieldCache` gains `evictTarget()`, `targetCount`, `portalEntries()` and `targetEntries()`.
