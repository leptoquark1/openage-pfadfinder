import { COLORS } from '../../../theme.js';
import type { View } from '../../layout.js';
import type { GuideModel } from '../../model/types.js';
import { SECTOR_SIZE } from '../../scenarios.js';
import type { Scene } from '../../story/scene.js';
import { INK } from '../ink.js';
import { clamp01, lerp, px, py, rgba, tag } from '../primitives.js';

/** Cells per second of the crowd looping after the story ended. */
const CROWD_LOOP_SPEED = 4.5;

export function drawRoute(ctx: CanvasRenderingContext2D, model: GuideModel, scene: Scene, v: View, now: number): void {
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

export function drawCrowd(
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
