import type { View } from '../layout.js';

const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/** Unit vector per `FlowDir`. */
const DIRECTIONS: readonly (readonly [number, number])[] = [
  [0, -1],
  [Math.SQRT1_2, -Math.SQRT1_2],
  [1, 0],
  [Math.SQRT1_2, Math.SQRT1_2],
  [0, 1],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [-1, 0],
  [-Math.SQRT1_2, -Math.SQRT1_2],
];

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export const smooth = (x: number) => x * x * (3 - 2 * x);

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const px = (v: View, ne: number) => v.ox + ne * v.s;

export const py = (v: View, se: number) => v.oy + se * v.s;

export function rgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Close to the target is warm, far away is cold. */
export function heat(t: number, alpha: number): string {
  const stops = [
    [245, 166, 35],
    [45, 163, 154],
    [39, 54, 107],
  ] as const;
  const x = clamp01(t) * 2;
  const i = Math.min(1, Math.floor(x));
  const f = x - i;
  const a = stops[i]!;
  const b = stops[i + 1]!;
  return `rgba(${Math.round(lerp(a[0], b[0], f))}, ${Math.round(lerp(a[1], b[1], f))}, ${Math.round(lerp(a[2], b[2], f))}, ${alpha})`;
}

export function text(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = 'center',
  weight = 400,
): void {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(value, x, y);
}

/** Text on a small dark plate, readable over any layer. */
export function tag(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
  color: string,
  alpha = 1,
): void {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.font = `600 ${size}px ${FONT}`;
  const w = ctx.measureText(value).width + size * 0.8;
  const h = size * 1.55;
  ctx.fillStyle = 'rgba(13, 17, 20, 0.88)';
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, size * 0.35);
  ctx.fill();
  ctx.strokeStyle = rgba(color, 0.55);
  ctx.lineWidth = 1;
  ctx.stroke();
  text(ctx, value, x, y + 0.5, size, color, 'center', 600);
  ctx.restore();
}

export function arrow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  dir: number,
  length: number,
  color: string,
  width: number,
): void {
  const [dx, dy] = DIRECTIONS[dir]!;
  const hx = cx + dx * length * 0.5;
  const hy = cy + dy * length * 0.5;
  const wing = length * 0.34;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - dx * length * 0.5, cy - dy * length * 0.5);
  ctx.lineTo(hx, hy);
  ctx.moveTo(hx - (dx - dy * 0.7) * wing, hy - (dy + dx * 0.7) * wing);
  ctx.lineTo(hx, hy);
  ctx.lineTo(hx - (dx + dy * 0.7) * wing, hy - (dy - dx * 0.7) * wing);
  ctx.stroke();
}
