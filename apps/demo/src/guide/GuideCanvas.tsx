import { COST_IMPASSABLE, COST_MIN } from '@leptoquark1/openage-pfadfinder/shared';
import { useEffect, useRef } from 'react';
import type { Insets } from './layout.js';
import type { Player } from './player.js';
import { drawGuide, screenToCell } from './render.js';
import { type Cell, COST_MUD, type Scenario, withCost, withPin } from './scenarios.js';
import { type Box, mixScene, type Timeline, type Tool } from './timeline.js';

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
  onEdit: (edit: (scenario: Scenario) => Scenario) => void;
  onHover: (hover: HoverPoint | null) => void;
}

const ease = (t: number) => t * t * (3 - 2 * t);
const sameCell = (a: Cell, b: Cell) => a.ne === b.ne && a.se === b.se;

export function GuideCanvas({ player, timeline, tool, tools, interactive, insets, onEdit, onHover }: GuideCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // The render loop is started once; live props reach it through refs.
  const live = useRef({ timeline, tool, tools, interactive, insets, onEdit, onHover });
  live.current = { timeline, tool, tools, interactive, insets, onEdit, onHover };

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
    const resize = () => {
      const rect = container.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * devicePixelRatio);
      canvas.height = Math.round(height * devicePixelRatio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    let camera: Box | null = null;
    let margins: Insets | null = null;
    let hover: Cell | null = null;
    let drag: 'start' | 'target' | 'paint' | null = null;
    let lastPaint: Cell | null = null;

    const cellOf = (e: PointerEvent): Cell | null => {
      if (!camera || !margins || !live.current.interactive) {
        return null;
      }
      const rect = canvas.getBoundingClientRect();
      return screenToCell(width, height, camera, margins, e.clientX - rect.left, e.clientY - rect.top);
    };

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
      const cell = cellOf(e);
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
      const cell = cellOf(e);
      if (cell?.ne === hover?.ne && cell?.se === hover?.se) {
        return;
      }
      hover = cell;
      if (cell && (drag === 'start' || drag === 'target')) {
        const pin = drag;
        live.current.onEdit(scenario => withPin(scenario, pin, cell));
      } else if (cell && drag === 'paint') {
        paintTo(cell);
      } else if (!drag) {
        const rect = canvas.getBoundingClientRect();
        live.current.onHover(cell && { cell, x: e.clientX - rect.left, y: e.clientY - rect.top });
      }
    };

    const onUp = () => {
      drag = null;
      lastPaint = null;
    };

    const onLeave = () => {
      if (!drag) {
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
    const frame = (now: number) => {
      const dt = Math.min(now - last, 100);
      last = now;
      player.tick(reducedMotion ? Number.POSITIVE_INFINITY : dt);

      const { timeline: current, tool: activeTool, interactive: reacts, insets: goalInsets } = live.current;
      const index = Math.min(player.index, current.steps.length - 1);
      const step = current.steps[index]!;
      const previous = current.steps[index - 1]?.scene ?? step.scene;
      const scene = mixScene(previous, step.scene, ease(player.t));

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
        margins = {
          top: towards(margins.top, goalInsets.top),
          right: towards(margins.right, goalInsets.right),
          bottom: towards(margins.bottom, goalInsets.bottom),
          left: towards(margins.left, goalInsets.left),
        };
      }

      // Once the story is over, the crowd keeps streaming to the target.
      const finale = !reducedMotion && index === current.steps.length - 1 && player.t >= 1 && step.chapter === 'crowd';
      finaleStart = finale ? (finaleStart ?? now) : null;

      const shownHover = reacts ? hover : null;
      if (width > 0 && height > 0) {
        drawGuide(ctx, current.model, {
          width,
          height,
          camera,
          insets: margins,
          scene,
          now,
          hover: shownHover,
          ghostPins: activeTool !== 'inspect',
          crowdClock: finaleStart === null ? null : (now - finaleStart) / 1000,
        });
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
