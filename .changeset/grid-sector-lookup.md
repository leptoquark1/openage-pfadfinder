---
'@leptoquark1/openage-pfadfinder': patch
---

`Grid.getSector(id)` looks the sector up directly instead of searching all sectors, when a sector's id is its index (as `buildGrid()` numbers them). On large grids that search took most of the time: planning a route on a 1024×1024 grid with 4096 sectors takes about 0.24 ms instead of 0.27 ms, the first requests after a build about 0.54 ms instead of 0.86 ms, and `updateCosts()` gets faster as well. Grids whose sectors have other ids work as before.
