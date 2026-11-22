import { ArrowLeft } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { GUIDE_TOUR_KEY, isUnseen, markSeen, WELCOME_KEY } from '../seen.js';
import { GuideCanvas, type HoverPoint } from './GuideCanvas.js';
import { GuideTour } from './GuideTour.js';
import { introInsets, layoutGuide, makeView } from './layout.js';
import { ChapterMenu, StepDock } from './navigation.js';
import { ApiCall, InspectorTip, Legend, OpenSet, StepStory, TryIt } from './panels.js';
import { Player } from './player.js';
import { COLS, ROWS, SCENARIOS, type Scenario } from './scenarios.js';
import { buildTimeline } from './story/timeline.js';
import type { ChapterId } from './story/chapters.js';
import { inspectCell } from './story/inspect.js';
import { type ReaderPlace, readerPlace, stepForPlace } from './story/place.js';
import type { Timeline, Tool } from './story/types.js';
import { INTRO_SLIDES, tourSceneStep, tourStopsFor } from './tour.js';

const NO_TOOLS: readonly Tool[] = [];

const durationsOf = (timeline: Timeline) => timeline.steps.map(step => step.duration);

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

  // Fast Refresh recreates the player but keeps refs, so remember which player was loaded.
  const loaded = useRef<{ player: Player; timeline: Timeline } | null>(null);
  // Where an edit pushed the reader out of their chapter; they return once it exists again.
  const displaced = useRef<{ place: ReaderPlace; landed: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const tourRef = useRef(tour);
  tourRef.current = tour;
  const userTimelineRef = useRef(userTimeline);
  userTimelineRef.current = userTimeline;

  useLayoutEffect(() => {
    const previous = loaded.current;
    if (previous?.player === player && previous.timeline === userTimeline) {
      return;
    }
    if (tourRef.current) {
      player.load(durationsOf(tourTimeline), tourSceneStep(tourTimeline, tourRef.current.at));
    } else if (previous) {
      const from = previous.player.index;
      const place = displaced.current?.landed === from ? displaced.current.place : readerPlace(previous.timeline, from);
      const landed = stepForPlace(userTimeline, place);
      displaced.current = userTimeline.steps[landed]!.chapter === place.chapter ? null : { place, landed };
      player.load(durationsOf(userTimeline), landed);
    } else {
      player.load(durationsOf(userTimeline), 0);
    }
    loaded.current = { player, timeline: userTimeline };
  }, [player, userTimeline, tourTimeline]);

  useLayoutEffect(() => {
    const card = cardRef.current!;
    const measure = () => setCardHeight(card.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  // Measured, not read from the window: mobile toolbars make the two heights differ.
  useLayoutEffect(() => {
    const root = rootRef.current!;
    const measure = () => setViewport({ width: root.clientWidth, height: root.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    // The card only glides between steps, not into its first position.
    const frame = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(frame);
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

  const tourStops = tourStopsFor(viewport.width);
  const tourAt = tour ? Math.min(tour.at, INTRO_SLIDES.length + tourStops.length - 1) : 0;
  const inIntro = tour !== null && tourAt < INTRO_SLIDES.length;
  const tourStop = tour && !inIntro ? tourStops[tourAt - INTRO_SLIDES.length] : undefined;
  const mapView = makeView(viewport.width, viewport.height, step.scene.camera, layout.insets);

  return (
    <div ref={rootRef} className="relative h-dvh w-screen overflow-hidden bg-bg font-sans text-fg">
      <h1 className="sr-only">
        Inside <span className="text-secondary">Pfadfinder</span>
      </h1>

      <GuideCanvas
        player={player}
        timeline={timeline}
        tool={tool}
        tools={tools}
        interactive={interaction !== null && !tour}
        insets={inIntro ? introInsets(viewport.width, viewport.height) : layout.insets}
        reveal={inIntro ? (INTRO_SLIDES[tourAt]!.reveal ?? null) : null}
        plainMap={inIntro && INTRO_SLIDES[tourAt]!.plainMap === true}
        slide={inIntro ? tourAt : null}
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
          inIntro ? 'invisible opacity-0' : 'opacity-100 delay-200'
        }`}
      >
        <a
          href={import.meta.env.BASE_URL}
          onClick={() => markSeen(WELCOME_KEY)}
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

      {info && inspected && <InspectorTip info={info} x={inspected.x} y={inspected.y} view={viewport} />}

      {tour && <GuideTour timeline={timeline} stops={tourStops} at={tourAt} onMove={moveTour} onDone={endTour} />}
    </div>
  );
}
