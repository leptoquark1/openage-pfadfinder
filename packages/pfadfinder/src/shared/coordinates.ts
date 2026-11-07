import type { TileDelta } from './types.js';

export function tileToIndex(delta: TileDelta, size: number): number {
  return delta.ne + delta.se * size;
}

export function xyToIndex(x: number, y: number, size: number): number {
  return x + y * size;
}

export function indexToX(idx: number, size: number): number {
  return idx % size;
}

export function indexToY(idx: number, size: number): number {
  return Math.floor(idx / size);
}

export function makeTileDelta(ne: number, se: number): TileDelta {
  return { ne, se };
}

export function tileDistance(a: TileDelta, b: TileDelta): number {
  return Math.abs(a.ne - b.ne) + Math.abs(a.se - b.se);
}

export function tileEuclidean(a: TileDelta, b: TileDelta): number {
  const dx = a.ne - b.ne;
  const dy = a.se - b.se;
  return Math.sqrt(dx * dx + dy * dy);
}
