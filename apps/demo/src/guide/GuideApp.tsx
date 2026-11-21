import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeft,
  BrickWall,
  ChevronFirst,
  ChevronLast,
  CircleDot,
  Eraser,
  Flag,
  MousePointer2,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  StepBack,
  StepForward,
  Waves,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { GuideCanvas, type Tool } from './GuideCanvas.js';
import { ApiCall, Inspector, Legend, OpenSet, ProgramListing, StepStory } from './panels.js';
import { Player } from './player.js';
import { type Cell, SCENARIOS, type Scenario } from './scenarios.js';
import { buildTimeline, CHAPTERS, inspectCell, type Timeline } from './timeline.js';

const SPEEDS = [0.5, 1, 2, 4] as const;

const TOOLS: readonly { id: Tool; label: string; icon: LucideIcon }[] = [
  { id: 'inspect', label: 'Inspect', icon: MousePointer2 },
  { id: 'start', label: 'Start', icon: CircleDot },
  { id: 'target', label: 'Target', icon: Flag },
  { id: 'wall', label: 'Wall', icon: BrickWall },
  { id: 'mud', label: 'Mud', icon: Waves },
  { id: 'erase', label: 'Erase', icon: Eraser },
];

function IconButton({
  icon: Icon,
  label,
  onClick,
  primary = false,
  disabled = false,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`flex shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-30 ${
        primary
          ? 'h-10 w-10 bg-mob text-bg hover:bg-mob/85'
          : 'h-8 w-8 text-muted enabled:hover:bg-panel enabled:hover:text-fg'
      }`}
    >
      <Icon size={primary ? 19 : 16} strokeWidth={2} fill={primary && Icon !== RotateCcw ? 'currentColor' : 'none'} />
    </button>
  );
}

/** The step to show after the map changed: the end of the chapter we were in. */
function stepAfterEdit(previous: Timeline, index: number, next: Timeline): number {
  const chapter = previous.steps[Math.min(index, previous.steps.length - 1)]!.chapter;
  const order = CHAPTERS.findIndex(c => c.id === chapter);
  for (let i = order; i >= 0; i--) {
    const id = CHAPTERS[i]!.id;
    const last = next.steps.findLastIndex(step => step.chapter === id);
    if (last >= 0) {
      return last;
    }
  }
  return 0;
}

/** Forward: the next chapter. Back: the start of this chapter, or of the one before. */
function chapterStep(timeline: Timeline, index: number, direction: 1 | -1): number {
  const current = timeline.steps[Math.min(index, timeline.steps.length - 1)]!.chapter;
  const at = timeline.chapters.findIndex(c => c.id === current);
  if (direction > 0) {
    return timeline.chapters[at + 1]?.first ?? timeline.steps.length - 1;
  }
  const first = timeline.chapters[at]!.first;
  return index > first ? first : (timeline.chapters[at - 1]?.first ?? 0);
}

export function GuideApp() {
  const player = useMemo(() => new Player(), []);
  const [scenario, setScenario] = useState<Scenario>(SCENARIOS[0]!);
  const [tool, setTool] = useState<Tool>('inspect');
  const [hover, setHover] = useState<Cell | null>(null);
  const timeline = useMemo(() => buildTimeline(scenario), [scenario]);
  useSyncExternalStore(player.subscribe, player.getVersion);

  const restart = useRef(true);
  const loaded = useRef<Timeline | null>(null);
  const progressBar = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (loaded.current === timeline) {
      return;
    }
    const durations = timeline.steps.map(step => step.duration);
    if (restart.current || !loaded.current) {
      restart.current = false;
      player.load(durations, 0);
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
        player.restart();
      }
    } else {
      player.load(durations, stepAfterEdit(loaded.current, player.index, timeline));
    }
    loaded.current = timeline;
  }, [player, timeline]);

  const handleEdit = useCallback((edit: (current: Scenario) => Scenario) => setScenario(edit), []);
  const handleProgress = useCallback((progress: number) => {
    progressBar.current?.style.setProperty('transform', `scaleX(${progress})`);
  }, []);

  const chooseScenario = (next: Scenario) => {
    if (next === scenario) {
      player.restart();
      return;
    }
    restart.current = true;
    setScenario(next);
  };

  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;
  const seekChapter = useCallback(
    (direction: 1 | -1) => player.seek(chapterStep(timelineRef.current, player.index, direction)),
    [player],
  );

  const index = Math.min(player.index, timeline.steps.length - 1);
  const step = timeline.steps[index]!;
  const chapterIndex = timeline.chapters.findIndex(c => c.id === step.chapter);
  const chapter = timeline.chapters[chapterIndex]!;
  const nextChapter = timeline.chapters[chapterIndex + 1];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }
      switch (e.key) {
        case ' ':
          player.toggle();
          break;
        case 'ArrowRight':
          e.shiftKey ? seekChapter(1) : player.stepForward();
          break;
        case 'ArrowLeft':
          e.shiftKey ? seekChapter(-1) : player.stepBack();
          break;
        case 'Home':
          player.seek(0);
          break;
        case 'End':
          player.seek(player.last);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [player, seekChapter]);

  const info = hover ? inspectCell(timeline.model, step.scene, hover) : null;
  const parts = [...new Set(timeline.chapters.map(c => c.part))];

  return (
    <div className="flex h-screen w-screen flex-col bg-bg font-sans text-fg">
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-border px-3 py-2">
        <a
          href={import.meta.env.BASE_URL}
          className="flex items-center gap-1.5 rounded-md px-1.5 py-1 font-mono text-[11px] text-muted hover:bg-panel hover:text-fg"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          Demo
        </a>
        <div className="flex items-center gap-2">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={20} height={20} />
          <h1 className="font-mono text-[13px] font-semibold tracking-[0.04em]">Inside the Pathfinder</h1>
        </div>

        <fieldset aria-label="Map" className="ml-auto flex flex-wrap items-center gap-1">
          {SCENARIOS.map(option => (
            <button
              key={option.id}
              type="button"
              aria-pressed={scenario.id === option.id}
              title={option.hint}
              onClick={() => chooseScenario(option)}
              className={`rounded-md px-2.5 py-1 font-mono text-[11px] transition-colors ${
                scenario.id === option.id ? 'bg-border-strong text-fg' : 'text-muted hover:bg-panel hover:text-fg'
              }`}
            >
              {option.name}
            </button>
          ))}
        </fieldset>
      </header>

      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <nav
          aria-label="Chapters"
          className="hidden w-[172px] shrink-0 overflow-y-auto border-r border-border p-2.5 xl:block"
        >
          {parts.map(part => (
            <div key={part} className="mb-3">
              <div className="mb-1 px-2 font-mono text-[10px] tracking-[0.1em] text-muted/70 uppercase">{part}</div>
              {timeline.chapters
                .filter(c => c.part === part)
                .map(c => {
                  const position = timeline.chapters.indexOf(c);
                  const done = position < chapterIndex;
                  const active = position === chapterIndex;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-current={active ? 'step' : undefined}
                      onClick={() => player.seek(c.first)}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-[6px] text-left font-mono text-[11.5px] transition-colors ${
                        active ? 'bg-panel text-fg' : 'text-muted hover:bg-panel/60 hover:text-fg'
                      }`}
                    >
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          active
                            ? 'bg-mob shadow-[0_0_0_3px_rgba(79,209,197,0.22)]'
                            : done
                              ? 'bg-mob/50'
                              : 'bg-border-strong'
                        }`}
                      />
                      {c.title}
                    </button>
                  );
                })}
            </div>
          ))}
        </nav>

        <div className="relative min-h-0 min-w-0 flex-1">
          <GuideCanvas
            player={player}
            timeline={timeline}
            tool={tool}
            onEdit={handleEdit}
            onHover={setHover}
            onProgress={handleProgress}
          />

          <fieldset
            aria-label="Canvas tool"
            className="absolute top-3 left-3 flex gap-0.5 rounded-lg border border-border bg-panel/90 p-1 backdrop-blur-sm"
          >
            {TOOLS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={tool === id}
                title={label}
                onClick={() => setTool(id)}
                className={`flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[10.5px] transition-colors ${
                  tool === id ? 'bg-border-strong text-fg' : 'text-muted hover:text-fg'
                }`}
              >
                <Icon size={13} aria-hidden="true" />
                <span className="hidden 2xl:inline">{label}</span>
              </button>
            ))}
          </fieldset>

          <Legend chapter={step.chapter} />
        </div>

        <aside className="flex h-[42%] w-full shrink-0 flex-col gap-3 overflow-y-auto border-t border-border p-4 lg:h-auto lg:w-[410px] lg:border-t-0 lg:border-l">
          <StepStory step={step} chapterTitle={chapter.title} part={chapter.part} />
          <ApiCall step={step} />
          {step.event >= 0 && <OpenSet timeline={timeline} step={step} />}
          <Inspector info={info} />
          <ProgramListing step={step} />
        </aside>
      </main>

      <footer className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2">
        <IconButton icon={ChevronFirst} label="Restart (Home)" onClick={() => player.seek(0)} disabled={index === 0} />
        <IconButton
          icon={SkipBack}
          label="Previous chapter (Shift + ←)"
          onClick={() => seekChapter(-1)}
          disabled={index === 0}
        />
        <IconButton icon={StepBack} label="Undo step (←)" onClick={() => player.stepBack()} disabled={index === 0} />
        <IconButton
          primary
          icon={player.playing ? Pause : player.atEnd ? RotateCcw : Play}
          label={player.playing ? 'Pause (Space)' : 'Play (Space)'}
          onClick={() => player.toggle()}
        />
        <IconButton
          icon={StepForward}
          label="Next step (→)"
          onClick={() => player.stepForward()}
          disabled={player.atEnd}
        />
        <IconButton
          icon={SkipForward}
          label="Next chapter (Shift + →)"
          onClick={() => seekChapter(1)}
          disabled={!nextChapter}
        />
        <IconButton
          icon={ChevronLast}
          label="Jump to end (End)"
          onClick={() => player.seek(player.last)}
          disabled={player.atEnd}
        />

        <div className="relative mx-2 h-8 min-w-0 flex-1">
          <div className="absolute inset-x-0 top-1/2 flex h-1.5 -translate-y-1/2 gap-[2px] overflow-hidden rounded-full">
            {timeline.chapters.map((c, i) => {
              const end = timeline.chapters[i + 1]?.first ?? timeline.steps.length;
              return <div key={c.id} className="h-full bg-border-strong" style={{ flexGrow: end - c.first }} />;
            })}
          </div>
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full">
            <div ref={progressBar} className="h-full w-full origin-left bg-mob" style={{ transform: 'scaleX(0)' }} />
          </div>
          <input
            type="range"
            aria-label="Timeline"
            min={0}
            max={timeline.steps.length - 1}
            value={index}
            onChange={e => player.seek(Number(e.target.value))}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </div>

        <span className="w-[66px] shrink-0 text-right font-mono text-[11px] text-muted tabular-nums">
          {index + 1} / {timeline.steps.length}
        </span>
        <fieldset aria-label="Speed" className="flex shrink-0 gap-0.5 rounded-lg border border-border p-0.5">
          {SPEEDS.map(speed => (
            <button
              key={speed}
              type="button"
              aria-pressed={player.speed === speed}
              onClick={() => player.setSpeed(speed)}
              className={`rounded-md px-1.5 py-0.5 font-mono text-[10.5px] ${
                player.speed === speed ? 'bg-border-strong text-fg' : 'text-muted hover:text-fg'
              }`}
            >
              {speed}×
            </button>
          ))}
        </fieldset>
      </footer>
    </div>
  );
}
