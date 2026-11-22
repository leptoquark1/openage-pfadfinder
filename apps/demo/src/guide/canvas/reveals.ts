import { COST_MIN, INTEGRATED_COST_UNREACHABLE } from '@leptoquark1/openage-pfadfinder/shared';
import type { View } from '../layout.js';
import { flowDirection } from '../model/fields.js';
import type { FieldTrace, GuideModel, PortalView } from '../model/types.js';
import { replayField } from '../observe.js';
import { COLS, ROWS, SECTOR_SIZE, SECTORS_X, SECTORS_Y } from '../scenarios.js';
import {
  fieldArrowProgress,
  fieldWaveProgress,
  gateLinkProgress,
  gateProgress,
  mapCellProgress,
  mapOutlineProgress,
  mapSectorProgress,
  problemProgress,
  searchChainProgress,
  searchProgress,
} from '../tour.js';
import { INK } from './ink.js';
import { drawTerrain } from './layers/terrain.js';
import {
  chainPoints,
  clamp01,
  disc,
  flowArrow,
  heat,
  lerp,
  portalPoint,
  px,
  py,
  rgba,
  segment,
  smooth,
  strokePartial,
  tag,
} from './primitives.js';

/** The terrain, then drawn over it: the outline, a sweep of grid lines and the sector borders. */
export function drawGridReveal(ctx: CanvasRenderingContext2D, model: GuideModel, v: View, seconds: number): void {
  const lastDiagonal = COLS + ROWS - 2;

  drawTerrain(ctx, model, v);

  ctx.save();
  // Each cell grows its top and left edge; the outline closes the map on the other sides.
  ctx.strokeStyle = 'rgba(138, 149, 161, 0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let se = 0; se < ROWS; se++) {
    for (let ne = 0; ne < COLS; ne++) {
      const drawn = smooth(mapCellProgress(seconds, (ne + se) / lastDiagonal));
      if (drawn <= 0) {
        continue;
      }
      const x = px(v, ne);
      const y = py(v, se);
      if (se > 0) {
        ctx.moveTo(x, y);
        ctx.lineTo(x + v.s * drawn, y);
      }
      if (ne > 0) {
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + v.s * drawn);
      }
    }
  }
  ctx.stroke();

  const borders = [
    ...Array.from({ length: SECTORS_X - 1 }, (_, i) => ({ x: (i + 1) * SECTOR_SIZE, y: 0, w: 0, h: ROWS })),
    ...Array.from({ length: SECTORS_Y - 1 }, (_, i) => ({ x: 0, y: (i + 1) * SECTOR_SIZE, w: COLS, h: 0 })),
  ];
  ctx.strokeStyle = INK.frame;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  borders.forEach((border, i) => {
    const drawn = smooth(mapSectorProgress(seconds, i / (borders.length - 1)));
    if (drawn > 0) {
      ctx.moveTo(px(v, border.x), py(v, border.y));
      ctx.lineTo(px(v, border.x + border.w * drawn), py(v, border.y + border.h * drawn));
    }
  });
  ctx.stroke();

  // A dash as long as the drawn part traces the outline clockwise from the top left corner.
  const perimeter = 2 * (COLS + ROWS) * v.s;
  const traced = smooth(mapOutlineProgress(seconds)) * perimeter;
  if (traced > 0) {
    ctx.strokeStyle = INK.chain;
    ctx.lineWidth = 2;
    ctx.setLineDash(traced < perimeter ? [traced, perimeter] : []);
    ctx.strokeRect(px(v, 0), py(v, 0), COLS * v.s, ROWS * v.s);
    ctx.setLineDash([]);
  }
  ctx.restore();
}

/** A gate's opening on the sector border, growing from its middle. */
function drawGateOpening(ctx: CanvasRenderingContext2D, portal: PortalView, v: View, shown: number): void {
  const side = portal.cells[0];
  const first = side[0]!;
  const last = side[side.length - 1]!;
  const from = portal.northSouth ? { x: first.ne, y: first.se + 1 } : { x: first.ne + 1, y: first.se };
  const to = { x: last.ne + 1, y: last.se + 1 };
  ctx.strokeStyle = INK.portal;
  ctx.lineWidth = Math.max(2.5, v.s * 0.13);
  ctx.lineCap = 'round';
  segment(
    ctx,
    px(v, lerp(portal.x, from.x, shown)),
    py(v, lerp(portal.y, from.y, shown)),
    px(v, lerp(portal.x, to.x, shown)),
    py(v, lerp(portal.y, to.y, shown)),
  );
}

/** The recorded A* search as a calm spread over the open gates, settling on the route it found. */
export function drawSearchReveal(ctx: CanvasRenderingContext2D, model: GuideModel, v: View, seconds: number): void {
  const events = model.search?.events.length ?? 0;
  const { reached, closedAt } = searchOrder(model);
  const edge = Math.max(3, events * 0.14);
  const at = (events + edge) * searchProgress(seconds);
  const arrived = (event: number) => smooth(clamp01((at - event) / edge));
  const chain = smooth(searchChainProgress(seconds));
  const tree = 1 - chain;
  const radius = Math.max(4, v.s * 0.2);
  const point = (id: number) => portalPoint(model, v, id);

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const portal of model.portals.values()) {
    drawGateOpening(ctx, portal, v, 1);
  }

  ctx.strokeStyle = rgba(INK.portal, 0.13);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const link of model.graphEdges) {
    const a = point(link.a);
    const b = point(link.b);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();

  ctx.strokeStyle = rgba(INK.open, 0.55 * tree);
  ctx.lineWidth = Math.max(1.5, v.s * 0.05);
  ctx.beginPath();
  for (const [id, { event, prev }] of reached) {
    const grown = arrived(event);
    if (prev !== null && grown > 0) {
      const a = point(prev);
      const b = point(id);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(lerp(a.x, b.x, grown), lerp(a.y, b.y, grown));
    }
  }
  ctx.stroke();

  const onRoute = new Set(model.search?.chain ?? []);
  for (const portal of model.portals.values()) {
    const { x, y } = point(portal.id);
    const dot = (color: string, alpha: number) => {
      if (alpha > 0) {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        disc(ctx, x, y, radius);
      }
    };
    const entry = reached.get(portal.id);
    const closed = closedAt.get(portal.id);
    dot('#2A3138', 1);
    dot(INK.open, entry ? arrived(entry.event) * tree : 0);
    dot(INK.closed, closed === undefined ? 0 : arrived(closed) * tree);
    dot(INK.chain, onRoute.has(portal.id) ? chain : 0);
  }
  ctx.globalAlpha = 1;

  if (chain > 0 && model.search && model.search.chain.length > 0) {
    ctx.strokeStyle = model.search.found ? INK.chain : INK.shadow;
    ctx.lineWidth = Math.max(3, v.s * 0.12);
    strokePartial(ctx, chainPoints(model, v), chain);
  }
  ctx.restore();
}

interface SearchOrder {
  /** The event that first reached each gate, and the gate it was finally reached from. */
  readonly reached: ReadonlyMap<number, { readonly event: number; readonly prev: number | null }>;
  /** The event that closed each gate. */
  readonly closedAt: ReadonlyMap<number, number>;
}

const searchOrders = new WeakMap<GuideModel, SearchOrder>();

/** When each gate joined the recorded search, so the replay can fade it in without flicker. */
function searchOrder(model: GuideModel): SearchOrder {
  const known = searchOrders.get(model);
  if (known) {
    return known;
  }
  const events = model.search?.events ?? [];
  const firstSeen = new Map<number, number>();
  const closedAt = new Map<number, number>();
  events.forEach((event, i) => {
    for (const state of event.states) {
      if (!firstSeen.has(state.id)) {
        firstSeen.set(state.id, i);
      }
      if (state.closed && !closedAt.has(state.id)) {
        closedAt.set(state.id, i);
      }
    }
  });
  const finalPrev = new Map((events.at(-1)?.states ?? []).map(state => [state.id, state.prev]));
  const reached = new Map(
    [...firstSeen].map(([id, event]) => [id, { event, prev: finalPrev.get(id) ?? null }] as const),
  );
  const order = { reached, closedAt };
  searchOrders.set(model, order);
  return order;
}

/** The width of the wave's soft edge, as a share of a field's cost range. */
const WAVE_EDGE = 0.45;

const finalFields = new WeakMap<FieldTrace, ReturnType<typeof replayField>>();

function finalField(field: FieldTrace): ReturnType<typeof replayField> {
  let state = finalFields.get(field);
  if (!state) {
    state = replayField(field.writes, field.writes.length, SECTOR_SIZE);
    finalFields.set(field, state);
  }
  return state;
}

/** A cell's opacity as a soft wave passes it; `place` is how far from the wave's origin it lies, from 0 to 1. */
const waveAt = (progress: number, place: number) => smooth(clamp01((progress * (1 + WAVE_EDGE) - place) / WAVE_EDGE));

/** A calm wave of the final costs through each route sector, then its arrows fading in the same way. */
export function drawFlowReveal(
  ctx: CanvasRenderingContext2D,
  model: GuideModel,
  v: View,
  seconds: number,
  opacity = 1,
): void {
  const count = model.fields.length;
  const size = SECTOR_SIZE * v.s;

  ctx.save();
  model.fields.forEach((field, i) => {
    const wave = fieldWaveProgress(seconds, i, count);
    if (wave <= 0) {
      return;
    }
    const arrows = fieldArrowProgress(seconds, i, count);
    const sector = model.sectors[field.sector]!;
    const { costs } = finalField(field);
    const range = Math.max(1, field.maxCost);

    for (let idx = 0; idx < SECTOR_SIZE * SECTOR_SIZE; idx++) {
      const cost = costs[idx]!;
      if (cost === INTEGRATED_COST_UNREACHABLE) {
        continue;
      }
      const place = cost / range;
      const ne = sector.ne + (idx % SECTOR_SIZE);
      const se = sector.se + Math.floor(idx / SECTOR_SIZE);
      const x = px(v, ne);
      const y = py(v, se);
      const shown = waveAt(wave, place);
      if (shown > 0) {
        ctx.globalAlpha = shown * opacity;
        // Costly ground stays readable under the wave, since it is what the wave adds up.
        ctx.fillStyle = heat(place, model.scenario.costs[ne + se * COLS]! > COST_MIN ? 0.3 : 0.62);
        ctx.fillRect(x + 0.5, y + 0.5, v.s - 1, v.s - 1);
      }

      const byte = field.flow[idx]!;
      const pointed = waveAt(arrows, place);
      if (pointed > 0 && flowDirection(field, byte) !== null) {
        ctx.globalAlpha = pointed * opacity;
        flowArrow(ctx, byte, x + v.s / 2, y + v.s / 2, v.s, 'rgba(255, 255, 255, 0.86)');
      }
    }

    ctx.globalAlpha = smooth(wave) * 0.7 * opacity;
    ctx.strokeStyle = INK.chain;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(px(v, sector.ne) + 1, py(v, sector.se) + 1, size - 2, size - 2);
  });
  ctx.restore();
}

/** The gates opening on the sector borders, then the links growing between them. */
export function drawGatesReveal(ctx: CanvasRenderingContext2D, model: GuideModel, v: View, seconds: number): void {
  const portals = [...model.portals.values()];
  const radius = Math.max(4, v.s * 0.2);

  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(INK.portal, 0.34);
  ctx.lineWidth = 1;
  ctx.beginPath();
  model.graphEdges.forEach((edge, i) => {
    const drawn = smooth(gateLinkProgress(seconds, i / Math.max(1, model.graphEdges.length - 1)));
    if (drawn > 0) {
      const a = model.portals.get(edge.a)!;
      const b = model.portals.get(edge.b)!;
      ctx.moveTo(px(v, a.x), py(v, a.y));
      ctx.lineTo(px(v, lerp(a.x, b.x, drawn)), py(v, lerp(a.y, b.y, drawn)));
    }
  });
  ctx.stroke();

  portals.forEach((portal, i) => {
    const shown = smooth(gateProgress(seconds, i / Math.max(1, portals.length - 1)));
    if (shown <= 0) {
      return;
    }
    drawGateOpening(ctx, portal, v, shown);

    const x = px(v, portal.x);
    const y = py(v, portal.y);
    ctx.fillStyle = INK.portal;
    disc(ctx, x, y, radius * (shown + Math.sin(shown * Math.PI) * 0.25));
  });
  ctx.restore();
}

/** A dashed line from start to target with a question mark: the way there is still unknown. */
export function drawProblem(ctx: CanvasRenderingContext2D, model: GuideModel, v: View, seconds: number): void {
  const { start, target } = model.scenario;
  const from = { x: px(v, start.ne + 0.5), y: py(v, start.se + 0.5) };
  const to = { x: px(v, target.ne + 0.5), y: py(v, target.se + 0.5) };
  const drawn = smooth(problemProgress(seconds));
  if (drawn <= 0) {
    return;
  }
  ctx.save();
  ctx.strokeStyle = rgba(INK.text, 0.45);
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 6]);
  segment(ctx, from.x, from.y, lerp(from.x, to.x, drawn), lerp(from.y, to.y, drawn));
  ctx.setLineDash([]);
  tag(
    ctx,
    '?',
    (from.x + to.x) / 2,
    (from.y + to.y) / 2,
    Math.max(13, v.s * 0.5),
    INK.open,
    clamp01((drawn - 0.6) / 0.4),
  );
  ctx.restore();
}
