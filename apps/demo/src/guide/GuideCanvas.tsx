import { COST_IMPASSABLE, COST_MIN } from '@leptoquark1/openage-pfadfinder/shared';
import { useEffect, useRef } from 'react';
import type { Insets } from './layout.js';
import type { GuideModel } from './model/types.js';
import type { Player } from './player.js';
import { smooth } from './canvas/primitives.js';
import { drawGuide } from './canvas/render.js';
import { screenToCell } from './layout.js';
import { type Cell, COST_MUD, type Scenario, withCost, withPin } from './scenarios.js';
import { type Box, mixScene } from './story/scene.js';
import type { Timeline, Tool } from './story/types.js';
import { type MapReveal, SCENE_FADE_MS, SCENE_HANDOVER_HOLD_MS, SCENE_HANDOVER_MS, sceneFade } from './tour.js';

const TOOL_COST: Partial<Record<Tool, number>> = {
  wall: COST_IMPASSABLE,
  mud: COST_MUD,
  erase: COST_MIN,
};

/** The hovered cell and the pointer position on the canvas. */
export interface HoverPoint {
  readonly cell: Cell;
  readonly x: number;
  readonly y: number;
}

interface GuideCanvasProps {
  player: Player;
  timeline: Timeline;
  tool: Tool;
  /** Tools the current step offers; pins can only be dragged when theirs is included. */
  tools: readonly Tool[];
  /** Whether the current step reacts to the pointer at all. */
  interactive: boolean;
  insets: Insets;
  /** The drawing shown instead of the current scene. */
  reveal: MapReveal | null;
  /** Shows only the terrain, the path, its two ends and the units. */
  plainMap: boolean;
  /** The intro slide on show; moving to another slide or out of the intro dissolves the scene. */
  slide: number | null;
  onEdit: (edit: (scenario: Scenario) => Scenario) => void;
  onHover: (hover: HoverPoint | null) => void;
}

const sameCell = (a: Cell | null, b: Cell | null) => a?.ne === b?.ne && a?.se === b?.se;

export function GuideCanvas({
  player,
  timeline,
  tool,
  tools,
  interactive,
  insets,
  reveal,
  plainMap,
  slide,
  onEdit,
  onHover,
}: GuideCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // The render loop is started once; live props reach it through refs.
  const live = useRef({ timeline, tool, tools, interactive, insets, reveal, plainMap, slide, onEdit, onHover });
  live.current = { timeline, tool, tools, interactive, insets, reveal, plainMap, slide, onEdit, onHover };

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) {
      return;
    }
    const ctx = canvas.getContext('2d')!;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = 0;
    let height = 0;
    let ratio = 1;
    const resize = () => {
      const rect = container.getBoundingClientRect();
      ratio = devicePixelRatio;
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    let camera: Box | null = null;
    let margins: Insets | null = null;
    let hover: Cell | null = null;
    let drag: 'start' | 'target' | 'paint' | null = null;
    let lastPaint: Cell | null = null;
    let pointer: { x: number; y: number } | null = null;

    const cellUnderPointer = (): Cell | null => {
      if (!pointer || !camera || !margins || !live.current.interactive) {
        return null;
      }
      return screenToCell(width, height, camera, margins, pointer.x, pointer.y);
    };

    const trackPointer = (e: PointerEvent): Cell | null => {
      const rect = canvas.getBoundingClientRect();
      pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      return cellUnderPointer();
    };

    const reportHover = () => live.current.onHover(hover && pointer && { cell: hover, ...pointer });

    const pinAt = (cell: Cell): 'start' | 'target' | null => {
      const { timeline: current, tools: offered } = live.current;
      const { start, target } = current.model.scenario;
      if (offered.includes('start') && sameCell(cell, start)) {
        return 'start';
      }
      return offered.includes('target') && sameCell(cell, target) ? 'target' : null;
    };

    const paintTo = (cell: Cell) => {
      const cost = TOOL_COST[live.current.tool];
      if (cost === undefined) {
        return;
      }
      // A fast stroke skips cells between two events; fill them in.
      const from = lastPaint ?? cell;
      const steps = Math.max(Math.abs(cell.ne - from.ne), Math.abs(cell.se - from.se), 1);
      const cells = Array.from({ length: steps + 1 }, (_, i) => ({
        ne: Math.round(from.ne + ((cell.ne - from.ne) * i) / steps),
        se: Math.round(from.se + ((cell.se - from.se) * i) / steps),
      }));
      live.current.onEdit(scenario => cells.reduce((next, c) => withCost(next, c, cost), scenario));
      lastPaint = cell;
    };

    const onDown = (e: PointerEvent) => {
      const cell = trackPointer(e);
      if (!cell || e.button !== 0) {
        return;
      }
      const active = live.current.tool;
      if (active === 'start' || active === 'target') {
        drag = active;
        live.current.onEdit(scenario => withPin(scenario, active, cell));
      } else if (active === 'inspect') {
        drag = pinAt(cell);
      } else {
        drag = 'paint';
        lastPaint = null;
        paintTo(cell);
      }
      if (drag) {
        live.current.onHover(null);
        canvas.setPointerCapture(e.pointerId);
      }
    };

    const onMove = (e: PointerEvent) => {
      const cell = trackPointer(e);
      // A stroke that leaves the map starts afresh where it comes back.
      if (!cell) {
        lastPaint = null;
      }
      if (sameCell(cell, hover)) {
        return;
      }
      hover = cell;
      if (cell && (drag === 'start' || drag === 'target')) {
        const pin = drag;
        live.current.onEdit(scenario => withPin(scenario, pin, cell));
      } else if (cell && drag === 'paint') {
        paintTo(cell);
      } else if (!drag) {
        reportHover();
      }
    };

    const onUp = () => {
      drag = null;
      lastPaint = null;
    };

    const onLeave = () => {
      if (!drag) {
        pointer = null;
        hover = null;
        live.current.onHover(null);
      }
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onLeave);

    let raf = 0;
    let last = performance.now();
    let finaleStart: number | null = null;
    let shownReveal: MapReveal | null = null;
    let revealStart = 0;
    let shownSlide = live.current.slide;
    let fadeStart: number | null = null;
    // Leaving the last slide, its map keeps being drawn so it glides along with the full map below it.
    let handover: { readonly model: GuideModel; readonly start: number } | null = null;
    let shownModel: GuideModel | null = null;
    const outgoing = document.createElement('canvas');
    const frame = (now: number) => {
      // Moving to a display with another scale keeps the CSS size, so ResizeObserver stays silent.
      if (devicePixelRatio !== ratio) {
        resize();
      }
      const dt = Math.min(now - last, 100);
      last = now;
      player.tick(reducedMotion ? Number.POSITIVE_INFINITY : dt);

      // The canvas still holds the last frame of the old slide: keep it to dissolve it.
      const { slide: nextSlide } = live.current;
      if (nextSlide !== shownSlide) {
        if (shownSlide !== null && !reducedMotion && canvas.width > 0 && canvas.height > 0) {
          handover =
            nextSlide === null && shownReveal === 'map' && shownModel
              ? { model: shownModel, start: revealStart }
              : null;
          if (!handover) {
            outgoing.width = canvas.width;
            outgoing.height = canvas.height;
            outgoing.getContext('2d')!.drawImage(canvas, 0, 0);
          }
          fadeStart = now;
        }
        shownSlide = nextSlide;
        // Slides can share a step, so the crowd starts over on each of them.
        finaleStart = null;
      }
      const fadeMs = handover ? SCENE_HANDOVER_MS : SCENE_FADE_MS;
      if (fadeStart !== null && now - fadeStart >= fadeMs) {
        fadeStart = null;
        handover = null;
      }

      const { timeline: current, tool: activeTool, interactive: reacts, insets: goalInsets } = live.current;
      const index = Math.min(player.index, current.steps.length - 1);
      const step = current.steps[index]!;
      const previous = current.steps[index - 1]?.scene ?? step.scene;
      const scene = mixScene(previous, step.scene, smooth(player.t));

      const goal = scene.camera;
      if (!camera || !margins || reducedMotion) {
        camera = goal;
        margins = goalInsets;
      } else {
        const k = 1 - Math.exp(-dt / 170);
        const towards = (from: number, to: number) => from + (to - from) * k;
        camera = {
          x: towards(camera.x, goal.x),
          y: towards(camera.y, goal.y),
          w: towards(camera.w, goal.w),
          h: towards(camera.h, goal.h),
        };
        const holding = handover !== null && fadeStart !== null && now - fadeStart < SCENE_HANDOVER_HOLD_MS;
        if (!holding) {
          margins = {
            top: towards(margins.top, goalInsets.top),
            right: towards(margins.right, goalInsets.right),
            bottom: towards(margins.bottom, goalInsets.bottom),
            left: towards(margins.left, goalInsets.left),
          };
        }
      }

      // The camera moves under a resting pointer, so the hovered cell can change without a pointer event.
      if (pointer && !drag) {
        const under = cellUnderPointer();
        if (!sameCell(under, hover)) {
          hover = under;
          reportHover();
        }
      }

      // Once the story is over, the crowd keeps streaming to the target.
      const finale = !reducedMotion && index === current.steps.length - 1 && player.t >= 1 && step.chapter === 'crowd';
      finaleStart = finale ? (finaleStart ?? now) : null;
      // Each drawing restarts whenever the reader comes back to it.
      if (live.current.reveal !== shownReveal) {
        shownReveal = live.current.reveal;
        revealStart = now;
      }
      const seconds = reducedMotion ? Number.POSITIVE_INFINITY : (now - revealStart) / 1000;

      const shownHover = reacts ? hover : null;
      if (width > 0 && height > 0) {
        const input = {
          width,
          height,
          camera,
          insets: margins,
          scene,
          now,
          hover: shownHover,
          ghostPins: activeTool !== 'inspect',
          crowdClock: finaleStart === null ? null : (now - finaleStart) / 1000,
          reveal: shownReveal && { kind: shownReveal, seconds },
          plainMap: live.current.plainMap,
          costLabels: nextSlide === null,
        };
        drawGuide(ctx, current.model, input);
        shownModel = current.model;
        if (fadeStart !== null) {
          if (handover) {
            if (outgoing.width !== canvas.width || outgoing.height !== canvas.height) {
              outgoing.width = canvas.width;
              outgoing.height = canvas.height;
            }
            const layer = outgoing.getContext('2d')!;
            layer.setTransform(ratio, 0, 0, ratio, 0, 0);
            drawGuide(layer, handover.model, {
              ...input,
              hover: null,
              ghostPins: false,
              crowdClock: null,
              reveal: { kind: 'map', seconds: (now - handover.start) / 1000 },
              plainMap: false,
              costLabels: false,
            });
          }
          ctx.save();
          ctx.globalAlpha = smooth(sceneFade(now - fadeStart, fadeMs));
          ctx.drawImage(outgoing, 0, 0, width, height);
          ctx.restore();
        }
      }

      const onPin = shownHover !== null && pinAt(shownHover) !== null;
      canvas.style.cursor = drag
        ? 'grabbing'
        : reacts && activeTool !== 'inspect'
          ? 'crosshair'
          : onPin
            ? 'grab'
            : 'default';

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
    };
  }, [player]);

  return (
    <div ref={containerRef} className="absolute inset-0">
      <canvas
        ref={canvasRef}
        className="block touch-none"
        role="img"
        aria-label="Animated view of the grid and the current pathfinding step"
      />
    </div>
  );
}
