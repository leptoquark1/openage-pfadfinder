import { COST_MUD } from './scenarios.js';
import type { ChapterId, Timeline } from './timeline.js';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Numbers of the tour's map, so the intro never claims anything the library did not do. */
export interface TourFacts {
  readonly units: number;
  readonly cells: number;
  readonly portals: number;
  readonly routeSectors: number;
  readonly steps: number;
  readonly chapters: number;
}

export function tourFacts({ model, steps, chapters }: Timeline): TourFacts {
  return {
    units: model.units.length,
    cells: model.scenario.costs.length,
    portals: model.portals.size,
    routeSectors: model.routeSectors.length,
    steps: steps.length,
    chapters: chapters.length,
  };
}

export type MapReveal = 'problem' | 'grid' | 'map' | 'gates' | 'search' | 'flow' | 'crowd';

/** One thought of the intro, told next to the matching scene on the real map. */
export interface IntroSlide {
  readonly kicker: string;
  readonly headline: (facts: TourFacts) => string;
  readonly text: (facts: TourFacts) => string;
  /** The chapters this slide leads into. */
  readonly chapters: readonly ChapterId[];
  /** Lights up the whole journey instead of single chapters. */
  readonly allChapters?: boolean;
  /** The chapter whose scene the map shows, by default its last step. */
  readonly scene: ChapterId;
  readonly sceneAtStart?: boolean;
  /**
   * Replaces the scene with a drawing on the terrain and both pins. `problem` only asks how to get from
   * start to target; `grid` draws the outline, the grid and the sector borders; `map` shows that grid finished, with the path and the units streaming along it;
   * `gates` starts from that grid and draws the gates and the links between them;
   * `search` replays the recorded A* search over the gates and ends on the route it found;
   * `flow` lets a soft cost wave run from the target back to the start, then the arrows appear;
   * `crowd` keeps the finished arrows in the background while the units stream over them.
   */
  readonly reveal?: MapReveal;
  /** Shows only the terrain, the path, its two ends and the units. */
  readonly plainMap?: boolean;
}

export const INTRO_SLIDES: readonly IntroSlide[] = [
  {
    kicker: 'Inside **Pfadfinder**',
    headline: f => `${f.units} units.\nOne search.`,
    text: () => 'Every unit on this map reaches the target, yet the route was searched for only once.',
    chapters: [],
    scene: 'crowd',
    plainMap: true,
  },
  {
    kicker: 'Identify the **problem**',
    headline: () => 'Cheaper is better.',
    text: () =>
      'A map full of obstacles and different terrain. What is the cheapest path from the start to the target?',
    chapters: [],
    scene: 'crowd',
    reveal: 'problem',
  },
  {
    kicker: 'Build the **grid**',
    headline: () => 'Every map becomes a grid.',
    text: f => `${f.cells} cells, cut into sectors, so no search has to visit them all.`,
    chapters: ['memory', 'sectors'],
    scene: 'sectors',
    reveal: 'grid',
  },
  {
    kicker: 'Find **gates**',
    headline: () => 'Every opening becomes a gate.',
    text: f => `Each dot is one of ${f.portals} gates between sectors. Lines join the gates a unit can walk between.`,
    chapters: ['portals', 'areas', 'graph'],
    scene: 'graph',
    reveal: 'gates',
  },
  {
    kicker: 'Find the **path**',
    headline: () => 'One search crosses the map.',
    text: f =>
      `A* (“A star”) always tries the gate with the shortest estimated total route. Here, that leads across ${f.routeSectors} sectors.`,
    chapters: ['request', 'search'],
    scene: 'search',
    reveal: 'search',
  },
  {
    kicker: 'Weigh the **terrain**',
    headline: () => 'Every step has a price.',
    text: () =>
      `Waves add up the terrain: ground costs 1, mud ${COST_MUD}, walls block. Arrows then follow the cheapest way.`,
    chapters: ['target', 'transit'],
    scene: 'route',
    sceneAtStart: true,
    reveal: 'flow',
  },
  {
    kicker: 'Follow the **flow**',
    headline: () => 'And the crowd just follows.',
    text: () => 'Each unit only asks its cell for the next move. That simple lookup is why one search is enough.',
    chapters: ['route', 'crowd'],
    scene: 'crowd',
    reveal: 'crowd',
  },
  {
    kicker: '**Deep** dive',
    headline: () => 'Piqued your curiosity?',
    text: f =>
      `In the complete guide you can analyse all ${f.steps} steps in detail, at your own pace. Rewind anything, redraw the map and try to break it.`,
    chapters: [],
    allChapters: true,
    scene: 'memory',
    reveal: 'map',
  },
];

/** The button of the last slide, which leads on to the controls. */
const CONTROLS_ACTION = 'Complete Guide';

/** The label of a slide's main button: the kicker of the slide it leads to. */
export function slideAction(at: number): string {
  const next = INTRO_SLIDES[at + 1];
  return next ? next.kicker.replaceAll('**', '') : CONTROLS_ACTION;
}

/** The step the interface tour explains: it shows the map, the card and the tools at once. */
const interfaceStep = ({ steps }: Timeline) =>
  Math.max(
    0,
    steps.findIndex(step => (step.interaction?.tools.length ?? 0) > 0),
  );

/** The step the map shows at a position of the tour. */
export function tourSceneStep(timeline: Timeline, at: number): number {
  const slide = INTRO_SLIDES[at];
  if (!slide) {
    return interfaceStep(timeline);
  }
  const inScene = (step: Timeline['steps'][number]) => step.chapter === slide.scene;
  return slide.sceneAtStart ? timeline.steps.findIndex(inScene) : timeline.steps.findLastIndex(inScene);
}

/** How long the old scene takes to dissolve into the new one. */
export const SCENE_FADE_MS = 500;

/** The opacity of the old scene, lying over the new one, after a slide change. */
export const sceneFade = (elapsed: number, duration = SCENE_FADE_MS): number => 1 - clamp(elapsed / duration, 0, 1);

/** How long the reduced map takes to turn into the full one when the intro hands over to the controls. */
export const SCENE_HANDOVER_MS = 900;

/** How long the map waits at the start of the handover, until the intro text has left its way. */
export const SCENE_HANDOVER_HOLD_MS = 220;

const OUTLINE_SECONDS = 1.1;
const CELLS_START_SECONDS = OUTLINE_SECONDS;
const CELLS_SWEEP_SECONDS = 1.5;
const CELL_SECONDS = 0.35;
const SECTORS_START_SECONDS = CELLS_START_SECONDS + CELLS_SWEEP_SECONDS + CELL_SECONDS;
const SECTORS_SWEEP_SECONDS = 0.6;
const SECTOR_LINE_SECONDS = 0.45;

const GATES_START_SECONDS = 0.35;
const GATES_SWEEP_SECONDS = 1.2;
const GATE_SECONDS = 0.4;
const LINKS_START_SECONDS = GATES_START_SECONDS + GATES_SWEEP_SECONDS + GATE_SECONDS;
const LINKS_SWEEP_SECONDS = 1.4;
const LINK_SECONDS = 0.45;

/** How far one gate has opened; `along` is its place in the order, from 0 to 1. */
export const gateProgress = (seconds: number, along: number): number =>
  clamp((seconds - GATES_START_SECONDS - along * GATES_SWEEP_SECONDS) / GATE_SECONDS, 0, 1);

/** How far one link between two gates is drawn, once all gates are open. */
export const gateLinkProgress = (seconds: number, along: number): number =>
  clamp((seconds - LINKS_START_SECONDS - along * LINKS_SWEEP_SECONDS) / LINK_SECONDS, 0, 1);

const SEARCH_START_SECONDS = 0.35;
const SEARCH_SECONDS = 5;
const CHAIN_PAUSE_SECONDS = 0.15;
const CHAIN_SECONDS = 1.4;

/** How much of the recorded search has played after `seconds`, from 0 to 1. */
export const searchProgress = (seconds: number): number =>
  clamp((seconds - SEARCH_START_SECONDS) / SEARCH_SECONDS, 0, 1);

/** How far the found route is drawn, once the search has finished. */
export const searchChainProgress = (seconds: number): number =>
  clamp((seconds - SEARCH_START_SECONDS - SEARCH_SECONDS - CHAIN_PAUSE_SECONDS) / CHAIN_SECONDS, 0, 1);

const PROBLEM_START_SECONDS = 0.5;
const PROBLEM_SECONDS = 1.2;

/** How far the open question between start and target is drawn. */
export const problemProgress = (seconds: number): number =>
  clamp((seconds - PROBLEM_START_SECONDS) / PROBLEM_SECONDS, 0, 1);

const FLOW_START_SECONDS = 0.35;
const FLOW_WAVES_SECONDS = 3.6;
const FLOW_ARROWS_PAUSE_SECONDS = 0.2;
const FLOW_ARROWS_SECONDS = 2.2;
/** How many fields' time one field takes, so neighbouring fields overlap into one movement. */
const FLOW_FIELD_OVERLAP = 1.8;

/** One field's share of a pass over all fields, where `pass` runs from 0 to 1. */
const fieldShare = (pass: number, index: number, count: number) =>
  clamp((pass * (count - 1 + FLOW_FIELD_OVERLAP) - index) / FLOW_FIELD_OVERLAP, 0, 1);

/** How far the cost wave of one of `count` fields has spread. */
export const fieldWaveProgress = (seconds: number, index: number, count: number): number =>
  fieldShare((seconds - FLOW_START_SECONDS) / FLOW_WAVES_SECONDS, index, count);

/** How far a field's arrows have appeared, once the waves of all fields are through. */
export const fieldArrowProgress = (seconds: number, index: number, count: number): number =>
  fieldShare(
    (seconds - FLOW_START_SECONDS - FLOW_WAVES_SECONDS - FLOW_ARROWS_PAUSE_SECONDS) / FLOW_ARROWS_SECONDS,
    index,
    count,
  );

/** How much of the map's outline is drawn after `seconds`, from 0 to 1. */
export const mapOutlineProgress = (seconds: number): number => clamp(seconds / OUTLINE_SECONDS, 0, 1);

/** How far one cell has appeared; `along` is its place in the sweep across the map, from 0 to 1. */
export const mapCellProgress = (seconds: number, along: number): number =>
  clamp((seconds - CELLS_START_SECONDS - along * CELLS_SWEEP_SECONDS) / CELL_SECONDS, 0, 1);

/** How far one sector border is drawn, once all cells are there; `along` is its place in the order, from 0 to 1. */
export const mapSectorProgress = (seconds: number, along: number): number =>
  clamp((seconds - SECTORS_START_SECONDS - along * SECTORS_SWEEP_SECONDS) / SECTOR_LINE_SECONDS, 0, 1);

export type TourSide = 'top' | 'right' | 'bottom' | 'left';

/** One stop of the interface tour, attached to the elements marked `data-tour="<target>"`. */
export interface TourStop {
  readonly target: string;
  readonly title: string;
  /** Text in backticks renders as code, `**text**` as bold. */
  readonly body: string;
  readonly side: TourSide;
  /** The element lives in the chapter menu, which the tour opens for it. */
  readonly inMenu?: boolean;
  /** The element is hidden on phones. */
  readonly wideOnly?: boolean;
}

export const TOUR_STOPS: readonly TourStop[] = [
  {
    target: 'map',
    title: 'This is the map',
    body: 'Every square is a **cell** with one byte of movement cost: `1` is free ground, `6` is slow mud and `255` is a wall. Everything that moves here is recorded from the real library.',
    side: 'right',
  },
  {
    target: 'story',
    title: 'What is happening',
    body: 'This card explains the current step. It floats next to the part of the map it talks about.',
    side: 'left',
  },
  {
    target: 'api',
    title: 'The real API call',
    body: 'The call behind this step, the functions it runs through, and what it returns.',
    side: 'left',
  },
  {
    target: 'legend',
    title: 'What the colors mean',
    body: 'The legend follows the story, so it only lists the colors of the current chapter.',
    side: 'left',
  },
  {
    target: 'try',
    title: 'Try it yourself',
    body: 'When a step lets you change something, it shows up here. Paint walls or mud, move start and target, or hover a cell to read its bytes. The whole story recalculates instantly.',
    side: 'left',
  },
  {
    target: 'step',
    title: 'Move at your own pace',
    body: '**Next step** moves forward, also with `→` or `Space`. The arrow on the left undoes a step, also with `←`. Nothing advances until you do.',
    side: 'top',
  },
  {
    target: 'ticks',
    title: 'Steps of this chapter',
    body: 'Each bar is one step of the current chapter. Click a bar to jump straight to it.',
    side: 'top',
    wideOnly: true,
  },
  {
    target: 'sections',
    title: 'Jump between chapters',
    body: 'The double arrows skip to the previous or next chapter, also with `Shift` + `←` or `→`.',
    side: 'top',
  },
  {
    target: 'chapters',
    title: 'All chapters',
    body: 'Your current chapter stays in the top right corner. Its arrow unfolds this list, so you can jump anywhere.',
    side: 'left',
    inMenu: true,
  },
  {
    target: 'maps',
    title: 'Try other maps',
    body: 'Each map puts Pfadfinder in a different situation. Open this to compare them and see what to watch for.',
    side: 'left',
    inMenu: true,
  },
];

export const tourStopsFor = (width: number): readonly TourStop[] =>
  TOUR_STOPS.filter(stop => !stop.wideOnly || width >= 640);

export function unionRect(rects: readonly Rect[]): Rect {
  const x = Math.min(...rects.map(r => r.x));
  const y = Math.min(...rects.map(r => r.y));
  const right = Math.max(...rects.map(r => r.x + r.w));
  const bottom = Math.max(...rects.map(r => r.y + r.h));
  return { x, y, w: right - x, h: bottom - y };
}

const GAP = 14;
const EDGE = 10;
const ARROW_INSET = 18;

const FALLBACKS: Record<TourSide, readonly TourSide[]> = {
  top: ['top', 'bottom', 'left', 'right'],
  bottom: ['bottom', 'top', 'left', 'right'],
  left: ['left', 'right', 'bottom', 'top'],
  right: ['right', 'left', 'bottom', 'top'],
};

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(Math.max(low, high), value));

export interface TipPlacement {
  readonly x: number;
  readonly y: number;
  /** The side of the target the tooltip sits on; null when it fits on none. */
  readonly side: TourSide | null;
  /** Where the arrow meets the tooltip's edge, measured along that edge. */
  readonly arrow: number;
}

/** Puts the tooltip beside the target on the first side where it fits on screen. */
export function placeTip(
  target: Rect,
  tip: { readonly w: number; readonly h: number },
  view: { readonly w: number; readonly h: number },
  preferred: TourSide,
): TipPlacement {
  const centerX = target.x + target.w / 2;
  const centerY = target.y + target.h / 2;

  for (const side of FALLBACKS[preferred]) {
    if (side === 'top' || side === 'bottom') {
      const y = side === 'top' ? target.y - tip.h - GAP : target.y + target.h + GAP;
      if (y >= EDGE && y + tip.h <= view.h - EDGE) {
        const x = clamp(centerX - tip.w / 2, EDGE, view.w - tip.w - EDGE);
        return { x, y, side, arrow: clamp(centerX - x, ARROW_INSET, tip.w - ARROW_INSET) };
      }
    } else {
      const x = side === 'left' ? target.x - tip.w - GAP : target.x + target.w + GAP;
      if (x >= EDGE && x + tip.w <= view.w - EDGE) {
        const y = clamp(centerY - tip.h / 2, EDGE, view.h - tip.h - EDGE);
        return { x, y, side, arrow: clamp(centerY - y, ARROW_INSET, tip.h - ARROW_INSET) };
      }
    }
  }
  return {
    x: clamp((view.w - tip.w) / 2, EDGE, view.w),
    y: clamp(view.h - tip.h - EDGE, EDGE, view.h),
    side: null,
    arrow: 0,
  };
}

/** SVG path of rounded rectangles, used to cut the highlighted elements out of the shade. */
export function holesPath(rects: readonly Rect[], radius = 10): string {
  return rects
    .map(({ x, y, w, h }) => {
      const r = Math.min(radius, w / 2, h / 2);
      return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
    })
    .join('');
}
