import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { arch, cpus, tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Types come from the sources; at runtime the built `dist/` is loaded dynamically.
import type * as Shared from '../src/shared/index.ts';

const args = process.argv.slice(2);
const IS_OUTPUT_JSON = args.includes('--json');
const IS_OUTPUT_PRETTY = args.includes('--pretty');
const IS_DOCS = args.includes('--docs');
/** The docs block on stdout: like `--docs`, but combinable with `--full` and a Then build. */
const IS_OUTPUT_MD = args.includes('--md');
const IS_EXTENDED = IS_DOCS || args.includes('--full');
const IS_SILENT = args.includes('--silent');

/** Wrong call or unloadable build: exit 2, so 1 always means "Then is faster". */
const fail = (message: string): never => {
  console.error(message);
  process.exit(2);
};

const ROUNDS = IS_EXTENDED ? 60 : 40;
/** Ratios within ±5 % of 1 count as noise, for coloring and the exit code. */
const NOISE = 0.05;
const PRECISION = 2;
const SECTOR_SIZE = 16;
const SIZES = IS_EXTENDED ? [512, 240, 64] : [64, 32];
const CHANGES = IS_EXTENDED ? [500, 100, 50, 10] : [35, 10];

/** Accepts a package dir or its dist dir; relative paths resolve against the cwd. */
const toDist = (dir: string): string => {
  const target = resolve(dir);
  return existsSync(resolve(target, 'shared/index.js')) ? target : resolve(target, 'dist');
};
/** The package this script belongs to, i.e. the parent of `scripts/`. */
const PKG_DIR = resolve(import.meta.dirname, '..');
/** Relative to the cwd or absolute, whichever is shorter. */
const short = (dir: string) => {
  const rel = relative(process.cwd(), dir) || '.';
  return rel.length <= dir.length ? rel : dir;
};

type Lib = typeof Shared;
type Grid = ReturnType<Lib['buildGrid']>;
/** `label` names the build in the output: a short path or `<package>@<version>`. */
type Build = { name: string; dir: string; label: string; lib: Lib };

const load = async (name: string, dir: string, label = short(dir)): Promise<Build> => {
  const entry = resolve(dir, 'shared/index.js');
  if (!existsSync(entry)) {
    fail(`${name} build not found: ${entry} is missing (run \`pnpm build\` there)`);
  }
  return { name, dir, label, lib: (await import(pathToFileURL(entry).href)) as Lib };
};

const PKG_NAME = (JSON.parse(readFileSync(resolve(PKG_DIR, 'package.json'), 'utf8')) as { name: string }).name;
/** A Then argument that is no existing path but looks like this is fetched from npm. */
const VERSION_RE = /^(?:latest|next|\d+\.\d+\.\d+(?:-[\w.]+)?)$/;

const exec = (cmd: string, cmdArgs: string[], cwd = PKG_DIR) =>
  execFileSync(cmd, cmdArgs, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    // npm and pnpm are .cmd scripts on Windows.
    shell: process.platform === 'win32',
  });

/** Temp dir for a fetched Then build, removed on exit. */
const tempDir = () => {
  const tmp = mkdtempSync(join(tmpdir(), 'pfadfinder-bench-'));
  process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));
  return tmp;
};

const errorDetail = (error: unknown) => (error as { stderr?: string }).stderr?.trim() || String(error);

/** Downloads a published version into a temp dir and returns its dist dir. */
const fetchRelease = (spec: string): { dir: string; label: string } => {
  const tmp = tempDir();

  try {
    const packed = JSON.parse(exec('npm', ['pack', `${PKG_NAME}@${spec}`, '--json', '--pack-destination', tmp]));
    const { filename, version } = (packed as { filename: string; version: string }[])[0]!;
    exec('tar', ['-xzf', join(tmp, filename), '-C', tmp]);
    return { dir: join(tmp, 'package', 'dist'), label: `${PKG_NAME}@${version}` };
  } catch (error) {
    return fail(`Then version "${spec}" could not be fetched from npm:\n${errorDetail(error)}`);
  }
};

/** The commit of a branch, tag or (short) hash, or undefined if it is none. */
const resolveRef = (ref: string): string | undefined => {
  try {
    return exec('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).trim();
  } catch {
    return undefined;
  }
};

/**
 * Exports this package at a commit into a temp dir and builds it there with
 * this checkout's TypeScript. Only committed files count, local changes don't.
 */
const buildRef = (ref: string, commit: string): { dir: string; label: string } => {
  const tmp = tempDir();
  const hash = commit.slice(0, 7);
  const label = commit.startsWith(ref) ? hash : `${ref} (${hash})`;
  if (!IS_SILENT) {
    console.error(`Building Then from ${label} …`);
  }

  try {
    // The package dir in the repo, e.g. "packages/pfadfinder/"; its tree is archived at the root.
    const prefix = exec('git', ['rev-parse', '--show-prefix']).trim();
    const pkg = join(tmp, 'package');
    mkdirSync(pkg);
    // From a subdir, git archive would limit even a tree to that subdir.
    const root = exec('git', ['rev-parse', '--show-toplevel']).trim();
    try {
      exec('git', ['cat-file', '-e', `${commit}:${prefix}tsconfig.build.json`], root);
    } catch {
      return fail(`Then ref "${ref}" has no buildable package at ${prefix}, try its npm version instead`);
    }
    exec('git', ['archive', '--format=tar', '-o', join(tmp, 'src.tar'), `${commit}:${prefix}`], root);
    exec('tar', ['-xf', join(tmp, 'src.tar'), '-C', pkg]);
    exec('pnpm', ['exec', 'tsc', '-p', join(pkg, 'tsconfig.build.json')]);
    return { dir: join(pkg, 'dist'), label };
  } catch (error) {
    const detail = (error as { stdout?: string }).stdout?.trim() || errorDetail(error);
    return fail(`Then ref "${ref}" could not be built:\n${detail}`);
  }
};

const DOCS_FILE = resolve(PKG_DIR, '../../docs/BENCHMARK.md');
const DOCS_START = '<!-- benchmark:start -->';
const DOCS_END = '<!-- benchmark:end -->';

const thenArg = args.find(a => !a.startsWith('--'));

/** Fails before measuring, so a wrong call doesn't cost a full run. */
const docsTemplate = (() => {
  if (!IS_DOCS) {
    return undefined;
  }
  if (thenArg !== undefined) {
    fail(`--docs documents this build only, drop the Then build "${thenArg}"`);
  }
  const text = existsSync(DOCS_FILE) ? readFileSync(DOCS_FILE, 'utf8') : '';
  const start = text.indexOf(DOCS_START);
  const end = text.indexOf(DOCS_END);
  if (start < 0 || end < start) {
    fail(`--docs: ${DOCS_FILE} needs a "${DOCS_START}" … "${DOCS_END}" block`);
  }
  return { before: text.slice(0, start + DOCS_START.length), after: text.slice(end) };
})();

const nowDir = toDist(PKG_DIR);
/** Then, unless it is an existing path: a published version first, then a git ref. */
const release = (() => {
  if (thenArg === undefined || existsSync(thenArg)) {
    return undefined;
  }
  if (VERSION_RE.test(thenArg)) {
    return fetchRelease(thenArg);
  }
  const commit = resolveRef(thenArg);
  return commit
    ? buildRef(thenArg, commit)
    : fail(`Then "${thenArg}" is no path, published version (latest, 1.1.0, …) or git ref`);
})();
const thenDir = release?.dir ?? (thenArg === undefined ? undefined : toDist(thenArg));

const now = await load('Now', nowDir);
const then = thenDir === undefined || thenDir === nowDir ? undefined : await load('Then', thenDir, release?.label);
const builds = then ? [then, now] : [now];

// Keep stdout pure JSON with `--json`.
const log = IS_SILENT ? () => {} : IS_OUTPUT_JSON || IS_OUTPUT_MD ? console.error : console.log;

log(then ? `Benchmark (Now: ${now.label} vs. Then: ${then.label})` : `Benchmark (${now.label})`);
log();

const ERR_COLOR = process.stderr.isTTY && !process.env.NO_COLOR;

/**
 * Single-line progress spinner on stderr, only on a terminal. The benchmark
 * blocks the event loop, so frames advance from `tick()` instead of a timer.
 */
const spinner = (() => {
  const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const enabled = process.stderr.isTTY && !IS_SILENT;
  let frame = 0;
  let last = 0;
  let label = '';
  /** `performance.now()` at which the run is expected to end, if known. */
  let deadline: number | undefined;

  /** E.g. "~1m 05s left"; seconds only below a minute, "estimating…" until known. */
  const countdown = (t: number) => {
    let text = 'estimating…';
    if (deadline !== undefined) {
      const sec = Math.max(0, Math.ceil((deadline - t) / 1000));
      text = `~${sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, '0')}s`} left`;
    }
    // Indented below the label, past the spinner symbol.
    return ERR_COLOR ? `  \x1b[2m${text}\x1b[0m` : `  ${text}`;
  };

  const draw = (force: boolean) => {
    const t = performance.now();
    if (!enabled || (!force && t - last < 80)) {
      return;
    }
    last = t;
    const symbol = FRAMES[frame++ % FRAMES.length]!;
    const status = `${ERR_COLOR ? `\x1b[36m${symbol}\x1b[0m` : symbol} ${label}`;
    // Two lines: status, then the countdown; the cursor goes back to the first line.
    process.stderr.write(`\r\x1b[2K${status}\n\x1b[2K${countdown(t)}\x1b[1A\r`);
  };

  return {
    set: (text: string, end?: number) => {
      label = text;
      deadline = end;
      draw(true);
    },
    tick: () => draw(false),
    stop: () => enabled && process.stderr.write('\r\x1b[2K\n\x1b[2K\x1b[1A\r'),
  };
})();

const { COST_IMPASSABLE, COST_MIN } = now.lib;

let seed = 1;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) >>> 0;
  return seed / 2 ** 32;
};

type Tile = { ne: number; se: number };

/** Pick `n` random passable tiles (duplicates possible on small maps). */
const pick = (costs: Uint8Array, size: number, n: number): Tile[] => {
  const out: Tile[] = [];

  while (out.length < n) {
    const i = Math.floor(rnd() * costs.length);
    if (costs[i] !== COST_IMPASSABLE) {
      out.push({ ne: i % size, se: Math.floor(i / size) });
    }
  }

  return out;
};

const run = (grid: Grid, costs: Uint8Array, size: number, n: number, batched: boolean): number => {
  let t = 0;

  for (let r = 0; r < ROUNDS; r++) {
    const tiles = pick(costs, size, n);
    const t0 = performance.now();

    for (const cost of [COST_IMPASSABLE, COST_MIN]) {
      if (batched) {
        grid.updateCosts(tiles.map(p => ({ ...p, cost })));
      } else {
        for (const p of tiles) {
          grid.updateCosts([{ ...p, cost }]);
        }
      }
    }

    t += performance.now() - t0;
    spinner.tick();
  }

  return t / ROUNDS / 2;
};

type Mode = 'single' | 'batched';
type Timing = { single: number; batched: number; factor: number };

const MODES = ['single', 'batched'] as const;
const MODE_LABEL: Record<Mode, string> = { single: 'Single', batched: 'Batched' };
const TOTAL = SIZES.length * CHANGES.length * builds.length * MODES.length;
let step = 0;

/**
 * Rough relative cost of one timed step, fitted to the `--docs` run: single
 * calls grow linearly with the changes, one batched call clearly less.
 */
const stepWeight = (size: number, n: number, mode: Mode) =>
  mode === 'single' ? n * size ** 1.3 : n ** 0.65 * size ** 1.45;

/**
 * Remaining-time estimate: the time spent per weight unit so far, per mode,
 * times the weight still to run. Unknown until both modes ran once.
 */
const eta = (() => {
  const spent: Record<Mode, number> = { single: 0, batched: 0 };
  const done: Record<Mode, number> = { single: 0, batched: 0 };
  const left: Record<Mode, number> = { single: 0, batched: 0 };
  for (const size of SIZES) {
    for (const n of CHANGES) {
      for (const mode of MODES) {
        left[mode] += stepWeight(size, n, mode) * builds.length;
      }
    }
  }
  let current: { mode: Mode; weight: number; t0: number } | undefined;

  /** Starts a step and returns the expected end of the whole run. */
  return (size: number, n: number, mode: Mode): number | undefined => {
    const t = performance.now();
    if (current) {
      spent[current.mode] += t - current.t0;
      done[current.mode] += current.weight;
      left[current.mode] -= current.weight;
    }
    current = { mode, weight: stepWeight(size, n, mode), t0: t };

    if (MODES.some(m => done[m] === 0)) {
      return undefined;
    }
    return t + MODES.reduce((sum, m) => sum + (left[m] * spent[m]) / done[m], 0);
  };
})();

const round = (v: number, digits = PRECISION) => +v.toFixed(digits);

/** Both modes on one build; the seed is reset so every build sees the same tile picks. */
const measure = (build: Build, costs: Uint8Array, size: number, n: number, caseSeed: number): Timing => {
  const grid = build.lib.buildGrid(costs.slice(), { width: size, height: size }, SECTOR_SIZE, 0);
  const timed = (mode: Mode) => {
    spinner.set(
      `[${++step}/${TOTAL}] ${size}×${size} · ${n} changes · ${build.name} · ${MODE_LABEL[mode]}`,
      eta(size, n, mode),
    );
    seed = caseSeed;
    return run(grid, costs, size, n, mode === 'batched');
  };

  const single = timed('single');
  const batched = timed('batched');

  return { single: round(single), batched: round(batched), factor: round(single / batched) };
};

type Result = { map: number; changes: number; timings: Record<string, Timing> };

const results: Result[] = [];

/**
 * Untimed pass per build first: each build is a separate module copy with its
 * own JIT state, and without warming up the build measured first in a case
 * (Then) is consistently slower. The seed is restored, so the maps stay the same.
 */
const WARMUP_SIZE = 64;
const warmupSeed = seed;
for (const b of builds) {
  const costs = new Uint8Array(WARMUP_SIZE * WARMUP_SIZE).map(() => (rnd() < 0.15 ? COST_IMPASSABLE : COST_MIN));
  const grid = b.lib.buildGrid(costs.slice(), { width: WARMUP_SIZE, height: WARMUP_SIZE }, SECTOR_SIZE, 0);
  spinner.set(`Warming up ${b.name}`);
  run(grid, costs, WARMUP_SIZE, 30, false);
  run(grid, costs, WARMUP_SIZE, 30, true);
}
seed = warmupSeed;

for (const size of SIZES.toReversed()) {
  for (const changes of CHANGES) {
    const costs = new Uint8Array(size * size).map(() => (rnd() < 0.15 ? COST_IMPASSABLE : COST_MIN));
    const caseSeed = seed;
    const timings: Record<string, Timing> = {};

    for (const b of builds) {
      timings[b.name] = measure(b, costs, size, changes, caseSeed);
    }

    results.push({ map: size, changes, timings });
  }
}

spinner.stop();

const speedup = (r: Result, mode: Mode) => round(r.timings.Then![mode] / r.timings.Now![mode]);

// ---------------------------------------------------------------- output

const USE_COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const sgr = (code: string) => (s: string) => (USE_COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = sgr('1');
const dim = sgr('2');
const green = sgr('32');
const red = sgr('31');
const plain = (s: string) => s;

type Style = (s: string) => string;

/** Green when the ratio favors the right side, red when it loses, dim within ±5 % noise. */
const colorRatio = (ratio: number): Style => (ratio >= 1 + NOISE ? green : ratio <= 1 - NOISE ? red : dim);

/** A matrix row: one per map size, split by mode when two builds are compared. */
type Row = { map: number; mode?: Mode };
/** `md`: the value with HTML for Markdown; `text` stays plain for the terminal. */
type Cell = { text: string; style: Style; md?: string };
/** `changes` set: a value column inside that column group; unset: a leading label column. */
type Column = { header: string; changes?: number; cell: (row: Row) => Cell };

const rows: Row[] = then ? SIZES.flatMap(map => MODES.map(mode => ({ map, mode }))) : SIZES.map(map => ({ map }));

const resultOf = (map: number, changes: number) => results.find(r => r.map === map && r.changes === changes)!;
const ms = (v: number): Cell => ({
  text: `${v.toFixed(PRECISION)} ms`,
  md: `${v.toFixed(PRECISION)}&#x2009;<small>ms</small>`,
  style: plain,
});
const ratio = (v: number): Cell => ({
  text: `${v.toFixed(PRECISION)}×`,
  md: `${v.toFixed(PRECISION)}&#x2009;<small>×</small>&nbsp;`,
  style: colorRatio(v),
});

const valueColumns = (changes: number): Column[] => {
  const at = (row: Row) => resultOf(row.map, changes);

  return then
    ? [
        { header: 'Then', changes, cell: row => ms(at(row).timings.Then![row.mode!]) },
        { header: 'Now', changes, cell: row => ms(at(row).timings.Now![row.mode!]) },
        { header: 'Speedup', changes, cell: row => ratio(speedup(at(row), row.mode!)) },
      ]
    : [
        { header: 'Single', changes, cell: row => ms(at(row).timings.Now!.single) },
        { header: 'Batched', changes, cell: row => ms(at(row).timings.Now!.batched) },
        { header: 'Factor', changes, cell: row => ratio(at(row).timings.Now!.factor) },
      ];
};

const columns: Column[] = [
  { header: 'Map', cell: row => ({ text: `${row.map}×${row.map}`, style: bold }) },
  ...(then ? [{ header: 'Mode', cell: (row: Row) => ({ text: MODE_LABEL[row.mode!], style: plain }) }] : []),
  ...CHANGES.flatMap(valueColumns),
];

const isLabel = (c: Column) => c.changes === undefined;
/** In comparison blocks the map is only named on its first row. */
const firstOfMap = (i: number) => i === 0 || rows[i - 1]!.map !== rows[i]!.map;

const median = (values: number[]): number => {
  const sorted = values.toSorted((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/** Median ratio over all cases: Now vs. Then when comparing, batched vs. single otherwise. */
const ratios = then
  ? results.flatMap(r => MODES.map(mode => speedup(r, mode)))
  : results.map(r => r.timings.Now!.factor);
const MEDIAN = round(median(ratios));

/** E.g. "Now is 1.12× faster than Then"; below 1 the inverse is reported as slower. */
const summaryHead = (() => {
  const [subject, other] = then ? ['Now', 'Then'] : ['Batching', 'single calls'];
  const verdict = MEDIAN >= 1 ? `${MEDIAN.toFixed(PRECISION)}× faster` : `${(1 / MEDIAN).toFixed(PRECISION)}× slower`;
  return `${subject} is ${verdict} than ${other}`;
})();
const summaryDetail = `(median of ${ratios.length} cases)`;
const summary = `${summaryHead} ${summaryDetail}`;

const legend = then
  ? `Time per update pass, ${ROUNDS} rounds · Speedup = Then / Now`
  : `Time per update pass, ${ROUNDS} rounds · Factor = Single / Batched`;

/**
 * Box-drawn terminal matrix: a spanning header per number of changes above
 * the compared values, right-aligned numbers and ratios colored by who wins.
 */
const pretty = (): string => {
  const cells = rows.map(row => columns.map(c => c.cell(row)));
  const widths = columns.map((c, i) => Math.max(c.header.length, ...cells.map(r => r[i]!.text.length)));

  // Consecutive columns of the same group share one spanning header.
  const groups: { label: string; cols: number[] }[] = [];
  columns.forEach((c, i) => {
    const prev = groups.at(-1);
    if (!isLabel(c) && prev && columns[prev.cols[0]!]!.changes === c.changes) {
      prev.cols.push(i);
    } else {
      groups.push({ label: isLabel(c) ? '' : `${c.changes} changes`, cols: [i] });
    }
  });
  const span = (cols: number[]) => cols.reduce((sum, i) => sum + widths[i]! + 3, -3);
  for (const { label, cols } of groups) {
    const extra = label.length - span(cols);
    if (extra > 0) {
      widths[cols.at(-1)!] = widths[cols.at(-1)!]! + extra;
    }
  }
  const groupStart = new Set(groups.map(g => g.cols[0]!));

  const line = (left: string, join: (i: number) => string, right: string, fill: (i: number) => string = () => '─') =>
    dim(left + columns.map((_, i) => (i ? join(i) : '') + fill(i).repeat(widths[i]! + 2)).join('') + right);
  const bar = dim('│');
  const center = (s: string, w: number) => s.padStart(s.length + Math.floor((w - s.length) / 2)).padEnd(w);
  // Pad before styling, ANSI codes would break the width calculation.
  const pad = (s: string, i: number) => (isLabel(columns[i]!) ? s.padEnd(widths[i]!) : s.padStart(widths[i]!));
  const row = (values: string[], style: (i: number) => Style) =>
    bar + values.map((v, i) => ` ${style(i)(pad(v, i))} `).join(bar) + bar;

  const out = [
    line('┌', i => (groupStart.has(i) ? '┬' : '─'), '┐'),
    bar + groups.map(g => ` ${bold(center(g.label, span(g.cols)))} `).join(bar) + bar,
    line(
      '│',
      i => (isLabel(columns[i]!) ? '│' : isLabel(columns[i - 1]!) ? '├' : groupStart.has(i) ? '┼' : '┬'),
      '┤',
      i => (isLabel(columns[i]!) ? ' ' : '─'),
    ),
    row(
      columns.map(c => c.header),
      () => bold,
    ),
    line('├', () => '┼', '┤'),
  ];

  rows.forEach((_, i) => {
    if (then && i > 0 && firstOfMap(i)) {
      out.push(line('├', () => '┼', '┤'));
    }
    const values = cells[i]!.map(c => c.text);
    out.push(row(then && !firstOfMap(i) ? ['', ...values.slice(1)] : values, c => cells[i]![c]!.style));
  });

  out.push(line('└', () => '┴', '┘'));
  out.push(bold(colorRatio(MEDIAN)(summary)));
  out.push(dim(legend));

  return out.join('\n');
};

const MD_KEYS = then ? ['◁', '▷', '×'] : ['•', '⇉', '×'];
const MD_RULE = '⎯⎯⎯&nbsp;&nbsp;';

const markdown = (): string => {
  const [keyA, keyB, keyRatio] = MD_KEYS;
  const label = (row: Row) => {
    const name = `**${row.map}×${row.map}**${row.mode ? ` · ${MODE_LABEL[row.mode]}` : ''}`;
    const keys = `${keyA}<br/>${keyB}<br/><br/>${keyRatio}`;
    return `<div align="left">${name}</div><div align="right">${keys}</div>`;
  };
  const cell = (row: Row, changes: number) => {
    const [a, b, r] = valueColumns(changes).map(c => {
      const value = c.cell(row);
      return value.md ?? value.text;
    });
    return `<br/>${a}<br/>${b}<br/>${MD_RULE}<br/>${r}`;
  };
  /** Quoted key line; the source lines join into one paragraph, spaced by `&nbsp;`. */
  const keyLegend = [
    ['Δ', 'Changes per pass'],
    ['↔', 'Map size'],
    ...(then
      ? [
          [keyA, 'Then'],
          [keyB, 'Now'],
          [keyRatio, 'Speedup'],
        ]
      : [
          [keyA, 'Single'],
          [keyB, 'Batched'],
          [keyRatio, 'Factor'],
        ]),
  ]
    .map(([key, text]) => `> **${key}** &nbsp; <small>_${text}_</small>`)
    .join(`${'&nbsp;'.repeat(4)}\n`);
  const corner = '**<div align="right">Δ</div><div align="left">&nbsp;↔</div>**';

  return [
    `Time per update pass, **${ROUNDS} rounds**`,
    ``,
    `| ${corner} | ${CHANGES.map(n => `**${n}**<br><br>`).join(' | ')} |`,
    `| :--- | ${CHANGES.map(() => '---:').join(' | ')} |`,
    ...rows.map(row => `| ${[label(row), ...CHANGES.map(n => cell(row, n))].join(' | ')} |`),
    ``,
    `**${summaryHead}** <small>${summaryDetail}</small>`,
    '',
    keyLegend,
  ].join('\n');
};

const json = (): unknown => {
  if (!then) {
    return results.map(r => ({ map: r.map, changes: r.changes, ...r.timings.Now }));
  }

  return {
    // biome-ignore lint/suspicious/noThenProperty: plain JSON output, never awaited
    builds: { then: release ? then.label : then.dir, now: now.dir },
    median: MEDIAN,
    results: results.map(r => ({
      map: r.map,
      changes: r.changes,
      // biome-ignore lint/suspicious/noThenProperty: plain JSON output, never awaited
      then: r.timings.Then,
      now: r.timings.Now,
      speedup: { single: speedup(r, 'single'), batched: speedup(r, 'batched') },
    })),
  };
};

/** Generated docs block: what ran where (and which builds, when comparing), then the Markdown matrix. */
const docs = (): string => {
  const env = [`Node ${process.version.split('.')[0]}`, cpus()[0]?.model.replace('Processor', '').trim(), `${arch()}`]
    .filter(Boolean)
    .join(' · ');

  const compared = then ? `Then: \`${then.label}\` · Now: \`${now.label}\`\n\n` : '';

  return `\nHost: _${env}_\n\n${compared}${markdown()}\n`;
};

if (docsTemplate) {
  writeFileSync(DOCS_FILE, docsTemplate.before + docs() + docsTemplate.after);
  if (!IS_SILENT) {
    console.error(`Updated ${short(DOCS_FILE)}\n`);
  }
}

if (!IS_SILENT) {
  const output = IS_OUTPUT_JSON
    ? JSON.stringify(json(), undefined, 2)
    : IS_OUTPUT_PRETTY
      ? pretty()
      : IS_OUTPUT_MD
        ? docs().trim()
        : markdown();
  console.log(output);
}

// Fail the comparison when Then is faster beyond noise, e.g. for CI.
if (then && MEDIAN <= 1 - NOISE) {
  if (!IS_SILENT) {
    console.error(`\nThen is faster than Now beyond the ${NOISE * 100} % noise margin`);
  }
  process.exitCode = 1;
}
