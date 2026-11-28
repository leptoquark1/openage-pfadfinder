import { ChevronDown, ChevronRight, GripHorizontal, Pause, Play, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { type PointerEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  type CrowdGroup,
  type CrowdScene,
  GROUP_RANGES,
  type GroupConfig,
  SCENE_SPEEDS,
  type ScenePhase,
} from '../world/scene.js';

interface ScenePanelProps {
  scene: CrowdScene;
}

/** Refresh rate of the live numbers (time, arrivals). */
const REFRESH_MS = 200;

interface Snapshot {
  readonly phase: ScenePhase;
  readonly time: number;
  readonly speed: number;
  readonly status: string;
  readonly groups: readonly CrowdGroup[];
  readonly selected: number;
  readonly pending: boolean;
}

function snapshotOf(scene: CrowdScene): Snapshot {
  return {
    phase: scene.getPhase(),
    time: scene.getSimTime(),
    speed: scene.getSpeed(),
    status: scene.statusText(),
    groups: scene.getGroups(),
    selected: scene.getSelectedGroup(),
    pending: scene.hasPendingChanges(),
  };
}

/**
 * HUD of the crowd simulation: run controls (start, pause, restart, speed),
 * the groups with their progress, and the settings of the selected group.
 * Start and goal of the selected group are placed with the Start and Goal
 * tools on the map.
 */
export function ScenePanel({ scene }: ScenePanelProps) {
  const [snap, setSnap] = useState<Snapshot>(() => snapshotOf(scene));
  const [editorOpen, setEditorOpen] = useState(true);
  const { panelRef, position, onDragStart } = useDraggable();
  const refresh = useCallback(() => setSnap(snapshotOf(scene)), [scene]);

  useEffect(() => {
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const act = (fn: () => void) => () => {
    fn();
    refresh();
  };

  const selected = snap.groups.find(g => g.id === snap.selected) ?? null;
  const running = snap.phase === 'running';
  const playLabel = snap.phase === 'setup' ? 'Start' : running ? 'Pause' : 'Resume';
  const onPlay = act(() => {
    if (snap.phase === 'setup') {
      scene.start();
    } else if (running) {
      scene.pause();
    } else if (snap.phase === 'paused') {
      scene.resume();
    }
  });

  return (
    <section
      ref={panelRef}
      aria-label="Crowd simulation"
      // left edge, vertically centered, until dragged elsewhere
      className={`absolute flex max-h-[calc(100%-1.75rem)] w-72 flex-col gap-2.5 overflow-y-auto rounded-lg border border-border bg-panel/85 px-3 py-2 font-mono text-[11px] text-muted backdrop-blur-sm scrollbar-subtle ${
        position ? '' : 'top-1/2 left-3.5 -translate-y-1/2'
      }`}
      style={position ? { left: position.x, top: position.y } : undefined}
    >
      <div
        onPointerDown={onDragStart}
        className="flex cursor-grab touch-none items-center justify-between border-b border-divider pb-1 tracking-[0.08em] text-[10px] text-section select-none active:cursor-grabbing"
        title="Drag to move"
      >
        CROWD SIMULATION
        <GripHorizontal size={13} />
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onPlay}
          disabled={snap.phase === 'ended' || (snap.phase === 'setup' && snap.groups.every(g => g.total === 0))}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border-strong bg-bg px-2 py-1.5 text-fg disabled:opacity-40"
        >
          {running ? <Pause size={14} /> : <Play size={14} />}
          {playLabel}
        </button>
        <button
          type="button"
          onClick={act(() => scene.restart())}
          className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 ${
            snap.pending
              ? 'border-secondary bg-secondary/15 text-secondary hover:bg-secondary/25'
              : 'border-border hover:text-fg'
          }`}
          title={
            snap.pending
              ? 'Restart with the changed groups: size, start, speed and delay'
              : 'Every group back to its start, then run again'
          }
        >
          <RotateCcw size={14} />
          {snap.pending ? 'Apply changes' : 'Restart'}
        </button>
      </div>

      <div className="flex items-center justify-between">
        <span>Speed</span>
        <div role="radiogroup" aria-label="Simulation speed" className="flex rounded-md border border-border p-0.5">
          {SCENE_SPEEDS.map(speed => (
            <button
              key={speed}
              type="button"
              aria-pressed={snap.speed === speed}
              onClick={act(() => scene.setSpeed(speed))}
              className={`rounded px-1.5 py-0.5 ${snap.speed === speed ? 'bg-bg text-fg' : 'hover:text-fg'}`}
            >
              {speed}×
            </button>
          ))}
        </div>
      </div>

      {snap.status && (
        <div className="rounded-md border border-border px-2 py-1.5 text-fg" aria-live="polite">
          {snap.status}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border pt-2">
        <span className="tracking-[0.08em] text-[10px] text-section">GROUPS</span>
        <span className="flex gap-1">
          <button
            type="button"
            onClick={act(() => scene.applyTemplate('crossing'))}
            className="rounded px-1 hover:text-fg"
            title="Four groups crossing from corner to opposite corner"
          >
            Crossing
          </button>
          <button
            type="button"
            onClick={act(() => scene.addGroup())}
            className="rounded px-1 hover:text-fg"
            aria-label="Add group"
            title="Add group"
          >
            <Plus size={13} />
          </button>
        </span>
      </div>

      <ul className="flex flex-col gap-0.5">
        {snap.groups.map(group => (
          <li key={group.id}>
            <button
              type="button"
              onClick={act(() => scene.selectGroup(group.id))}
              aria-pressed={group.id === snap.selected}
              className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left ${
                group.id === snap.selected ? 'bg-bg text-fg' : 'hover:text-fg'
              }`}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: group.color }} />
              <span className="flex-1 truncate">{group.name}</span>
              <span>
                {group.arrived}/{group.total}
              </span>
              <span className="w-12 text-right text-[10px]">
                {group.finishedAt !== null
                  ? `${group.finishedAt.toFixed(1)} s`
                  : group.stuck > 0
                    ? `${group.stuck} stuck`
                    : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {selected && (
        <GroupEditor
          key={selected.id}
          scene={scene}
          group={selected}
          open={editorOpen}
          onToggle={() => setEditorOpen(!editorOpen)}
          onChange={refresh}
        />
      )}
    </section>
  );
}

function GroupEditor({
  scene,
  group,
  open,
  onToggle,
  onChange,
}: {
  scene: CrowdScene;
  group: CrowdGroup;
  open: boolean;
  onToggle: () => void;
  onChange: () => void;
}) {
  const update = (patch: Partial<GroupConfig>) => {
    scene.updateGroup(group.id, patch);
    onChange();
  };
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={open ? 'Collapse group settings' : 'Expand group settings'}
          className="rounded p-0.5 hover:text-fg"
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: group.color }} />
        <input
          aria-label="Group name"
          className="min-w-0 flex-1 rounded border border-border bg-bg px-1.5 py-0.5 text-fg"
          value={group.name}
          onChange={e => update({ name: e.target.value })}
        />
        <button
          type="button"
          onClick={() => {
            scene.removeGroup(group.id);
            onChange();
          }}
          className="rounded p-1 hover:text-fg"
          aria-label="Remove group"
          title="Remove group"
        >
          <Trash2 size={13} />
        </button>
      </div>
      {open && (
        <>
          <div className="text-[10px]">
            Start ({group.start.ne}, {group.start.se}) → Goal ({group.goal.ne}, {group.goal.se}) — place with the Start
            and Goal tools
          </div>
          <Slider
            label="Mobs"
            value={group.count}
            range={GROUP_RANGES.count}
            format={v => `${v}`}
            onChange={count => update({ count })}
          />
          <Slider
            label="Speed"
            value={group.speed}
            range={GROUP_RANGES.speed}
            format={v => `${v.toFixed(1)} cells/s`}
            onChange={speed => update({ speed })}
          />
          <Slider
            label="Speed spread"
            value={group.speedVariance}
            range={GROUP_RANGES.speedVariance}
            format={v => `±${Math.round(v * 100)} %`}
            onChange={speedVariance => update({ speedVariance })}
          />
          <Slider
            label="Start delay"
            value={group.delay}
            range={GROUP_RANGES.delay}
            format={v => `${v.toFixed(1)} s`}
            onChange={delay => update({ delay })}
          />
        </>
      )}
    </div>
  );
}

function Slider({
  label,
  value,
  range,
  format,
  onChange,
}: {
  label: string;
  value: number;
  range: { readonly min: number; readonly max: number; readonly step: number };
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-0.5">
      <label htmlFor={id} className="flex justify-between">
        <span>{label}</span>
        <span className="text-fg">{format(value)}</span>
      </label>
      <input
        id={id}
        type="range"
        className="w-full accent-current"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
      />
    </div>
  );
}

/**
 * Drag a panel by a handle within its positioned parent. Until the first
 * drag the panel keeps its CSS position; then it sits at the dragged
 * place, kept inside the parent.
 */
function useDraggable() {
  const panelRef = useRef<HTMLElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);

  const onDragStart = useCallback((e: PointerEvent<HTMLElement>) => {
    const panel = panelRef.current;
    const parent = panel?.offsetParent;
    if (!panel || !(parent instanceof HTMLElement) || e.button !== 0) {
      return;
    }
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const panelRect = panel.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    const grabX = e.clientX - panelRect.left;
    const grabY = e.clientY - panelRect.top;
    const move = (ev: globalThis.PointerEvent) => {
      const maxX = parentRect.width - panelRect.width;
      const maxY = parentRect.height - panelRect.height;
      setPosition({
        x: Math.min(Math.max(0, ev.clientX - parentRect.left - grabX), Math.max(0, maxX)),
        y: Math.min(Math.max(0, ev.clientY - parentRect.top - grabY), Math.max(0, maxY)),
      });
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }, []);

  return { panelRef, position, onDragStart };
}
