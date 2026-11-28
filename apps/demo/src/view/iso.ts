import { MAX_HEIGHT } from '../world/elevation.js';

export interface IsoProjection {
  readonly tileW: number;
  readonly tileH: number;
  readonly heightScale: number;
  readonly originX: number;
  readonly originY: number;
}

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

const VIEWPORT_FILL = 0.94;
const PEAK_HEIGHT_IN_TILES = 2.5;
const PICK_STEP = 0.25;
const PICK_REFINE_STEPS = 8;

export function fitIso(cols: number, rows: number, width: number, height: number): IsoProjection {
  const span = cols + rows;
  const tileW = Math.min(
    (VIEWPORT_FILL * width * 2) / span,
    (VIEWPORT_FILL * height) / (span / 4 + PEAK_HEIGHT_IN_TILES),
  );
  const tileH = tileW / 2;
  const heightScale = (tileW * PEAK_HEIGHT_IN_TILES) / MAX_HEIGHT;
  return {
    tileW,
    tileH,
    heightScale,
    originX: width / 2 - ((cols - rows) * tileW) / 4,
    originY: (height - (span * tileH) / 2 + MAX_HEIGHT * heightScale) / 2,
  };
}

export function project(projection: IsoProjection, u: number, v: number, h: number): ScreenPoint {
  return {
    x: projection.originX + ((u - v) * projection.tileW) / 2,
    y: projection.originY + ((u + v) * projection.tileH) / 2 - h * projection.heightScale,
  };
}

export function cornerHeights(height: Uint8Array, cols: number, rows: number): Float32Array {
  const corners = new Float32Array((cols + 1) * (rows + 1));
  for (let cv = 0; cv <= rows; cv++) {
    for (let cu = 0; cu <= cols; cu++) {
      let sum = 0;
      let count = 0;
      for (let se = cv - 1; se <= cv; se++) {
        for (let ne = cu - 1; ne <= cu; ne++) {
          if (ne >= 0 && se >= 0 && ne < cols && se < rows) {
            sum += height[ne + se * cols]!;
            count++;
          }
        }
      }
      corners[cu + cv * (cols + 1)] = sum / count;
    }
  }
  return corners;
}

export function surfaceHeight(corners: Float32Array, cols: number, rows: number, u: number, v: number): number {
  const cu = Math.min(Math.max(Math.floor(u), 0), cols - 1);
  const cv = Math.min(Math.max(Math.floor(v), 0), rows - 1);
  const fu = Math.min(Math.max(u - cu, 0), 1);
  const fv = Math.min(Math.max(v - cv, 0), 1);
  const stride = cols + 1;
  const top = corners[cu + cv * stride]! * (1 - fu) + corners[cu + 1 + cv * stride]! * fu;
  const bottom = corners[cu + (cv + 1) * stride]! * (1 - fu) + corners[cu + 1 + (cv + 1) * stride]! * fu;
  return top * (1 - fv) + bottom * fv;
}

export function pickSurface(
  projection: IsoProjection,
  corners: Float32Array,
  cols: number,
  rows: number,
  screen: ScreenPoint,
): { u: number; v: number } | null {
  const difference = (2 * (screen.x - projection.originX)) / projection.tileW;
  const groundSum = (2 * (screen.y - projection.originY)) / projection.tileH;
  const peakSum = groundSum + (2 * MAX_HEIGHT * projection.heightScale) / projection.tileH;
  const covers = (sum: number) => {
    const u = (sum + difference) / 2;
    const v = (sum - difference) / 2;
    if (u < 0 || v < 0 || u >= cols || v >= rows) {
      return false;
    }
    return project(projection, u, v, surfaceHeight(corners, cols, rows, u, v)).y <= screen.y;
  };

  for (let sum = Math.min(peakSum, cols + rows); sum >= groundSum - PICK_STEP; sum -= PICK_STEP) {
    if (!covers(sum)) {
      continue;
    }
    let hit = sum;
    let miss = sum + PICK_STEP;
    for (let i = 0; i < PICK_REFINE_STEPS; i++) {
      const middle = (hit + miss) / 2;
      if (covers(middle)) {
        hit = middle;
      } else {
        miss = middle;
      }
    }
    return { u: (hit + difference) / 2, v: (hit - difference) / 2 };
  }
  return null;
}
