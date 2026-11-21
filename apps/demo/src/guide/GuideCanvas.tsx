import { COST_IMPASSABLE, COST_MIN } from '@leptoquark1/openage-pfadfinder/shared';
import { useEffect, useRef } from 'react';
import type { Player } from './player.js';
import { drawGuide, screenToCell } from './render.js';
import { type Cell, COST_MUD, type Scenario, withCost, withPin } from './scenarios.js';
import { type Box, mixScene, type Timeline } from './timeline.js';

export type Tool = 'inspect' | 'start' | 'target' | 'wall' | 'mud' | 'erase';

const TOOL_COST: Partial<Record<Tool, number>> = {
  wall: COST_IMPASSABLE,
  mud: COST_MUD,
  erase: COST_MIN,
};

interface GuideCanvasProps {
  player: Player;
  timeline: Timeline;
  tool: Tool;
  onEdit: (edit: (scenario: Scenario) => Scenario) => void;
  onHover: (cell: Cell | null) => void;
  /** Called every frame with the overall progress, 0..1. */
  onProgress: (progress: number) => void;
}

const ease = (t: number) => t * t * (3 - 2 * t);

export function GuideCanvas({ player, timeline, tool, onEdit, onHover, onProgress }: GuideCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // The render loop is started once; live props reach it through refs.
  const live = useRef({ timeline, tool, onEdit, onHover, onProgress });
  live.current = { timeline, tool, onEdit, onHover, onProgress };

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
    let hover: Cell | null = null;
    let drag: 'start' | 'target' | 'paint' | null = null;
    let lastPaint: Cell | null = null;

    const cellOf = (e: PointerEvent): Cell | null => {
      if (!camera) {
        return null;
      }
      const rect = canvas.getBoundingClientRect();
      return screenToCell(width, height, camera, e.clientX - rect.left, e.clientY - rect.top);
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
      const { tool: active, timeline: current } = live.current;
      const { start, target } = current.model.scenario;
      if (active === 'start' || active === 'target') {
        drag = active;
        live.current.onEdit(scenario => withPin(scenario, active, cell));
      } else if (active === 'inspect') {
        if (cell.ne === start.ne && cell.se === start.se) {
          drag = 'start';
        } else if (cell.ne === target.ne && cell.se === target.se) {
          drag = 'target';
        }
      } else {
        drag = 'paint';
        lastPaint = null;
        paintTo(cell);
      }
      if (drag) {
        canvas.setPointerCapture(e.pointerId);
      }
    };

    const onMove = (e: PointerEvent) => {
      const cell = cellOf(e);
      if (cell?.ne !== hover?.ne || cell?.se !== hover?.se) {
        hover = cell;
        live.current.onHover(cell);
        if (cell && (drag === 'start' || drag === 'target')) {
          const pin = drag;
          live.current.onEdit(scenario => withPin(scenario, pin, cell));
        } else if (cell && drag === 'paint') {
          paintTo(cell);
        }
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
      player.tick(dt);

      const { timeline: current, tool: activeTool } = live.current;
      const index = Math.min(player.index, current.steps.length - 1);
      const step = current.steps[index]!;
      const previous = current.steps[index - 1]?.scene ?? step.scene;
      const scene = mixScene(previous, step.scene, ease(player.t));

      const goal = scene.camera;
      if (!camera || reducedMotion) {
        camera = goal;
      } else {
        const k = 1 - Math.exp(-dt / 170);
        camera = {
          x: camera.x + (goal.x - camera.x) * k,
          y: camera.y + (goal.y - camera.y) * k,
          w: camera.w + (goal.w - camera.w) * k,
          h: camera.h + (goal.h - camera.h) * k,
        };
      }

      // Once the story is over, the crowd keeps streaming to the target.
      const finale = !reducedMotion && index === current.steps.length - 1 && player.t >= 1 && step.chapter === 'crowd';
      finaleStart = finale ? (finaleStart ?? now) : null;

      if (width > 0 && height > 0) {
        drawGuide(ctx, current.model, {
          width,
          height,
          camera,
          scene,
          now,
          hover,
          ghostPins: activeTool !== 'inspect',
          crowdClock: finaleStart === null ? null : (now - finaleStart) / 1000,
        });
      }

      const { start, target } = current.model.scenario;
      const onPin =
        hover !== null &&
        ((hover.ne === start.ne && hover.se === start.se) || (hover.ne === target.ne && hover.se === target.se));
      canvas.style.cursor = drag ? 'grabbing' : activeTool !== 'inspect' ? 'crosshair' : onPin ? 'grab' : 'default';

      live.current.onProgress((index + player.t) / current.steps.length);
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
