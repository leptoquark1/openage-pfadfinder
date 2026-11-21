# Benchmark

<!-- benchmark:start -->
Host: _Node v26 · AMD Ryzen 7 9800X3D 8-Core · x64_

Time per update pass, **60 rounds**

| **<div align="right">Δ</div><div align="left">&nbsp;↔</div>** | **500**<br><br> | **100**<br><br> | **50**<br><br> | **10**<br><br> |
| :--- | ---: | ---: | ---: | ---: |
| <div align="left">**512×512**</div><div align="right">•<br/>⇉<br/><br/>×</div> | <br/>59.29&#x2009;<small>ms</small><br/>8.08&#x2009;<small>ms</small><br/>⎯⎯⎯&nbsp;&nbsp;<br/>7.34&#x2009;<small>×</small>&nbsp; | <br/>15.72&#x2009;<small>ms</small><br/>2.93&#x2009;<small>ms</small><br/>⎯⎯⎯&nbsp;&nbsp;<br/>5.36&#x2009;<small>×</small>&nbsp; | <br/>8.04&#x2009;<small>ms</small><br/>1.62&#x2009;<small>ms</small><br/>⎯⎯⎯&nbsp;&nbsp;<br/>4.97&#x2009;<small>×</small>&nbsp; | <br/>1.62&#x2009;<small>ms</small><br/>0.45&#x2009;<small>ms</small><br/>⎯⎯⎯&nbsp;&nbsp;<br/>3.56&#x2009;<small>×</small>&nbsp; |
| <div align="left">**240×240**</div><div align="right">•<br/>⇉<br/><br/>×</div> | <br/>22.28&#x2009;<small>ms</small><br/>3.31&#x2009;<small>ms</small><br/>⎯⎯⎯&nbsp;&nbsp;<br/>6.73&#x2009;<small>×</small>&nbsp; | <br/>5.98&#x2009;<small>ms</small><br/>2.03&#x2009;<small>ms</small><br/>⎯⎯⎯&nbsp;&nbsp;<br/>2.95&#x2009;<small>×</small>&nbsp; | <br/>2.87&#x2009;<small>ms</small><br/>1.24&#x2009;<small>ms</small><br/>⎯⎯⎯&nbsp;&nbsp;<br/>2.33&#x2009;<small>×</small>&nbsp; | <br/>0.56&#x2009;<small>ms</small><br/>0.30&#x2009;<small>ms</small><br/>⎯⎯⎯&nbsp;&nbsp;<br/>1.88&#x2009;<small>×</small>&nbsp; |
| <div align="left">**64×64**</div><div align="right">•<br/>⇉<br/><br/>×</div> | <br/>7.07&#x2009;<small>ms</small><br/>0.22&#x2009;<small>ms</small><br/>⎯⎯⎯&nbsp;&nbsp;<br/>31.72&#x2009;<small>×</small>&nbsp; | <br/>1.66&#x2009;<small>ms</small><br/>0.17&#x2009;<small>ms</small><br/>⎯⎯⎯&nbsp;&nbsp;<br/>9.64&#x2009;<small>×</small>&nbsp; | <br/>0.80&#x2009;<small>ms</small><br/>0.16&#x2009;<small>ms</small><br/>⎯⎯⎯&nbsp;&nbsp;<br/>4.93&#x2009;<small>×</small>&nbsp; | <br/>0.15&#x2009;<small>ms</small><br/>0.08&#x2009;<small>ms</small><br/>⎯⎯⎯&nbsp;&nbsp;<br/>1.76&#x2009;<small>×</small>&nbsp; |

**Batching is 4.95× faster than single calls** <small>(median of 12 cases)</small>

> **Δ** &nbsp; <small>_Changes per pass_</small>&nbsp;&nbsp;&nbsp;&nbsp;
> **↔** &nbsp; <small>_Map size_</small>&nbsp;&nbsp;&nbsp;&nbsp;
> **•** &nbsp; <small>_Single_</small>&nbsp;&nbsp;&nbsp;&nbsp;
> **⇉** &nbsp; <small>_Batched_</small>&nbsp;&nbsp;&nbsp;&nbsp;
> **×** &nbsp; <small>_Factor_</small>
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
| 1 | Then is faster: median speedup ≤ 0.95 |
| 2 | Wrong call or a build could not be loaded |

The `benchmark` job in [ci.yml](../.github/workflows/ci.yml) runs
`pnpm benchmark latest` on PRs that change the package and fails on exit code.

> Runners are noisy, so rerun a failed job before looking for a regression.
