---
'@leptoquark1/openage-pfadfinder-crowd': minor
---

First release of the crowd plugin: `CrowdSimulation` moves agents along the pathfinder's flow routes in fixed timesteps, with predictive collision avoidance (time-to-collision power law), separation, lane formation by the side rule, wall collision and deterministic overlap resolution. `DensityCostModel` feeds crowding back into the cost fields as surcharges without portal rebuilds, keeping terrain costs apart. Agents follow shared flow fields (`FlowRouteGuidance`) or a path of their own each (`PathGuidance`). Every part is an exchangeable strategy (`GuidanceProvider`, `PreferredVelocityModifier`, `SteeringForce`, `CongestionModel`), and the built-in ones can be retuned while the simulation runs (`configure()`).
