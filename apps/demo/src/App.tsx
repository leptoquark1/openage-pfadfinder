import { useCallback, useMemo, useRef, useState } from 'react';
import { ConfirmDialog } from './components/ConfirmDialog.js';
import { PathfinderCanvas } from './components/PathfinderCanvas.js';
import { type Scene, Toolbar } from './components/Toolbar.js';
import { WelcomeDialog } from './components/WelcomeDialog.js';
import { isUnseen, markSeen, WELCOME_KEY } from './seen.js';
import type { Mode } from './theme.js';
import { CrowdScene } from './world/scene.js';
import { World, type WorldStats } from './world/world.js';

const EMPTY_STATS: WorldStats = { mobs: 0, obstacles: 0, blocked: 0, hasTarget: false };

export function App() {
  // Two maps, each with its own world: switching keeps both as they are.
  const sandbox = useMemo(() => new World(), []);
  const crowds = useMemo(() => new CrowdScene(), []);
  const [scene, setScene] = useState<Scene>('sandbox');
  const world = scene === 'crowds' ? crowds : sandbox;
  const [mode, setMode] = useState<Mode>('target');
  // Last mode other than "target" — active again once a target has been placed.
  const lastDrawMode = useRef<Exclude<Mode, 'target'>>('obstacle');
  const [showFlow, setShowFlow] = useState(true);
  const [showTraces, setShowTraces] = useState(true);
  const [showPerf, setShowPerf] = useState(false);
  const [showCrowd, setShowCrowd] = useState(false);
  const [showLegend, setShowLegend] = useState(true);
  const [mazeActive, setMazeActive] = useState(false);
  // Obstacles the labyrinth would remove, while its confirmation is open.
  const [mazeConfirm, setMazeConfirm] = useState<{ walls: number; moving: number } | null>(null);
  const [stats, setStats] = useState<WorldStats>(EMPTY_STATS);
  const [showWelcome, setShowWelcome] = useState(() => isUnseen(WELCOME_KEY));

  const handleWelcomeDone = useCallback(() => {
    markSeen(WELCOME_KEY);
    setShowWelcome(false);
  }, []);

  const handleMode = useCallback(
    (next: Mode) => {
      // Leaving patrol mode abandons a half-placed route.
      if (mode === 'patrolObstacle' && next !== 'patrolObstacle') {
        world.cancelPatrolAnchor();
      }
      if (next !== 'target') {
        lastDrawMode.current = next;
      }
      setMode(next);
    },
    [mode, world],
  );

  const handleTargetPlaced = useCallback(() => {
    // the playground's single target is placed once; group goals are moved again and again
    if (scene === 'sandbox') {
      setMode(lastDrawMode.current);
    }
  }, [scene]);

  const handleScene = useCallback(
    (next: Scene) => {
      world.cancelPatrolAnchor();
      setScene(next);
      setMazeActive((next === 'crowds' ? crowds : sandbox).hasLabyrinth());
      setStats(EMPTY_STATS);
      if (next === 'crowds' && mode === 'mob') {
        setMode('start');
      }
      if (next === 'sandbox' && mode === 'start') {
        setMode('target');
      }
    },
    [world, crowds, sandbox, mode],
  );

  const handleReset = useCallback(() => {
    world.reset();
    setMazeActive(false);
    setStats(EMPTY_STATS);
    if (scene === 'sandbox') {
      setMode('target');
    }
  }, [world, scene]);

  const generateLabyrinth = useCallback(() => {
    world.generateLabyrinth();
    // The world may decline to generate (too small), so read the state back.
    setMazeActive(world.hasLabyrinth());
  }, [world]);

  const handleToggleLabyrinth = useCallback(() => {
    if (world.hasLabyrinth()) {
      world.removeLabyrinth();
      setMazeActive(false);
      return;
    }
    // The labyrinth replaces every obstacle — ask first if there are any.
    const moving = world.getObstacles().length;
    const walls = world.getStats().obstacles - moving;
    if (walls + moving > 0) {
      setMazeConfirm({ walls, moving });
      return;
    }
    generateLabyrinth();
  }, [world, generateLabyrinth]);

  const handleConfirmLabyrinth = useCallback(() => {
    setMazeConfirm(null);
    generateLabyrinth();
  }, [generateLabyrinth]);

  const handleCancelLabyrinth = useCallback(() => {
    setMazeConfirm(null);
  }, []);

  const handleScatterWalls = useCallback(() => {
    world.scatterWallsAroundTarget();
  }, [world]);

  const status = world instanceof CrowdScene ? world.statusText() : statusText(stats, mode);

  return (
    <div className="flex h-screen w-screen bg-bg font-sans text-fg">
      <Toolbar
        scene={scene}
        onScene={handleScene}
        mode={mode}
        onMode={handleMode}
        showFlow={showFlow}
        onShowFlow={setShowFlow}
        showTraces={showTraces}
        onShowTraces={setShowTraces}
        showPerf={showPerf}
        onShowPerf={setShowPerf}
        showLegend={showLegend}
        onShowLegend={setShowLegend}
        onReset={handleReset}
        mazeActive={mazeActive}
        onToggleLabyrinth={handleToggleLabyrinth}
        onScatterWalls={handleScatterWalls}
        showCrowd={showCrowd}
        onShowCrowd={setShowCrowd}
        mobCount={stats.mobs}
        obstacleCount={stats.obstacles}
      />
      <PathfinderCanvas
        world={world}
        mode={mode}
        showFlow={showFlow}
        showTraces={showTraces}
        showPerf={showPerf}
        showCrowd={showCrowd}
        showLegend={showLegend}
        status={status}
        onStats={setStats}
        onTargetPlaced={handleTargetPlaced}
      />
      <ConfirmDialog
        open={mazeConfirm !== null}
        title="Generate maze?"
        confirmLabel="Remove obstacles"
        onConfirm={handleConfirmLabyrinth}
        onCancel={handleCancelLabyrinth}
      >
        The maze replaces all existing obstacles: <span className="text-fg">{mazeConfirm?.walls ?? 0}</span> walls and{' '}
        <span className="text-fg">{mazeConfirm?.moving ?? 0}</span> moving obstacles will be removed. The target and
        mobs are kept.
      </ConfirmDialog>
      {showWelcome && <WelcomeDialog onDone={handleWelcomeDone} />}
    </div>
  );
}

/** Hint shown in the status badge — what the playground is currently missing. */
function statusText(stats: WorldStats, mode: Mode): string {
  if (!stats.hasTarget && (stats.mobs > 0 || mode === 'mob')) {
    return 'no target set';
  }
  if (stats.blocked > 0) {
    return `${stats.blocked} mob(s) without a path`;
  }
  return '';
}
