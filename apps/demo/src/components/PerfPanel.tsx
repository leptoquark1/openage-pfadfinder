import { useEffect, useState } from 'react';
import { COLORS } from '../theme.js';
import { EMPTY_SNAPSHOT, type PerfEntry, type PerfSnapshot } from '../world/perf.js';
import type { World } from '../world/world.js';

interface PerfPanelProps {
  world: World
}

/** Refresh rate of the panel — fast enough to feel live, slow enough to read. */
const REFRESH_MS = 250;

/** Frame budget of a 60 Hz display, the reference every timing is scaled to. */
const BUDGET_MS = 1000 / 60;

/**
 * Phases in display order. `indent` marks the parts `Sim` is made of, so the
 * panel shows where the simulation time goes instead of a flat list.
 */
const PHASES: { readonly name: string, readonly indent: boolean }[] = [
  { name: 'Sim', indent: false },
  { name: 'Grid', indent: true },
  { name: 'Flow', indent: true },
  { name: 'Traces', indent: true },
  { name: 'Obstacles', indent: true },
  { name: 'Mobs', indent: true },
  { name: 'Draw', indent: false },
];

const COUNTERS = ['Cells', 'Sectors', 'Portals', 'Fields', 'Mobs', 'Traces'];

/** Green while inside the frame budget, amber near it, red past it. */
function budgetColor(ms: number): string {
  if (ms <= BUDGET_MS * 0.5) {
    return COLORS.perfGood;
  }
  return ms <= BUDGET_MS ? COLORS.perfWarn : COLORS.perfBad;
}

/**
 * Live timing readout for the playground: frame budget, the phases the
 * simulation spends it in, and the size of the structures behind them.
 *
 * Grid rebuild and flow-field integration run on the 10 Hz planning tick, not
 * every frame — their "/s" column says how often they actually ran, which is
 * what makes their millisecond cost comparable to the per-frame phases.
 */
export function PerfPanel({ world }: PerfPanelProps) {
  const [snapshot, setSnapshot] = useState<PerfSnapshot>(EMPTY_SNAPSHOT);

  useEffect(() => {
    const perf = world.getPerf();
    const id = setInterval(() => setSnapshot(perf.snapshot()), REFRESH_MS);
    return () => clearInterval(id);
  }, [world]);

  const phases = new Map(snapshot.phases);
  const counters = new Map(snapshot.counters);
  const fps = Math.round(snapshot.fps);

  return (
    <div
      className="absolute top-3.5 left-3.5 w-56 rounded-lg border border-border bg-panel/85 px-3 py-2 font-mono text-[11px] text-muted backdrop-blur-sm"
      aria-live="off"
    >
      <div className="mb-2 border-b border-divider pb-1 tracking-[0.08em] text-[10px] text-section">PERFORMANCE</div>

      <div className="flex items-baseline justify-between">
        <span className="text-lg leading-none text-fg" style={{ color: budgetColor(snapshot.frame.avg) }}>
          {fps}
          <span className="ml-1 text-[11px]">fps</span>
        </span>
        <span>
          {format(snapshot.frame.avg)}
          {' '}
          <span className="text-[10px]">avg</span>
          {' '}
          /
          {' '}
          {format(snapshot.frame.max)}
          {' '}
          <span className="text-[10px]">max</span>
        </span>
      </div>

      <Sparkline values={snapshot.frameHistory} />

      <div className="mt-2 flex flex-col gap-0.5">
        {PHASES.map(({ name, indent }) => {
          const entry = phases.get(name);
          return entry ? <PhaseRow key={name} label={name} entry={entry} indent={indent} /> : null;
        })}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-3 border-t border-border pt-1.5">
        {COUNTERS.map(name => (
          <div key={name} className="flex justify-between">
            <span className="text-[10px]">{name}</span>
            <span className="text-fg">{counters.get(name) ?? 0}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * One phase: its average cost, a bar relative to the frame budget, and how
 * often it ran per second when that is not once per frame.
 */
function PhaseRow({ label, entry, indent }: { label: string, entry: PerfEntry, indent: boolean }) {
  const share = Math.min(entry.avg / BUDGET_MS, 1);
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-16 truncate ${indent ? 'pl-2 text-[10px]' : ''}`}>{label}</span>
      <span className="h-1 flex-1 rounded-full bg-border">
        <span className="block h-full rounded-full" style={{ width: `${share * 100}%`, background: budgetColor(entry.avg) }} />
      </span>
      <span className="w-11 text-right text-fg">{format(entry.avg)}</span>
      <span className="w-8 text-right text-[10px]">
        {entry.callsPerSecond}
        /s
      </span>
    </div>
  );
}

/** Frame times of the last two seconds, oldest bar first. */
function Sparkline({ values }: { values: readonly number[] }) {
  if (values.length === 0) {
    return <div className="mt-1.5 h-7" />;
  }

  // Scaled to the worst frame, but never below twice the budget, so a steady
  // 60 fps stays a flat line at half height instead of a noisy full-height one.
  const scale = Math.max(BUDGET_MS * 2, ...values);
  const step = 120 / values.length;

  return (
    <svg className="mt-1.5 h-7 w-full" viewBox="0 0 120 28" preserveAspectRatio="none" role="img" aria-label="Frame-Zeiten der letzten Sekunden">
      <line x1="0" y1={28 - (BUDGET_MS / scale) * 28} x2="120" y2={28 - (BUDGET_MS / scale) * 28} stroke={COLORS.border} strokeWidth="0.5" />
      {values.map((value, i) => {
        const height = Math.max((value / scale) * 28, 0.5);
        return (
        // biome-ignore lint/suspicious/noArrayIndexKey: samples are a positional ring buffer, not identities
          <rect key={i} x={i * step} y={28 - height} width={Math.max(step - 0.3, 0.4)} height={height} fill={budgetColor(value)} />
        );
      })}
    </svg>
  );
}

function format(ms: number): string {
  return `${ms < 10 ? ms.toFixed(2) : ms.toFixed(1)}`;
}
