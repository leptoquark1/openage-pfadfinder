# openage-pfadfinder-crowd

Crowd simulation on top of [`@leptoquark1/openage-pfadfinder`](../pfadfinder): units follow the pathfinder's shared flow fields and move as a crowd — predictive collision avoidance, lane formation in counter-flow, and congestion that feeds back into the route costs. Every part is an exchangeable strategy.

> **Status:** in development inside the workspace (`private`, `0.0.0`), not published yet.

## Quick start

```typescript
import { buildGrid, Pathfinder } from '@leptoquark1/openage-pfadfinder';
import { CrowdSimulation, DensityCostModel } from '@leptoquark1/openage-pfadfinder-crowd';

const pathfinder = new Pathfinder();
pathfinder.addGrid(buildGrid(costs, { width: 256, height: 256 }, 16));

const crowd = new CrowdSimulation(pathfinder, 0, {
  timestep: 1 / 20,                    // fixed: every step() advances exactly this
  congestion: new DensityCostModel(),  // optional: crowds make cells more expensive
});

const id = crowd.addAgent({ position: { x: 3.5, y: 4.5 }, radius: 0.4, maxSpeed: 2, goal: { ne: 200, se: 180 } });

// the host owns real time and feeds fixed steps
let acc = 0;
function frame(dtSeconds: number) {
  acc += dtSeconds;
  while (acc >= crowd.timestep) {
    crowd.step();
    acc -= crowd.timestep;
  }
  const p = crowd.getPosition(id);   // a copy, in cells
  const state = crowd.getState(id);  // IDLE | MOVING | ARRIVED | UNREACHABLE | STUCK
}
```

Lengths are in **cells**, times in **seconds**. Cell `(ne, se)` covers `[ne, ne + 1) × [se, se + 1)`, so its center is `(ne + 0.5, se + 0.5)`; `x` runs along `ne`, `y` along `se`.

## How a tick works

`CrowdSimulation.step()`:

1. **Congestion** (optional): `observe()` takes in where the agents are; `commit()` writes cost surcharges when due. Changed sectors are invalidated in the guidance.
2. **Guidance**: `prepare()` plans or refreshes routes within its budget.
3. Per agent, in ascending id, all from the state at the start of the tick:
   - **preferred velocity** from the guidance (towards the goal, ignoring others; braking near the goal),
   - **preferred-velocity modifiers** (the side rule),
   - **forces**: the goal term `(v_pref − v)/ξ` plus every `SteeringForce` (avoidance, separation), clamped to `maxAccel`; the velocity is clamped to `maxSpeed`.
4. **Movement** against the walls, in sub-steps (no tunneling), sliding along them.
5. **Overlap resolution**: several deterministic passes, each followed by pushing agents out of walls again.
6. **States**: `IDLE` (no goal), `MOVING`, `ARRIVED` (within `arrivalRadius` of the goal, or touching an arrived agent of its group with the same goal), `UNREACHABLE` (no route), `STUCK` (less than `stuckDistance` progress in `stuckTime`; it keeps trying).

The side rule acts on the *preferred* velocity, before avoidance, so avoidance always has the last word on the direction.

## Built-in strategies

| Part | Class | What it does | Source |
| --- | --- | --- | --- |
| Guidance | `FlowRouteGuidance` | Follows `Pathfinder.getFlowRoute()`; routes shared per (group, goal), planning budgeted, staleness by cost field versions | — |
| Avoidance | `PowerLawAvoidance` | Time-to-collision power law, `F = −∇ₓ(k/τ² · e^(−τ/τ₀))` | Karamouzas, Skinner, Guy 2014 |
| Short range | `Separation` | Repulsion when bodies (nearly) touch, where τ is ill-conditioned | Reynolds 1999 |
| Lanes | `SideRule` | In counter-flow, turn to the own right (or left); overtake slower agents on the other side | Moussaïd et al. 2009 |
| Overlaps | `OverlapResolver` | Positional correction in fixed pair order, several passes | — |
| Congestion | `DensityCostModel` | Density splat → smoothed surcharge with hysteresis → cost fields | Continuum Crowds' density splat, Treuille et al. 2006 |

### Defaults

| Option | Default | Meaning |
| --- | ---: | --- |
| **`CrowdSimulation`** | | |
| `neighborRadius` / `maxNeighbors` | 4 / 10 | Neighbors considered per agent (nearest first, ties by id) |
| `hashCellSize` | 2 | Bucket size of the neighbor grid |
| `relaxationTime` (ξ) | 0.5 s | How fast the velocity follows the preferred one |
| `arrivalRadius` / `arrivalChainGap` | 0.5 / 0.2 | Arrival at the goal / next to arrived agents (0: off) |
| `stuckDistance` / `stuckTime` | 0.5 / 2 s | `STUCK` detection |
| **`FlowRouteGuidance`** | | |
| `maxPlansPerTick` | 8 | Route plans per tick (UNSAFE replans do not count) |
| `lookahead` | 3 | Cells aimed ahead along the flow while the line is clear |
| `slowRadius` | 1.5 | Braking distance before the goal |
| `retryInterval` / `routeTtl` | 20 / 200 ticks | Retry of unreachable goals / drop of unused routes |
| **`PowerLawAvoidance`** | | |
| `strength` (k) / `tau0` (τ₀) | 1.5 / 3 s | Interaction strength / exponential cutoff |
| `horizon` / `tauMin` / `maxForce` | 3 s / 0.2 s / 20 | Ignored beyond / saturation below / cap of the sum |
| **`Separation`** | | |
| `range` / `strength` | 0.2 / 8 | Gap below which it pushes / push at contact |
| **`SideRule`** | | |
| `side` / `strength` | `'right'` / 1 | Kept side / largest turn (45°) |
| `angle` / `horizon` / `inflate` / `lateral` | 45° / 2 s / 1.5 / 0.5 | Counter-flow cone / look-ahead / wider bodies for the test / offset passed the natural way |
| `overtake` / `overtakeBelow` | true / 0.75 | Overtake agents slower than 75 % of the own speed |
| **`OverlapResolver`** | | |
| `iterations` / `stiffness` | 4 / 1 | Passes per tick / share of an overlap removed per pass |
| **`DensityCostModel`** | | |
| `smoothingTime` (T) | 2 s | `α = 1 − e^(−dt/T)` |
| `freeDensity` / `costPerDensity` / `maxSurcharge` | 0.4 / 40 / 60 | Surcharge `min(max, round(k · max(0, ρ − free)))`, ρ in agents per cell |
| `riseThreshold` / `fallThreshold` / `maxStep` | 3 / 6 / 15 | Asymmetric hysteresis, change cap per write |
| `commitInterval` / `dwellTime` | 0.5 s / 1 s | Write rate / time a sector keeps its costs |

## Congestion and the cost fields

`DensityCostModel` writes `base + surcharge` into the sectors' cost fields, one version bump per sector and write. Impassable cells are never touched and a passable cell never becomes impassable, so no portal rebuild is needed; the pathfinder drops its cached fields of that sector and the next routes steer around the crowd.

- **Ownership contract.** The model keeps the base costs of every sector it wrote to. While it is active, change terrain through `CrowdSimulation.applyTerrain()`, not `Grid.updateCosts()`. Safety net: a cost field changed behind its back is re-based (every cell that differs from `base + surcharge` becomes its new base) and reported `UNSAFE`, so `dispose()` never restores outdated terrain.
- **Limitation.** The portal graph's costs are geometric (portal distances), so congestion changes *how* a route crosses a sector, not *which* sectors it passes. Two bottlenecks in one sector: the crowd spreads over both. Two bottlenecks in different sectors: it does not.
- **Line of sight.** The pathfinder treats every cell costing more than `COST_MIN` as an obstacle for line of sight. In a surcharged area routes therefore follow the flow cell by cell instead of heading straight for the goal (the guidance's `lookahead` still smooths the path).
- **Feedback loop.** Jam → detour → jam elsewhere can oscillate. Smoothing, asymmetric hysteresis, the change cap and the dwell time dampen it; they do not rule it out. The limitation above also confines it to alternatives within a sector.

### Stale and unsafe routes

A route remembers the cost field versions of its sectors. After a change it is:

- **`STALE`**: only costs changed (a surcharge the guidance was told about). The route stays safe to follow and is replanned within the planning budget.
- **`UNSAFE`**: passability may have changed (`applyTerrain()`, or any change nobody announced). The route is dropped; its agents replan at once, outside the budget.

A change in a sector no route passes does not reroute anything.

## Determinism

Deterministic for identical inputs, timestep, call order and JavaScript engine: agents are processed in ascending id, neighbors by (distance, id), overlap pairs in a fixed order, nothing is random, and route planning tie-breaks by portal edge order. `stateHash()` hashes ids, positions, velocities and states for regression tests and replay checks. **Bit-identical lockstep across engines or platforms is not guaranteed**: `Math.exp` and `Math.cos` are not correctly rounded everywhere.

## Extending

Every strategy is an interface; pass your own in the options.

```typescript
import {
  type CrowdContext,
  CrowdSimulation,
  type NeighborList,
  PowerLawAvoidance,
  Separation,
  type SteeringForce,
  type Vec2,
} from '@leptoquark1/openage-pfadfinder-crowd';

/** Keep a group together: pull towards the neighbors of the same group. */
class Cohesion implements SteeringForce {
  accumulate(ctx: CrowdContext, i: number, neighbors: NeighborList, out: Vec2): void {
    const a = ctx.agents;
    for (let n = 0; n < neighbors.count; n++) {
      const j = neighbors.index[n]!;
      if (a.group(j) === a.group(i)) {
        out.x += (a.x(j) - a.x(i)) * 0.2;
        out.y += (a.y(j) - a.y(i)) * 0.2;
      }
    }
  }
}

new CrowdSimulation(pathfinder, 0, { timestep: 1 / 20, forces: [new PowerLawAvoidance(), new Separation(), new Cohesion()] });
```

| Interface | Role |
| --- | --- |
| `GuidanceProvider` | Preferred velocity of an agent (`prepare`, `preferredVelocity`, `invalidate`, `release`, `dispose`) |
| `PreferredVelocityModifier` | Shapes the preferred velocity before the forces |
| `SteeringForce` | Adds an acceleration; reads the state at the start of the tick |
| `CongestionModel` | `attach`, `observe`, `commit` (returns `stale` / `unsafe` sectors), optional `applyTerrain`, `dispose` |

Extension points see a narrow, read-only `CrowdContext`: `agents` (by dense index, valid within one tick), `neighbors`, `navigation` (costs, passability, sectors), `density` and the tick. Providers that need the pathfinder take it in their constructor.

A Continuum Crowds guidance (Treuille et al. 2006) would implement `GuidanceProvider` on the same `DensityField` and replace `FlowRouteGuidance` and `DensityCostModel` together; nothing outside the guidance touches flow fields.

## Performance

`pnpm --filter @leptoquark1/openage-pfadfinder-crowd benchmark` prints the time per `step()` for 100 to 10,000 agents, uniformly spread and jammed around one goal; results in [docs/BENCHMARK.md](../../docs/BENCHMARK.md#crowd-simulation). Neighbor queries cost O(n + candidates): a ring search stops once no closer agent can follow, so dense crowds stay affordable.

## References

- C. Reynolds, "Steering Behaviors For Autonomous Characters", GDC 1999.
- I. Karamouzas, B. Skinner, S. J. Guy, "Universal Power Law Governing Pedestrian Interactions", Phys. Rev. Lett. 113, 238701, 2014.
- M. Moussaïd et al., "Experimental study of the behavioural mechanisms underlying self-organization in human crowds", Proc. R. Soc. B 276, 2009.
- A. Treuille, S. Cooper, Z. Popović, "Continuum Crowds", ACM SIGGRAPH 2006.
- D. Helbing, P. Molnár, "Social force model for pedestrian dynamics", Phys. Rev. E 51, 1995 (not used; the power law reacts to the predicted collision instead of the current distance).
