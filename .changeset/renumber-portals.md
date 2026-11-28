---
'@leptoquark1/openage-pfadfinder': minor
---

Add `Grid.renumberPortals()`: it gives every portal the id a fresh `buildGrid()` from the same costs would give it, and returns the changed ids. After `updateCosts()` portals and routes already match a fresh build, but ids depend on the update history; call it when the ids themselves must match, e.g. before hashing or saving state that holds portal ids. Portal nodes keep their identity under the new ids.
