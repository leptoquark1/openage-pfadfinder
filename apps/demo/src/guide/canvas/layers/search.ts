import { COLORS } from '../../../theme.js';
import type { View } from '../../layout.js';
import type { GuideModel, PortalView } from '../../model/types.js';
import type { AStarNodeState } from '../../observe.js';
import type { Cell } from '../../scenarios.js';
import type { Scene } from '../../story/scene.js';
import { INK } from '../ink.js';
import { clamp01, lerp, px, py, rgba, smooth, tag, text } from '../primitives.js';

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

export function drawGraph(
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
