import { MODES, type Mode } from '../theme.js';

interface StatusBadgeProps {
  mode: Mode
  /** Secondary line, e.g. a hint that mobs are stuck. Hidden when empty. */
  status: string
}

export function StatusBadge({ mode, status }: StatusBadgeProps) {
  const current = MODES.find(m => m.id === mode);
  return (
    <div
      className="absolute top-3.5 right-3.5 rounded-lg border border-border bg-panel/85 px-3 py-2 font-mono text-xs text-muted backdrop-blur-sm"
      aria-live="polite"
    >
      <div>
        Mode:
        {' '}
        <span className="text-fg">{current?.label}</span>
      </div>
      {status && <div className="mt-1 text-[11px] text-obstacle">{status}</div>}
    </div>
  );
}
