# Benchmark

`packages/pfadfinder/scripts/bench.ts` measures `Grid#updateCosts`: one call
per changed tile ("Single") against one call for all tiles ("Batched"). It can
also compare this build ("Now") with another one ("Then").

Each round blocks random passable tiles on a seeded random map and frees them
again. Times are ms per update pass, averaged over 40 rounds.

## Usage

```bash
pnpm benchmark                  # Markdown matrix (--pretty: terminal, --json: JSON)
pnpm benchmark latest           # compare with a published version (latest, 1.1.0, …)
pnpm benchmark <dir>            # compare with a local build (package dir or dist/)
pnpm benchmark latest --silent  # only the exit code
pnpm benchmark --docs           # larger run, updates the results below
```

Both builds are warmed up and measured in the same run on the same maps.
Published versions are fetched from npm into a temp dir. Relative paths
resolve against `packages/pfadfinder`. `--docs` cannot be combined with a
Then build.

| Exit code | Meaning |
| ---: | :--- |
| 0 | Done, Now is not slower than Then beyond 5 % noise |
| 1 | Then is faster: median speedup ≤ 0.95 |
| 2 | Wrong call or a build could not be loaded |

The `benchmark` job in [ci.yml](../.github/workflows/ci.yml) runs
`pnpm benchmark latest` on PRs that change the package and fails on exit code
1. Runners are noisy, so rerun a failed job before looking for a regression.

## Reading the results

- **Factor** = Single / Batched, **Speedup** = Then / Now. Above 1 is better.
- The summary line reports the median over all cases.
- Only compare results from the same machine.

## Results

<!-- benchmark:start -->
_2026-11-14 · Node v26.13.0 · linux x64 · AMD Ryzen 7 9800X3D 8-Core Processor_

Build: `dist`

| Map | Single (100) | Batched (100) | Factor (100) | Single (50) | Batched (50) | Factor (50) | Single (10) | Batched (10) | Factor (10) |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 240×240 | 6.228 ms | 2.052 ms | 3.03× | 2.770 ms | 1.173 ms | 2.36× | 0.570 ms | 0.306 ms | 1.86× |
| 64×64 | 1.607 ms | 0.170 ms | 9.45× | 0.840 ms | 0.160 ms | 5.26× | 0.157 ms | 0.093 ms | 1.69× |

**Batching is 2.69× faster than single calls (median of 6 cases)**

Time per update pass, 40 rounds · Factor = Single / Batched · (n) = changes per pass
<!-- benchmark:end -->
