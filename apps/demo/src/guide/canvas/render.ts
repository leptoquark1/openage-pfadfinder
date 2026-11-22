import { COLORS } from '../../theme.js';
import { type Insets, makeView } from '../layout.js';
import type { GuideModel } from '../model/types.js';
import type { Cell } from '../scenarios.js';
import type { Box, Scene } from '../story/scene.js';
import type { MapReveal } from '../tour.js';
import { drawFields } from './layers/fields.js';
import { drawCoords, drawHover, drawPins, drawSpotlight } from './layers/markers.js';
import { drawCrowd, drawRoute } from './layers/route.js';
import { drawGraph } from './layers/search.js';
import { drawAreas, drawFrames, drawPortals } from './layers/structure.js';
import { drawBackdrop, drawCells, drawStrip, drawTerrain } from './layers/terrain.js';
import { drawFlowReveal, drawGatesReveal, drawGridReveal, drawProblem, drawSearchReveal } from './reveals.js';

export interface DrawInput {
  readonly width: number;
  readonly height: number;
  readonly camera: Box;
  /** Canvas space the map leaves free for the floating interface. */
  readonly insets: Insets;
  readonly scene: Scene;
  readonly now: number;
  readonly hover: Cell | null;
  /** Show the pins before the story reaches them, while editing the map. */
  readonly ghostPins: boolean;
  /** Seconds the crowd has been looping after the story ended; null during the story. */
  readonly crowdClock: number | null;
  /** The drawing that replaces the scene, and how many seconds it has been running. */
  readonly reveal: { readonly kind: MapReveal; readonly seconds: number } | null;
  /** Leaves out cells, sectors and all search layers. */
  readonly plainMap: boolean;
  /** Writes each cell's movement cost into it, when there is room. */
  readonly costLabels: boolean;
}

export function drawGuide(ctx: CanvasRenderingContext2D, model: GuideModel, input: DrawInput): void {
  const { width, height, camera, insets, scene, now, hover, ghostPins, crowdClock, reveal, plainMap, costLabels } =
    input;
  const v = makeView(width, height, camera, insets);
  ctx.save();
  if (plainMap || reveal !== null) {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, width, height);
    if (reveal !== null) {
      if (reveal.kind === 'problem') {
        drawTerrain(ctx, model, v);
        drawProblem(ctx, model, v, reveal.seconds);
      } else {
        drawGridReveal(ctx, model, v, reveal.kind === 'grid' ? reveal.seconds : Number.POSITIVE_INFINITY);
      }
      if (reveal.kind === 'gates') {
        drawGatesReveal(ctx, model, v, reveal.seconds);
      } else if (reveal.kind === 'search') {
        drawSearchReveal(ctx, model, v, reveal.seconds);
      } else if (reveal.kind === 'flow') {
        drawFlowReveal(ctx, model, v, reveal.seconds);
      } else if (reveal.kind === 'map') {
        // This slide rests on an early step, so the path and the crowd run on the drawing's own clock.
        const finished = { ...scene, route: 0, walk: 1, crowd: 1 };
        drawRoute(ctx, model, finished, v, now);
        drawCrowd(ctx, model, finished, v, Number.isFinite(reveal.seconds) ? reveal.seconds : null);
      } else if (reveal.kind === 'crowd') {
        drawFlowReveal(ctx, model, v, Number.POSITIVE_INFINITY, 0.55);
        drawCrowd(ctx, model, scene, v, crowdClock);
      }
      drawPins(ctx, model, { ...scene, pins: 1 }, v, now, false);
    } else {
      drawTerrain(ctx, model, v);
      drawRoute(ctx, model, { ...scene, route: 0 }, v, now);
      drawCrowd(ctx, model, scene, v, crowdClock);
      drawPins(ctx, model, scene, v, now, false);
    }
    ctx.restore();
    return;
  }
  drawBackdrop(ctx, width, height, v);
  drawStrip(ctx, model, scene, v);
  drawCells(ctx, model, scene, v, costLabels);
  drawFields(ctx, model, scene, v, now);
  drawAreas(ctx, model, scene, v);
  drawFrames(ctx, model, scene, v, now);
  drawPortals(ctx, model, scene, v, now);
  drawGraph(ctx, model, scene, v, now, hover);
  drawSpotlight(ctx, scene, width, height, camera, v);
  drawRoute(ctx, model, scene, v, now);
  drawCrowd(ctx, model, scene, v, crowdClock);
  drawCoords(ctx, model, scene, v);
  drawPins(ctx, model, scene, v, now, ghostPins);
  drawHover(ctx, hover, v);
  ctx.restore();
}
