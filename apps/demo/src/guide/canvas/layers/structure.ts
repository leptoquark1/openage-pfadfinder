import type { View } from '../../layout.js';
import type { GuideModel } from '../../model/types.js';
import { type Cell, SECTOR_SIZE } from '../../scenarios.js';
import type { Scene } from '../../story/scene.js';
import { AREA_COLORS, INK } from '../ink.js';
import { clamp01, px, py, rgba, smooth, tag, text } from '../primitives.js';

export function drawFrames(ctx: CanvasRenderingContext2D, model: GuideModel, scene: Scene, v: View, now: number): void {
  if (scene.frames <= 0) {
    return;
  }
  const size = SECTOR_SIZE * v.s;
  const active = scene.slicing;
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

export function drawAreas(ctx: CanvasRenderingContext2D, model: GuideModel, scene: Scene, v: View): void {
  // Areas belong to the build phase; the graph replaces them for good.
  const fade = 1 - clamp01(Math.max(scene.graph * 1.6, scene.pins));
  if (scene.areas <= 0 || fade <= 0) {
    return;
  }
  ctx.save();
  for (const sector of model.sectors) {
    if (sector.id >= scene.areas) {
      continue;
    }
    const current = sector.id === scene.labelling;
    const progress = clamp01(scene.areas - sector.id);
    const reveal = current ? (sector.floodMax + 1) * smooth(clamp01(progress / 0.75)) : Number.POSITIVE_INFINITY;
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
    const links = current ? clamp01((progress - 0.65) / 0.35) : 0.6;
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

export function drawPortals(
  ctx: CanvasRenderingContext2D,
  model: GuideModel,
  scene: Scene,
  v: View,
  now: number,
): void {
  if (scene.edges <= 0) {
    return;
  }
  const quiet = 1 - clamp01(Math.max(scene.graph, scene.pins)) * 0.7;

  ctx.save();
  model.edges.forEach((edge, i) => {
    if (i >= scene.edges) {
      return;
    }
    const scanning = i === scene.scanning;
    const sweep = clamp01(scene.edges - i) * SECTOR_SIZE;

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
      const glow = sweep < SECTOR_SIZE ? 0.6 + 0.4 * Math.sin(now / 60) : 0.85;
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
