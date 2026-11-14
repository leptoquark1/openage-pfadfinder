---
'@leptoquark1/openage-pfadfinder': patch
---

After `Grid.updateCosts()` or `rebuildPortals()`, a route could differ from the one a grid built from scratch from the same costs finds, and be longer: new portals went to the end of their sectors' lists, and A* breaks ties by that order. `Sector.addPortal()` now inserts a portal at its place in edge order (top, left, bottom, right, along an edge by position), so a sector lists its portals the same way however the grid got there, and both grids plan the same routes.
