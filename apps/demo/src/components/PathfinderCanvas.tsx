import type { Grid } from '@leptoquark1/openage-pfadfinder';
import type { Waypoint } from '@leptoquark1/openage-pfadfinder/shared';
import { COST_IMPASSABLE, FLOW_DIR_MASK, FLOW_LOS_MASK, FLOW_PATHABLE_MASK, FlowDir } from '@leptoquark1/openage-pfadfinder/shared';
import { useEffect, useRef } from 'react';
import { COLORS, type Mode } from '../theme.js';
import { CELL_SIZE, MOB_RADIUS, type Mob, type MovingObstacle, OBSTACLE_SIZE, SECTOR_SIZE, type World, type WorldStats } from '../world/world.js';
import { Legend } from './Legend.js';
import { PerfPanel } from './PerfPanel.js';
import { RepoLink } from './RepoLink.js';
import { StatusBadge } from './StatusBadge.js';
import { TitleBar } from './TitleBar.js';

interface PathfinderCanvasProps {
  world: World
  mode: Mode
  showFlow: boolean
  showTraces: boolean
  showPerf: boolean
  showLegend: boolean
  /** Hint line for the status badge, derived from the latest stats. */
  status: string
  onStats: (stats: WorldStats) => void
  /** Called once the target has actually been placed. */
  onTargetPlaced: () => void
}

const FLOW_VECTORS: Record<number, readonly [number, number]> = {
  [FlowDir.NORTH]: [0, -1],
  [FlowDir.NORTH_EAST]: [0.7, -0.7],
  [FlowDir.EAST]: [1, 0],
  [FlowDir.SOUTH_EAST]: [0.7, 0.7],
  [FlowDir.SOUTH]: [0, 1],
  [FlowDir.SOUTH_WEST]: [-0.7, 0.7],
  [FlowDir.WEST]: [-1, 0],
  [FlowDir.NORTH_WEST]: [-0.7, -0.7],
};

/** Preview colors — green shades when the placement works, red when it does not. */
const PREVIEW_OK = '#3FBF7F';
const PREVIEW_OK_FILL = 'rgba(63, 191, 127, 0.02)';
const PREVIEW_BAD = '#E5484D';
const PREVIEW_BAD_FILL = 'rgba(229, 72, 77, 0.18)';

export function PathfinderCanvas({ world, mode, showFlow, showTraces, showPerf, showLegend, status, onStats, onTargetPlaced }: PathfinderCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // The render loop is started once; live props reach it through refs.
  const modeRef = useRef(mode);
  const showFlowRef = useRef(showFlow);
  const showTracesRef = useRef(showTraces);
  const onStatsRef = useRef(onStats);
  const onTargetPlacedRef = useRef(onTargetPlaced);
  modeRef.current = mode;
  showFlowRef.current = showFlow;
  showTracesRef.current = showTraces;
  onStatsRef.current = onStats;
  onTargetPlacedRef.current = onTargetPlaced;

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) {
      return;
    }
    const ctx = canvas.getContext('2d')!;

    let width = 0;
    let height = 0;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * devicePixelRatio);
      canvas.height = Math.round(height * devicePixelRatio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      world.resize(Math.ceil(width / CELL_SIZE), Math.ceil(height / CELL_SIZE));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    let painting = false;
    let erasing = false;
    // Last pointer position in canvas pixels; null while the pointer is off-canvas.
    let cursor: { x: number, y: number } | null = null;

    const toCanvasPos = (e: PointerEvent): { x: number, y: number } => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const handlePointer = (e: PointerEvent, isDrag: boolean) => {
      const { x, y } = toCanvasPos(e);

      // Right button erases the element the current mode places.
      if (erasing) {
        switch (modeRef.current) {
          case 'obstacle':
            world.eraseWall(x, y);
            break;
          case 'movingObstacle':
            if (!isDrag) {
              world.removeMovingObstacle(x, y);
            }
            break;
          case 'patrolObstacle':
            // A pending anchor falls first; only without one does the
            // click remove the patrol obstacle under the cursor.
            if (world.getPatrolAnchor()) {
              world.cancelPatrolAnchor();
            }
            else if (!isDrag) {
              world.removeMovingObstacle(x, y);
            }
            break;
          case 'mob':
            if (!isDrag) {
              world.removeMob(x, y);
            }
            break;
        }
        return;
      }

      switch (modeRef.current) {
        case 'target':
          if (world.setTargetAt(x, y)) {
            onTargetPlacedRef.current();
          }
          break;
        case 'mob':
          if (!isDrag) {
            world.addMob(x, y);
          }
          break;
        case 'obstacle':
          world.paintWall(x, y);
          break;
        case 'movingObstacle':
          if (!isDrag) {
            world.addMovingObstacle(x, y);
          }
          break;
        case 'patrolObstacle':
          // First click anchors endpoint A, the second spawns the obstacle.
          if (!isDrag) {
            world.addPatrolObstacle(x, y);
          }
          break;
      }
    };

    const onDown = (e: PointerEvent) => {
      // Bitmask instead of e.button: a second button pressed mid-drag
      // must not silently cancel the first button's drag mode.
      painting = (e.buttons & 1) !== 0;
      erasing = (e.buttons & 2) !== 0;
      handlePointer(e, false);
    };
    const onMove = (e: PointerEvent) => {
      cursor = toCanvasPos(e);
      if (erasing) {
        if (modeRef.current === 'obstacle') {
          handlePointer(e, true);
        }
        return;
      }
      if (painting && modeRef.current === 'obstacle') {
        handlePointer(e, true);
      }
    };
    const onUp = (e: PointerEvent) => {
      // Keep a drag alive while its button is still held.
      painting = (e.buttons & 1) !== 0;
      erasing = (e.buttons & 2) !== 0;
    };
    const onLeave = () => {
      cursor = null;
    };
    const onContextMenu = (e: Event) => e.preventDefault();

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('pointerup', onUp);
    // Touch: the OS can take over the gesture (edge swipe, notification)
    // and fire pointercancel instead of pointerup — end the drag then too.
    window.addEventListener('pointercancel', onUp);

    let raf = 0;
    let lastFrame = performance.now();
    let lastStats: WorldStats | null = null;

    const perf = world.getPerf();

    const frame = (now: number) => {
      const dt = now - lastFrame;
      lastFrame = now;
      perf.frame(dt, now);

      perf.begin('Sim');
      world.step(dt, now);
      perf.end('Sim');

      const preview = cursor ? evaluatePreview(world, modeRef.current, cursor.x, cursor.y) : null;

      perf.begin('Draw');
      draw(ctx, world, width, height, showFlowRef.current, showTracesRef.current, preview);
      perf.end('Draw');

      // Pointer over an object right-click removes, not-allowed when placing is impossible.
      canvas.style.cursor = preview?.eraseCandidate ? 'pointer' : preview && !preview.valid ? 'not-allowed' : 'none';

      const stats = world.getStats();
      if (
        !lastStats
        || stats.mobs !== lastStats.mobs
        || stats.obstacles !== lastStats.obstacles
        || stats.blocked !== lastStats.blocked
        || stats.hasTarget !== lastStats.hasTarget
      ) {
        lastStats = stats;
        onStatsRef.current(stats);
      }

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [world]);

  return (
    <div ref={containerRef} className="relative min-w-0 flex-1">
      <canvas ref={canvasRef} className="block cursor-none touch-none" />
      <TitleBar />
      <StatusBadge mode={mode} status={status} />
      {showPerf && <PerfPanel world={world} />}
      {showLegend && <Legend />}
      <RepoLink />
    </div>
  );
}

/**
 * What the mode under the cursor would do there: place its object (valid or
 * not), or right-click-remove the object underneath. Drives both the preview
 * overlay and the cursor style.
 */
interface Preview {
  readonly mode: Mode
  readonly x: number
  readonly y: number
  /** True when the mode's object can be placed at this position. */
  readonly valid: boolean
  /** Wall cell / moving obstacle / mob that right-click would remove here. */
  readonly eraseCandidate: Waypoint | MovingObstacle | Mob | null
  /** Pending patrol anchor, when the mode is mid-placement. */
  readonly patrolAnchor: { x: number, y: number } | null
}

function evaluatePreview(world: World, mode: Mode, x: number, y: number): Preview | null {
  let valid = false;
  let eraseCandidate: Preview['eraseCandidate'] = null;

  switch (mode) {
    case 'target':
      valid = world.canPlaceTarget(x, y);
      break;
    case 'mob':
      valid = world.canPlaceMob(x, y);
      eraseCandidate = world.mobAt(x, y);
      break;
    case 'obstacle':
      valid = world.canPlaceWall(x, y);
      eraseCandidate = world.wallAt(x, y);
      break;
    case 'movingObstacle':
      valid = world.canPlaceMovingObstacle(x, y);
      eraseCandidate = world.movingObstacleAt(x, y);
      break;
    case 'patrolObstacle':
      valid = world.canPlacePatrolObstacle(x, y);
      eraseCandidate = world.getPatrolAnchor() ? null : world.movingObstacleAt(x, y);
      break;
  }

  return { mode, x, y, valid, eraseCandidate, patrolAnchor: world.getPatrolAnchor() };
}

function draw(
  ctx: CanvasRenderingContext2D,
  world: World,
  width: number,
  height: number,
  showFlow: boolean,
  showTraces: boolean,
  preview: Preview | null,
): void {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, width, height);

  drawGrid(ctx, width, height);

  const grid = world.getGrid();
  if (grid) {
    drawSectorBorders(ctx, grid, width, height);
    if (showFlow) {
      drawFlowField(ctx, world, grid);
    }
  }

  drawWalls(ctx, world);
  drawObstacles(ctx, world);
  drawTarget(ctx, world);
  if (showTraces) {
    drawPatrolRoutes(ctx, world);
    drawTraces(ctx, world);
  }
  drawMobs(ctx, world);
  if (preview) {
    drawPreview(ctx, preview);
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= width; x += CELL_SIZE) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, height);
  }
  for (let y = 0; y <= height; y += CELL_SIZE) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
  }
  ctx.stroke();
}

function drawSectorBorders(ctx: CanvasRenderingContext2D, grid: Grid, width: number, height: number): void {
  const size = grid.getSize();
  const step = SECTOR_SIZE * CELL_SIZE;
  ctx.strokeStyle = COLORS.sector;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= size.width; x++) {
    ctx.moveTo(x * step + 0.5, 0);
    ctx.lineTo(x * step + 0.5, height);
  }
  for (let y = 0; y <= size.height; y++) {
    ctx.moveTo(0, y * step + 0.5);
    ctx.lineTo(width, y * step + 0.5);
  }
  ctx.stroke();
}

/** Real per-sector flow fields — one short stroke per pathable cell. */
function drawFlowField(ctx: CanvasRenderingContext2D, world: World, grid: Grid): void {
  const fields = world.getFlowFields();
  if (fields.size === 0) {
    return;
  }

  ctx.lineWidth = 1;
  for (const sector of grid.getSectors()) {
    const flow = fields.get(sector.getId());
    if (!flow) {
      continue;
    }

    const position = sector.getPosition();
    const originX = position.x * SECTOR_SIZE * CELL_SIZE;
    const originY = position.y * SECTOR_SIZE * CELL_SIZE;

    for (let y = 0; y < SECTOR_SIZE; y++) {
      for (let x = 0; x < SECTOR_SIZE; x++) {
        const cell = flow.cells[x + y * SECTOR_SIZE]!;
        if ((cell & FLOW_PATHABLE_MASK) === 0) {
          continue;
        }

        const [dx, dy] = FLOW_VECTORS[cell & FLOW_DIR_MASK] ?? [0, 0];
        const cx = originX + x * CELL_SIZE + CELL_SIZE / 2;
        const cy = originY + y * CELL_SIZE + CELL_SIZE / 2;

        // Cells with line of sight to the target get the brighter stroke.
        ctx.strokeStyle = (cell & FLOW_LOS_MASK) !== 0 ? COLORS.flowStrong : COLORS.flow;
        ctx.beginPath();
        ctx.moveTo(cx - dx * 6, cy - dy * 6);
        ctx.lineTo(cx + dx * 8, cy + dy * 8);
        ctx.stroke();
      }
    }
  }
}

function drawWalls(ctx: CanvasRenderingContext2D, world: World): void {
  const costs = world.getStaticCost();
  const cols = world.getCols();
  ctx.fillStyle = COLORS.obstacle;
  ctx.globalAlpha = 0.85;
  for (let i = 0; i < costs.length; i++) {
    if (costs[i] !== COST_IMPASSABLE) {
      continue;
    }
    const x = (i % cols) * CELL_SIZE;
    const y = Math.floor(i / cols) * CELL_SIZE;
    ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
  }
  ctx.globalAlpha = 1;
}

function drawObstacles(ctx: CanvasRenderingContext2D, world: World): void {
  ctx.fillStyle = COLORS.obstacleMoving;
  ctx.globalAlpha = 0.85;
  for (const o of world.getObstacles()) {
    ctx.fillRect(o.x - o.size / 2, o.y - o.size / 2, o.size, o.size);
  }
  ctx.globalAlpha = 1;
}

/** Routes of patrolling obstacles: thin dashed line between both endpoints. */
function drawPatrolRoutes(ctx: CanvasRenderingContext2D, world: World): void {
  ctx.strokeStyle = COLORS.obstacleMoving;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);

  for (const o of world.getObstacles()) {
    const route = o.patrol;
    if (!route) {
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(route.ax, route.ay);
    ctx.lineTo(route.bx, route.by);
    ctx.stroke();
  }

  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

function drawTarget(ctx: CanvasRenderingContext2D, world: World): void {
  const target = world.getTarget();
  if (!target) {
    return;
  }

  const cx = target.ne * CELL_SIZE + CELL_SIZE / 2;
  const cy = target.se * CELL_SIZE + CELL_SIZE / 2;
  const pulse = 6 + Math.sin(world.getElapsedMs() * 0.005) * 3;

  ctx.strokeStyle = COLORS.target;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 10 + pulse, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = COLORS.target;
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fill();
}

/** The cells each mob will pass through, traced along the flow fields. */
function drawTraces(ctx: CanvasRenderingContext2D, world: World): void {
  ctx.strokeStyle = COLORS.mob;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);

  for (const mob of world.getMobs()) {
    if (mob.trace.length < 2) {
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(mob.x, mob.y);
    for (let i = 1; i < mob.trace.length; i++) {
      const cell = mob.trace[i]!;
      ctx.lineTo(cell.ne * CELL_SIZE + CELL_SIZE / 2, cell.se * CELL_SIZE + CELL_SIZE / 2);
    }
    ctx.stroke();
  }

  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

function drawMobs(ctx: CanvasRenderingContext2D, world: World): void {
  for (const mob of world.getMobs()) {
    ctx.fillStyle = COLORS.mob;
    ctx.globalAlpha = mob.blocked ? 0.4 : 1;
    ctx.beginPath();
    ctx.arc(mob.x, mob.y, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Shape the mode would place at the cursor, tinted by placement validity. */
function drawPreview(ctx: CanvasRenderingContext2D, preview: Preview): void {
  const stroke = preview.valid ? PREVIEW_OK : PREVIEW_BAD;
  const fill = preview.valid ? PREVIEW_OK_FILL : PREVIEW_BAD_FILL;

  if (preview.eraseCandidate) {
    drawEraseHighlight(ctx, preview.eraseCandidate);
    return;
  }

  ctx.strokeStyle = stroke;
  ctx.fillStyle = fill;
  ctx.lineWidth = 2;

  switch (preview.mode) {
    case 'target':
      drawTargetPreview(ctx, preview.x, preview.y);
      break;
    case 'mob':
      drawMobPreview(ctx, preview.x, preview.y);
      break;
    case 'obstacle':
      drawWallPreview(ctx, preview.x, preview.y);
      break;
    case 'movingObstacle':
      drawMovingObstaclePreview(ctx, preview.x, preview.y);
      break;
    case 'patrolObstacle':
      drawPatrolObstaclePreview(ctx, preview.x, preview.y, preview.patrolAnchor);
      break;
  }
}

/**
 * Patrol placement preview: the pending anchor with a dashed line to the
 * cursor plus the endpoint box there — green when the second click would
 * spawn, red otherwise. Without an anchor only the endpoint box shows.
 */
function drawPatrolObstaclePreview(ctx: CanvasRenderingContext2D, x: number, y: number, anchor: { x: number, y: number } | null): void {
  if (anchor) {
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(anchor.x, anchor.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  drawMovingObstaclePreview(ctx, x, y);
}

/** Target ring preview snapped to the cell under the cursor. */
function drawTargetPreview(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const cx = Math.floor(x / CELL_SIZE) * CELL_SIZE + CELL_SIZE / 2;
  const cy = Math.floor(y / CELL_SIZE) * CELL_SIZE + CELL_SIZE / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 10, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawMobPreview(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.beginPath();
  ctx.arc(x, y, MOB_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, MOB_RADIUS - 3, 0, Math.PI * 2);
  ctx.fill();
}

function drawWallPreview(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const cx = Math.floor(x / CELL_SIZE) * CELL_SIZE;
  const cy = Math.floor(y / CELL_SIZE) * CELL_SIZE;
  ctx.fillRect(cx + 1, cy + 1, CELL_SIZE - 2, CELL_SIZE - 2);
  ctx.strokeRect(cx + 1.5, cy + 1.5, CELL_SIZE - 3, CELL_SIZE - 3);
}

function drawMovingObstaclePreview(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillRect(x - OBSTACLE_SIZE / 2, y - OBSTACLE_SIZE / 2, OBSTACLE_SIZE, OBSTACLE_SIZE);
  ctx.strokeRect(x - OBSTACLE_SIZE / 2 + 0.5, y - OBSTACLE_SIZE / 2 + 0.5, OBSTACLE_SIZE - 1, OBSTACLE_SIZE - 1);
}

/** Outline of the object right-click would remove, in red. */
function drawEraseHighlight(ctx: CanvasRenderingContext2D, candidate: Waypoint | MovingObstacle | Mob): void {
  ctx.strokeStyle = PREVIEW_BAD;
  ctx.lineWidth = 2;

  if ('ne' in candidate) {
    const cx = candidate.ne * CELL_SIZE;
    const cy = candidate.se * CELL_SIZE;
    ctx.strokeRect(cx + 1.5, cy + 1.5, CELL_SIZE - 3, CELL_SIZE - 3);
  }
  else if ('size' in candidate) {
    ctx.strokeRect(candidate.x - candidate.size / 2 + 0.5, candidate.y - candidate.size / 2 + 0.5, candidate.size - 1, candidate.size - 1);
  }
  else {
    ctx.beginPath();
    ctx.arc(candidate.x, candidate.y, MOB_RADIUS + 3, 0, Math.PI * 2);
    ctx.stroke();
  }
}
