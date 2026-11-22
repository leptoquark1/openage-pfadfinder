import { COST_IMPASSABLE, COST_MIN } from '@leptoquark1/openage-pfadfinder/shared';
import { COLORS } from '../../../theme.js';
import type { View } from '../../layout.js';
import type { GuideModel } from '../../model/types.js';
import { COLS, ROWS, SECTOR_SIZE, SECTORS_X } from '../../scenarios.js';
import type { Scene } from '../../story/scene.js';
import { INK } from '../ink.js';
import { clamp01, lerp, px, py, rgba, smooth, text } from '../primitives.js';

const STRIP_Y = -1.9;

const TAPE_Y = -4.15;

export function drawBackdrop(ctx: CanvasRenderingContext2D, width: number, height: number, v: View): void {
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

export function drawStrip(ctx: CanvasRenderingContext2D, model: GuideModel, scene: Scene, v: View): void {
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

export function drawCells(
  ctx: CanvasRenderingContext2D,
  model: GuideModel,
  scene: Scene,
  v: View,
  costLabels: boolean,
): void {
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
      if (costLabels && !folding && v.s >= 26 && !covered.has(sector)) {
        costLabel(ctx, costs[idx]!, px(v, x), py(v, y), v.s);
      }
    }
  }
  ctx.globalAlpha = 1;
}

function costLabel(ctx: CanvasRenderingContext2D, cost: number, x: number, y: number, size: number): void {
  const color = cost === COST_IMPASSABLE ? rgba(INK.wallTop, 0.8) : cost > 1 ? INK.sight : 'rgba(138,149,161,0.42)';
  text(ctx, String(cost), x + size / 2, y + size / 2, size * (cost > 99 ? 0.27 : 0.32), color);
}

/** Only the cells that differ from free ground. */
export function drawTerrain(ctx: CanvasRenderingContext2D, model: GuideModel, v: View): void {
  const { costs } = model.scenario;
  for (let se = 0; se < ROWS; se++) {
    for (let ne = 0; ne < COLS; ne++) {
      const cost = costs[ne + se * COLS]!;
      if (cost !== COST_MIN) {
        paintCell(ctx, px(v, ne), py(v, se), v.s, v.s, cost, false);
      }
    }
  }
}
