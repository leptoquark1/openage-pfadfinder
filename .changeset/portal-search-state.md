---
'@leptoquark1/openage-pfadfinder': patch
---

`portalAStar()` keeps its search state on the portal nodes while it runs, and its open set no longer updates a lookup table on every swap. Portals also remember their entry centers and cache keys instead of deriving them per request. A route takes about 45 % less time on a 1024×1024 grid with 4096 sectors (0.14 ms → 0.077 ms), 35 % on a 256×256 grid with sectors of 16 and 27 % on a 512×512 grid with sectors of 32. Routes stay exactly the same, as the heap keeps its order for equal priorities.
