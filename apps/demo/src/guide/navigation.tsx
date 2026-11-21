import type { LucideIcon } from 'lucide-react';
import { ArrowRight, Check, ChevronDown, ChevronLeft, ChevronsLeft, ChevronsRight, RotateCcw } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { SCENARIOS, type Scenario } from './scenarios.js';
import { CHAPTERS, type Chapter, type Timeline } from './timeline.js';

/** The steps of a chapter of this run: `first` up to, but not including, `end`. */
function stepRange(timeline: Timeline, chapterAt: number) {
  const first = timeline.chapters[chapterAt]!.first;
  const end = timeline.chapters[chapterAt + 1]?.first ?? timeline.steps.length;
  return { first, end };
}

function ProgressLine({ progress }: { progress: number }) {
  return (
    <span className="absolute inset-x-0 bottom-0 h-[2px] bg-border/70">
      <span className="block h-full bg-mob transition-[width] duration-300" style={{ width: `${progress * 100}%` }} />
    </span>
  );
}

function ChapterRow({
  chapter,
  timeline,
  index,
  onSelect,
}: {
  chapter: Chapter;
  timeline: Timeline;
  index: number;
  onSelect: (step: number) => void;
}) {
  const number = CHAPTERS.indexOf(chapter) + 1;
  const current = CHAPTERS.findIndex(c => c.id === timeline.steps[index]!.chapter) + 1;
  const at = timeline.chapters.findIndex(c => c.id === chapter.id);
  const available = at >= 0;
  const active = number === current;
  const done = available && number < current;

  let progress = done ? 1 : 0;
  if (active) {
    const { first, end } = stepRange(timeline, at);
    progress = (index - first + 1) / (end - first);
  }

  return (
    <li>
      <button
        type="button"
        disabled={!available}
        aria-current={active ? 'step' : undefined}
        title={available ? undefined : 'Not used on this map'}
        onClick={() => onSelect(timeline.chapters[at]!.first)}
        className={`relative flex h-9 w-full items-center gap-2.5 overflow-hidden rounded-md px-2 text-left transition-colors disabled:opacity-35 ${
          active ? 'bg-mob/12 text-fg' : 'text-muted enabled:hover:bg-border/60 enabled:hover:text-fg'
        }`}
      >
        <span
          className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-bold ${
            active ? 'bg-mob text-bg' : done ? 'bg-mob/25 text-mob' : 'bg-border text-muted'
          }`}
        >
          {done ? <Check size={11} strokeWidth={3} aria-hidden="true" /> : number}
        </span>
        <span className={`truncate font-mono text-[12px] ${active ? 'font-semibold' : ''}`}>{chapter.title}</span>
        {active && <ProgressLine progress={progress} />}
      </button>
    </li>
  );
}

/** The current chapter, top right. Unfolds into all chapters and the maps. */
export function ChapterMenu({
  timeline,
  index,
  scenario,
  onSelect,
  onScenario,
}: {
  timeline: Timeline;
  index: number;
  scenario: Scenario;
  onSelect: (step: number) => void;
  onScenario: (scenario: Scenario) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const at = timeline.chapters.findIndex(c => c.id === timeline.steps[index]!.chapter);
  const chapter = timeline.chapters[at]!;
  const number = CHAPTERS.findIndex(c => c.id === chapter.id) + 1;
  const { first, end } = stepRange(timeline, at);
  const parts = [...new Set(CHAPTERS.map(c => c.part))];

  return (
    <nav
      ref={root}
      aria-label="Chapters"
      className="absolute top-3 right-3 z-30 w-[264px] overflow-hidden rounded-xl border border-border-strong bg-panel/95 shadow-[0_10px_30px_rgba(0,0,0,0.45)] backdrop-blur-md"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`Chapter ${number}: ${chapter.title}. ${open ? 'Hide' : 'Show'} all chapters`}
        onClick={() => setOpen(!open)}
        className="relative flex h-11 w-full items-center gap-2.5 px-3 text-left transition-colors hover:bg-border/40"
      >
        <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-mob font-mono text-[11px] font-bold text-bg">
          {number}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] font-semibold text-fg">{chapter.title}</span>
        <span className="shrink-0 font-mono text-[10.5px] text-muted tabular-nums">
          {index - first + 1}/{end - first}
        </span>
        <ChevronDown
          size={17}
          aria-hidden="true"
          className={`shrink-0 text-muted transition-transform duration-200 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
        />
        {!open && <ProgressLine progress={(index - first + 1) / (end - first)} />}
      </button>

      <div
        className={`grid transition-[grid-template-rows] duration-200 motion-reduce:transition-none ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div id={listId} inert={!open} className="min-h-0 overflow-hidden">
          <div className="max-h-[calc(100vh-5rem)] overflow-y-auto border-t border-border p-2">
            {parts.map(part => (
              <div key={part} className="mb-2">
                <div className="mb-0.5 px-2 pt-1 font-mono text-[10px] tracking-[0.1em] text-muted/80 uppercase">
                  {part}
                </div>
                <ol className="flex flex-col gap-0.5">
                  {CHAPTERS.filter(c => c.part === part).map(c => (
                    <ChapterRow
                      key={c.id}
                      chapter={c}
                      timeline={timeline}
                      index={index}
                      onSelect={step => {
                        onSelect(step);
                        setOpen(false);
                      }}
                    />
                  ))}
                </ol>
              </div>
            ))}

            <fieldset aria-label="Map" className="border-t border-border px-1 pt-2">
              <div className="mb-1 px-1 font-mono text-[10px] tracking-[0.1em] text-muted/80 uppercase">Map</div>
              <div className="grid grid-cols-2 gap-0.5">
                {SCENARIOS.map(option => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={scenario.id === option.id}
                    title={option.hint}
                    onClick={() => onScenario(option)}
                    className={`truncate rounded-md px-2 py-1.5 text-left font-mono text-[11px] transition-colors ${
                      scenario.id === option.id
                        ? 'bg-border-strong text-fg'
                        : 'text-muted hover:bg-border/60 hover:text-fg'
                    }`}
                  >
                    {option.name}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
        </div>
      </div>
    </nav>
  );
}

function DockButton({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-fg/85 transition-colors enabled:hover:bg-border-strong enabled:hover:text-fg disabled:opacity-25"
    >
      <Icon size={19} strokeWidth={2.25} aria-hidden="true" />
    </button>
  );
}

/** The floating controls. Every button keeps its place, so repeated clicks stay on target. */
export function StepDock({
  timeline,
  index,
  onBack,
  onNext,
  onChapter,
  onSeek,
}: {
  timeline: Timeline;
  index: number;
  onBack: () => void;
  onNext: () => void;
  onChapter: (direction: 1 | -1) => void;
  onSeek: (step: number) => void;
}) {
  const at = timeline.chapters.findIndex(c => c.id === timeline.steps[index]!.chapter);
  const nextChapter = timeline.chapters[at + 1];
  const { first, end } = stepRange(timeline, at);
  const atFinish = index === timeline.steps.length - 1;
  const atChapterEnd = index === end - 1;

  const nextLabel = atFinish ? 'Start over' : atChapterEnd ? `Next: ${nextChapter!.title}` : 'Next step';
  const NextIcon = atFinish ? RotateCcw : ArrowRight;

  return (
    <nav
      aria-label="Steps"
      className="absolute bottom-3 left-1/2 z-20 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-0.5 rounded-full border border-border-strong bg-panel/95 p-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.5)] backdrop-blur-sm"
    >
      <DockButton
        icon={ChevronsLeft}
        label="Previous section (Shift + ←)"
        onClick={() => onChapter(-1)}
        disabled={index === 0}
      />
      <DockButton icon={ChevronLeft} label="Previous step (←)" onClick={onBack} disabled={index === 0} />

      <div className="hidden h-3 w-[132px] shrink-0 items-center gap-[2px] px-2 sm:flex">
        {Array.from({ length: end - first }, (_, i) => {
          const step = first + i;
          return (
            <button
              key={step}
              type="button"
              aria-label={`Step ${i + 1}: ${timeline.steps[step]!.title}`}
              aria-current={step === index ? 'step' : undefined}
              title={timeline.steps[step]!.title}
              onClick={() => onSeek(step)}
              className="group flex h-full min-w-0 flex-1 items-center"
            >
              <span
                className={`block h-1 w-full rounded-full transition-colors group-hover:bg-fg ${
                  step === index ? 'bg-target' : step < index ? 'bg-mob' : 'bg-border-strong'
                }`}
              />
            </button>
          );
        })}
      </div>

      <button
        type="button"
        title={atFinish ? 'Start over' : `${nextLabel} (→)`}
        onClick={atFinish ? () => onSeek(0) : onNext}
        className="flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full bg-mob px-3 font-mono text-[12px] font-semibold text-bg transition-colors hover:bg-mob/85 sm:w-[184px] sm:flex-none"
      >
        <span className="truncate">{nextLabel}</span>
        <NextIcon size={16} strokeWidth={2.5} className="shrink-0" aria-hidden="true" />
      </button>
      <DockButton
        icon={ChevronsRight}
        label="Next section (Shift + →)"
        onClick={() => onChapter(1)}
        disabled={!nextChapter}
      />
    </nav>
  );
}
