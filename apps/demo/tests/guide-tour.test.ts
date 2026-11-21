import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../src/guide/scenarios.js';
import { buildTimeline, CHAPTERS } from '../src/guide/timeline.js';
import {
  holesPath,
  INTRO_SLIDES,
  placeTip,
  type Rect,
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

  it('states the real numbers of the map', () => {
    expect(INTRO_SLIDES[0]!.headline(facts)).toContain(String(timeline.model.units.length));
    expect(INTRO_SLIDES[2]!.text(facts)).toContain(`${timeline.model.portals.size} gates`);
    expect(INTRO_SLIDES[3]!.text(facts)).toContain(`${timeline.model.routeSectors.length} sectors`);
    expect(INTRO_SLIDES.at(-1)!.headline(facts)).toContain(String(timeline.steps.length));
  });

  it('keeps each slide to one short thought', () => {
    for (const slide of INTRO_SLIDES) {
      expect(slide.headline(facts).length).toBeLessThanOrEqual(32);
      expect(slide.text(facts).length).toBeLessThanOrEqual(120);
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
