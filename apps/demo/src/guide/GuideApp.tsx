import { ArrowLeft } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { GUIDE_TOUR_KEY, isUnseen, markSeen } from '../seen.js';
import { GuideCanvas, type HoverPoint } from './GuideCanvas.js';
import { GuideTour } from './GuideTour.js';
import { introInsets, layoutGuide, makeView } from './layout.js';
import { ChapterMenu, StepDock } from './navigation.js';
import { ApiCall, Inspector, Legend, OpenSet, StepStory, TryIt } from './panels.js';
import { Player } from './player.js';
import { COLS, ROWS, SCENARIOS, type Scenario } from './scenarios.js';
import { buildTimeline, CHAPTERS, type ChapterId, inspectCell, type Timeline, type Tool } from './timeline.js';
import { INTRO_SLIDES, tourSceneStep, tourStopsFor } from './tour.js';

const NO_TOOLS: readonly Tool[] = [];

const durationsOf = (timeline: Timeline) => timeline.steps.map(step => step.duration);

/** The step to show after the map changed: the same place in the same chapter, if it still exists. */
function stepAfterEdit(previous: Timeline, index: number, next: Timeline): number {
  const at = Math.min(index, previous.steps.length - 1);
  const chapter = previous.steps[at]!.chapter;
  const first = previous.steps.findIndex(step => step.chapter === chapter);
  const wasLast = previous.steps[at + 1]?.chapter !== chapter;

  const order = CHAPTERS.findIndex(c => c.id === chapter);
  for (let i = order; i >= 0; i--) {
    const id = CHAPTERS[i]!.id;
    const last = next.steps.findLastIndex(step => step.chapter === id);
    if (last >= 0) {
      const nextFirst = next.steps.findIndex(step => step.chapter === id);
      return id === chapter && !wasLast ? Math.min(nextFirst + at - first, last) : last;
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
  const [chosen, setChosen] = useState<{ tool: Tool; chapter: ChapterId } | null>(null);
  const [hover, setHover] = useState<HoverPoint | null>(null);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [cardHeight, setCardHeight] = useState(0);
  const [settled, setSettled] = useState(false);
  // While the tour runs, `resume` is the step to return to afterwards.
  const [tour, setTour] = useState<{ at: number; resume: number } | null>(() =>
    isUnseen(GUIDE_TOUR_KEY) ? { at: 0, resume: 0 } : null,
  );
  const userTimeline = useMemo(() => buildTimeline(scenario), [scenario]);
  // The tour always tells its story on the first map, whichever map the reader has open.
  const tourTimeline = useMemo(() => buildTimeline(SCENARIOS[0]!), []);
  const timeline = tour ? tourTimeline : userTimeline;
  useSyncExternalStore(player.subscribe, player.getVersion);

  const loaded = useRef<Timeline | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const tourRef = useRef(tour);
  tourRef.current = tour;
  const userTimelineRef = useRef(userTimeline);
  userTimelineRef.current = userTimeline;

  useLayoutEffect(() => {
    if (loaded.current === userTimeline) {
      return;
    }
    if (loaded.current) {
      player.load(durationsOf(userTimeline), stepAfterEdit(loaded.current, player.index, userTimeline));
    } else if (tourRef.current) {
      player.load(durationsOf(tourTimeline), tourSceneStep(tourTimeline, 0));
    } else {
      player.load(durationsOf(userTimeline), 0);
    }
    loaded.current = userTimeline;
  }, [player, userTimeline, tourTimeline]);

  useLayoutEffect(() => {
    const card = cardRef.current!;
    const measure = () => setCardHeight(card.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    // The card only glides between steps, not into its first position.
    const frame = requestAnimationFrame(() => setSettled(true));
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(frame);
    };
  }, []);

  const handleEdit = useCallback((edit: (current: Scenario) => Scenario) => setScenario(edit), []);

  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;
  const seekChapter = useCallback(
    (direction: 1 | -1) => player.seek(chapterStep(timelineRef.current, player.index, direction)),
    [player],
  );
  const seek = useCallback((step: number) => player.seek(step), [player]);

  const startTour = useCallback(() => {
    setTour({ at: 0, resume: player.index });
    player.load(durationsOf(tourTimeline), tourSceneStep(tourTimeline, 0));
  }, [player, tourTimeline]);
  const moveTour = useCallback(
    (at: number) => {
      setTour(current => current && { ...current, at });
      player.seek(tourSceneStep(tourTimeline, at));
    },
    [player, tourTimeline],
  );
  const endTour = useCallback(() => {
    markSeen(GUIDE_TOUR_KEY);
    player.load(durationsOf(userTimelineRef.current), tourRef.current?.resume ?? 0);
    setTour(null);
  }, [player]);

  const index = Math.min(player.index, timeline.steps.length - 1);
  const step = timeline.steps[index]!;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || tourRef.current) {
        return;
      }
      switch (e.key) {
        case ' ':
          // A focused button handles Space itself.
          if (e.target instanceof Element && e.target.closest('button')) {
            return;
          }
          player.stepForward();
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

  const { interaction } = step;
  const tools = interaction?.tools ?? NO_TOOLS;
  const tool = chosen?.chapter === step.chapter && tools.includes(chosen.tool) ? chosen.tool : 'inspect';
  const chooseTool = (next: Tool) => setChosen({ tool: next === tool ? 'inspect' : next, chapter: step.chapter });

  const layout = layoutGuide(viewport.width, viewport.height, step.side, step.focus, step.scene.camera, cardHeight);
  const inspected = interaction?.inspect && tool === 'inspect' && !tour ? hover : null;
  const info = inspected ? inspectCell(timeline.model, step.scene, inspected.cell) : null;
  const tooltipLeft = inspected !== null && inspected.x > viewport.width / 2;
  const tooltipUp = inspected !== null && inspected.y > viewport.height / 2;

  const tourStops = tourStopsFor(viewport.width);
  const tourAt = tour ? Math.min(tour.at, INTRO_SLIDES.length + tourStops.length - 1) : 0;
  const inIntro = tour !== null && tourAt < INTRO_SLIDES.length;
  const tourStop = tour && !inIntro ? tourStops[tourAt - INTRO_SLIDES.length] : undefined;
  const mapView = makeView(viewport.width, viewport.height, step.scene.camera, layout.insets);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-bg font-sans text-fg">
      <h1 className="sr-only">Inside the Pfadfinder</h1>

      <GuideCanvas
        player={player}
        timeline={timeline}
        tool={tool}
        tools={tools}
        interactive={interaction !== null}
        insets={inIntro ? introInsets(viewport.width, viewport.height) : layout.insets}
        onEdit={handleEdit}
        onHover={setHover}
      />

      {tourStop && (
        <div
          data-tour="map"
          className="pointer-events-none absolute"
          style={{ left: mapView.ox, top: mapView.oy, width: COLS * mapView.s, height: ROWS * mapView.s }}
        />
      )}

      {/* The intro shows nothing but the map; the interface fades in when the tour explains it. */}
      <div
        data-guide-interface
        className={`transition-opacity duration-500 motion-reduce:transition-none ${
          inIntro ? 'invisible opacity-0' : 'opacity-100'
        }`}
      >
        <a
          href={import.meta.env.BASE_URL}
          className="absolute top-3 left-3 z-20 flex h-9 items-center gap-1.5 rounded-lg border border-border bg-panel/85 px-2.5 font-mono text-[11px] text-muted backdrop-blur-sm transition-colors hover:bg-panel hover:text-fg"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          Demo
        </a>

        <ChapterMenu
          timeline={timeline}
          index={index}
          scenario={tour ? SCENARIOS[0]! : scenario}
          forceOpen={tourStop?.inMenu === true}
          onSelect={seek}
          onScenario={setScenario}
          onTour={startTour}
        />

        <div
          ref={cardRef}
          className={`absolute top-0 left-0 z-10 flex flex-col gap-3 overflow-y-auto rounded-2xl border border-border-strong bg-panel/92 p-4 shadow-[0_14px_40px_rgba(0,0,0,0.5)] backdrop-blur-md ${
            settled ? 'transition-transform duration-500 ease-out motion-reduce:transition-none' : ''
          }`}
          style={{
            width: layout.card.width,
            maxHeight: layout.card.maxHeight,
            transform: `translate(${layout.card.x}px, ${layout.card.y}px)`,
          }}
        >
          <StepStory step={step} />
          <ApiCall step={step} />
          {step.event >= 0 && <OpenSet timeline={timeline} step={step} />}
          <Legend chapter={step.chapter} />
          {interaction && <TryIt interaction={interaction} tool={tool} onTool={chooseTool} />}
        </div>

        <StepDock
          timeline={timeline}
          index={index}
          onBack={() => player.stepBack()}
          onNext={() => player.stepForward()}
          onChapter={seekChapter}
          onSeek={seek}
        />
      </div>

      {info && inspected && (
        <div
          className="pointer-events-none absolute z-40"
          style={{
            left: inspected.x + (tooltipLeft ? -16 : 16),
            top: inspected.y + (tooltipUp ? -16 : 16),
            transform: `translate(${tooltipLeft ? '-100%' : '0'}, ${tooltipUp ? '-100%' : '0'})`,
          }}
        >
          <Inspector info={info} />
        </div>
      )}

      {tour && <GuideTour timeline={timeline} stops={tourStops} at={tourAt} onMove={moveTour} onDone={endTour} />}
    </div>
  );
}
