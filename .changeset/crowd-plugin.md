---
'@leptoquark1/openage-pfadfinder-crowd': minor
---

First release of the crowd plugin: `CrowdSimulation` moves agents along the pathfinder's flow routes in fixed timesteps, with predictive collision avoidance (time-to-collision power law), separation, lane formation by the side rule, wall collision and deterministic overlap resolution. `DensityCostModel` feeds crowding back into the cost fields as surcharges without portal rebuilds, keeping terrain costs apart. Every part is an exchangeable strategy (`GuidanceProvider`, `PreferredVelocityModifier`, `SteeringForce`, `CongestionModel`).
