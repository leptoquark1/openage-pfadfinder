---
'@leptoquark1/openage-pfadfinder': patch
---

`portalAStar()` does less per portal it looks at: it reads a node's exit costs in place instead of copying them into a new map, keeps the closed mark on its search node instead of in a second set, and computes the heuristic only for a portal it reaches for the first time or at a lower cost. Planning a route takes about 10 % less time (0.21 ms → 0.18 ms on a 1024×1024 grid with 4096 sectors). Routes stay exactly the same.
