import { COST_IMPASSABLE } from '@leptoquark1/openage-pfadfinder';

export const MAX_HEIGHT = 255;
export const SLOPE_STEP = 8;
export const CLIFF_SLOPE = 64;
export const BRUSH_RADIUS = 3;
export const BRUSH_STRENGTH = 24;

const NOISE_OCTAVES = [
  { period: 16, amplitude: 1 },
  { period: 8, amplitude: 0.5 },
  { period: 4, amplitude: 0.25 },
];
const GENERATED_HEIGHT_RANGE = 200;

export interface CellRect {
  readonly minNe: number;
  readonly minSe: number;
  readonly maxNe: number;
  readonly maxSe: number;
}

export function slopeAt(height: Uint8Array, cols: number, rows: number, idx: number): number {
  const ne = idx % cols;
  const se = (idx - ne) / cols;
  const own = height[idx]!;
  let slope = 0;
  if (ne > 0) {
    slope = Math.max(slope, Math.abs(own - height[idx - 1]!));
  }
  if (ne < cols - 1) {
    slope = Math.max(slope, Math.abs(own - height[idx + 1]!));
  }
  if (se > 0) {
    slope = Math.max(slope, Math.abs(own - height[idx - cols]!));
  }
  if (se < rows - 1) {
    slope = Math.max(slope, Math.abs(own - height[idx + cols]!));
  }
  return slope;
}

export function isCliff(slope: number): boolean {
  return slope > CLIFF_SLOPE;
}

export function slopeCost(slope: number): number {
  return isCliff(slope) ? COST_IMPASSABLE : Math.floor(slope / SLOPE_STEP);
}

export function applyBrush(
  height: Uint8Array,
  cols: number,
  rows: number,
  centerNe: number,
  centerSe: number,
  delta: number,
): CellRect {
  const rect = {
    minNe: Math.max(0, centerNe - BRUSH_RADIUS),
    minSe: Math.max(0, centerSe - BRUSH_RADIUS),
    maxNe: Math.min(cols - 1, centerNe + BRUSH_RADIUS),
    maxSe: Math.min(rows - 1, centerSe + BRUSH_RADIUS),
  };
  for (let se = rect.minSe; se <= rect.maxSe; se++) {
    for (let ne = rect.minNe; ne <= rect.maxNe; ne++) {
      const distance = Math.hypot(ne - centerNe, se - centerSe);
      if (distance > BRUSH_RADIUS) {
        continue;
      }
      const falloff = 0.5 * (1 + Math.cos((Math.PI * distance) / BRUSH_RADIUS));
      const idx = ne + se * cols;
      height[idx] = Math.min(MAX_HEIGHT, Math.max(0, Math.round(height[idx]! + delta * falloff)));
    }
  }
  return rect;
}

export function generateHeights(cols: number, rows: number, random: () => number): Uint8Array {
  const noise = new Float32Array(cols * rows);
  let amplitudeSum = 0;
  for (const { period, amplitude } of NOISE_OCTAVES) {
    amplitudeSum += amplitude;
    const latticeCols = Math.ceil(cols / period) + 2;
    const latticeRows = Math.ceil(rows / period) + 2;
    const lattice = Float32Array.from({ length: latticeCols * latticeRows }, () => random());
    for (let se = 0; se < rows; se++) {
      const v = se / period;
      const row = Math.floor(v);
      const fv = smoothstep(v - row);
      for (let ne = 0; ne < cols; ne++) {
        const u = ne / period;
        const col = Math.floor(u);
        const fu = smoothstep(u - col);
        const top = lerp(lattice[col + row * latticeCols]!, lattice[col + 1 + row * latticeCols]!, fu);
        const bottom = lerp(lattice[col + (row + 1) * latticeCols]!, lattice[col + 1 + (row + 1) * latticeCols]!, fu);
        const idx = ne + se * cols;
        noise[idx] = noise[idx]! + lerp(top, bottom, fv) * amplitude;
      }
    }
  }
  return Uint8Array.from(noise, value => Math.round((value / amplitudeSum) * GENERATED_HEIGHT_RANGE));
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}
