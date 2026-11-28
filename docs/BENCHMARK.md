# Benchmark

<!-- benchmark:start -->
Host: _Node v26 · AMD Ryzen 7 9800X3D 8-Core · x64_

Time per update pass, **60 rounds**

| **<div align="right">Δ</div><div align="left">&nbsp;↔</div>** | **500**<br><br> | **100**<br><br> | **50**<br><br> | **10**<br><br> |
| :--- | ---: | ---: | ---: | ---: |
| <div align="left">**512×512**</div><div align="right">•<br/>⇉<br/><br/>×</div> | <br/>57.45&#x2009;<small>ms</small><br/>7.39&#x2009;<small>ms</small><br/>⎯⎯⎯&nbsp;&nbsp;<br/>7.78&#x2009;<small>×</small>&nbsp; | <br/>15.64&#x2009;<small>ms</small><br/>2.68&#x2009;<small>ms</small><br/>⎯⎯⎯&nbsp;&nbsp;<br/>5.84&#x2009;<small>×</small>&nbsp; | <br/>8.24&#x2009;<small>ms</small><br/>1.50&#x2009;<small>ms</small><br/>⎯⎯⎯&nbsp;&nbsp;<br/>5.49&#x2009;<small>×</small>&nbsp; | <br/>1.61&#x2009;<small>ms</small><br/>0.45&#x2009;<small>ms</small><br/>⎯⎯⎯&nbsp;&nbsp;<br/>3.58&#x2009;<small>×</small>&nbsp; |
| <div align="left">**240×240**</div><div align="right">•<br/>⇉<br/><br/>×</div> | <br/>21.65&#x2009;<small>ms</small><br/>3.09&#x2009;<small>ms</small><br/>⎯⎯⎯&nbsp;&nbsp;<br/>7.02&#x2009;<small>×</small>&nbsp; | <br/>5.67&#x2009;<small>ms</small><br/>1.85&#x2009;<small>ms</small><br/>⎯⎯⎯&nbsp;&nbsp;<br/>3.07&#x2009;<small>×</small>&nbsp; | <br/>2.76&#x2009;<small>ms</small><br/>1.14&#x2009;<small>ms</small><br/>⎯⎯⎯&nbsp;&nbsp;<br/>2.43&#x2009;<small>×</small>&nbsp; | <br/>0.55&#x2009;<small>ms</small><br/>0.27&#x2009;<small>ms</small><br/>⎯⎯⎯&nbsp;&nbsp;<br/>2.00&#x2009;<small>×</small>&nbsp; |
| <div align="left">**64×64**</div><div align="right">•<br/>⇉<br/><br/>×</div> | <br/>6.63&#x2009;<small>ms</small><br/>0.21&#x2009;<small>ms</small><br/>⎯⎯⎯&nbsp;&nbsp;<br/>31.11&#x2009;<small>×</small>&nbsp; | <br/>1.55&#x2009;<small>ms</small><br/>0.16&#x2009;<small>ms</small><br/>⎯⎯⎯&nbsp;&nbsp;<br/>9.63&#x2009;<small>×</small>&nbsp; | <br/>0.76&#x2009;<small>ms</small><br/>0.14&#x2009;<small>ms</small><br/>⎯⎯⎯&nbsp;&nbsp;<br/>5.27&#x2009;<small>×</small>&nbsp; | <br/>0.13&#x2009;<small>ms</small><br/>0.08&#x2009;<small>ms</small><br/>⎯⎯⎯&nbsp;&nbsp;<br/>1.77&#x2009;<small>×</small>&nbsp; |

**Batching is 5.38× faster than single calls** <small>(median of 12 cases)</small>

> **Δ** &nbsp; <small>_Changes per pass_</small>&nbsp;&nbsp;&nbsp;&nbsp;
> **↔** &nbsp; <small>_Map size_</small>&nbsp;&nbsp;&nbsp;&nbsp;
> **•** &nbsp; <small>_Single_</small>&nbsp;&nbsp;&nbsp;&nbsp;
> **⇉** &nbsp; <small>_Batched_</small>&nbsp;&nbsp;&nbsp;&nbsp;
> **×** &nbsp; <small>_Factor_</small>

Time per path (`getPath`), **1000 paths**, median of **16 passes**

| Map | Workload | Time |
| :--- | :--- | ---: |
| **1024×1024** | First requests | 315.7&#x2009;<small>µs</small> |
|  | Repeated | 79.6&#x2009;<small>µs</small> |
|  | Shared target | 74.1&#x2009;<small>µs</small> |
| **512×512** | First requests | 77.2&#x2009;<small>µs</small> |
|  | Repeated | 33.3&#x2009;<small>µs</small> |
|  | Shared target | 26.7&#x2009;<small>µs</small> |
| **240×240** | First requests | 32.9&#x2009;<small>µs</small> |
|  | Repeated | 15.3&#x2009;<small>µs</small> |
|  | Shared target | 18.0&#x2009;<small>µs</small> |
<!-- benchmark:end -->

## Usage

```bash
pnpm benchmark                  # Markdown matrix (--pretty: terminal, --json: JSON, --full: larger run)
pnpm benchmark latest           # compare with a published version (latest, 1.1.0, …)
pnpm benchmark <dir>            # compare with a local build (package dir or dist/)
pnpm benchmark main             # compare with a git ref (branch, tag, commit hash)
pnpm benchmark latest --silent  # only the exit code
pnpm benchmark --docs           # updates the results below (+larger run)
pnpm benchmark latest --md      # the results block on stdout (also with --full)
```

| Exit code | Meaning |
| ---: | :--- |
| 0 | Done, Now is not slower than Then beyond 5 % noise |
| 1 | Then is faster: median speedup ≤ 0.95 in cost updates or in path planning |
| 2 | Wrong call or a build could not be loaded |

Two suites run: `Grid.updateCosts()` and path planning with `Pathfinder.getPath()`.
Planning measures the first requests on an empty cache, repeated requests on a
filled one, and many units heading for one shared target.

The `benchmark` job in [ci.yml](../.github/workflows/ci.yml) runs
`pnpm benchmark latest` on PRs that change the package and fails on exit code.

> Runners are noisy, so rerun a failed job before looking for a regression.

## Crowd simulation

`pnpm benchmark:crowd` (the crowd package's `benchmark` script) prints the time per `CrowdSimulation.step()`.
*Uniform*: agents spread over the map with random goals. *Jam*: all agents start packed around one goal, about
1.5 agents per cell. *+ congestion*: with `DensityCostModel`.

Host: _Node v26 · AMD Ryzen 7 9800X3D 8-Core · x64_

Median time per `step()` (60 ticks after 40 warm-up), 256×256 map, sector size 16

| Agents | Uniform | Uniform + congestion | Jam | Jam + congestion |
| ---: | ---: | ---: | ---: | ---: |
| **100** | 0.11&#x2009;<small>ms</small> | 0.13&#x2009;<small>ms</small> | 0.18&#x2009;<small>ms</small> | 0.18&#x2009;<small>ms</small> |
| **500** | 0.38&#x2009;<small>ms</small> | 0.53&#x2009;<small>ms</small> | 1.03&#x2009;<small>ms</small> | 0.98&#x2009;<small>ms</small> |
| **1,000** | 0.79&#x2009;<small>ms</small> | 0.91&#x2009;<small>ms</small> | 2.06&#x2009;<small>ms</small> | 2.06&#x2009;<small>ms</small> |
| **5,000** | 3.71&#x2009;<small>ms</small> | 3.93&#x2009;<small>ms</small> | 11.04&#x2009;<small>ms</small> | 11.50&#x2009;<small>ms</small> |
| **10,000** | 9.33&#x2009;<small>ms</small> | 9.59&#x2009;<small>ms</small> | 22.19&#x2009;<small>ms</small> | 22.73&#x2009;<small>ms</small> |

A jam costs about 2–3× a spread crowd: every agent has its full set of neighbors, and the overlap resolver works on
every pair.
