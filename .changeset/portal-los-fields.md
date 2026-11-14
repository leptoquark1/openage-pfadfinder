---
'@leptoquark1/openage-pfadfinder': patch
---

`Integrator.getPortal()` and `integratePortal()` with line of sight (`withLos`, the default) left most of a sector without a cost when the portal cells did not see the target: only the portal cells themselves were integrated, and the flow field led nowhere. `getPortal()` then cached that field and returned it to later requests without LOS as well. The costs now always come from the whole portal and the LOS marks are added on top; the cache keeps the fields without LOS, so a request gets the same fields whether or not they were cached. `Pathfinder` never asked for LOS on portal fields, so its routes stay the same.
