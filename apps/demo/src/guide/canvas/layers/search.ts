import { COLORS } from '../../../theme.js';
import type { View } from '../../layout.js';
import type { GuideModel, PortalView } from '../../model/types.js';
import type { AStarNodeState } from '../../observe.js';
import type { Cell } from '../../scenarios.js';
import type { Scene } from '../../story/scene.js';
import { INK } from '../ink.js';
import {
  cellCenter,
  chainPoints,
  clamp01,
  disc,
  lerp,
  type Point,
  portalPoint,
  px,
  py,
  rgba,
  ring,
  segment,
  smooth,
  strokePartial,
  tag,
  text,
} from '../primitives.js';

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

/** What every part of the graph needs for one frame. */
interface GraphPass {
  readonly ctx: CanvasRenderingContext2D;
  readonly model: GuideModel;
  readonly scene: Scene;
  readonly v: View;
  readonly now: number;
  readonly alpha: number;
  readonly states: ReadonlyMap<number, AStarNodeState>;
  readonly searching: boolean;
  readonly radius: number;
  readonly point: (id: number) => Point;
}

function drawLinks({ ctx, model, v, searching, point }: GraphPass, hovered: PortalView | null): void {
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

  if (!hovered) {
    return;
  }
  for (const edge of model.graphEdges) {
    if (edge.a !== hovered.id && edge.b !== hovered.id) {
      continue;
    }
    const a = point(edge.a);
    const b = point(edge.b);
    ctx.strokeStyle = INK.sight;
    ctx.lineWidth = 2;
    segment(ctx, a.x, a.y, b.x, b.y);
    tag(ctx, String(edge.cost), (a.x + b.x) / 2, (a.y + b.y) / 2, Math.max(9, v.s * 0.28), INK.sight);
  }
}

/** Each reached node points back to where it was reached from. */
function drawSearchTree({ ctx, v, states, point }: GraphPass): void {
  ctx.lineWidth = Math.max(1.5, v.s * 0.06);
  for (const state of states.values()) {
    if (state.prev === null) {
      continue;
    }
    const a = point(state.prev);
    const b = point(state.id);
    ctx.strokeStyle = rgba(state.closed ? INK.closed : INK.open, state.closed ? 0.8 : 0.72);
    segment(ctx, a.x, a.y, b.x, b.y);
  }
}

/** Seeds start at the unit itself. */
function drawSeedLines({ ctx, model, v, states, point }: GraphPass): void {
  const from = cellCenter(v, model.scenario.start);
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

function drawChain({ ctx, model, scene, v }: GraphPass): void {
  ctx.strokeStyle = model.search?.found ? INK.chain : INK.shadow;
  ctx.lineWidth = Math.max(3, v.s * 0.12);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  strokePartial(ctx, chainPoints(model, v), smooth(scene.chain));
}

/** The event being applied right now. */
function drawAppliedEvent({ ctx, model, scene, v, radius, point }: GraphPass): void {
  const applying = model.search?.events[Math.floor(scene.astar)];
  const frac = scene.astar - Math.floor(scene.astar);
  if (!applying || frac <= 0) {
    return;
  }
  if (applying.kind === 'relax') {
    const a = point(applying.from);
    const b = point(applying.portal);
    const color = applying.outcome === 'skipped' ? INK.closed : INK.sight;
    ctx.strokeStyle = rgba(color, 0.7);
    ctx.lineWidth = 2;
    segment(ctx, a.x, a.y, lerp(a.x, b.x, frac), lerp(a.y, b.y, frac));
    ctx.fillStyle = color;
    disc(ctx, lerp(a.x, b.x, frac), lerp(a.y, b.y, frac), radius * 0.55);
  } else {
    const p = point(applying.portal);
    ctx.strokeStyle = rgba(INK.text, 1 - frac);
    ctx.lineWidth = 2;
    ring(ctx, p.x, p.y, radius + frac * v.s * 0.8);
  }
}

/** The portal the search popped last. */
function expandingPortal(model: GuideModel, astar: number): number | null {
  const events = model.search?.events ?? [];
  for (let i = Math.min(events.length, Math.ceil(astar)) - 1; i >= 0; i--) {
    const event = events[i]!;
    if (event.kind === 'pop') {
      return event.portal;
    }
  }
  return null;
}

function drawNode(pass: GraphPass, portal: PortalView, inChain: boolean, expanding: boolean): void {
  const { ctx, model, scene, v, now, alpha, states, searching, radius } = pass;
  const x = px(v, portal.x);
  const y = py(v, portal.y);
  const state = states.get(portal.id);
  const isChain = scene.chain > 0.5 && inChain;
  const reach = scene.reach > 0 && (model.startPortals.includes(portal.id) || model.targetPortals.includes(portal.id));

  if (reach && !isChain) {
    const isStart = model.startPortals.includes(portal.id);
    ctx.strokeStyle = rgba(isStart ? INK.chain : INK.open, scene.reach);
    ctx.lineWidth = 2.5;
    ring(ctx, x, y, radius + 4 + Math.sin(now / 240) * 1.5);
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
  if (expanding && scene.chain < 1) {
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ring(ctx, x, y, radius + 3 + Math.sin(now / 130) * 1.5);
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
  const searching = scene.astar > 0;
  const chain = model.search?.chain ?? [];
  const pass: GraphPass = {
    ctx,
    model,
    scene,
    v,
    now,
    alpha,
    states: searchStates(model, scene),
    searching,
    radius: Math.max(4, v.s * 0.2),
    point: id => portalPoint(model, v, id),
  };

  ctx.save();
  ctx.globalAlpha = alpha;
  drawLinks(pass, scene.graph > 0.5 ? hoveredPortal(model, hover) : null);
  if (scene.chain < 1) {
    drawSearchTree(pass);
    if (searching) {
      drawSeedLines(pass);
    }
  }
  if (scene.chain > 0 && chain.length > 0) {
    drawChain(pass);
  }
  drawAppliedEvent(pass);

  const inChain = new Set(chain);
  const expanding = expandingPortal(model, scene.astar);
  for (const portal of model.portals.values()) {
    drawNode(pass, portal, inChain.has(portal.id), portal.id === expanding);
  }
  ctx.restore();
}
