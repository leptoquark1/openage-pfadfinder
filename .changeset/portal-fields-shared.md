---
'@leptoquark1/openage-pfadfinder': minor
---

`Integrator.getPortalShared()` returns the cached integration and flow field of a portal themselves, without line of sight and without the copies `getPortal()` makes. `Pathfinder` uses it for the start and transit sectors of a route, which it only reads: a request takes about 15 % less time (0.18 ms → 0.15 ms on a 1024×1024 grid with 4096 sectors), and routes through the same portal share one flow field instead of holding a copy each. The flow fields of `FlowRoute.getSteps()` are therefore read-only outside the target sector; writing to them would change later routes. Routes stay exactly the same.
