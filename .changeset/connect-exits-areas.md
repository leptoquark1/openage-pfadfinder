---
"@leptoquark1/openage-pfadfinder": patch
---

`Sector.connectExits()` floods the sector's areas of passable cells once instead of once per portal, and two portals connect when their entry cells share an area. Rebuilding one sector's portals (`Grid.rebuildPortals()`, `updateCosts()`) takes about 0.01 ms instead of 0.6 ms for a 16×16 sector, and `buildGrid()` builds a 240×240 grid in about 3 ms instead of 97 ms. The exits found stay the same.
