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
  readonly action: string;
}

export const INTRO_SLIDES: readonly IntroSlide[] = [
  {
    kicker: 'Inside the Pfadfinder',
    headline: f => `${f.units} units.\nOne search.`,
    text: () =>
      'Every unit on this map reaches the target, yet the route was searched for only once. Let’s find out how.',
    chapters: [],
    scene: 'crowd',
    action: 'Show me how',
  },
  {
    kicker: 'Build the grid',
    headline: () => 'It starts with plain bytes.',
    text: f => `A map is just ${f.cells} numbers. First, we give them shape and cut them into sectors.`,
    chapters: ['memory', 'sectors'],
    scene: 'sectors',
    action: 'Next',
  },
  {
    kicker: 'Build the grid',
    headline: () => 'Then the map finds its gates.',
    text: f =>
      `Every way from sector to sector is mapped once. ${f.cells} cells shrink to a graph of ${f.portals} gates.`,
    chapters: ['portals', 'areas', 'graph'],
    scene: 'graph',
    action: 'Next',
  },
  {
    kicker: 'Find the path',
    headline: () => 'One search crosses the map.',
    text: f => `A* hops from gate to gate and settles on the ${f.routeSectors} sectors the route will cross.`,
    chapters: ['request', 'search'],
    scene: 'search',
    action: 'Next',
  },
  {
    kicker: 'Find the path',
    headline: () => 'Waves turn into arrows.',
    text: () => 'Cost waves wash through those sectors until every cell on the way knows where to go.',
    chapters: ['target', 'transit'],
    scene: 'route',
    sceneAtStart: true,
    action: 'Next',
  },
  {
    kicker: 'Find the path',
    headline: () => 'And the crowd just follows.',
    text: () => 'Each unit only asks its cell for the next move. That simple lookup is why one search is enough.',
    chapters: ['route', 'crowd'],
    scene: 'crowd',
    action: 'Next',
  },
  {
    kicker: 'Your turn',
    headline: f => `${f.steps} small steps.\nYour pace.`,
    text: () => 'Nothing moves until you say so. Rewind anything, redraw the map and try to break it.',
    chapters: [],
    allChapters: true,
    scene: 'memory',
    action: 'Show the controls',
  },
];

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
    body: 'Each map puts the Pfadfinder in a different situation. Open this to compare them and see what to watch for.',
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
