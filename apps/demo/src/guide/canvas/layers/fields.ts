import {
  FLOW_PATHABLE_MASK,
  INTEGRATE_LOS_MASK,
  INTEGRATE_TARGET_MASK,
  INTEGRATE_WAVEFRONT_BLOCKED_MASK,
  INTEGRATED_COST_UNREACHABLE,
} from '@leptoquark1/openage-pfadfinder/shared';
import type { View } from '../../layout.js';
import { flowDirection } from '../../model/fields.js';
import type { GuideModel } from '../../model/types.js';
import { replayField } from '../../observe.js';
import { SECTOR_SIZE } from '../../scenarios.js';
import type { Scene } from '../../story/scene.js';
import { INK } from '../ink.js';
import { clamp01, flowArrow, heat, px, py, rgba, text } from '../primitives.js';

export function drawFields(ctx: CanvasRenderingContext2D, model: GuideModel, scene: Scene, v: View, now: number): void {
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
        if (flowDirection(field, byte) !== null) {
          const cy = y + v.s / 2 + (v.s >= 44 ? v.s * 0.07 : 0);
          flowArrow(ctx, byte, x + v.s / 2, cy, v.s, `rgba(255,255,255,${0.86 * faded})`);
        }
      } else if ((flags & INTEGRATE_TARGET_MASK) !== 0 && field.kind === 'portal') {
        ctx.strokeStyle = INK.portal;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 2, y + 2, v.s - 4, v.s - 4);
      }
    }
  });
}
