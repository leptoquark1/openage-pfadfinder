---
"@leptoquark1/openage-pfadfinder": minor
---

`Grid.updateCosts()` is up to about four times faster on large grids: it no longer recomputes the exits of every portal node, only those of the sectors whose portals changed (e.g. 2.4 ms → 0.6 ms per call on a 240×240 grid). `Grid.rebuildPortalNodes()` takes the sectors `rebuildPortals()` returned to do the same; without them it refreshes all nodes as before. Routes stay exactly the same.
