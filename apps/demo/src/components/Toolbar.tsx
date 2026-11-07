import type { LucideIcon } from 'lucide-react';
import { Activity, BrickWall, Dices, Eye, Info, RotateCcw, Route } from 'lucide-react';
import { MODES, type Mode } from '../theme.js';

interface ToolbarButtonProps {
  active?: boolean
  icon: LucideIcon
  label: string
  onClick: () => void
}

function ToolbarButton({ active = false, icon: Icon, label, onClick }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex w-full flex-col items-center gap-1.5 rounded-lg border px-1 py-2.5 transition-colors duration-150 ${
        active ? 'border-border-strong bg-panel text-fg' : 'border-transparent text-muted hover:bg-panel/60 hover:text-fg'
      }`}
    >
      <Icon size={18} strokeWidth={1.75} />
      <span className="font-mono text-[11px]">{label}</span>
    </button>
  );
}

function ToolbarSectionTitle({ label, mt }: { label: string, mt?: boolean }) {
  return <div className={`${mt ? 'my-2' : 'mb-2'} pb-2 border-b border-divider text-center font-mono text-[10px] text-section tracking-[0.08em]`}>{label}</div>;
}

interface ToolbarProps {
  mode: Mode
  onMode: (mode: Mode) => void
  showFlow: boolean
  onShowFlow: (show: boolean) => void
  showTraces: boolean
  onShowTraces: (show: boolean) => void
  showPerf: boolean
  onShowPerf: (show: boolean) => void
  showLegend: boolean
  onShowLegend: (show: boolean) => void
  onReset: () => void
  mazeActive: boolean
  onToggleLabyrinth: () => void
  onScatterWalls: () => void
  mobCount: number
  obstacleCount: number
}

export function Toolbar({
  mode,
  onMode,
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
  mobCount,
  obstacleCount,
}: ToolbarProps) {
  return (
    <div className="flex w-21 shrink-0 flex-col gap-1.5 border-r border-border bg-bg px-2 py-4 overflow-y-scroll">
      <ToolbarSectionTitle label="Objects" />

      <div role="radiogroup" aria-label="Mode">
        {MODES.filter(m => m.type !== 'obstacle').map(m => (
          <ToolbarButton key={m.id} active={mode === m.id} icon={m.icon} label={m.label} onClick={() => onMode(m.id)} />
        ))}

        <ToolbarSectionTitle label="Obstacles" mt={true} />

        {MODES.filter(m => m.type === 'obstacle').map(m => (
          <ToolbarButton key={m.id} active={mode === m.id} icon={m.icon} label={m.label} onClick={() => onMode(m.id)} />
        ))}
      </div>
      <ToolbarButton active={mazeActive} icon={Dices} label="Maze" onClick={onToggleLabyrinth} />

      <div className="flex-1" />

      <ToolbarSectionTitle label="View" />

      <ToolbarButton active={showFlow} icon={Eye} label="Flow" onClick={() => onShowFlow(!showFlow)} />
      <ToolbarButton active={showTraces} icon={Route} label="Traces" onClick={() => onShowTraces(!showTraces)} />
      <ToolbarButton active={showPerf} icon={Activity} label="Perf" onClick={() => onShowPerf(!showPerf)} />
      <ToolbarButton active={showLegend} icon={Info} label="Legend" onClick={() => onShowLegend(!showLegend)} />
      <ToolbarButton icon={BrickWall} label="Scatter" onClick={onScatterWalls} />
      <ToolbarButton icon={RotateCcw} label="Reset" onClick={onReset} />

      <ToolbarSectionTitle label="Stats" mt={true} />
      <div className="pl-2 font-mono text-[11px] leading-[1.8] text-muted" aria-live="polite">
        <div>
          {mobCount}
          {' '}
          Mobs
        </div>
        <div>
          {obstacleCount}
          {' '}
          Obst.
        </div>
      </div>
    </div>
  );
}
