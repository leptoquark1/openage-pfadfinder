import { MODES, type Mode } from '../theme.js';

interface StatusBadgeProps {
  mode: Mode;
  /** Secondary line, e.g. a hint that mobs are stuck. Hidden when empty. */
  status: string;
  /** Label for the mode instead of its default one, e.g. "Goal" in the crowd scene. */
  modeLabel?: string;
}

export function StatusBadge({ mode, status, modeLabel }: StatusBadgeProps) {
  const current = MODES.find(m => m.id === mode);
  return (
    <div
      className="absolute top-3.5 right-3.5 rounded-lg border border-border bg-panel/85 px-3 py-2 font-mono text-xs text-muted backdrop-blur-sm"
      aria-live="polite"
    >
      <div>
        Mode: <span className="text-fg">{modeLabel ?? current?.label}</span>
        {current?.cost !== undefined && <span> · cost {current.cost}</span>}
      </div>
      {status && <div className="mt-1 text-[11px] text-obstacle">{status}</div>}
    </div>
  );
}
