---
"@leptoquark1/openage-pfadfinder": patch
---

`Grid.updateCosts()`/`rebuildPortals()` gave out portal ids twice after repeated updates, or right away for a grid built from existing sectors (`new Grid(id, size, sectors)`); routes could not be found until the grid was rebuilt.
