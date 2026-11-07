/**
 * Rolling timing statistics for the playground.
 *
 * The simulation runs two clocks: every frame moves obstacles and mobs, while
 * the planning tick (10 Hz) rebuilds the grid and re-integrates the flow
 * fields. A single average would blend both, so every phase is measured
 * separately and reported with how often it actually ran — a phase costing
 * 4 ms ten times a second is a very different budget than 4 ms every frame.
 */

/** Samples kept per phase — two seconds at 60 fps. */
const WINDOW = 120;

/** Rolling window over the last `WINDOW` samples of one phase. */
class Series {
  private readonly samples = new Float32Array(WINDOW);
  /** Wall-clock time of each sample, for calls-per-second. */
  private readonly stamps = new Float64Array(WINDOW);
  private count = 0;
  private cursor = 0;

  push(value: number, nowMs: number): void {
    this.samples[this.cursor] = value;
    this.stamps[this.cursor] = nowMs;
    this.cursor = (this.cursor + 1) % WINDOW;
    if (this.count < WINDOW) {
      this.count++;
    }
  }

  read(nowMs: number): PerfEntry {
    if (this.count === 0) {
      return EMPTY_ENTRY;
    }

    let sum = 0;
    let max = 0;
    let recent = 0;
    for (let i = 0; i < this.count; i++) {
      const value = this.samples[i]!;
      sum += value;
      if (value > max) {
        max = value;
      }
      if (nowMs - this.stamps[i]! <= 1000) {
        recent++;
      }
    }

    const lastIdx = (this.cursor - 1 + WINDOW) % WINDOW;
    return { last: this.samples[lastIdx]!, avg: sum / this.count, max, callsPerSecond: recent };
  }

  /** The window's samples in chronological order. */
  history(out: number[]): void {
    out.length = 0;
    const start = this.count < WINDOW ? 0 : this.cursor;
    for (let i = 0; i < this.count; i++) {
      out.push(this.samples[(start + i) % WINDOW]!);
    }
  }
}

/** Statistics of one measured phase, all times in milliseconds. */
export interface PerfEntry {
  readonly last: number
  readonly avg: number
  readonly max: number
  /** How often the phase ran in the last second — separates per-frame from per-tick work. */
  readonly callsPerSecond: number
}

const EMPTY_ENTRY: PerfEntry = { last: 0, avg: 0, max: 0, callsPerSecond: 0 };

export interface PerfSnapshot {
  readonly fps: number
  readonly frame: PerfEntry
  /** Measured phases in insertion order, so the panel keeps a stable layout. */
  readonly phases: readonly (readonly [string, PerfEntry])[]
  readonly counters: readonly (readonly [string, number])[]
  /** Frame times of the window, oldest first — the sparkline's data. */
  readonly frameHistory: readonly number[]
}

export const EMPTY_SNAPSHOT: PerfSnapshot = {
  fps: 0,
  frame: EMPTY_ENTRY,
  phases: [],
  counters: [],
  frameHistory: [],
};

/**
 * Collects phase timings and counters. Measuring is unconditional — a handful
 * of `performance.now()` calls per frame costs far less than the branch needed
 * to skip them, and the panel then shows valid numbers the moment it opens.
 */
export class PerfMeter {
  private readonly series: Map<string, Series> = new Map();
  private readonly counters: Map<string, number> = new Map();
  private readonly open: Map<string, number> = new Map();
  private readonly frameSeries = new Series();
  private readonly historyBuffer: number[] = [];

  /** Start measuring a phase. Nested phases are fine, re-entrant ones are not. */
  begin(name: string): void {
    this.open.set(name, performance.now());
  }

  end(name: string): void {
    const started = this.open.get(name);
    if (started === undefined) {
      return;
    }
    this.open.delete(name);
    const now = performance.now();
    this.sample(name, now - started, now);
  }

  /** Record a duration measured elsewhere. */
  sample(name: string, durationMs: number, nowMs = performance.now()): void {
    let series = this.series.get(name);
    if (!series) {
      series = new Series();
      this.series.set(name, series);
    }
    series.push(durationMs, nowMs);
  }

  /** Record the wall-clock length of a rendered frame. */
  frame(frameMs: number, nowMs: number): void {
    this.frameSeries.push(frameMs, nowMs);
  }

  setCounter(name: string, value: number): void {
    this.counters.set(name, value);
  }

  snapshot(): PerfSnapshot {
    const now = performance.now();
    const frame = this.frameSeries.read(now);
    this.frameSeries.history(this.historyBuffer);

    const phases: [string, PerfEntry][] = [];
    for (const [name, series] of this.series) {
      phases.push([name, series.read(now)]);
    }

    return {
      fps: frame.avg > 0 ? 1000 / frame.avg : 0,
      frame,
      phases,
      counters: [...this.counters],
      frameHistory: this.historyBuffer.slice(),
    };
  }
}
