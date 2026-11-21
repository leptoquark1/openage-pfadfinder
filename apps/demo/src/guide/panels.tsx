import {
  FLOW_DIR_MASK,
  FLOW_LOS_MASK,
  FLOW_PATHABLE_MASK,
  FLOW_TARGET_MASK,
  INTEGRATE_FOUND_MASK,
  INTEGRATE_LOS_MASK,
  INTEGRATE_TARGET_MASK,
  INTEGRATE_WAVEFRONT_BLOCKED_MASK,
} from '@leptoquark1/openage-pfadfinder/shared';
import { ChevronRight } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import { LINE_OF, PROGRAM, type Token, type TokenKind, tokenize } from './program.js';
import { INK } from './render.js';
import type { ChapterId, CellInspection, GuideStep, Timeline } from './timeline.js';

const TOKEN_CLASS: Record<TokenKind, string> = {
  plain: 'text-fg/80',
  comment: 'text-muted/70 italic',
  string: 'text-[#86EFAC]',
  keyword: 'text-[#C4B5FD]',
  number: 'text-target',
  type: 'text-mob',
  call: 'text-[#7DD3FC]',
};

function Code({ tokens }: { tokens: readonly Token[] }) {
  return tokens.map((token, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: tokens of a line never reorder
    <span key={i} className={TOKEN_CLASS[token.kind]}>
      {token.text}
    </span>
  ));
}

/** Renders `code` and **bold** spans of a step's text. */
function Rich({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  let at = 0;
  for (const match of text.matchAll(pattern)) {
    parts.push(text.slice(at, match.index));
    if (match[1]) {
      parts.push(
        <code key={match.index} className="rounded bg-border px-1 py-0.5 font-mono text-[0.86em] text-fg">
          {match[1]}
        </code>,
      );
    } else {
      parts.push(
        <strong key={match.index} className="font-semibold text-fg">
          {match[2]}
        </strong>,
      );
    }
    at = match.index + match[0].length;
  }
  parts.push(text.slice(at));
  return parts;
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="mb-1.5 font-mono text-[10px] tracking-[0.1em] text-muted uppercase">{children}</div>;
}

export function StepStory({ step, chapterTitle, part }: { step: GuideStep; chapterTitle: string; part: string }) {
  return (
    <section aria-live="polite">
      <div className="mb-1 font-mono text-[10.5px] tracking-[0.06em] text-mob">
        {part} · {chapterTitle}
      </div>
      <h2 className="mb-2 text-[19px] leading-tight font-semibold text-fg">{step.title}</h2>
      <p className="min-h-[82px] text-[13.5px] leading-[1.6] text-[#B4BEC8]">
        <Rich text={step.body} />
      </p>
    </section>
  );
}

export function ApiCall({ step }: { step: GuideStep }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-panel">
      {step.stack.length > 0 && (
        <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-3 py-1.5 font-mono text-[10.5px] text-muted">
          {step.stack.map((frame, i) => (
            <span key={frame} className="flex items-center gap-0.5">
              {i > 0 && <ChevronRight size={11} aria-hidden="true" />}
              <span className={i === step.stack.length - 1 ? 'text-[#7DD3FC]' : ''}>{frame}</span>
            </span>
          ))}
        </div>
      )}
      <div className="px-3 py-2 font-mono text-[12px] leading-[1.55] break-all">
        <Code tokens={tokenize(step.call)} />
      </div>
      <div className="flex gap-2 border-t border-border bg-bg/50 px-3 py-1.5 font-mono text-[11px]">
        <span className="shrink-0 text-muted">returns</span>
        <span className="min-w-0 break-all text-target">{step.returns}</span>
      </div>
    </section>
  );
}

export function ProgramListing({ step }: { step: GuideStep }) {
  const active = LINE_OF[step.line];
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = scroller.current;
    const row = box?.querySelector<HTMLElement>(`[data-line="${active}"]`);
    if (box && row) {
      box.scrollTo({ top: row.offsetTop - box.clientHeight / 2 + row.clientHeight / 2, behavior: 'smooth' });
    }
  }, [active]);

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <SectionLabel>Your code</SectionLabel>
      <div
        ref={scroller}
        className="relative min-h-[110px] flex-1 overflow-auto rounded-lg border border-border bg-panel py-1.5 font-mono text-[11px] leading-[1.7]"
      >
        {PROGRAM.map((line, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: the listing is static
            key={i}
            data-line={i}
            className={`flex w-max min-w-full pr-3 ${i === active ? 'bg-mob/15 shadow-[inset_2px_0_0_var(--color-mob)]' : ''}`}
          >
            <span className="w-8 shrink-0 pr-2 text-right text-muted/40 select-none">{i + 1}</span>
            <span className="whitespace-pre">
              <Code tokens={tokenize(line)} />
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function OpenSet({ timeline, step }: { timeline: Timeline; step: GuideStep }) {
  const event = timeline.model.search?.events[step.event];
  if (!event) {
    return null;
  }
  const open = event.states.filter(s => !s.closed).sort((a, b) => a.f - b.f);
  const closed = event.states.length - open.length;
  const maxF = Math.max(1, ...open.map(s => s.f));

  return (
    <section>
      <SectionLabel>
        Open set · {open.length} waiting · {closed} closed
      </SectionLabel>
      <div className="max-h-[132px] overflow-auto rounded-lg border border-border bg-panel p-1.5 font-mono text-[10.5px]">
        {open.length === 0 && <div className="px-1 py-0.5 text-muted">empty</div>}
        {open.map((state, i) => (
          <div key={state.id} className="flex items-center gap-2 px-1 py-[2px]">
            <span className={`w-8 ${i === 0 ? 'font-bold text-target' : 'text-fg/80'}`}>P{state.id}</span>
            <span className="flex h-2 flex-1 overflow-hidden rounded-sm bg-border">
              <span className="block bg-mob/80" style={{ width: `${(state.g / maxF) * 100}%` }} />
              <span className="block bg-target/80" style={{ width: `${(state.h / maxF) * 100}%` }} />
            </span>
            <span className="w-[86px] text-right text-muted">
              {state.g}+{state.h}=<span className="text-fg">{state.f}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Bits({ value, labels }: { value: number; labels: Readonly<Record<number, string>> }) {
  return (
    <div className="flex gap-[3px]">
      {[7, 6, 5, 4, 3, 2, 1, 0].map(bit => {
        const on = (value & (1 << bit)) !== 0;
        return (
          <span
            key={bit}
            title={labels[1 << bit] ?? `bit ${bit}`}
            className={`flex h-[17px] w-[17px] items-center justify-center rounded-[3px] text-[9px] ${
              on ? 'bg-mob font-bold text-bg' : 'bg-border text-muted/60'
            }`}
          >
            {on ? 1 : 0}
          </span>
        );
      })}
    </div>
  );
}

const INTEGRATION_BITS: Readonly<Record<number, string>> = {
  [INTEGRATE_FOUND_MASK]: 'FOUND',
  [INTEGRATE_WAVEFRONT_BLOCKED_MASK]: 'WAVEFRONT_BLOCKED',
  [INTEGRATE_LOS_MASK]: 'LOS',
  [INTEGRATE_TARGET_MASK]: 'TARGET',
};

const FLOW_BITS: Readonly<Record<number, string>> = {
  1: 'direction',
  2: 'direction',
  4: 'direction',
  8: 'direction',
  [FLOW_PATHABLE_MASK]: 'PATHABLE',
  [FLOW_LOS_MASK]: 'LOS',
  [FLOW_TARGET_MASK]: 'TARGET',
};

const DIRECTION_NAMES = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

const flagNames = (value: number, names: Readonly<Record<number, string>>) =>
  Object.entries(names)
    .filter(([mask, name]) => name !== 'direction' && (value & Number(mask)) !== 0)
    .map(([, name]) => name)
    .join(' · ') || 'no flags';

export function Inspector({ info }: { info: CellInspection | null }) {
  if (!info) {
    return (
      <section>
        <SectionLabel>Cell inspector</SectionLabel>
        <div className="rounded-lg border border-dashed border-border px-3 py-3 font-mono text-[11px] text-muted">
          Hover a cell to read its real bytes.
        </div>
      </section>
    );
  }
  const row = (label: string, value: ReactNode) => (
    <div className="flex justify-between gap-2">
      <span className="text-muted">{label}</span>
      <span className="text-fg">{value}</span>
    </div>
  );
  return (
    <section>
      <SectionLabel>Cell inspector</SectionLabel>
      <div className="space-y-2 rounded-lg border border-border bg-panel px-3 py-2 font-mono text-[11px]">
        <div className="grid grid-cols-2 gap-x-5 gap-y-0.5">
          {row('global', `${info.cell.ne}, ${info.cell.se}`)}
          {row('index', info.index)}
          {row('sector', `S${info.sector}`)}
          {row('local', `${info.local.ne}, ${info.local.se}`)}
          {row('cost', info.cost)}
          {row('integrated', info.integrated ?? '–')}
        </div>
        {info.integrationFlags !== null && (
          <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
            <div className="min-w-0">
              <div className="text-muted">integration</div>
              <div className="truncate text-[9.5px] text-mob">{flagNames(info.integrationFlags, INTEGRATION_BITS)}</div>
            </div>
            <Bits value={info.integrationFlags} labels={INTEGRATION_BITS} />
          </div>
        )}
        {info.flow !== null && (
          <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
            <div className="min-w-0">
              <div className="text-muted">flow · {DIRECTION_NAMES[info.flow & FLOW_DIR_MASK]}</div>
              <div className="truncate text-[9.5px] text-mob">{flagNames(info.flow, FLOW_BITS)}</div>
            </div>
            <Bits value={info.flow} labels={FLOW_BITS} />
          </div>
        )}
      </div>
    </section>
  );
}

interface LegendItem {
  readonly color: string;
  readonly label: string;
}

const TERRAIN: readonly LegendItem[] = [
  { color: INK.freeAlt, label: 'free · 1' },
  { color: INK.mudLine, label: 'mud · 6' },
  { color: INK.wallTop, label: 'wall · 255' },
];

const HEAT: readonly LegendItem[] = [
  { color: '#F5A623', label: 'near' },
  { color: '#2DA39A', label: 'mid' },
  { color: '#27366B', label: 'far' },
];

const LEGENDS: Record<ChapterId, readonly LegendItem[]> = {
  memory: TERRAIN,
  sectors: [...TERRAIN, { color: INK.frame, label: 'sector' }],
  portals: [
    { color: INK.portal, label: 'portal' },
    { color: INK.shadow, label: 'blocked pair' },
    { color: INK.sight, label: 'scanner' },
  ],
  areas: [
    { color: '#4FD1C5', label: 'area 1' },
    { color: '#A78BFA', label: 'area 2' },
    { color: INK.text, label: 'exit link' },
  ],
  graph: [
    { color: INK.portal, label: 'portal node' },
    { color: INK.sight, label: 'hover: edge costs' },
  ],
  request: [
    { color: INK.chain, label: 'start' },
    { color: INK.open, label: 'target' },
  ],
  search: [
    { color: INK.open, label: 'open' },
    { color: INK.closed, label: 'closed' },
    { color: '#FFFFFF', label: 'expanding' },
    { color: INK.chain, label: 'chain' },
  ],
  target: [...HEAT, { color: INK.sight, label: 'sees target' }, { color: INK.shadow, label: 'shadow' }],
  transit: [...HEAT, { color: INK.portal, label: 'exit cells' }],
  route: [
    { color: INK.chain, label: 'route sector' },
    { color: INK.sight, label: 'waypoints' },
  ],
  crowd: [{ color: INK.chain, label: 'unit' }],
};

export function Legend({ chapter }: { chapter: ChapterId }) {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-x-3 gap-y-1 rounded-lg border border-border bg-panel/85 px-3 py-1.5 font-mono text-[10.5px] text-muted backdrop-blur-sm">
      {LEGENDS[chapter].map(item => (
        <span key={item.label} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}
