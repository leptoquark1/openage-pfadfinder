import {
  COST_IMPASSABLE,
  FLOW_DIR_MASK,
  FLOW_PATHABLE_MASK,
  FLOW_TARGET_MASK,
  INTEGRATE_LOS_MASK,
  INTEGRATE_TARGET_MASK,
  INTEGRATE_WAVEFRONT_BLOCKED_MASK,
  INTEGRATED_COST_UNREACHABLE,
} from '@leptoquark1/openage-pfadfinder/shared';
import { COLORS } from '../theme.js';
import type { GuideModel, PortalView } from './model.js';
import { type AStarNodeState, replayField } from './observe.js';
import { type Cell, COLS, ROWS, SECTOR_SIZE, SECTORS_X } from './scenarios.js';
import type { Box, Scene } from './timeline.js';

export const INK = {
  free: '#171D22',
  freeAlt: '#1A2127',
  mud: '#3B3320',
  mudLine: '#7A6733',
  wall: '#3A2029',
  wallTop: COLORS.obstacle,
  frame: '#4A5563',
  portal: '#7DD3FC',
  open: COLORS.target,
  closed: '#5C6773',
  chain: COLORS.mob,
  shadow: COLORS.obstacle,
  sight: '#FDE68A',
  text: COLORS.textPrimary,
  muted: COLORS.textSecondary,
} as const;

const AREA_COLORS = ['#4FD1C5', '#A78BFA', '#F5A623', '#FB7185', '#7DD3FC', '#86EFAC'] as const;
const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const STRIP_Y = -1.9;
const TAPE_Y = -4.15;
/** Cells per second of the crowd looping after the story ended. */
const CROWD_LOOP_SPEED = 4.5;

/** Unit vector per `FlowDir`. */
const DIRECTIONS: readonly (readonly [number, number])[] = [
  [0, -1],
  [Math.SQRT1_2, -Math.SQRT1_2],
  [1, 0],
  [Math.SQRT1_2, Math.SQRT1_2],
  [0, 1],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [-1, 0],
  [-Math.SQRT1_2, -Math.SQRT1_2],
];

export interface DrawInput {
  readonly width: number;
  readonly height: number;
  readonly camera: Box;
  readonly scene: Scene;
  readonly now: number;
  readonly hover: Cell | null;
  /** Show the pins before the story reaches them, while editing the map. */
  readonly ghostPins: boolean;
  /** Seconds the crowd has been looping after the story ended; null during the story. */
  readonly crowdClock: number | null;
}

interface View {
  readonly s: number;
  readonly ox: number;
  readonly oy: number;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => x * x * (3 - 2 * x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const px = (v: View, ne: number) => v.ox + ne * v.s;
const py = (v: View, se: number) => v.oy + se * v.s;

function makeView(width: number, height: number, camera: Box): View {
  const s = Math.min(width / camera.w, height / camera.h);
  return { s, ox: (width - camera.w * s) / 2 - camera.x * s, oy: (height - camera.h * s) / 2 - camera.y * s };
}

/** The map cell under a canvas position, or null outside the map. */
export function screenToCell(width: number, height: number, camera: Box, x: number, y: number): Cell | null {
  const v = makeView(width, height, camera);
  const ne = Math.floor((x - v.ox) / v.s);
  const se = Math.floor((y - v.oy) / v.s);
  return ne >= 0 && se >= 0 && ne < COLS && se < ROWS ? { ne, se } : null;
}

function rgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Close to the target is warm, far away is cold. */
function heat(t: number, alpha: number): string {
  const stops = [
    [245, 166, 35],
    [45, 163, 154],
    [39, 54, 107],
  ] as const;
  const x = clamp01(t) * 2;
  const i = Math.min(1, Math.floor(x));
  const f = x - i;
  const a = stops[i]!;
  const b = stops[i + 1]!;
  return `rgba(${Math.round(lerp(a[0], b[0], f))}, ${Math.round(lerp(a[1], b[1], f))}, ${Math.round(lerp(a[2], b[2], f))}, ${alpha})`;
}

function text(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = 'center',
  weight = 400,
): void {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(value, x, y);
}

/** Text on a small dark plate, readable over any layer. */
function tag(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
  color: string,
  alpha = 1,
): void {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.font = `600 ${size}px ${FONT}`;
  const w = ctx.measureText(value).width + size * 0.8;
  const h = size * 1.55;
  ctx.fillStyle = 'rgba(13, 17, 20, 0.88)';
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, size * 0.35);
  ctx.fill();
  ctx.strokeStyle = rgba(color, 0.55);
  ctx.lineWidth = 1;
  ctx.stroke();
  text(ctx, value, x, y + 0.5, size, color, 'center', 600);
  ctx.restore();
}

function arrow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  dir: number,
  length: number,
  color: string,
  width: number,
): void {
  const [dx, dy] = DIRECTIONS[dir]!;
  const hx = cx + dx * length * 0.5;
  const hy = cy + dy * length * 0.5;
  const wing = length * 0.34;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - dx * length * 0.5, cy - dy * length * 0.5);
  ctx.lineTo(hx, hy);
  ctx.moveTo(hx - (dx - dy * 0.7) * wing, hy - (dy + dx * 0.7) * wing);
  ctx.lineTo(hx, hy);
  ctx.lineTo(hx - (dx + dy * 0.7) * wing, hy - (dy - dx * 0.7) * wing);
  ctx.stroke();
}

function drawBackdrop(ctx: CanvasRenderingContext2D, width: number, height: number, v: View): void {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, width, height);
  const step = v.s;
  if (step < 8) {
    return;
  }
  ctx.fillStyle = 'rgba(138, 149, 161, 0.07)';
  const startX = ((v.ox % step) + step) % step;
  const startY = ((v.oy % step) + step) % step;
  for (let x = startX; x < width; x += step) {
    for (let y = startY; y < height; y += step) {
      ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
    }
  }
}

function paintCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  cost: number,
  alt: boolean,
) {
  if (cost === COST_IMPASSABLE) {
    ctx.fillStyle = INK.wall;
    ctx.fillRect(x, y, w, h);
    if (w > 6) {
      ctx.fillStyle = rgba(INK.wallTop, 0.75);
      ctx.fillRect(x, y, w, Math.max(1.5, h * 0.1));
      ctx.fillStyle = rgba(INK.wallTop, 0.13);
      ctx.fillRect(x, y + h * 0.5, w, 1);
      ctx.fillRect(x + w * 0.5, y + h * 0.1, 1, h * 0.4);
    }
  } else if (cost > 1) {
    ctx.fillStyle = INK.mud;
    ctx.fillRect(x, y, w, h);
    if (w > 8) {
      ctx.strokeStyle = rgba(INK.mudLine, 0.65);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const f of [0.3, 0.7]) {
        ctx.moveTo(x + w * 0.16, y + h * f);
        ctx.quadraticCurveTo(x + w * 0.33, y + h * (f - 0.12), x + w * 0.5, y + h * f);
        ctx.quadraticCurveTo(x + w * 0.67, y + h * (f + 0.12), x + w * 0.84, y + h * f);
      }
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = alt ? INK.freeAlt : INK.free;
    ctx.fillRect(x, y, w, h);
  }
}

function drawStrip(ctx: CanvasRenderingContext2D, model: GuideModel, scene: Scene, v: View): void {
  const alpha = 1 - smooth(clamp01(scene.fold * 2.4));
  if (alpha <= 0) {
    return;
  }
  const { costs } = model.scenario;
  ctx.save();
  ctx.globalAlpha = alpha;

  text(ctx, 'costs: Uint8Array', px(v, 0), py(v, TAPE_Y - 0.28), v.s * 0.4, INK.text, 'left', 600);
  text(ctx, `${COLS * ROWS} bytes`, px(v, COLS), py(v, TAPE_Y - 0.28), v.s * 0.36, INK.muted, 'right');
  for (let i = 0; i < COLS; i++) {
    const x = px(v, i);
    const y = py(v, TAPE_Y);
    paintCell(ctx, x + 1, y, v.s - 2, v.s - 2, costs[i]!, false);
    ctx.strokeStyle = COLORS.borderStrong;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 1, y, v.s - 2, v.s - 2);
    text(ctx, String(costs[i]), x + v.s / 2, y + v.s / 2 - 1, v.s * (costs[i]! > 99 ? 0.3 : 0.38), INK.text);
    if (i % 4 === 0) {
      text(ctx, String(i), x + v.s / 2, y + v.s * 1.17, v.s * 0.27, INK.muted);
    }
  }

  // The first row of the tape is a magnified view of the head of the strip.
  ctx.strokeStyle = rgba(INK.portal, 0.4);
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(px(v, 0), py(v, TAPE_Y + 1.42));
  ctx.lineTo(px(v, 0), py(v, STRIP_Y));
  ctx.moveTo(px(v, COLS), py(v, TAPE_Y + 1.42));
  ctx.lineTo(px(v, COLS / ROWS), py(v, STRIP_Y));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawCells(ctx: CanvasRenderingContext2D, model: GuideModel, scene: Scene, v: View): void {
  const { costs } = model.scenario;
  const folding = scene.fold < 1;
  const covered = new Set<number>();
  model.fields.forEach((field, i) => {
    if ((scene.fieldWrites[i] ?? 0) > 0) {
      covered.add(field.sector);
    }
  });

  for (let se = 0; se < ROWS; se++) {
    for (let ne = 0; ne < COLS; ne++) {
      const idx = ne + se * COLS;
      const sector = Math.floor(ne / SECTOR_SIZE) + Math.floor(se / SECTOR_SIZE) * SECTORS_X;
      const built = clamp01(scene.slices - sector);
      const lift = Math.sin(built * Math.PI);
      let x = ne;
      let y = se - lift * 0.14;
      let w = 1;
      let h = 1;
      if (folding) {
        const p = smooth(clamp01((scene.fold * (ROWS + 6) - se) / 6));
        x = lerp(idx / ROWS, ne, p);
        y = lerp(STRIP_Y, se, p);
        w = lerp(1 / ROWS, 1, p);
        h = lerp(0.7, 1, p);
      }
      const gap = w > 0.5 && v.s > 10 ? 1 : 0;
      ctx.globalAlpha = 1 - scene.frames * (1 - built) * 0.55;
      paintCell(
        ctx,
        px(v, x) + gap / 2,
        py(v, y) + gap / 2,
        w * v.s - gap,
        h * v.s - gap,
        costs[idx]!,
        (ne + se) % 2 === 0,
      );
      if (lift > 0.01) {
        ctx.fillStyle = rgba(INK.chain, lift * 0.24);
        ctx.fillRect(px(v, x), py(v, y), v.s, v.s);
      }
      if (!folding && v.s >= 26 && !covered.has(sector)) {
        const cost = costs[idx]!;
        const color =
          cost === COST_IMPASSABLE ? rgba(INK.wallTop, 0.8) : cost > 1 ? INK.sight : 'rgba(138,149,161,0.42)';
        text(ctx, String(cost), px(v, x) + v.s / 2, py(v, y) + v.s / 2, v.s * (cost > 99 ? 0.27 : 0.32), color);
      }
    }
  }
  ctx.globalAlpha = 1;
}

function drawFrames(ctx: CanvasRenderingContext2D, model: GuideModel, scene: Scene, v: View, now: number): void {
  if (scene.frames <= 0) {
    return;
  }
  const size = SECTOR_SIZE * v.s;
  const active = scene.slices < model.sectors.length ? Math.floor(scene.slices) : -1;
  ctx.save();
  for (const sector of model.sectors) {
    const x = px(v, sector.ne);
    const y = py(v, sector.se);
    const reveal = smooth(clamp01(scene.frames * 2 - (sector.id / model.sectors.length) * 1));
    ctx.globalAlpha = reveal;
    ctx.strokeStyle = sector.id === active ? INK.chain : INK.frame;
    ctx.lineWidth = sector.id === active ? 2.5 : 1.25;
    ctx.strokeRect(x, y, size, size);
    if ((scene.slices > sector.id || scene.slices === 0) && v.s < 44) {
      text(
        ctx,
        `S${sector.id}`,
        x + 5,
        y + Math.max(8, v.s * 0.26),
        Math.min(12, Math.max(9, v.s * 0.28)),
        rgba(INK.text, 0.7),
        'left',
        600,
      );
    }
    if (sector.id === active) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 110);
      ctx.strokeStyle = rgba(INK.chain, 0.2 + pulse * 0.25);
      ctx.lineWidth = 6;
      ctx.strokeRect(x, y, size, size);
    }
  }
  ctx.restore();
}

function drawAreas(ctx: CanvasRenderingContext2D, model: GuideModel, scene: Scene, v: View): void {
  // Areas belong to the build phase; the graph replaces them for good.
  const fade = 1 - clamp01(Math.max(scene.graph * 1.6, scene.pins));
  if (scene.areas <= 0 || fade <= 0) {
    return;
  }
  const done = Math.floor(scene.areas);
  const frac = scene.areas - done;
  ctx.save();
  for (const sector of model.sectors) {
    if (sector.id > done || (sector.id === done && frac <= 0)) {
      continue;
    }
    const current = sector.id === done;
    const reveal = current ? (sector.floodMax + 1) * smooth(clamp01(frac / 0.75)) : Number.POSITIVE_INFINITY;
    for (let idx = 0; idx < sector.areas.length; idx++) {
      const area = sector.areas[idx]!;
      if (area === 0 || sector.floodRank[idx]! > reveal) {
        continue;
      }
      const ne = sector.ne + (idx % SECTOR_SIZE);
      const se = sector.se + Math.floor(idx / SECTOR_SIZE);
      ctx.fillStyle = rgba(AREA_COLORS[(area - 1) % AREA_COLORS.length]!, (current ? 0.48 : 0.2) * fade);
      ctx.fillRect(px(v, ne), py(v, se), v.s, v.s);
    }
    const links = current ? clamp01((frac - 0.65) / 0.35) : 0.6;
    if (links > 0) {
      ctx.strokeStyle = rgba(INK.text, (current ? 0.85 : 0.35) * links * fade);
      ctx.lineWidth = current ? 2 : 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      for (const edge of model.graphEdges) {
        if (edge.sector === sector.id) {
          const a = model.portals.get(edge.a)!;
          const b = model.portals.get(edge.b)!;
          ctx.moveTo(px(v, a.x), py(v, a.y));
          ctx.lineTo(px(v, b.x), py(v, b.y));
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  ctx.restore();
}

function drawPortals(ctx: CanvasRenderingContext2D, model: GuideModel, scene: Scene, v: View, now: number): void {
  if (scene.edges <= 0) {
    return;
  }
  const done = Math.floor(scene.edges);
  const frac = scene.edges - done;
  const quiet = 1 - clamp01(Math.max(scene.graph, scene.pins)) * 0.7;

  ctx.save();
  model.edges.forEach((edge, i) => {
    if (i > done || (i === done && frac <= 0)) {
      return;
    }
    const scanning = i === done;
    const sweep = scanning ? frac * SECTOR_SIZE : SECTOR_SIZE;

    for (const id of edge.portalIds) {
      const portal = model.portals.get(id)!;
      const along = (c: Cell) => (edge.northSouth ? c.ne % SECTOR_SIZE : c.se % SECTOR_SIZE);
      const first = along(portal.cells[0][0]!);
      const end = along(portal.cells[0][portal.cells[0].length - 1]!) + 1;
      const visibleEnd = Math.min(end, sweep);
      if (visibleEnd <= first) {
        continue;
      }

      ctx.fillStyle = rgba(INK.portal, 0.13 * quiet);
      for (const side of portal.cells) {
        for (const c of side) {
          if (along(c) < visibleEnd) {
            ctx.fillRect(px(v, c.ne), py(v, c.se), v.s, v.s);
          }
        }
      }

      const base = portal.cells[0][0]!;
      ctx.strokeStyle = rgba(INK.portal, quiet);
      ctx.lineWidth = Math.max(2.5, v.s * 0.13);
      ctx.lineCap = 'round';
      ctx.beginPath();
      if (edge.northSouth) {
        const y = py(v, base.se + 1);
        ctx.moveTo(px(v, base.ne) + 3, y);
        ctx.lineTo(px(v, base.ne - first + visibleEnd) - 3, y);
      } else {
        const x = px(v, base.ne + 1);
        ctx.moveTo(x, py(v, base.se) + 3);
        ctx.lineTo(x, py(v, base.se - first + visibleEnd) - 3);
      }
      ctx.stroke();

      if (visibleEnd === end && scene.graph < 0.5 && scene.pins === 0) {
        const size = Math.min(12, Math.max(9, v.s * 0.3));
        tag(ctx, `P${id}`, px(v, portal.x), py(v, portal.y), size, INK.portal, 1 - scene.graph * 2);
      }
    }

    if (scanning) {
      edge.pairs.forEach((pair, index) => {
        if (index >= sweep || pair.open) {
          return;
        }
        const cx = edge.northSouth ? px(v, pair.a.ne + 0.5) : px(v, pair.a.ne + 1);
        const cy = edge.northSouth ? py(v, pair.a.se + 1) : py(v, pair.a.se + 0.5);
        const r = v.s * 0.16;
        ctx.strokeStyle = INK.shadow;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - r, cy - r);
        ctx.lineTo(cx + r, cy + r);
        ctx.moveTo(cx + r, cy - r);
        ctx.lineTo(cx - r, cy + r);
        ctx.stroke();
      });

      const head = edge.pairs[0]!.a;
      const glow = 0.6 + 0.4 * Math.sin(now / 60);
      ctx.strokeStyle = rgba(INK.sight, glow);
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (edge.northSouth) {
        const x = px(v, head.ne + sweep);
        ctx.moveTo(x, py(v, head.se));
        ctx.lineTo(x, py(v, head.se + 2));
      } else {
        const y = py(v, head.se + sweep);
        ctx.moveTo(px(v, head.ne), y);
        ctx.lineTo(px(v, head.ne + 2), y);
      }
      ctx.stroke();
    }
  });
  ctx.restore();
}

function drawFields(ctx: CanvasRenderingContext2D, model: GuideModel, scene: Scene, v: View, now: number): void {
  const faded = 1 - clamp01(scene.crowd * 6) * 0.45;
  model.fields.forEach((field, i) => {
    const writesF = scene.fieldWrites[i] ?? 0;
    if (writesF <= 0) {
      return;
    }
    const flowF = scene.fieldFlow[i] ?? 0;
    const writes = Math.floor(writesF);
    const state = replayField(field.writes, writes, SECTOR_SIZE);
    const recent = new Set(field.writes.slice(Math.max(0, writes - 4), writes).map(w => w.idx));
    const animating = writesF < field.writes.length;
    const sector = model.sectors[field.sector]!;

    for (let idx = 0; idx < SECTOR_SIZE * SECTOR_SIZE; idx++) {
      const ne = sector.ne + (idx % SECTOR_SIZE);
      const se = sector.se + Math.floor(idx / SECTOR_SIZE);
      const cost = state.costs[idx]!;
      const flags = state.flags[idx]!;
      const x = px(v, ne);
      const y = py(v, se);
      const shadow = (flags & INTEGRATE_WAVEFRONT_BLOCKED_MASK) !== 0;

      if (cost !== INTEGRATED_COST_UNREACHABLE) {
        ctx.fillStyle = heat(cost / field.maxCost, 0.62 * faded);
        ctx.fillRect(x + 0.5, y + 0.5, v.s - 1, v.s - 1);
        if ((flags & INTEGRATE_LOS_MASK) !== 0) {
          ctx.fillStyle = rgba(INK.sight, 0.14 * faded);
          ctx.fillRect(x + 0.5, y + 0.5, v.s - 1, v.s - 1);
        }
      }
      if (shadow) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, v.s, v.s);
        ctx.clip();
        ctx.strokeStyle = rgba(INK.shadow, 0.5 * faded);
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let d = -1; d <= 1; d += 0.34) {
          ctx.moveTo(x + d * v.s, y + v.s);
          ctx.lineTo(x + (d + 1) * v.s, y);
        }
        ctx.stroke();
        ctx.restore();
      }
      if (animating && recent.has(idx)) {
        const pulse = 0.5 + 0.5 * Math.sin(now / 70);
        ctx.fillStyle = `rgba(255, 255, 255, ${0.22 + pulse * 0.2})`;
        ctx.fillRect(x, y, v.s, v.s);
      }

      if (cost === INTEGRATED_COST_UNREACHABLE) {
        continue;
      }
      const hasFlow = idx < flowF && (field.flow[idx]! & FLOW_PATHABLE_MASK) !== 0;
      // Small cells have room for a number or an arrow, large ones for both.
      if (v.s >= 26 && (!hasFlow || v.s >= 44)) {
        const corner = hasFlow;
        text(
          ctx,
          String(cost),
          corner ? x + 4 : x + v.s / 2,
          corner ? y + v.s * 0.17 : y + v.s / 2,
          v.s * (corner ? 0.17 : cost > 99 ? 0.27 : 0.33),
          'rgba(255,255,255,0.92)',
          corner ? 'left' : 'center',
          600,
        );
      }
      if (hasFlow) {
        const byte = field.flow[idx]!;
        const isGoal = field.kind === 'target' && (byte & FLOW_TARGET_MASK) !== 0;
        const cx = x + v.s / 2;
        const cy = y + v.s / 2 + (v.s >= 44 ? v.s * 0.07 : 0);
        if (isGoal) {
          continue;
        }
        const isExit = (byte & FLOW_TARGET_MASK) !== 0;
        arrow(
          ctx,
          cx,
          cy,
          byte & FLOW_DIR_MASK,
          v.s * (v.s >= 26 ? 0.52 : 0.62),
          isExit ? INK.portal : `rgba(255,255,255,${0.86 * faded})`,
          Math.max(1.1, v.s * (isExit ? 0.07 : 0.045)),
        );
      } else if ((flags & INTEGRATE_TARGET_MASK) !== 0 && field.kind === 'portal') {
        ctx.strokeStyle = INK.portal;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 2, y + 2, v.s - 4, v.s - 4);
      }
    }
  });
}

function searchStates(model: GuideModel, scene: Scene): ReadonlyMap<number, AStarNodeState> {
  const events = model.search?.events ?? [];
  const applied = Math.min(events.length, Math.floor(scene.astar));
  const states = new Map<number, AStarNodeState>();
  if (applied > 0) {
    for (const state of events[applied - 1]!.states) {
      states.set(state.id, state);
    }
  }
  return states;
}

function hoveredPortal(model: GuideModel, hover: Cell | null): PortalView | null {
  if (!hover) {
    return null;
  }
  let best: PortalView | null = null;
  let bestDist = 1.1;
  for (const portal of model.portals.values()) {
    const dist = Math.hypot(portal.x - (hover.ne + 0.5), portal.y - (hover.se + 0.5));
    if (dist < bestDist) {
      best = portal;
      bestDist = dist;
    }
  }
  return best;
}

function drawGraph(
  ctx: CanvasRenderingContext2D,
  model: GuideModel,
  scene: Scene,
  v: View,
  now: number,
  hover: Cell | null,
): void {
  if (scene.graph <= 0 && scene.astar <= 0) {
    return;
  }
  const alpha = clamp01(scene.graph);
  const states = searchStates(model, scene);
  const events = model.search?.events ?? [];
  const searching = scene.astar > 0;
  const chain = model.search?.chain ?? [];
  const inChain = new Set(chain);
  const hovered = scene.graph > 0.5 ? hoveredPortal(model, hover) : null;
  const radius = Math.max(4, v.s * 0.2);
  const point = (id: number) => {
    const portal = model.portals.get(id)!;
    return { x: px(v, portal.x), y: py(v, portal.y) };
  };

  ctx.save();
  ctx.globalAlpha = alpha;

  ctx.strokeStyle = rgba(INK.portal, searching ? 0.13 : 0.34);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const edge of model.graphEdges) {
    const a = point(edge.a);
    const b = point(edge.b);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();

  if (hovered) {
    for (const edge of model.graphEdges) {
      if (edge.a !== hovered.id && edge.b !== hovered.id) {
        continue;
      }
      const a = point(edge.a);
      const b = point(edge.b);
      ctx.strokeStyle = INK.sight;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      tag(ctx, String(edge.cost), (a.x + b.x) / 2, (a.y + b.y) / 2, Math.max(9, v.s * 0.28), INK.sight);
    }
  }

  // Search tree: each reached node points back to where it was reached from.
  if (scene.chain < 1) {
    ctx.lineWidth = Math.max(1.5, v.s * 0.06);
    for (const state of states.values()) {
      if (state.prev === null) {
        continue;
      }
      const a = point(state.prev);
      const b = point(state.id);
      ctx.strokeStyle = rgba(state.closed ? INK.closed : INK.open, state.closed ? 0.8 : 0.72);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  // Seeds start at the unit itself.
  if (searching && scene.chain < 1) {
    const from = { x: px(v, model.scenario.start.ne + 0.5), y: py(v, model.scenario.start.se + 0.5) };
    ctx.strokeStyle = rgba(INK.chain, 0.5);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    for (const state of states.values()) {
      if (state.prev === null) {
        const p = point(state.id);
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(p.x, p.y);
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (scene.chain > 0 && chain.length > 0) {
    const pts = [
      { x: px(v, model.scenario.start.ne + 0.5), y: py(v, model.scenario.start.se + 0.5) },
      ...chain.map(point),
    ];
    if (model.search?.found) {
      pts.push({ x: px(v, model.scenario.target.ne + 0.5), y: py(v, model.scenario.target.se + 0.5) });
    }
    const segments = (pts.length - 1) * smooth(scene.chain);
    ctx.strokeStyle = model.search?.found ? INK.chain : INK.shadow;
    ctx.lineWidth = Math.max(3, v.s * 0.12);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length && i - 1 < segments; i++) {
      const f = clamp01(segments - (i - 1));
      ctx.lineTo(lerp(pts[i - 1]!.x, pts[i]!.x, f), lerp(pts[i - 1]!.y, pts[i]!.y, f));
    }
    ctx.stroke();
  }

  // The event being applied right now.
  const applying = events[Math.floor(scene.astar)];
  const frac = scene.astar - Math.floor(scene.astar);
  if (applying && frac > 0) {
    if (applying.kind === 'relax') {
      const a = point(applying.from);
      const b = point(applying.portal);
      const color = applying.outcome === 'skipped' ? INK.closed : INK.sight;
      ctx.strokeStyle = rgba(color, 0.7);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(lerp(a.x, b.x, frac), lerp(a.y, b.y, frac));
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(lerp(a.x, b.x, frac), lerp(a.y, b.y, frac), radius * 0.55, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const p = point(applying.portal);
      ctx.strokeStyle = rgba(INK.text, 1 - frac);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius + frac * v.s * 0.8, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  let current: number | null = null;
  for (let i = Math.min(events.length, Math.ceil(scene.astar)) - 1; i >= 0; i--) {
    const event = events[i]!;
    if (event.kind === 'pop') {
      current = event.portal;
      break;
    }
  }

  for (const portal of model.portals.values()) {
    const x = px(v, portal.x);
    const y = py(v, portal.y);
    const state = states.get(portal.id);
    const isChain = scene.chain > 0.5 && inChain.has(portal.id);
    const reach =
      scene.reach > 0 && (model.startPortals.includes(portal.id) || model.targetPortals.includes(portal.id));

    if (reach && !isChain) {
      const isStart = model.startPortals.includes(portal.id);
      ctx.strokeStyle = rgba(isStart ? INK.chain : INK.open, scene.reach);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, y, radius + 4 + Math.sin(now / 240) * 1.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    if (isChain) {
      ctx.fillStyle = model.search?.found ? INK.chain : INK.shadow;
    } else if (state?.closed) {
      ctx.fillStyle = INK.closed;
    } else if (state) {
      ctx.fillStyle = COLORS.bg;
    } else {
      ctx.fillStyle = searching ? '#2A3138' : INK.portal;
    }
    ctx.fill();
    if (state && !state.closed && !isChain) {
      ctx.strokeStyle = INK.open;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
    if (portal.id === current && scene.chain < 1) {
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, radius + 3 + Math.sin(now / 130) * 1.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (v.s >= 18 && alpha > 0.5) {
      text(
        ctx,
        String(portal.id),
        x,
        y + 0.5,
        Math.max(7.5, radius * 0.92),
        state && !state.closed && !isChain ? INK.open : COLORS.bg,
        'center',
        700,
      );
    }
    if (state && !state.closed && !isChain && scene.chain < 0.5 && v.s >= 22) {
      tag(ctx, `f ${state.f}`, x, y - radius - v.s * 0.28, Math.max(8.5, v.s * 0.24), INK.open);
    }
  }
  ctx.restore();
}

function drawRoute(ctx: CanvasRenderingContext2D, model: GuideModel, scene: Scene, v: View, now: number): void {
  if (scene.route > 0) {
    ctx.save();
    ctx.globalAlpha = scene.route;
    const size = SECTOR_SIZE * v.s;
    const seen = new Set<number>();
    for (const id of model.routeSectors) {
      const sector = model.sectors[id]!;
      ctx.strokeStyle = INK.chain;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(px(v, sector.ne) + 1, py(v, sector.se) + 1, size - 2, size - 2);
      if (!seen.has(id)) {
        seen.add(id);
        const label = model.routeSectors.flatMap((other, i) => (other === id ? [i + 1] : [])).join('+');
        tag(
          ctx,
          `#${label}`,
          px(v, sector.ne + SECTOR_SIZE) - v.s * 0.72,
          py(v, sector.se) + v.s * 0.4,
          Math.max(9, v.s * 0.3),
          INK.chain,
        );
      }
    }
    ctx.restore();
  }

  if (scene.walk <= 0 || model.waypoints.length < 2) {
    return;
  }
  const points = model.waypoints.map(w => ({ x: px(v, w.ne + 0.5), y: py(v, w.se + 0.5) }));
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
  const total = lengths.reduce((a, b) => a + b, 0);
  let budget = total * clamp01(scene.walk);
  let head = points[0]!;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = rgba(INK.sight, 0.25);
  ctx.lineWidth = Math.max(7, v.s * 0.3);
  const trace = () => {
    budget = total * clamp01(scene.walk);
    ctx.beginPath();
    ctx.moveTo(points[0]!.x, points[0]!.y);
    for (let i = 1; i < points.length && budget > 0; i++) {
      const f = Math.min(1, budget / lengths[i - 1]!);
      head = { x: lerp(points[i - 1]!.x, points[i]!.x, f), y: lerp(points[i - 1]!.y, points[i]!.y, f) };
      ctx.lineTo(head.x, head.y);
      budget -= lengths[i - 1]!;
    }
    ctx.stroke();
  };
  trace();
  ctx.strokeStyle = INK.sight;
  ctx.lineWidth = Math.max(2.5, v.s * 0.09);
  trace();

  let walked = total * clamp01(scene.walk);
  points.forEach((p, i) => {
    if (walked >= -0.01) {
      ctx.fillStyle = COLORS.bg;
      ctx.strokeStyle = INK.sight;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(3, v.s * 0.13), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    walked -= lengths[i] ?? 0;
  });

  if (scene.walk < 1 && scene.crowd === 0) {
    const pulse = 1 + Math.sin(now / 90) * 0.15;
    ctx.fillStyle = INK.chain;
    ctx.beginPath();
    ctx.arc(head.x, head.y, Math.max(5, v.s * 0.24) * pulse, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawCrowd(
  ctx: CanvasRenderingContext2D,
  model: GuideModel,
  scene: Scene,
  v: View,
  clock: number | null,
): void {
  if (scene.crowd <= 0 || model.units.length === 0) {
    return;
  }
  const longest = model.units.reduce((max, unit) => Math.max(max, unit.total), 1);
  const span = longest + 1.5;
  const travelled = clock === null ? scene.crowd * span : (clock * CROWD_LOOP_SPEED) % (span + 1);
  const position = (unit: (typeof model.units)[number], d: number) => {
    let i = 1;
    while (i < unit.cells.length - 1 && unit.dist[i]! < d) {
      i++;
    }
    const a = unit.cells[i - 1]!;
    const b = unit.cells[i]!;
    const span = unit.dist[i]! - unit.dist[i - 1]!;
    const f = span > 0 ? clamp01((d - unit.dist[i - 1]!) / span) : 1;
    return { x: lerp(a.ne, b.ne, f) + 0.5, y: lerp(a.se, b.se, f) + 0.5 };
  };

  ctx.save();
  model.units.forEach((unit, index) => {
    const d = Math.min(travelled, unit.total);
    const arrived = travelled >= unit.total;
    // A stable offset per unit keeps the crowd from collapsing into one dot.
    const angle = index * 2.399963;
    const spread = 0.26 * clamp01((unit.total - d) / 1.5);
    const ox = Math.cos(angle) * spread;
    const oy = Math.sin(angle) * spread;
    const here = position(unit, d);
    const trail = position(unit, Math.max(0, d - 1.1));

    if (!arrived) {
      ctx.strokeStyle = rgba(INK.chain, 0.32);
      ctx.lineWidth = Math.max(1.5, v.s * 0.09);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(px(v, trail.x + ox), py(v, trail.y + oy));
      ctx.lineTo(px(v, here.x + ox), py(v, here.y + oy));
      ctx.stroke();
    }
    ctx.fillStyle = arrived ? rgba(INK.chain, 0.28) : INK.chain;
    ctx.beginPath();
    ctx.arc(px(v, here.x + ox), py(v, here.y + oy), Math.max(2.4, v.s * (arrived ? 0.07 : 0.13)), 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

function drawCoords(ctx: CanvasRenderingContext2D, model: GuideModel, scene: Scene, v: View): void {
  if (scene.coords <= 0) {
    return;
  }
  const { start } = model.scenario;
  const sector = model.sectors[model.startSector]!;
  const cx = px(v, start.ne + 0.5);
  const cy = py(v, start.se + 0.5);
  const reveal = smooth(scene.coords);
  const size = SECTOR_SIZE * v.s;
  const fontSize = Math.max(9.5, v.s * 0.3);

  ctx.save();
  ctx.fillStyle = rgba(INK.chain, 0.13 * reveal);
  ctx.fillRect(px(v, sector.ne), py(v, sector.se), size, size);
  ctx.strokeStyle = rgba(INK.chain, reveal);
  ctx.lineWidth = 2.5;
  ctx.strokeRect(px(v, sector.ne), py(v, sector.se), size, size);

  ctx.strokeStyle = rgba(INK.sight, 0.8 * reveal);
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx, lerp(cy, py(v, 0), reveal));
  ctx.moveTo(cx, cy);
  ctx.lineTo(lerp(cx, px(v, 0), reveal), cy);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.globalAlpha = reveal;
  tag(ctx, `ne ${start.ne}`, cx, py(v, 0) + fontSize * 0.2, fontSize, INK.sight);
  tag(ctx, `se ${start.se}`, px(v, 0) + fontSize * 2.1, cy, fontSize, INK.sight);
  tag(
    ctx,
    `S${sector.id} · local (${start.ne - sector.ne}, ${start.se - sector.se})`,
    px(v, sector.ne) + size / 2,
    py(v, sector.se + SECTOR_SIZE) - fontSize,
    fontSize,
    INK.chain,
  );
  ctx.restore();
}

function drawPins(
  ctx: CanvasRenderingContext2D,
  model: GuideModel,
  scene: Scene,
  v: View,
  now: number,
  ghost: boolean,
) {
  const alpha = Math.max(scene.pins, ghost ? 0.75 : 0);
  if (alpha <= 0) {
    return;
  }
  const { start, target } = model.scenario;
  const pop = scene.pins > 0 ? 1 + Math.sin(clamp01(scene.pins) * Math.PI) * 0.5 : 1;
  const radius = Math.max(6.5, v.s * 0.34) * pop;

  ctx.save();
  ctx.globalAlpha = alpha;

  const tx = px(v, target.ne + 0.5);
  const ty = py(v, target.se + 0.5);
  for (let i = 0; i < 2; i++) {
    const wave = (((now / 1500 + i / 2) % 1) + 1) % 1;
    ctx.strokeStyle = rgba(INK.open, (1 - wave) * 0.7);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(tx, ty, radius + wave * v.s * 0.9, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = INK.open;
  ctx.beginPath();
  ctx.arc(tx, ty, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COLORS.bg;
  ctx.beginPath();
  ctx.arc(tx, ty, radius * 0.62, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = INK.open;
  ctx.beginPath();
  ctx.arc(tx, ty, radius * 0.3, 0, Math.PI * 2);
  ctx.fill();

  const sx = px(v, start.ne + 0.5);
  const sy = py(v, start.se + 0.5);
  ctx.fillStyle = INK.chain;
  ctx.beginPath();
  ctx.arc(sx, sy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = COLORS.bg;
  ctx.lineWidth = 2;
  ctx.stroke();
  text(ctx, 'S', sx, sy + 0.5, radius * 1.05, COLORS.bg, 'center', 800);
  ctx.restore();
}

function drawHover(ctx: CanvasRenderingContext2D, hover: Cell | null, v: View): void {
  if (!hover) {
    return;
  }
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(px(v, hover.ne) + 0.75, py(v, hover.se) + 0.75, v.s - 1.5, v.s - 1.5);
}

/** Dims everything around the sector the camera is focused on. */
function drawSpotlight(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  width: number,
  height: number,
  camera: Box,
  v: View,
): void {
  const goal = scene.camera;
  const strength = clamp01((16 - camera.w) / 6);
  if (strength <= 0 || goal.w > 12) {
    return;
  }
  const size = SECTOR_SIZE * v.s;
  ctx.fillStyle = `rgba(13, 17, 20, ${0.66 * strength})`;
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.rect(px(v, goal.x + 1.3), py(v, goal.y + 1.3), size, size);
  ctx.fill('evenodd');
}

export function drawGuide(ctx: CanvasRenderingContext2D, model: GuideModel, input: DrawInput): void {
  const { width, height, camera, scene, now, hover, ghostPins, crowdClock } = input;
  const v = makeView(width, height, camera);
  ctx.save();
  drawBackdrop(ctx, width, height, v);
  drawStrip(ctx, model, scene, v);
  drawCells(ctx, model, scene, v);
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
