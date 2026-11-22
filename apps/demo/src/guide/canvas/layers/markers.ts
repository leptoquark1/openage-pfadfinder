import { COLORS } from '../../../theme.js';
import type { View } from '../../layout.js';
import type { GuideModel } from '../../model/types.js';
import { type Cell, SECTOR_SIZE } from '../../scenarios.js';
import type { Box, Scene } from '../../story/scene.js';
import { INK } from '../ink.js';
import { clamp01, disc, lerp, px, py, rgba, ring, smooth, tag, text } from '../primitives.js';

export function drawCoords(ctx: CanvasRenderingContext2D, model: GuideModel, scene: Scene, v: View): void {
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

export function drawPins(
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
    ring(ctx, tx, ty, radius + wave * v.s * 0.9);
  }
  ctx.fillStyle = INK.open;
  disc(ctx, tx, ty, radius);
  ctx.fillStyle = COLORS.bg;
  disc(ctx, tx, ty, radius * 0.62);
  ctx.fillStyle = INK.open;
  disc(ctx, tx, ty, radius * 0.3);

  const sx = px(v, start.ne + 0.5);
  const sy = py(v, start.se + 0.5);
  ctx.fillStyle = INK.chain;
  disc(ctx, sx, sy, radius);
  ctx.strokeStyle = COLORS.bg;
  ctx.lineWidth = 2;
  ctx.stroke();
  text(ctx, 'S', sx, sy + 0.5, radius * 1.05, COLORS.bg, 'center', 800);
  ctx.restore();
}

export function drawHover(ctx: CanvasRenderingContext2D, hover: Cell | null, v: View): void {
  if (!hover) {
    return;
  }
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(px(v, hover.ne) + 0.75, py(v, hover.se) + 0.75, v.s - 1.5, v.s - 1.5);
}

/** Dims everything around the sector the camera is focused on. */
export function drawSpotlight(
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
