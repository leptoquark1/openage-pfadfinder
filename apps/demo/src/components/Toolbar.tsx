import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BookOpen,
  Box,
  BrickWall,
  Dices,
  Eraser,
  Eye,
  Info,
  MountainSnow,
  RotateCcw,
  Route,
  Shapes,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
import { MODES, type Mode, type View } from '../theme.js';

interface ToolbarButtonProps {
  active?: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}

function ToolbarButton({ active = false, icon: Icon, label, onClick }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex w-full flex-col items-center gap-1.5 rounded-lg border px-1 py-2.5 transition-colors duration-150 ${
        active
          ? 'border-border-strong bg-panel text-fg'
          : 'border-transparent text-muted hover:bg-panel/60 hover:text-fg'
      }`}
    >
      <Icon size={18} strokeWidth={1.75} />
      <span className="font-mono text-[11px]">{label}</span>
    </button>
  );
}

function ToolbarSectionTitle({ label, mt }: { label: string; mt?: boolean }) {
  return (
    <div
      className={`${mt ? 'my-2' : 'mb-2'} pb-2 border-b border-divider text-center font-mono text-[10px] text-section tracking-[0.08em]`}
    >
      {label}
    </div>
  );
}

/** The two maps of the demo: the free playground and the crowd simulation. */
export type Scene = 'sandbox' | 'crowds';

interface ToolbarProps {
  scene: Scene;
  onScene: (scene: Scene) => void;
  mode: Mode;
  onMode: (mode: Mode) => void;
  view: View;
  onView: (view: View) => void;
  onGenerateHills: () => void;
  onFlattenGround: () => void;
  showFlow: boolean;
  onShowFlow: (show: boolean) => void;
  showTraces: boolean;
  onShowTraces: (show: boolean) => void;
  showPerf: boolean;
  onShowPerf: (show: boolean) => void;
  showLegend: boolean;
  onShowLegend: (show: boolean) => void;
  onReset: () => void;
  mazeActive: boolean;
  onToggleLabyrinth: () => void;
  onScatterWalls: () => void;
  showCrowd: boolean;
  onShowCrowd: (show: boolean) => void;
  mobCount: number;
  obstacleCount: number;
}

export function Toolbar({
  scene,
  onScene,
  mode,
  onMode,
  view,
  onView,
  onGenerateHills,
  onFlattenGround,
  showFlow,
  onShowFlow,
  showTraces,
  onShowTraces,
  showPerf,
  onShowPerf,
  showLegend,
  onShowLegend,
  onReset,
  mazeActive,
  onToggleLabyrinth,
  onScatterWalls,
  showCrowd,
  onShowCrowd,
  mobCount,
  obstacleCount,
}: ToolbarProps) {
  return (
    <div className="flex w-21 shrink-0 flex-col gap-1.5 border-r border-border bg-bg px-2 py-4 overflow-y-auto scrollbar-subtle">
      <ToolbarSectionTitle label="Scene" />

      <div role="radiogroup" aria-label="Scene">
        <ToolbarButton active={scene === 'sandbox'} icon={Shapes} label="Sandbox" onClick={() => onScene('sandbox')} />
        <ToolbarButton active={scene === 'crowds'} icon={Users} label="Crowds" onClick={() => onScene('crowds')} />
      </div>

      <ToolbarSectionTitle label="Objects" mt={true} />

      <div role="radiogroup" aria-label="Mode">
        {MODES.filter(
          m =>
            (m.type === 'target' || m.type === 'spawn') &&
            // start only in the crowd scene; there mobs come from the groups
            (scene === 'crowds' ? m.id !== 'mob' : m.id !== 'start'),
        ).map(m => (
          <ToolbarButton
            key={m.id}
            active={mode === m.id}
            icon={m.icon}
            // in the crowd scene the target is the selected group's goal
            label={scene === 'crowds' && m.id === 'target' ? 'Goal' : m.label}
            onClick={() => onMode(m.id)}
          />
        ))}

        <ToolbarSectionTitle label="Obstacles" mt={true} />

        {MODES.filter(m => m.type === 'obstacle').map(m => (
          <ToolbarButton key={m.id} active={mode === m.id} icon={m.icon} label={m.label} onClick={() => onMode(m.id)} />
        ))}
      </div>
      <ToolbarButton active={mazeActive} icon={Dices} label="Maze" onClick={onToggleLabyrinth} />

      <ToolbarSectionTitle label="Terrain" mt={true} />

      <div role="radiogroup" aria-label="Terrain">
        {MODES.filter(m => m.type === 'terrain').map(m => (
          <ToolbarButton
            key={m.id}
            active={mode === m.id}
            icon={m.icon}
            label={`${m.label} ${m.cost}`}
            onClick={() => onMode(m.id)}
          />
        ))}
      </div>

      <ToolbarSectionTitle label="Elevation" mt={true} />

      <div role="radiogroup" aria-label="Elevation">
        {MODES.filter(m => m.type === 'elevation').map(m => (
          <ToolbarButton key={m.id} active={mode === m.id} icon={m.icon} label={m.label} onClick={() => onMode(m.id)} />
        ))}
      </div>
      <ToolbarButton icon={MountainSnow} label="Hills" onClick={onGenerateHills} />
      <ToolbarButton icon={Eraser} label="Flatten" onClick={onFlattenGround} />

      <div className="flex-1" />

      <ToolbarSectionTitle label="View" />

      <ToolbarButton
        active={view === 'iso'}
        icon={Box}
        label="3D"
        onClick={() => onView(view === 'iso' ? 'top' : 'iso')}
      />
      <ToolbarButton active={showFlow} icon={Eye} label="Flow" onClick={() => onShowFlow(!showFlow)} />
      <ToolbarButton active={showTraces} icon={Route} label="Traces" onClick={() => onShowTraces(!showTraces)} />
      <ToolbarButton
        active={showCrowd}
        icon={SlidersHorizontal}
        label="Tuning"
        onClick={() => onShowCrowd(!showCrowd)}
      />
      <ToolbarButton active={showPerf} icon={Activity} label="Perf" onClick={() => onShowPerf(!showPerf)} />
      <ToolbarButton active={showLegend} icon={Info} label="Legend" onClick={() => onShowLegend(!showLegend)} />
      <ToolbarButton icon={BrickWall} label="Scatter" onClick={onScatterWalls} />
      <ToolbarButton icon={RotateCcw} label="Reset" onClick={onReset} />
      <a
        href={`${import.meta.env.BASE_URL}guide.html`}
        className="flex w-full flex-col items-center gap-1.5 rounded-lg border border-transparent px-1 py-2.5 text-muted transition-colors duration-150 hover:bg-panel/60 hover:text-fg"
      >
        <BookOpen size={18} strokeWidth={1.75} />
        <span className="font-mono text-[11px]">Guide</span>
      </a>

      <ToolbarSectionTitle label="Stats" mt={true} />
      <div className="pl-2 font-mono text-[11px] leading-[1.8] text-muted" aria-live="polite">
        <div>{mobCount} Mobs</div>
        <div>{obstacleCount} Obst.</div>
      </div>
    </div>
  );
}
