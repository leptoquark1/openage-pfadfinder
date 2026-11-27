---
'@leptoquark1/openage-pfadfinder': minor
---

Keep portal exits in one cost table per sector instead of a list and a cost map per portal side. A grid of 240 × 240 cells with sector size 16 and 15 % walls now needs about 0.95 MB instead of 3.4 MB, cost updates are faster, and routes stay the same.

`PortalNode.exits` is now built on every read from the sector tables; A* no longer uses it. `Portal.getConnected()` and `Portal.getExits()` return a new array on every call. `Portal.setExits()` is deprecated: it still works, but `Sector.connectExits()` sets the exits of a whole sector at once.
