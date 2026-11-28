import {
  COST_IMPASSABLE,
  COST_MIN,
  FLOW_DIR_MASK,
  FLOW_LOS_MASK,
  FLOW_PATHABLE_MASK,
} from '@leptoquark1/openage-pfadfinder';
import { COLORS, TERRAIN_COLORS } from '../../theme.js';
import {
  cornerHeights,
  fitIso,
  type IsoProjection,
  pickSurface,
  project,
  type ScreenPoint,
  surfaceHeight,
} from '../../view/iso.js';
import { BRUSH_RADIUS, MAX_HEIGHT } from '../../world/elevation.js';
import { terrainByCost } from '../../world/terrain.js';
import { CELL_SIZE, MOB_RADIUS, SECTOR_SIZE, type World } from '../../world/world.js';
import { FLOW_VECTORS, type Preview, PREVIEW_BAD, PREVIEW_OK } from '../PathfinderCanvas.js';

type Rgb = readonly [number, number, number];

const WALL_BLOCK_TILES = 0.45;
const OBSTACLE_BLOCK_TILES = 0.35;
const SKIRT_TILES = 0.6;
const TERRAIN_MIX = 0.45;
const CLIFF_MIX = 0.6;
const SHADE_PER_HEIGHT = 0.02;
const SHADE_MIN = 0.5;
const SHADE_MAX = 1.5;

export class IsoRenderer {
  private projection: IsoProjection = fitIso(1, 1, 1, 1);
  private corners: Float32Array = new Float32Array(4);
  private readonly ground = document.createElement('canvas');
  private groundKey = '';

  pick(world: World, width: number, height: number, screen: ScreenPoint): ScreenPoint | null {
    this.sync(world, width, height);
    const hit = pickSurface(this.projection, this.corners, world.getCols(), world.getRows(), screen);
    return hit ? { x: hit.u * CELL_SIZE, y: hit.v * CELL_SIZE } : null;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    world: World,
    width: number,
    height: number,
    showFlow: boolean,
    showTraces: boolean,
    preview: Preview | null,
  ): void {
    this.sync(world, width, height);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(this.ground, 0, 0, width, height);

    if (showFlow) {
      this.drawFlowField(ctx, world);
    }
    this.drawObstacles(ctx, world);
    this.drawTarget(ctx, world);
    if (showTraces) {
      this.drawPatrolRoutes(ctx, world);
      this.drawTraces(ctx, world);
    }
    this.drawMobs(ctx, world);
    if (preview) {
      this.drawPreview(ctx, world, preview);
    }
  }

  private sync(world: World, width: number, height: number): void {
    const cols = world.getCols();
    const rows = world.getRows();
    const key = `${world.getGroundVersion()}:${cols}:${rows}:${width}:${height}:${devicePixelRatio}`;
    if (key === this.groundKey || cols === 0 || rows === 0) {
      return;
    }
    this.groundKey = key;
    this.projection = fitIso(cols, rows, width, height);
    this.corners = cornerHeights(world.getHeight(), cols, rows);
    this.renderGround(world, width, height);
  }

  private at(world: World, u: number, v: number, lift = 0): ScreenPoint {
    const h = surfaceHeight(this.corners, world.getCols(), world.getRows(), u, v);
    const point = project(this.projection, u, v, h);
    return { x: point.x, y: point.y - lift };
  }

  private cellQuad(world: World, ne: number, se: number, lift = 0): ScreenPoint[] {
    return [
      this.at(world, ne, se, lift),
      this.at(world, ne + 1, se, lift),
      this.at(world, ne + 1, se + 1, lift),
      this.at(world, ne, se + 1, lift),
    ];
  }

  private renderGround(world: World, width: number, height: number): void {
    this.ground.width = Math.round(width * devicePixelRatio);
    this.ground.height = Math.round(height * devicePixelRatio);
    const ctx = this.ground.getContext('2d')!;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const cols = world.getCols();
    const rows = world.getRows();
    const walls = world.getStaticCost();
    const wallLift = this.projection.tileW * WALL_BLOCK_TILES;
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = COLORS.grid;

    for (let sum = 0; sum <= cols + rows - 2; sum++) {
      for (let ne = Math.max(0, sum - rows + 1); ne <= Math.min(cols - 1, sum); ne++) {
        const se = sum - ne;
        const quad = this.cellQuad(world, ne, se);
        fillPolygon(ctx, quad, toCss(this.cellColor(world, ne, se)));
        ctx.stroke();
        if (walls[ne + se * cols] === COST_IMPASSABLE) {
          drawBlock(ctx, quad, wallLift, hexToRgb(COLORS.obstacle));
        }
      }
    }
    this.drawSkirts(ctx, world);
  }

  private cellColor(world: World, ne: number, se: number): Rgb {
    const cols = world.getCols();
    const idx = ne + se * cols;
    const stride = cols + 1;
    const c00 = this.corners[ne + se * stride]!;
    const c10 = this.corners[ne + 1 + se * stride]!;
    const c01 = this.corners[ne + (se + 1) * stride]!;
    const c11 = this.corners[ne + 1 + (se + 1) * stride]!;

    let color = mix(hexToRgb(COLORS.groundLow), hexToRgb(COLORS.groundHigh), world.getHeight()[idx]! / MAX_HEIGHT);
    const terrain = terrainByCost(world.getTerrain()[idx]!);
    if (terrain && world.getTerrain()[idx] !== COST_MIN) {
      color = mix(color, hexToRgb(TERRAIN_COLORS[terrain.id]), TERRAIN_MIX);
    }
    if (world.isCliffCell(ne, se)) {
      color = mix(color, hexToRgb(COLORS.cliff), CLIFF_MIX);
    }
    const rise = (c10 + c11 - c00 - c01) / 2 + (c01 + c11 - c00 - c10) / 2;
    return scale(color, Math.min(SHADE_MAX, Math.max(SHADE_MIN, 1 + rise * SHADE_PER_HEIGHT)));
  }

  private drawSkirts(ctx: CanvasRenderingContext2D, world: World): void {
    const cols = world.getCols();
    const rows = world.getRows();
    const drop = this.projection.tileW * SKIRT_TILES;
    const skirt = hexToRgb(COLORS.skirt);
    for (let ne = 0; ne < cols; ne++) {
      const a = this.at(world, ne, rows);
      const b = this.at(world, ne + 1, rows);
      fillPolygon(ctx, [a, b, { x: b.x, y: b.y + drop }, { x: a.x, y: a.y + drop }], toCss(scale(skirt, 1.3)));
    }
    for (let se = 0; se < rows; se++) {
      const a = this.at(world, cols, se);
      const b = this.at(world, cols, se + 1);
      fillPolygon(ctx, [a, b, { x: b.x, y: b.y + drop }, { x: a.x, y: a.y + drop }], toCss(skirt));
    }
  }

  private drawFlowField(ctx: CanvasRenderingContext2D, world: World): void {
    const grid = world.getGrid();
    const fields = world.getFlowOverlay();
    if (!grid || fields.size === 0) {
      return;
    }
    const strong = new Path2D();
    const weak = new Path2D();
    for (const sector of grid.getSectors()) {
      const cells = fields.get(sector.getId());
      if (!cells) {
        continue;
      }
      const position = sector.getPosition();
      for (let y = 0; y < SECTOR_SIZE; y++) {
        for (let x = 0; x < SECTOR_SIZE; x++) {
          const cell = cells[x + y * SECTOR_SIZE]!;
          if ((cell & FLOW_PATHABLE_MASK) === 0) {
            continue;
          }
          const [dx, dy] = FLOW_VECTORS[cell & FLOW_DIR_MASK] ?? [0, 0];
          const u = position.x * SECTOR_SIZE + x + 0.5;
          const v = position.y * SECTOR_SIZE + y + 0.5;
          const from = this.at(world, u - dx * 0.2, v - dy * 0.2);
          const to = this.at(world, u + dx * 0.25, v + dy * 0.25);
          const path = (cell & FLOW_LOS_MASK) !== 0 ? strong : weak;
          path.moveTo(from.x, from.y);
          path.lineTo(to.x, to.y);
        }
      }
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = COLORS.flow;
    ctx.stroke(weak);
    ctx.strokeStyle = COLORS.flowStrong;
    ctx.stroke(strong);
  }

  private drawObstacles(ctx: CanvasRenderingContext2D, world: World): void {
    const lift = this.projection.tileW * OBSTACLE_BLOCK_TILES;
    const color = hexToRgb(COLORS.obstacleMoving);
    const sorted = [...world.getObstacles()].sort((a, b) => a.x + a.y - (b.x + b.y));
    for (const o of sorted) {
      const u = o.x / CELL_SIZE;
      const v = o.y / CELL_SIZE;
      const half = o.size / CELL_SIZE / 2;
      const base = surfaceHeight(this.corners, world.getCols(), world.getRows(), u, v);
      const quad = [
        project(this.projection, u - half, v - half, base),
        project(this.projection, u + half, v - half, base),
        project(this.projection, u + half, v + half, base),
        project(this.projection, u - half, v + half, base),
      ];
      drawBlock(ctx, quad, lift, color);
    }
  }

  private drawTarget(ctx: CanvasRenderingContext2D, world: World): void {
    const target = world.getTarget();
    if (!target) {
      return;
    }
    const center = this.at(world, target.ne + 0.5, target.se + 0.5);
    const radius = this.projection.tileW * (0.3 + Math.sin(world.getElapsedMs() * 0.005) * 0.08);
    ctx.strokeStyle = COLORS.target;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(center.x, center.y, radius, radius / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = COLORS.target;
    ctx.beginPath();
    ctx.ellipse(center.x, center.y, radius / 3, radius / 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawPatrolRoutes(ctx: CanvasRenderingContext2D, world: World): void {
    ctx.strokeStyle = COLORS.obstacleMoving;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    for (const o of world.getObstacles()) {
      if (!o.patrol) {
        continue;
      }
      const a = this.at(world, o.patrol.ax / CELL_SIZE, o.patrol.ay / CELL_SIZE);
      const b = this.at(world, o.patrol.bx / CELL_SIZE, o.patrol.by / CELL_SIZE);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  private drawTraces(ctx: CanvasRenderingContext2D, world: World): void {
    ctx.strokeStyle = COLORS.mob;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    for (const mob of world.getMobs()) {
      if (mob.trace.length < 2) {
        continue;
      }
      ctx.beginPath();
      const start = this.at(world, mob.x / CELL_SIZE, mob.y / CELL_SIZE);
      ctx.moveTo(start.x, start.y);
      for (let i = 1; i < mob.trace.length; i++) {
        const cell = mob.trace[i]!;
        const point = this.at(world, cell.ne + 0.5, cell.se + 0.5);
        ctx.lineTo(point.x, point.y);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  private drawMobs(ctx: CanvasRenderingContext2D, world: World): void {
    const radius = Math.max(3, (MOB_RADIUS / CELL_SIZE) * this.projection.tileW * 0.6);
    const sorted = [...world.getMobs()].sort((a, b) => a.x + a.y - (b.x + b.y));
    for (const mob of sorted) {
      const foot = this.at(world, mob.x / CELL_SIZE, mob.y / CELL_SIZE);
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = COLORS.bg;
      ctx.beginPath();
      ctx.ellipse(foot.x, foot.y, radius, radius / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = mob.blocked ? 0.4 : 1;
      ctx.fillStyle = COLORS.mob;
      ctx.beginPath();
      ctx.arc(foot.x, foot.y - radius, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawPreview(ctx: CanvasRenderingContext2D, world: World, preview: Preview): void {
    ctx.lineWidth = 2;
    const candidate = preview.eraseCandidate;
    if (candidate) {
      ctx.strokeStyle = PREVIEW_BAD;
      const ne = 'ne' in candidate ? candidate.ne : Math.floor(candidate.x / CELL_SIZE);
      const se = 'ne' in candidate ? candidate.se : Math.floor(candidate.y / CELL_SIZE);
      strokePolygon(ctx, this.cellQuad(world, ne, se));
      return;
    }
    ctx.strokeStyle = preview.valid ? PREVIEW_OK : PREVIEW_BAD;
    const u = preview.x / CELL_SIZE;
    const v = preview.y / CELL_SIZE;
    if (preview.mode === 'elevation') {
      const center = this.at(world, u, v);
      const radius = (BRUSH_RADIUS * this.projection.tileW) / Math.SQRT2;
      ctx.beginPath();
      ctx.ellipse(center.x, center.y, radius, radius / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }
    strokePolygon(ctx, this.cellQuad(world, Math.floor(u), Math.floor(v)));
  }
}

function fillPolygon(ctx: CanvasRenderingContext2D, points: readonly ScreenPoint[], color: string): void {
  tracePolygon(ctx, points);
  ctx.fillStyle = color;
  ctx.fill();
}

function strokePolygon(ctx: CanvasRenderingContext2D, points: readonly ScreenPoint[]): void {
  tracePolygon(ctx, points);
  ctx.stroke();
}

function tracePolygon(ctx: CanvasRenderingContext2D, points: readonly ScreenPoint[]): void {
  ctx.beginPath();
  ctx.moveTo(points[0]!.x, points[0]!.y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i]!.x, points[i]!.y);
  }
  ctx.closePath();
}

function drawBlock(ctx: CanvasRenderingContext2D, base: readonly ScreenPoint[], lift: number, color: Rgb): void {
  const top = base.map(point => ({ x: point.x, y: point.y - lift }));
  fillPolygon(ctx, [base[1]!, base[2]!, top[2]!, top[1]!], toCss(scale(color, 0.6)));
  fillPolygon(ctx, [base[3]!, base[2]!, top[2]!, top[3]!], toCss(scale(color, 0.75)));
  fillPolygon(ctx, top, toCss(color));
}

function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function mix(from: Rgb, to: Rgb, t: number): Rgb {
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t];
}

function scale(color: Rgb, factor: number): Rgb {
  return [color[0] * factor, color[1] * factor, color[2] * factor];
}

function toCss(color: Rgb): string {
  const channel = (value: number) => Math.round(Math.min(255, Math.max(0, value)));
  return `rgb(${channel(color[0])}, ${channel(color[1])}, ${channel(color[2])})`;
}
