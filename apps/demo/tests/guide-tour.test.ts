import { describe, expect, it } from 'vitest';
import { COST_MUD, SCENARIOS } from '../src/guide/scenarios.js';
import { buildTimeline } from '../src/guide/story/timeline.js';
import { CHAPTERS } from '../src/guide/story/chapters.js';
import {
  fieldArrowProgress,
  fieldWaveProgress,
  gateLinkProgress,
  gateProgress,
  holesPath,
  INTRO_SLIDES,
  mapCellProgress,
  mapOutlineProgress,
  mapSectorProgress,
  placeTip,
  problemProgress,
  type Rect,
  SCENE_FADE_MS,
  SCENE_HANDOVER_MS,
  sceneFade,
  slideAction,
  searchChainProgress,
  searchProgress,
  TOUR_STOPS,
  tourFacts,
  tourSceneStep,
  tourStopsFor,
  unionRect,
} from '../src/guide/tour.js';

const tip = { w: 320, h: 200 };
const view = { w: 1280, h: 720 };
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

describe('guide tour: tooltip placement', () => {
  it('uses the preferred side when it fits', () => {
    const target = { x: 600, y: 300, w: 100, h: 40 };
    expect(placeTip(target, tip, view, 'left').side).toBe('left');
    expect(placeTip(target, tip, view, 'top').side).toBe('top');
  });

  it('falls back to another side at the screen edge', () => {
    expect(placeTip({ x: 20, y: 300, w: 100, h: 40 }, tip, view, 'left').side).toBe('right');
    expect(placeTip({ x: 600, y: 660, w: 100, h: 40 }, tip, view, 'bottom').side).toBe('top');
  });

  it('stays on screen and off the target wherever the target is', () => {
    for (let x = 0; x < view.w; x += 90) {
      for (let y = 0; y < view.h; y += 70) {
        const target = { x, y, w: 120, h: 50 };
        const placed = placeTip(target, tip, view, 'left');
        expect(placed.x).toBeGreaterThanOrEqual(0);
        expect(placed.y).toBeGreaterThanOrEqual(0);
        expect(placed.x + tip.w).toBeLessThanOrEqual(view.w);
        expect(placed.y + tip.h).toBeLessThanOrEqual(view.h);
        expect(overlaps({ x: placed.x, y: placed.y, ...tip }, target)).toBe(false);
      }
    }
  });

  it('keeps the arrow on the tooltip, pointing at the target', () => {
    const target = { x: 1200, y: 640, w: 60, h: 40 };
    const placed = placeTip(target, tip, view, 'top');
    expect(placed.arrow).toBeGreaterThan(0);
    expect(placed.arrow).toBeLessThan(tip.w);
  });

  it('has no side to point from when a target fills the screen', () => {
    const placed = placeTip({ x: 0, y: 0, w: view.w, h: view.h }, tip, view, 'right');
    expect(placed.side).toBeNull();
    expect(placed.y + tip.h).toBeLessThanOrEqual(view.h);
  });
});

describe('guide tour: intro', () => {
  const timeline = buildTimeline(SCENARIOS[0]!);
  const facts = tourFacts(timeline);

  it('leads through every chapter once and in order', () => {
    expect(INTRO_SLIDES.flatMap(slide => slide.chapters)).toEqual(CHAPTERS.map(chapter => chapter.id));
  });

  it('opens on the crowd and ends on the step the interface tour explains', () => {
    expect(timeline.steps[tourSceneStep(timeline, 0)]!.chapter).toBe('crowd');
    const last = tourSceneStep(timeline, INTRO_SLIDES.length - 1);
    expect(last).toBe(tourSceneStep(timeline, INTRO_SLIDES.length));
    expect(timeline.steps[last]!.interaction?.tools.length).toBeGreaterThan(0);
  });

  it('shows a scene from the tour map on every slide', () => {
    INTRO_SLIDES.forEach((slide, at) => {
      const step = timeline.steps[tourSceneStep(timeline, at)];
      expect(step?.chapter, slide.kicker).toBe(slide.scene);
    });
  });

  it('labels each button with the kicker of the next slide', () => {
    expect(slideAction(0)).toBe('Identify the problem');
    INTRO_SLIDES.slice(1).forEach((slide, i) => {
      expect(slideAction(i)).toBe(slide.kicker.replaceAll('**', ''));
    });
    expect(slideAction(INTRO_SLIDES.length - 1)).toBe('Complete Guide');
  });

  it('poses the open problem on the bare terrain', () => {
    const slide = INTRO_SLIDES[1]!;
    expect(slide.reveal).toBe('problem');
    expect(slide.text(facts)).toContain('cheapest path');
    expect(problemProgress(0)).toBe(0);
    expect(problemProgress(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it('opens on a plain map whose scene has the path, both ends and the crowd', () => {
    expect(INTRO_SLIDES.filter(slide => slide.plainMap === true)).toEqual([INTRO_SLIDES[0]]);
    const { scene } = timeline.steps[tourSceneStep(timeline, 0)]!;
    expect(scene.walk).toBe(1);
    expect(scene.pins).toBeGreaterThan(0);
    expect(scene.crowd).toBe(1);
  });

  it('keeps the map in place on every slide, so scenes dissolve without a double image', () => {
    const cameras = INTRO_SLIDES.map((_, at) => timeline.steps[tourSceneStep(timeline, at)]!.scene.camera);
    for (const camera of cameras) {
      expect(camera).toEqual(cameras[0]);
    }
  });

  it('opens all gates on the third slide before it links them', () => {
    expect(INTRO_SLIDES[3]!.reveal).toBe('gates');
    for (let seconds = 0; seconds < 6; seconds += 0.01) {
      if (gateLinkProgress(seconds, 0) > 0) {
        expect(gateProgress(seconds, 1)).toBe(1);
      }
    }
    expect(gateProgress(Number.POSITIVE_INFINITY, 1)).toBe(1);
    expect(gateLinkProgress(Number.POSITIVE_INFINITY, 1)).toBe(1);
  });

  it('replays the whole search on the fourth slide before it draws the route', () => {
    expect(INTRO_SLIDES[4]!.reveal).toBe('search');
    expect(timeline.model.search?.events.length).toBeGreaterThan(0);
    expect(timeline.model.search?.chain.length).toBeGreaterThan(0);
    expect(searchProgress(0)).toBe(0);
    for (let seconds = 0; seconds < 9; seconds += 0.01) {
      if (searchChainProgress(seconds) > 0) {
        expect(searchProgress(seconds)).toBe(1);
      }
    }
    expect(searchChainProgress(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it('runs all waves on the fifth slide before any arrow appears', () => {
    expect(INTRO_SLIDES[5]!.reveal).toBe('flow');
    expect(INTRO_SLIDES[5]!.text(facts)).toContain(`mud ${COST_MUD}`);
    const count = timeline.model.fields.length;
    expect(count).toBeGreaterThan(0);
    for (let seconds = 0; seconds < 8; seconds += 0.01) {
      if (fieldArrowProgress(seconds, 0, count) > 0) {
        expect(fieldWaveProgress(seconds, count - 1, count)).toBe(1);
      }
    }
    expect(fieldWaveProgress(Number.POSITIVE_INFINITY, count - 1, count)).toBe(1);
    expect(fieldArrowProgress(Number.POSITIVE_INFINITY, count - 1, count)).toBe(1);
  });

  it('lets the crowd follow the finished arrows on the sixth slide', () => {
    const slide = INTRO_SLIDES[6]!;
    expect(slide.reveal).toBe('crowd');
    expect(slide.kicker).toBe('Follow the **flow**');
    expect(timeline.steps[tourSceneStep(timeline, 6)]!.scene.crowd).toBe(1);
  });

  it('draws every intro slide in the reduced style', () => {
    for (const slide of INTRO_SLIDES) {
      expect(slide.plainMap === true || slide.reveal !== undefined, slide.kicker).toBe(true);
    }
    expect(INTRO_SLIDES.at(-1)!.reveal).toBe('map');
  });

  it('dissolves the old scene into the new one', () => {
    expect(sceneFade(0)).toBe(1);
    expect(sceneFade(SCENE_FADE_MS / 2)).toBe(0.5);
    expect(sceneFade(SCENE_FADE_MS)).toBe(0);
  });

  it('takes longer to hand the last slide over to the controls', () => {
    expect(SCENE_HANDOVER_MS).toBeGreaterThan(SCENE_FADE_MS);
    expect(sceneFade(SCENE_FADE_MS, SCENE_HANDOVER_MS)).toBeGreaterThan(0);
    expect(sceneFade(SCENE_HANDOVER_MS, SCENE_HANDOVER_MS)).toBe(0);
  });

  it('draws the outline on the second slide before the cells', () => {
    expect(INTRO_SLIDES[2]!.reveal).toBe('grid');
    expect(mapOutlineProgress(0)).toBe(0);
    for (let seconds = 0; seconds < 1.1; seconds += 0.05) {
      expect(mapOutlineProgress(seconds)).toBeLessThan(1);
      expect(mapCellProgress(seconds, 0)).toBe(0);
    }
    expect(mapOutlineProgress(1.1)).toBe(1);
    expect(mapCellProgress(1.5, 0)).toBeGreaterThan(mapCellProgress(1.5, 1));
    expect(mapCellProgress(Number.POSITIVE_INFINITY, 1)).toBe(1);
  });

  it('draws the sector borders only once every cell is there', () => {
    for (let seconds = 0; seconds < 5; seconds += 0.01) {
      if (mapSectorProgress(seconds, 0) > 0) {
        expect(mapCellProgress(seconds, 1)).toBe(1);
      }
    }
    expect(mapSectorProgress(5, 0)).toBe(1);
    expect(mapSectorProgress(5, 1)).toBe(1);
    expect(mapSectorProgress(Number.POSITIVE_INFINITY, 1)).toBe(1);
  });

  it('states the real numbers of the map', () => {
    expect(INTRO_SLIDES[0]!.headline(facts)).toContain(String(timeline.model.units.length));
    expect(INTRO_SLIDES[3]!.text(facts)).toContain(`${timeline.model.portals.size} gates`);
    expect(INTRO_SLIDES[4]!.text(facts)).toContain(`${timeline.model.routeSectors.length} sectors`);
    expect(INTRO_SLIDES.at(-1)!.text(facts)).toContain(`${timeline.steps.length} steps`);
  });

  it('keeps each slide to one short thought', () => {
    for (const slide of INTRO_SLIDES) {
      expect(slide.headline(facts).length).toBeLessThanOrEqual(32);
      expect(slide.text(facts).length).toBeLessThanOrEqual(150);
    }
  });
});

describe('guide tour: stops', () => {
  it('explains each element once', () => {
    const targets = TOUR_STOPS.map(stop => stop.target);
    expect(new Set(targets).size).toBe(targets.length);
  });

  it('leaves out elements a phone does not show', () => {
    expect(tourStopsFor(390).map(stop => stop.target)).not.toContain('ticks');
    expect(tourStopsFor(1280)).toHaveLength(TOUR_STOPS.length);
  });

  it('frames several elements and cuts one hole for each', () => {
    const rects = [
      { x: 10, y: 10, w: 20, h: 20 },
      { x: 100, y: 40, w: 30, h: 10 },
    ];
    expect(unionRect(rects)).toEqual({ x: 10, y: 10, w: 120, h: 40 });
    expect(holesPath(rects).match(/Z/g)).toHaveLength(2);
  });
});
