---
'@leptoquark1/openage-pfadfinder': minor
---

`Sector.getAreas()` gives the area of each cell: passable cells that reach each other inside the sector share one. The areas are kept until the cost field changes, and `Pathfinder` reads them instead of flood-filling the start and target sector on every request. A request takes about 0.054 ms instead of 0.082 ms on a 256×256 grid with sectors of 16, and about 0.105 ms instead of 0.21 ms on a 512×512 grid with sectors of 32. Routes stay exactly the same, also for a start on an impassable cell.
