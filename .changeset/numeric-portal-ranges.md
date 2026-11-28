---
'@leptoquark1/openage-pfadfinder': patch
---

Keep a portal's cell range as four numbers instead of `TileDelta` objects, and derive entry and exit coordinates on demand. Grids need about a quarter less memory (24 grids of 240 × 240 cells: 22.7 MB → 16.7 MB), and A* no longer allocates objects per edge for its heuristic. Routes stay the same. `Portal.getEntryStart()`, `getEntryEnd()`, `getEntryCenter()`, `getExitStart()` and `getExitEnd()` now return a new object on every call.
