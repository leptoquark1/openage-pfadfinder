---
"@leptoquark1/openage-pfadfinder": minor
---

`Grid.rebuildPortals()` no longer uses up portal ids on portals that survive a rebuild; only new portals take an id. `Sector.findPortals()` accepts an id allocator `() => PortalId` instead of a start id, and an optional list of existing portals (`reuse`) that are returned again when they span a found range. `Portal.spans()` compares a portal with a cell range. Existing calls with a start id keep working; see "Portal ids with `findPortals`" in docs/API.md for when to use the new parameters and how to migrate.
